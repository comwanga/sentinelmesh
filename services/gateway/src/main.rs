mod config;
mod db;
mod error;
mod maps;
mod middleware;
mod nudge;
mod reports;
mod routes;
mod subscribers;
mod trust;
mod ws;

use axum::http::{HeaderName, Method};
use axum::{extract::State, http::StatusCode, response::Json, routing::get, Router};
use governor::{DefaultKeyedRateLimiter, Quota, RateLimiter};
use std::num::NonZeroU32;
use std::sync::{atomic::AtomicBool, Arc};
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tower_governor::{governor::GovernorConfigBuilder, GovernorLayer};
use tower_http::cors::{Any, CorsLayer};
use ws::{circle_hub::CircleHub, hub::WsHub};

const ACOUSTIC_RATE_LIMIT_PER_MINUTE: u32 = 5;

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::PgPool,
    pub reputation_db: sqlx::PgPool,
    pub config: Arc<config::Config>,
    pub http_client: reqwest::Client,
    pub hub: Arc<WsHub>,
    pub circle_hub: Arc<CircleHub>,
    pub redis_healthy: Arc<AtomicBool>,
    pub map_provider: std::sync::Arc<dyn maps::MapProvider>,
    pub acoustic_limiter: Arc<DefaultKeyedRateLimiter<String>>,
    pub event_tx: Arc<broadcast::Sender<ws::ViewportEvent>>,
    pub redis: redis::aio::ConnectionManager,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let config = Arc::new(config::Config::from_env()?);
    let db = db::create_pool(&config.database_url, config.max_db_connections).await?;
    let reputation_db = db::create_reputation_pool(&config.database_url).await?;
    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;
    let hub = Arc::new(WsHub::new());
    let circle_hub = Arc::new(CircleHub::new());
    let redis_healthy = Arc::new(AtomicBool::new(false));

    let map_provider: std::sync::Arc<dyn maps::MapProvider> =
        std::sync::Arc::new(maps::MapboxAdapter::new(
            http_client.clone(),
            config.mapbox_token.clone().unwrap_or_default(),
        ));

    let acoustic_limiter: Arc<DefaultKeyedRateLimiter<String>> = Arc::new(RateLimiter::keyed(
        Quota::per_minute(NonZeroU32::new(ACOUSTIC_RATE_LIMIT_PER_MINUTE).unwrap()),
    ));

    // Capacity 512: allows slow viewport-WS clients up to 512 events of lag
    // before Lagged errors force them into snapshot mode.
    let (event_tx_inner, _) = broadcast::channel::<ws::ViewportEvent>(512);
    let event_tx = Arc::new(event_tx_inner);

    let redis_client = redis::Client::open(config.redis_url.as_str()).expect("invalid REDIS_URL");
    let redis = redis::aio::ConnectionManager::new(redis_client)
        .await
        .expect("failed to connect to Redis — check REDIS_URL");

    if let Err(e) = backfill_report_cells(&db).await {
        tracing::warn!("report cell backfill failed: {e:#}");
    }

    let state = AppState {
        db: db.clone(),
        reputation_db: reputation_db.clone(),
        config: config.clone(),
        http_client,
        hub: hub.clone(),
        circle_hub,
        redis_healthy: redis_healthy.clone(),
        map_provider,
        acoustic_limiter,
        event_tx: event_tx.clone(),
        redis,
    };

    // Spawn Redis subscriber task (supervised, runs for the lifetime of the process)
    {
        let redis_url = config.redis_url.clone();
        let pool = db.clone();
        let hub_ref = hub.clone();
        let healthy = redis_healthy.clone();
        let tx = event_tx.clone();
        tokio::spawn(async move {
            subscribers::event_subscriber::run(redis_url, pool, hub_ref, healthy, tx).await;
        });
    }

    // Spawn synthesis worker (ticks every 5s, clusters acoustic signals into public_events)
    {
        let pool_synth = db.clone();
        let synthesis_enabled = config.synthesis_enabled;
        let confirm_enabled = config.acoustic_confirm_enabled;
        let tx_synth = event_tx.clone();
        tokio::spawn(async move {
            subscribers::synthesis_worker::run(
                pool_synth,
                synthesis_enabled,
                confirm_enabled,
                tx_synth,
            )
            .await;
        });
    }

    // Spawn NLP trust-ladder synthesis worker (promotes heuristic->corroborating
    // ->confirmed from staged nlp_signals, expires stale detections, and fires
    // push only on the confirm transition). H-5 Phase 2B-ii.
    {
        let pool_nlp = db.clone();
        let nlp_enabled = config.nlp_synthesis_enabled;
        let push = subscribers::nlp_synthesis_worker::PushConfig {
            vapid_private_key: config.vapid_private_key.clone(),
            vapid_subject: config.vapid_subject.clone(),
        };
        let tx_nlp = event_tx.clone();
        tokio::spawn(async move {
            subscribers::nlp_synthesis_worker::run(pool_nlp, nlp_enabled, push, tx_nlp).await;
        });
    }

    // Spawn retention worker (acoustic coordinate degradation + event expiry).
    // Always on — it is a privacy/safety hygiene control (audit AC-5, AC-7).
    {
        let pool_ret = db.clone();
        tokio::spawn(async move {
            subscribers::retention_worker::run(pool_ret).await;
        });
    }

    // CORS: allow any origin (public-read API — safety events, community reports)
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_headers([
            HeaderName::from_static("content-type"),
            HeaderName::from_static("authorization"),
        ]);

    // Rate limiting: 100 req/s per IP, burst of 50
    let governor_conf = Arc::new(
        GovernorConfigBuilder::default()
            .per_second(100)
            .burst_size(50)
            .finish()
            .expect("invalid governor config"),
    );

    let app = Router::new()
        .route("/health", get(health))
        .route("/health/detailed", get(health_detailed))
        .route("/ws", get(ws::ws_handler))
        .route("/ws/circles", get(ws::ws_circles_handler))
        .route("/ws/events", get(ws::ws_events_handler))
        .merge(routes::build_router())
        .layer(GovernorLayer {
            config: governor_conf,
        })
        .layer(cors)
        .with_state(state);

    let addr = format!("0.0.0.0:{}", config.port);
    let listener = TcpListener::bind(&addr).await?;
    tracing::info!("gateway listening on {addr}");

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;

    Ok(())
}

