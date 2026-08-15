mod circles;
mod config;
mod db;
mod error;
mod maps;
mod middleware;
mod reports;
mod routes;
mod subscribers;
mod trust;
mod vouches;
mod ws;

use axum::http::{HeaderName, Method};
use axum::{extract::State, http::StatusCode, response::Json, routing::get, Router};
use governor::{DefaultKeyedRateLimiter, Quota, RateLimiter};
use std::num::NonZeroU32;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
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
    pub workers_healthy: Arc<AtomicBool>,
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

    // Circle membership revocation closes removed members' sockets via the
    // in-process CircleHub, which cannot reach other replicas. Fail closed rather
    // than silently leaving revoked members connected.
    if config.safe_circle_location_enabled && config.gateway_replicas > 1 {
        anyhow::bail!(
            "SAFE_CIRCLE_LOCATION_ENABLED requires a single gateway replica (GATEWAY_REPLICAS must be 1)"
        );
    }

    let db = db::create_pool(&config.database_url, config.max_db_connections).await?;
    db::assert_schema_version(&db).await?;
    let reputation_db = db::create_reputation_pool(&config.database_url).await?;
    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;
    let hub = Arc::new(WsHub::new());
    let circle_hub = Arc::new(CircleHub::new());
    let redis_healthy = Arc::new(AtomicBool::new(false));
    let workers_healthy = Arc::new(AtomicBool::new(true));

    let map_provider: std::sync::Arc<dyn maps::MapProvider> = if config.map_api_enabled {
        std::sync::Arc::new(maps::StadiaAdapter::new(
            http_client.clone(),
            config
                .stadia_api_key
                .clone()
                .ok_or_else(|| anyhow::anyhow!("MAP_API_ENABLED requires STADIA_API_KEY"))?,
        ))
    } else {
        // Keyless OSM Nominatim geocoding (search + reverse) keeps location lookup
        // and home-address setup working without a paid key. Routing stays gated.
        std::sync::Arc::new(maps::NominatimAdapter::new(http_client.clone()))
    };

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

    let state = AppState {
        db: db.clone(),
        reputation_db: reputation_db.clone(),
        config: config.clone(),
        http_client,
        hub: hub.clone(),
        circle_hub,
        redis_healthy: redis_healthy.clone(),
        workers_healthy: workers_healthy.clone(),
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
        let workers_ok = workers_healthy.clone();
        tokio::spawn(async move {
            subscribers::event_subscriber::run(redis_url, pool, hub_ref, healthy, tx).await;
            workers_ok.store(false, Ordering::Relaxed);
            tracing::error!(worker = "event_subscriber", "critical worker exited");
        });
    }

    // Spawn synthesis worker (ticks every 5s, clusters acoustic signals into public_events)
    if config.synthesis_enabled {
        let pool_synth = db.clone();
        let confirm_enabled = config.acoustic_confirm_enabled;
        let tx_synth = event_tx.clone();
        let workers_ok = workers_healthy.clone();
        tokio::spawn(async move {
            subscribers::synthesis_worker::run(pool_synth, true, confirm_enabled, tx_synth).await;
            workers_ok.store(false, Ordering::Relaxed);
            tracing::error!(worker = "acoustic_synthesis", "critical worker exited");
        });
    }

    // Spawn NLP trust-ladder synthesis worker (promotes heuristic->corroborating
    // ->confirmed from staged nlp_signals, expires stale detections, and fires
    // push only on the confirm transition). H-5 Phase 2B-ii.
    if config.nlp_synthesis_enabled {
        let pool_nlp = db.clone();
        let tx_nlp = event_tx.clone();
        let workers_ok = workers_healthy.clone();
        tokio::spawn(async move {
            subscribers::nlp_synthesis_worker::run(pool_nlp, true, tx_nlp).await;
            workers_ok.store(false, Ordering::Relaxed);
            tracing::error!(worker = "nlp_synthesis", "critical worker exited");
        });
    }

    match (
        config.vapid_private_key.clone(),
        config.vapid_subject.clone(),
    ) {
        (Some(key), Some(subject)) if !key.is_empty() && !subject.is_empty() => {
            let pool_push = db.clone();
            let workers_ok = workers_healthy.clone();
            tokio::spawn(async move {
                subscribers::push_outbox_worker::run(pool_push, key, subject).await;
                workers_ok.store(false, Ordering::Relaxed);
                tracing::error!(worker = "push_outbox", "critical worker exited");
            });
        }
        _ => tracing::warn!("push outbox worker disabled: VAPID configuration incomplete"),
    }

    // Chat notification push worker: independent of the safety-event outbox. Only
    // enabled when both the flag and VAPID are configured.
    if config.chat_push_enabled {
        match (
            config.vapid_private_key.clone(),
            config.vapid_subject.clone(),
        ) {
            (Some(key), Some(subject)) if !key.is_empty() && !subject.is_empty() => {
                let pool_chat = db.clone();
                let workers_ok = workers_healthy.clone();
                tokio::spawn(async move {
                    subscribers::chat_push_worker::run(pool_chat, key, subject).await;
                    workers_ok.store(false, Ordering::Relaxed);
                    tracing::error!(worker = "chat_push_outbox", "critical worker exited");
                });
            }
            _ => tracing::warn!(
                "chat push worker disabled: CHAT_PUSH_ENABLED set but VAPID incomplete"
            ),
        }
    }

    // Spawn trust-hygiene worker (C-1b-1): periodic metrics snapshot (always) +
    // gated reputation decay. Snapshots run even when decay is dark-launched.
    {
        let pool_trust = db.clone();
        let tick = config.trust_worker_tick_secs;
        let cfg = subscribers::trust_worker::DecayConfig {
            enabled: config.reputation_decay_enabled,
            grace_days: config.reputation_decay_grace_days,
            horizon_days: config.reputation_decay_horizon_days,
            floor: config.reputation_decay_floor,
            retention_days: config.observatory_snapshot_retention_days,
        };
        let workers_ok = workers_healthy.clone();
        tokio::spawn(async move {
            subscribers::trust_worker::run(pool_trust, tick, cfg).await;
            workers_ok.store(false, Ordering::Relaxed);
            tracing::error!(worker = "trust_hygiene", "critical worker exited");
        });
    }

    // Spawn retention worker (acoustic coordinate degradation + event expiry).
    // Always on — it is a privacy/safety hygiene control (audit AC-5, AC-7).
    {
        let pool_ret = db.clone();
        let workers_ok = workers_healthy.clone();
        tokio::spawn(async move {
            subscribers::retention_worker::run(pool_ret).await;
            workers_ok.store(false, Ordering::Relaxed);
            tracing::error!(worker = "retention", "critical worker exited");
        });
    }

    // CORS: allow any origin (public-read API — safety events, community reports)
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            HeaderName::from_static("content-type"),
            HeaderName::from_static("authorization"),
            HeaderName::from_static("x-nostr-auth"),
        ]);

    // Rate limiting: 100 req/s per IP, burst of 50. tower_governor's
    // `per_second(n)` sets the replenish INTERVAL (one token every n seconds),
    // so the 100-request-per-second quota is `per_millisecond(10)`.
    let governor_conf = Arc::new(
        GovernorConfigBuilder::default()
            .per_millisecond(10)
            .burst_size(50)
            .finish()
            .expect("invalid governor config"),
    );

    // The rate limiter is applied only to the REST API. Health/live/ready and
    // WebSocket endpoints must never be rate-limited (the container healthcheck
    // hits /ready and would otherwise flap to unhealthy).
    let app = Router::new()
        .route("/health", get(health))
        .route("/live", get(health))
        .route("/ready", get(ready))
        .route("/health/detailed", get(health_detailed))
        .route("/ws", get(ws::ws_handler))
        .route("/ws/circles", get(ws::ws_circles_handler))
        .route("/ws/events", get(ws::ws_events_handler))
        .merge(routes::build_router().layer(GovernorLayer {
            config: governor_conf,
        }))
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

