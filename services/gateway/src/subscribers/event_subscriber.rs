use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use anyhow::Result;
use redis::AsyncCommands;
use redis::streams::{StreamReadOptions, StreamReadReply};
use sqlx::PgPool;
use tokio::time::{sleep, Duration};

use crate::ws::hub::WsHub;

const STREAM: &str = "sentinel:events:stream";
const GROUP: &str = "gateway-consumers";
const CONSUMER: &str = "gateway-main";
const BATCH: usize = 100;
const BLOCK_MS: usize = 5_000;

const BASE_BACKOFF_MS: u64 = 100;
const MAX_BACKOFF_MS: u64 = 30_000;

const SCHEMA_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../event_schema.json"
));

pub async fn run(
    redis_url: String,
    pool: PgPool,
    hub: Arc<WsHub>,
    redis_healthy: Arc<AtomicBool>,
    event_tx: Arc<tokio::sync::broadcast::Sender<crate::ws::ViewportEvent>>,
) {
    let schema: serde_json::Value = serde_json::from_str(SCHEMA_JSON)
        .expect("event_schema.json is invalid JSON — regenerate with export_schema binary");
    let validator = jsonschema::validator_for(&schema)
        .expect("event_schema.json is not a valid JSON Schema — regenerate with export_schema binary");

    let mut backoff_ms = BASE_BACKOFF_MS;
    loop {
        match read_loop(&redis_url, &pool, &hub, &redis_healthy, &validator, &event_tx).await {
            Ok(()) => break,
            Err(e) => {
                let was_healthy = redis_healthy.swap(false, Ordering::Relaxed);
                if was_healthy {
                    backoff_ms = BASE_BACKOFF_MS;
                }
                tracing::warn!("redis stream reader error: {e:#}, retrying in {backoff_ms}ms");
                sleep(Duration::from_millis(backoff_ms)).await;
                backoff_ms = (backoff_ms * 2).min(MAX_BACKOFF_MS);
            }
        }
    }
}

async fn read_loop(
    redis_url: &str,
    pool: &PgPool,
    hub: &Arc<WsHub>,
    redis_healthy: &Arc<AtomicBool>,
    validator: &jsonschema::Validator,
    event_tx: &Arc<tokio::sync::broadcast::Sender<crate::ws::ViewportEvent>>,
) -> Result<()> {
    let client = redis::Client::open(redis_url)?;
    let mut conn = client.get_multiplexed_async_connection().await?;

    // Create consumer group. "0" means deliver from the beginning of the stream
    // on fresh creation; MKSTREAM creates the stream if it doesn't exist yet.
    // BUSYGROUP error means the group already exists — that's fine.
    let create_result: redis::RedisResult<()> =
        conn.xgroup_create_mkstream(STREAM, GROUP, "0").await;
    if let Err(e) = create_result {
        if !e.to_string().contains("BUSYGROUP") {
            return Err(e.into());
        }
    }

    redis_healthy.store(true, Ordering::Relaxed);
    tracing::info!("redis stream reader connected, reading {STREAM} as {GROUP}/{CONSUMER}");

    let opts = StreamReadOptions::default()
        .group(GROUP, CONSUMER)
        .count(BATCH)
        .block(BLOCK_MS);

    loop {
        let reply: StreamReadReply =
            conn.xread_options(&[STREAM], &[">"], &opts).await?;

        for stream_key in reply.keys {
            for entry in stream_key.ids {
                let msg_id = entry.id.clone();

                let Some(payload_val) = entry.map.get("payload") else {
                    tracing::warn!("stream entry {msg_id} missing 'payload' field — acking and skipping");
                    let _: i64 = conn.xack(STREAM, GROUP, &[&msg_id]).await?;
                    continue;
                };

                let payload: String = redis::from_redis_value(payload_val)?;

                let value: serde_json::Value = match serde_json::from_str(&payload) {
                    Ok(v) => v,
                    Err(e) => {
                        tracing::warn!("dropping non-JSON stream entry {msg_id}: {e}");
                        let _: i64 = conn.xack(STREAM, GROUP, &[&msg_id]).await?;
                        continue;
                    }
                };

                if let Err(errors) = validator.validate(&value) {
                    let msgs: Vec<String> = errors.map(|e| e.to_string()).collect();
                    tracing::warn!("dropping schema-invalid entry {msg_id}: {}", msgs.join("; "));
                    let _: i64 = conn.xack(STREAM, GROUP, &[&msg_id]).await?;
                    continue;
                }

                let event: sentinel_core::RedisEventPayload = match serde_json::from_value(value) {
                    Ok(e) => e,
                    Err(e) => {
                        tracing::warn!("dropping entry {msg_id} that passed schema but failed deserialization: {e}");
                        let _: i64 = conn.xack(STREAM, GROUP, &[&msg_id]).await?;
                        continue;
                    }
                };

                if let Err(e) = handle_message(pool, hub, &event, event_tx).await {
                    tracing::warn!("failed to handle stream entry {msg_id}: {e:#}");
                    // Do not ACK — will be redelivered after visibility timeout
                    continue;
                }

                let _: i64 = conn.xack(STREAM, GROUP, &[&msg_id]).await?;
            }
        }
    }
}