async fn health() -> (StatusCode, Json<serde_json::Value>) {
    let ts = chrono::Utc::now().to_rfc3339();
    (
        StatusCode::OK,
        Json(serde_json::json!({ "ok": true, "service": "gateway", "ts": ts })),
    )
}

async fn health_detailed(State(state): State<AppState>) -> Json<serde_json::Value> {
    let redis_ok = state
        .redis_healthy
        .load(std::sync::atomic::Ordering::Relaxed);
    let ts = chrono::Utc::now().to_rfc3339();
    Json(serde_json::json!({ "ok": true, "service": "gateway", "ts": ts, "redis": redis_ok }))
}

/// One-shot: snap any pre-C-2 community_reports rows (h3_r9 IS NULL) to their r9
/// centroid, coarsening their stored lat/lng in place. Idempotent and a no-op on
/// a fresh database.
async fn backfill_report_cells(pool: &sqlx::PgPool) -> anyhow::Result<()> {
    let rows: Vec<(uuid::Uuid, f64, f64)> =
        sqlx::query_as("SELECT id, lat::float8, lng::float8 FROM community_reports WHERE h3_r9 IS NULL")
            .fetch_all(pool)
            .await?;
    for (id, lat, lng) in rows {
        let (cell, clat, clng) = reports::geo::snap_to_r9(lat, lng);
        sqlx::query("UPDATE community_reports SET h3_r9 = $2, lat = $3, lng = $4 WHERE id = $1")
            .bind(id)
            .bind(&cell)
            .bind(clat)
            .bind(clng)
            .execute(pool)
            .await?;
    }
    Ok(())
}

async fn shutdown_signal() {
    use tokio::signal;

    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    {
        let terminate = async {
            signal::unix::signal(signal::unix::SignalKind::terminate())
                .expect("failed to install SIGTERM handler")
                .recv()
                .await;
        };
        tokio::select! {
            _ = ctrl_c => {}
            _ = terminate => {}
        }
    }

    #[cfg(not(unix))]
    ctrl_c.await;

    tracing::info!("shutdown signal received");
}
