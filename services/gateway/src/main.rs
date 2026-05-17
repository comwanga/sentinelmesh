mod config;
mod db;
mod error;
mod lightning;
mod middleware;
mod nudge;
mod reports;
mod routes;
mod subscribers;
mod ws;

use std::sync::{atomic::AtomicBool, Arc};
use axum::{extract::State, http::StatusCode, response::Json, routing::get, Router};
use tokio::net::TcpListener;
use tower_http::cors::{Any, CorsLayer};
use tower_governor::{governor::GovernorConfigBuilder, GovernorLayer};
use axum::http::{Method, HeaderName};
use ws::{circle_hub::CircleHub, hub::WsHub};

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::PgPool,
    pub config: Arc<config::Config>,
    pub http_client: reqwest::Client,
    pub hub: Arc<WsHub>,
    pub circle_hub: Arc<CircleHub>,
    pub redis_healthy: Arc<AtomicBool>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let config = Arc::new(config::Config::from_env()?);
    let db = db::create_pool(&config.database_url, config.max_db_connections).await?;
    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;
    let hub = Arc::new(WsHub::new());
    let circle_hub = Arc::new(CircleHub::new());
    let redis_healthy = Arc::new(AtomicBool::new(false));

    let state = AppState {
        db: db.clone(),
        config: config.clone(),
        http_client,
        hub: hub.clone(),
        circle_hub,
        redis_healthy: redis_healthy.clone(),
    };

    // Spawn Redis subscriber task (supervised, runs for the lifetime of the process)
    {
        let redis_url = config.redis_url.clone();
        let pool = db.clone();
        let hub_ref = hub.clone();
        let healthy = redis_healthy.clone();
        tokio::spawn(async move {
            subscribers::event_subscriber::run(redis_url, pool, hub_ref, healthy).await;
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
        .merge(routes::build_router())
        .layer(GovernorLayer { config: governor_conf })
        .layer(cors)
        .with_state(state);

    let addr = format!("0.0.0.0:{}", config.port);
    let listener = TcpListener::bind(&addr).await?;
    tracing::info!("gateway listening on {addr}");

    axum::serve(listener, app)
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
    let redis_ok = state.redis_healthy.load(std::sync::atomic::Ordering::Relaxed);
    let ts = chrono::Utc::now().to_rfc3339();
    Json(serde_json::json!({ "ok": true, "service": "gateway", "ts": ts, "redis": redis_ok }))
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
