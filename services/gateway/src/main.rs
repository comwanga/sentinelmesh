mod config;
mod db;
mod error;
mod middleware;

use std::sync::Arc;
use axum::{http::StatusCode, response::Json, routing::get, Router};
use tokio::net::TcpListener;

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::PgPool,
    pub config: Arc<config::Config>,
    pub http_client: reqwest::Client,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let config = Arc::new(config::Config::from_env()?);
    let db = db::create_pool(&config.database_url).await?;
    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;

    let state = AppState { db, config, http_client };

    let app = Router::new()
        .route("/health", get(health))
        .with_state(state);

    let addr = format!("0.0.0.0:3000");
    let listener = TcpListener::bind(&addr).await?;
    tracing::info!("gateway listening on {addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health() -> (StatusCode, Json<serde_json::Value>) {
    let ts = chrono::Utc::now().to_rfc3339();
    (StatusCode::OK, Json(serde_json::json!({ "ok": true, "service": "gateway", "ts": ts })))
}
