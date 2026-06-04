use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use anyhow::Result;
use h3o::{LatLng, Resolution};
use redis::streams::{StreamReadOptions, StreamReadReply};
use redis::AsyncCommands;
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

const SCHEMA_JSON: &str =
    include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../event_schema.json"));

trait ConfidenceDefault {
    fn confidence_or_default(&self) -> f32;
}

impl ConfidenceDefault for sentinel_core::RedisEventPayload {
    /// The payload does not carry the classifier confidence; stage a neutral
    /// midpoint so the NOT NULL column is satisfied. (Promotion in 2B-ii is driven
    /// by independence, not this value, so a constant is acceptable for now.)
    fn confidence_or_default(&self) -> f32 {
        0.5
    }
}

/// Channel for a payload, defaulting to "unknown" when the emitter set none.
/// Used for BOTH source_type and origin_channel on the staged nlp_signals row,
/// which are NOT NULL. (The payload carries origin_channel but no source_type;
/// for current emitters the two are identical.)
fn channel_or_unknown(origin_channel: &Option<String>) -> String {
    origin_channel.clone().unwrap_or_else(|| "unknown".to_string())
}

/// Resolution-9 (~100 m clustering cell) and resolution-7 (~5 km region) H3 cells
/// for a coordinate, as the lowercase hex strings stored in nlp_signals.
fn h3_cells(lat: f64, lng: f64) -> (String, String) {
    let ll = LatLng::new(lat, lng).expect("event lat/lng out of range");
    (
        ll.to_cell(Resolution::Nine).to_string(),
        ll.to_cell(Resolution::Seven).to_string(),
    )
}