async fn ready(State(state): State<AppState>) -> (StatusCode, Json<serde_json::Value>) {
    dependency_health(&state).await
}

async fn health_detailed(State(state): State<AppState>) -> (StatusCode, Json<serde_json::Value>) {
    dependency_health(&state).await
}

async fn dependency_health(state: &AppState) -> (StatusCode, Json<serde_json::Value>) {
    let postgres_ok = matches!(
        tokio::time::timeout(
            std::time::Duration::from_secs(1),
            sqlx::query_scalar::<_, i32>("SELECT 1").fetch_one(&state.db),
        )
        .await,
        Ok(Ok(1))
    );
    let redis_ok = state.redis_healthy.load(Ordering::Relaxed);
    let workers_ok = state.workers_healthy.load(Ordering::Relaxed);
    let ok = postgres_ok && redis_ok && workers_ok;
    let ts = chrono::Utc::now().to_rfc3339();
    let status = readiness_status(postgres_ok, redis_ok, workers_ok);
    (
        status,
        Json(serde_json::json!({
            "ok": ok,
            "service": "gateway",
            "ts": ts,
            "postgres": postgres_ok,
            "redis": redis_ok,
            "workers": workers_ok
        })),
    )
}

fn readiness_status(postgres_ok: bool, redis_ok: bool, workers_ok: bool) -> StatusCode {
    if postgres_ok && redis_ok && workers_ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    }
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

#[cfg(test)]
mod health_tests {
    use super::*;

    #[test]
    fn readiness_requires_every_core_dependency() {
        assert_eq!(readiness_status(true, true, true), StatusCode::OK);
        assert_eq!(
            readiness_status(false, true, true),
            StatusCode::SERVICE_UNAVAILABLE
        );
        assert_eq!(
            readiness_status(true, false, true),
            StatusCode::SERVICE_UNAVAILABLE
        );
        assert_eq!(
            readiness_status(true, true, false),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }
}
