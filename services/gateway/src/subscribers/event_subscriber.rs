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

const SCHEMA_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../event_schema.json"
));

pub async fn run(
    redis_url: String,
    pool: PgPool,
    hub: Arc<WsHub>,
    redis_healthy: Arc<AtomicBool>,
) {
    let schema: serde_json::Value = serde_json::from_str(SCHEMA_JSON)
        .expect("event_schema.json is invalid JSON — regenerate with export_schema binary");
    let validator = jsonschema::validator_for(&schema)
        .expect("event_schema.json is not a valid JSON Schema — regenerate with export_schema binary");

    let mut backoff_ms = BASE_BACKOFF_MS;
    loop {
        match subscribe_loop(&redis_url, &pool, &hub, &redis_healthy, &validator).await {
            Ok(()) => break,
            Err(e) => {
                let was_healthy = redis_healthy.swap(false, Ordering::Relaxed);
                if was_healthy {
                    backoff_ms = BASE_BACKOFF_MS;
                }
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
    validator: &jsonschema::Validator,
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

        let value: serde_json::Value = match serde_json::from_str(&payload) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!("dropping non-JSON message on {CHANNEL}: {e}");
                continue;
            }
        };

        if let Err(errors) = validator.validate(&value) {
            let msgs: Vec<String> = errors.map(|e| e.to_string()).collect();
            tracing::warn!("dropping schema-invalid event on {CHANNEL}: {}", msgs.join("; "));
            continue;
        }

        let event: sentinel_core::RedisEventPayload = match serde_json::from_value(value) {
            Ok(e) => e,
            Err(e) => {
                tracing::warn!("dropping event that passed schema but failed deserialization: {e}");
                continue;
            }
        };

        if let Err(e) = handle_message(pool, hub, &event).await {
            tracing::warn!("failed to handle redis message: {e:#}");
        }
    }
}

async fn handle_message(
    pool: &PgPool,
    hub: &Arc<WsHub>,
    event: &sentinel_core::RedisEventPayload,
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

    let ws_msg = serde_json::json!({
        "type": "NEW_EVENT",
        "payload": sentinel_core::Event::from(event)
    });
    hub.broadcast(
        county.as_deref(),
        serde_json::to_string(&ws_msg).unwrap().into(),
    );

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
