// services/blockchain/src/main.rs
mod config;
mod db;
mod utils;
mod workers;

use axum::{routing::get, Json, Router};
use serde_json::json;
use std::sync::Arc;
use tokio::signal;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let config = config::Config::from_env().unwrap_or_else(|e| {
        tracing::error!("config error: {}", e);
        std::process::exit(1);
    });
    let config = Arc::new(config);

    let pool = db::pool::create_pool(&config.database_url)
        .await
        .unwrap_or_else(|e| {
            tracing::error!("DB pool error: {}", e);
            std::process::exit(1);
        });
    let pool = Arc::new(pool);

    tracing::info!("blockchain starting on port {}", config.port);

    let publish_task = tokio::spawn(workers::publish_worker::run(
        Arc::clone(&pool),
        Arc::clone(&config),
    ));
    let poller_task = tokio::spawn(workers::confirmation_poller::run(
        Arc::clone(&pool),
        Arc::clone(&config),
    ));

    let app = Router::new().route("/health", get(health));
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", config.port))
        .await
        .unwrap_or_else(|e| {
            tracing::error!("bind error: {}", e);
            std::process::exit(1);
        });

    // Run until the server receives a shutdown signal OR a worker exits unexpectedly.
    // Dropping a JoinHandle aborts the task, so workers stop when the select exits.
    tokio::select! {
        result = publish_task => {
            tracing::error!("publish worker exited unexpectedly: {:?}", result);
            std::process::exit(1);
        }
        result = poller_task => {
            tracing::error!("confirmation poller exited unexpectedly: {:?}", result);
            std::process::exit(1);
        }
        result = axum::serve(listener, app).with_graceful_shutdown(shutdown_signal()) => {
            result.unwrap_or_else(|e| tracing::error!("server error: {}", e));
        }
    }

    tracing::info!("blockchain shutdown complete");
}

async fn health() -> Json<serde_json::Value> {
    Json(json!({ "ok": true, "service": "blockchain", "ts": chrono::Utc::now().to_rfc3339() }))
}

async fn shutdown_signal() {
    let ctrl_c = async { signal::ctrl_c().await.expect("ctrl-c handler failed") };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("SIGTERM handler failed")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("shutdown signal received");
}
