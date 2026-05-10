use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use anyhow::Result;
use futures::StreamExt;
use sqlx::PgPool;
use tokio::time::{sleep, Duration};

use crate::ws::hub::WsHub;

const CHANNEL: &str = "sentinel:events:new";
const BASE_BACKOFF_MS: u64 = 100;
const MAX_BACKOFF_MS: u64 = 30_000;

pub async fn run(
    redis_url: String,
    pool: PgPool,
    hub: Arc<WsHub>,
    redis_healthy: Arc<AtomicBool>,
) {
    let mut backoff_ms = BASE_BACKOFF_MS;
    loop {
        match subscribe_loop(&redis_url, &pool, &hub, &redis_healthy).await {
            Ok(()) => break,
            Err(e) => {
                redis_healthy.store(false, Ordering::Relaxed);
                tracing::warn!(
                    "redis subscriber error: {e:#}, retrying in {backoff_ms}ms"
                );
                sleep(Duration::from_millis(backoff_ms)).await;
                backoff_ms = (backoff_ms * 2).min(MAX_BACKOFF_MS);
            }
        }
    }
}

async fn subscribe_loop(
    redis_url: &str,
    pool: &PgPool,
    hub: &Arc<WsHub>,
    redis_healthy: &Arc<AtomicBool>,
) -> Result<()> {
    let client = redis::Client::open(redis_url)?;
    let mut pubsub = client.get_async_pubsub().await?;
    pubsub.subscribe(CHANNEL).await?;

    redis_healthy.store(true, Ordering::Relaxed);
    tracing::info!("redis subscriber connected, listening on {CHANNEL}");

    let mut stream = pubsub.into_on_message();
    loop {
        let msg: redis::Msg = match stream.next().await {
            Some(m) => m,
            None => anyhow::bail!("redis pub/sub stream ended unexpectedly"),
        };

        let payload: String = msg.get_payload()?;
        if let Err(e) = handle_message(pool, hub, &payload).await {
            tracing::warn!("failed to handle redis message: {e:#}");
        }
    }
}

async fn handle_message(pool: &PgPool, hub: &Arc<WsHub>, payload: &str) -> Result<()> {
    let event: serde_json::Value = serde_json::from_str(payload)?;

    let county = event["location"]["county"].as_str().map(str::to_string);

    sqlx::query(
        "INSERT INTO safety_events
           (id, event_type, severity, title, lat, lng, started_at,
            summary, place_name, county, is_active, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,NOW(),NOW())
         ON CONFLICT (id) DO UPDATE SET
           severity   = EXCLUDED.severity,
           title      = EXCLUDED.title,
           summary    = EXCLUDED.summary,
           updated_at = NOW()"
    )
    .bind(event["id"].as_str().and_then(|s| s.parse::<uuid::Uuid>().ok()))
    .bind(event["type"].as_str())
    .bind(event["severity"].as_str())
    .bind(event["title"].as_str())
    .bind(event["location"]["lat"].as_f64())
    .bind(event["location"]["lng"].as_f64())
    .bind(
        event["startedAt"]
            .as_str()
            .and_then(|s| s.parse::<chrono::DateTime<chrono::Utc>>().ok()),
    )
    .bind(event["summary"].as_str())
    .bind(event["location"]["placeName"].as_str())
    .bind(county.as_deref())
    .execute(pool)
    .await?;

    let ws_msg = serde_json::json!({ "type": "NEW_EVENT", "payload": event });
    hub.broadcast(
        county.as_deref(),
        serde_json::to_string(&ws_msg).unwrap().into(),
    );

    Ok(())
}