pub async fn run(
    redis_url: String,
    pool: PgPool,
    hub: Arc<WsHub>,
    redis_healthy: Arc<AtomicBool>,
    event_tx: Arc<tokio::sync::broadcast::Sender<crate::ws::ViewportEvent>>,
) {
    let schema: serde_json::Value = serde_json::from_str(SCHEMA_JSON)
        .expect("event_schema.json is invalid JSON — regenerate with export_schema binary");
    let validator = jsonschema::validator_for(&schema).expect(
        "event_schema.json is not a valid JSON Schema — regenerate with export_schema binary",
    );

    let mut backoff_ms = BASE_BACKOFF_MS;
    loop {
        match read_loop(
            &redis_url,
            &pool,
            &hub,
            &redis_healthy,
            &validator,
            &event_tx,
        )
        .await
        {
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
        let reply: StreamReadReply = conn.xread_options(&[STREAM], &[">"], &opts).await?;

        for stream_key in reply.keys {
            for entry in stream_key.ids {
                let msg_id = entry.id.clone();

                let Some(payload_val) = entry.map.get("payload") else {
                    tracing::warn!(
                        "stream entry {msg_id} missing 'payload' field — acking and skipping"
                    );
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
                    tracing::warn!(
                        "dropping schema-invalid entry {msg_id}: {}",
                        msgs.join("; ")
                    );
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
    let (h3_r9, h3_r7) = h3_cells(event.lat, event.lng);
    let channel = channel_or_unknown(&event.origin_channel);

    // Corroboration window: how long an active cluster keeps accepting new signals.
    const CLUSTER_WINDOW_SECS: i64 = 1800; // 30 min, matches the Python fuse window

    // Steps 1-3 run in one transaction so a failure cannot leave a safety_events
    // row without its staged signal (which redelivery would then duplicate).
    let mut tx = pool.begin().await?;

    // 1. Find an existing active (heuristic/corroborating) event for this cell+type
    //    within the window, via already-staged signals. None -> we create one.
    let existing: Option<uuid::Uuid> = sqlx::query_scalar(
        "SELECT event_id FROM nlp_signals
          WHERE h3_r9 = $1 AND event_type = $2 AND event_id IS NOT NULL
            AND trust_state IN ('pending', 'corroborating')
            AND received_at > now() - ($3 * interval '1 second')
          ORDER BY received_at DESC
          LIMIT 1",
    )
    .bind(&h3_r9)
    .bind(&event.event_type)
    .bind(CLUSTER_WINDOW_SECS)
    .fetch_optional(&mut *tx)
    .await?;

    // 2. Resolve the surfaced event id and its current trust_state. Reuse the
    //    cluster's event (reading its possibly-promoted trust_state), or insert a
    //    new HEURISTIC machine event (trust_state is known to be 'heuristic').
    let (event_id, trust_state): (uuid::Uuid, String) = match existing {
        Some(id) => {
            let ts: String =
                sqlx::query_scalar("SELECT trust_state FROM safety_events WHERE id = $1")
                    .bind(id)
                    .fetch_one(&mut *tx)
                    .await?;
            (id, ts)
        }
        None => {
            let id: uuid::Uuid = sqlx::query_scalar(
                "INSERT INTO safety_events
                   (event_type, severity, title, lat, lng, started_at, summary,
                    place_name, county, is_active, trust_state, origin_class,
                    distinct_source_count, distinct_channel_count, created_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,'heuristic','machine',1,1,$10)
                 RETURNING id",
            )
            .bind(&event.event_type)
            .bind(&event.severity)
            .bind(&event.title)
            .bind(event.lat)
            .bind(event.lng)
            .bind(event.started_at)
            .bind(event.summary.as_deref())
            .bind(event.place_name.as_deref())
            .bind(county.as_deref())
            .bind(event.created_at)
            .fetch_one(&mut *tx)
            .await?;
            (id, "heuristic".to_string())
        }
    };

    // 3. Stage the raw signal (pending) linked to the surfaced event. The synthesis
    //    worker (2B-ii) recomputes distinct sources/channels and promotes.
    sqlx::query(
        "INSERT INTO nlp_signals
           (event_id, source_type, source_id, origin_channel, event_type, severity,
            title, summary, lat, lng, h3_r9, h3_r7, county, place_name, confidence,
            trust_state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pending')",
    )
    .bind(event_id)
    .bind(&channel)
    .bind(event.source_id.as_deref())
    .bind(&channel)
    .bind(&event.event_type)
    .bind(&event.severity)
    .bind(&event.title)
    .bind(event.summary.as_deref())
    .bind(event.lat)
    .bind(event.lng)
    .bind(&h3_r9)
    .bind(&h3_r7)
    .bind(county.as_deref())
    .bind(event.place_name.as_deref())
    .bind(event.confidence_or_default())
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    // 4. Broadcast to the map viewport channel (fire-and-forget), after commit so we
    //    never surface an event that rolled back. Heuristic events ARE shown —
    //    labeled — but never push. Push is gated to confirmed and applied by the
    //    synthesis worker on the confirm transition (Phase 2B-ii).
    let ws_event_json = serde_json::json!({
        "id": event_id,
        "event_type": event.event_type,
        "severity": event.severity,
        "state": "ACTIVE",
        "trust_state": trust_state,
        "title": event.title,
        "lat": event.lat,
        "lng": event.lng,
        "started_at": event.started_at,
    });
    let _ = event_tx.send(crate::ws::ViewportEvent {
        id: event_id,
        lat: event.lat,
        lng: event.lng,
        severity: event.severity.clone(),
        event_json: ws_event_json.to_string().into(),
    });

    let ws_msg = serde_json::json!({
        "type": "NEW_EVENT",
        "payload": {
            "id": event_id,
            "event_type": event.event_type,
            "severity": event.severity,
            "title": event.title,
            "lat": event.lat,
            "lng": event.lng,
            "started_at": event.started_at,
            "trust_state": trust_state,
        }
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

    #[test]
    fn channel_defaults_to_unknown_when_absent() {
        assert_eq!(channel_or_unknown(&None), "unknown");
        assert_eq!(channel_or_unknown(&Some("rss".to_string())), "rss");
    }

    #[test]
    fn h3_cells_resolve_from_coordinates() {
        let (r9, r7) = h3_cells(-1.286, 36.817);
        assert!(!r9.is_empty() && !r7.is_empty());
        assert_ne!(r9, r7);
    }
}