async fn handle_message(
    pool: &PgPool,
    hub: &Arc<WsHub>,
    event: &sentinel_core::RedisEventPayload,
    event_tx: &Arc<tokio::sync::broadcast::Sender<crate::ws::ViewportEvent>>,
) -> Result<()> {
    let county = event.county.clone();

    sqlx::query(
        "INSERT INTO safety_events
           (id, event_type, severity, title, lat, lng, started_at,
            summary, place_name, county, is_active, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
         ON CONFLICT (id) DO UPDATE SET
           severity   = EXCLUDED.severity,
           title      = EXCLUDED.title,
           summary    = EXCLUDED.summary,
           state      = CASE WHEN EXCLUDED.is_active
                             THEN COALESCE(safety_events.state, 'ACTIVE')
                             ELSE 'RESOLVED'
                        END,
           updated_at = NOW()",
    )
    .bind(event.id)
    .bind(&event.event_type)
    .bind(&event.severity)
    .bind(&event.title)
    .bind(event.lat)
    .bind(event.lng)
    .bind(event.started_at)
    .bind(&event.summary)
    .bind(&event.place_name)
    .bind(county.as_deref())
    .bind(event.is_active)
    .bind(event.created_at)
    .execute(pool)
    .await?;

    // Publish to viewport broadcast channel (fire-and-forget; Err means no receivers)
    let state_str = event.state.clone().unwrap_or_else(|| "ACTIVE".into());
    let ws_event_json = serde_json::json!({
        "id": event.id,
        "event_type": event.event_type,
        "severity": event.severity,
        "state": state_str,
        "title": event.title,
        "lat": event.lat,
        "lng": event.lng,
        "started_at": event.started_at,
    });
    let _ = event_tx.send(crate::ws::ViewportEvent {
        id: event.id,
        lat: event.lat,
        lng: event.lng,
        severity: event.severity.clone(),
        event_json: ws_event_json.to_string().into(),
    });

    let ws_msg = serde_json::json!({
        "type": "NEW_EVENT",
        "payload": sentinel_core::Event::from(event)
    });
    hub.broadcast(
        county.as_deref(),
        serde_json::to_string(&ws_msg).unwrap().into(),
    );

    // Fire-and-forget push notifications — failure must not block event processing
    if let (Some(priv_key), Some(subject)) = (
        std::env::var("VAPID_PRIVATE_KEY").ok(),
        std::env::var("VAPID_SUBJECT").ok(),
    ) {
        let pool = pool.clone();
        let title = format!("{} — {}", event.severity, event.event_type.replace('_', " "));
        let body = event.place_name.clone().unwrap_or_else(|| {
            format!("{:.4}, {:.4}", event.lat, event.lng)
        });
        let event_id = event.id.to_string();
        tokio::spawn(async move {
            crate::routes::push::broadcast_push(&pool, &priv_key, &subject, &title, &body, &event_id).await;
        });
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_validator() -> jsonschema::Validator {
        let schema: serde_json::Value = serde_json::from_str(SCHEMA_JSON).unwrap();
        jsonschema::validator_for(&schema).unwrap()
    }

    fn valid_payload() -> serde_json::Value {
        serde_json::json!({
            "schema_version": 1,
            "id": "00000000-0000-0000-0000-000000000001",
            "event_type": "FLOOD",
            "severity": "CRITICAL",
            "title": "Flooding downtown",
            "lat": -1.2921,
            "lng": 36.8219,
            "started_at": "2026-01-01T00:00:00Z",
            "summary": "Roads impassable",
            "place_name": "CBD",
            "county": "Nairobi",
            "is_active": true,
            "created_at": "2026-01-01T00:00:00Z"
        })
    }

    #[test]
    fn schema_loads_and_compiles() {
        make_validator();
    }

    #[test]
    fn valid_event_passes_validation() {
        let v = make_validator();
        assert!(v.validate(&valid_payload()).is_ok());
    }

    #[test]
    fn missing_required_field_fails_validation() {
        let v = make_validator();
        let mut bad = valid_payload();
        bad.as_object_mut().unwrap().remove("event_type");
        assert!(v.validate(&bad).is_err());
    }

    #[test]
    fn extra_field_fails_due_to_additional_properties_false() {
        let v = make_validator();
        let mut bad = valid_payload();
        bad["extra"] = serde_json::json!("not allowed");
        assert!(v.validate(&bad).is_err());
    }

    #[test]
    fn malformed_json_is_caught_before_validation() {
        let bad_json = "not json at all {{";
        let parse_result = serde_json::from_str::<serde_json::Value>(bad_json);
        assert!(parse_result.is_err());
    }

    #[test]
    fn optional_fields_absent_passes_validation() {
        let v = make_validator();
        let mut event = valid_payload();
        let obj = event.as_object_mut().unwrap();
        obj.remove("summary");
        obj.remove("place_name");
        obj.remove("county");
        assert!(v.validate(&event).is_ok());
    }
}
