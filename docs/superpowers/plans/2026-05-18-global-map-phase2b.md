# Global Map Phase 2b — Gateway Viewport WebSocket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/ws/events` WebSocket endpoint that accepts viewport bounds from clients, returns an initial batch of active events within those bounds, and streams incremental `DIFF_PATCH` messages as events change or the viewport moves.

**Architecture:** A `tokio::sync::broadcast` channel (`event_tx`) carries lightweight `ViewportEvent` structs from the Redis subscriber to every connected WS handler. Each handler tracks the client's current known event set (`HashMap<Uuid, EventDigest>`), queries Postgres with `ST_MakeEnvelope && geog` for bulk fetches, and applies a 300 ms debounce on viewport changes before computing added/removed/updated diffs. Per-client outbound rate limiting and `low_bandwidth` mode are implemented as simple counters in handler state. H3 server-side clustering (zoom ≤ 10) is deferred to Phase 2c.

**Tech Stack:** Rust, tokio, axum WebSocket, sqlx, PostGIS (from Phase 2a), `tokio::sync::broadcast`, `tokio::time::sleep`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `services/gateway/src/ws/events_ws.rs` | All viewport WS types + DB query + handler logic |
| Modify | `services/gateway/src/ws/mod.rs` | Add `pub mod events_ws`; re-export `ws_events_handler` and `ViewportEvent` |
| Modify | `services/gateway/src/main.rs` | Add `event_tx` to `AppState`; register `/ws/events` route |
| Modify | `services/gateway/src/config.rs` | Add `ws_events_rate_cap: u32` |
| Modify | `services/gateway/src/subscribers/event_subscriber.rs` | Accept `event_tx`; publish `ViewportEvent` after insert |

---

## Task 1: ViewportEvent + AppState event_tx + config + event_subscriber wiring

**Files:**
- Modify: `services/gateway/src/ws/mod.rs`
- Modify: `services/gateway/src/main.rs`
- Modify: `services/gateway/src/config.rs`
- Modify: `services/gateway/src/subscribers/event_subscriber.rs`

The broadcast channel (`event_tx`) carries a `ViewportEvent` for each event inserted by the Redis subscriber. Every `/ws/events` handler subscribes to this channel and does a cheap bounding-box check to decide whether to forward the event.

- [ ] **Step 1: Add ViewportEvent stub to ws/mod.rs and re-export**

Add to `services/gateway/src/ws/mod.rs` at the top:

```rust
pub mod events_ws;

pub use events_ws::{ws_events_handler, ViewportEvent};
```

Create a minimal `services/gateway/src/ws/events_ws.rs` that defines only `ViewportEvent` for now (the full handler is added in Task 3):

```rust
use std::sync::Arc;
use uuid::Uuid;

/// Lightweight event descriptor published to the viewport broadcast channel.
/// Carries just enough data for bounding-box filtering and client delivery
/// without a second DB round-trip per connected client.
#[derive(Debug, Clone)]
pub struct ViewportEvent {
    pub id: Uuid,
    pub lat: f64,
    pub lng: f64,
    /// Pre-serialised `WsEvent` JSON ready to embed in a DIFF_PATCH message.
    /// Using Arc<str> avoids cloning the string for each broadcast subscriber.
    pub event_json: Arc<str>,
}
```

- [ ] **Step 2: Add ws_events_rate_cap to config**

In `services/gateway/src/config.rs`, add the field to the struct:

```rust
pub struct Config {
    // ... existing fields ...
    pub ws_events_rate_cap: u32,
}
```

Add to `Config::from_env()`:

```rust
ws_events_rate_cap: std::env::var("WS_EVENTS_RATE_CAP")
    .ok()
    .and_then(|v| v.parse().ok())
    .unwrap_or(30),
```

- [ ] **Step 3: Add event_tx to AppState in main.rs**

Add to the `use` section:

```rust
use tokio::sync::broadcast;
```

Add `event_tx` field to `AppState`:

```rust
pub struct AppState {
    pub db: sqlx::PgPool,
    pub config: Arc<config::Config>,
    pub http_client: reqwest::Client,
    pub hub: Arc<WsHub>,
    pub circle_hub: Arc<CircleHub>,
    pub redis_healthy: Arc<AtomicBool>,
    pub map_provider: std::sync::Arc<dyn maps::MapProvider>,
    pub event_tx: Arc<broadcast::Sender<ws::ViewportEvent>>,
}
```

In `main()`, create the channel and add to state:

```rust
// Capacity 512: allows slow viewport-WS clients up to 512 events of lag
// before Lagged errors force them into snapshot mode.
let (event_tx_inner, _) = broadcast::channel::<ws::ViewportEvent>(512);
let event_tx = Arc::new(event_tx_inner);

let state = AppState {
    db: db.clone(),
    config: config.clone(),
    http_client,
    hub: hub.clone(),
    circle_hub,
    redis_healthy: redis_healthy.clone(),
    map_provider,
    event_tx: event_tx.clone(),
};
```

Also update the subscriber spawn to pass `event_tx`:

```rust
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
```

- [ ] **Step 4: Update event_subscriber to accept and publish to event_tx**

Update `services/gateway/src/subscribers/event_subscriber.rs`:

Change the `run` signature:

```rust
pub async fn run(
    redis_url: String,
    pool: PgPool,
    hub: Arc<WsHub>,
    redis_healthy: Arc<AtomicBool>,
    event_tx: Arc<tokio::sync::broadcast::Sender<crate::ws::ViewportEvent>>,
) {
```

Add `event_tx` to `read_loop` call and signature:

```rust
match read_loop(&redis_url, &pool, &hub, &redis_healthy, &validator, &event_tx).await {
```

```rust
async fn read_loop(
    redis_url: &str,
    pool: &PgPool,
    hub: &Arc<WsHub>,
    redis_healthy: &Arc<AtomicBool>,
    validator: &jsonschema::Validator,
    event_tx: &Arc<tokio::sync::broadcast::Sender<crate::ws::ViewportEvent>>,
) -> Result<()> {
```

Pass `event_tx` to `handle_message`:

```rust
if let Err(e) = handle_message(pool, hub, &event, event_tx).await {
```

Update `handle_message` signature and body. Add the `ViewportEvent` publish after the DB insert succeeds:

```rust
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

    // ... rest of handle_message unchanged (VAPID push) ...
```

- [ ] **Step 5: Run all gateway tests**

```
cd services && cargo test -p gateway
```
Expected: all 49 existing tests pass. (The new route is not registered yet so no integration tests.)

- [ ] **Step 6: Commit**

```bash
git add services/gateway/src/ws/mod.rs \
        services/gateway/src/ws/events_ws.rs \
        services/gateway/src/config.rs \
        services/gateway/src/main.rs \
        services/gateway/src/subscribers/event_subscriber.rs
git commit -m "feat: add ViewportEvent broadcast channel and event_tx to AppState"
```

---

## Task 2: WsEvent + ClientMsg + ServerMsg + Bounds + EventDigest

**Files:**
- Modify: `services/gateway/src/ws/events_ws.rs`

Add all protocol types to `events_ws.rs`. These are the types the handler uses to communicate with clients and track state.

- [ ] **Step 1: Write failing unit tests**

Add to `services/gateway/src/ws/events_ws.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_contains_point_inside() {
        let b = Bounds { north: 0.0, south: -2.0, east: 37.0, west: 36.0 };
        assert!(b.contains(-1.0, 36.5));
    }

    #[test]
    fn bounds_does_not_contain_point_outside() {
        let b = Bounds { north: 0.0, south: -2.0, east: 37.0, west: 36.0 };
        assert!(!b.contains(1.0, 36.5));   // north of bounds
        assert!(!b.contains(-1.0, 38.0));  // east of bounds
    }

    #[test]
    fn bounds_edge_is_inclusive() {
        let b = Bounds { north: 0.0, south: -2.0, east: 37.0, west: 36.0 };
        assert!(b.contains(0.0, 36.0));    // north-west corner
        assert!(b.contains(-2.0, 37.0));   // south-east corner
    }

    #[test]
    fn client_subscribe_parses() {
        let json = r#"{
            "type": "SUBSCRIBE",
            "bounds": {"north": 0.0, "south": -2.0, "east": 37.0, "west": 36.0},
            "zoom": 12.0,
            "filters": [],
            "low_bandwidth": false
        }"#;
        let msg: ClientMsg = serde_json::from_str(json).unwrap();
        assert!(matches!(msg, ClientMsg::Subscribe { .. }));
    }

    #[test]
    fn client_viewport_changed_parses() {
        let json = r#"{
            "type": "VIEWPORT_CHANGED",
            "bounds": {"north": 1.0, "south": -1.0, "east": 38.0, "west": 36.0},
            "zoom": 14.0
        }"#;
        let msg: ClientMsg = serde_json::from_str(json).unwrap();
        assert!(matches!(msg, ClientMsg::ViewportChanged { .. }));
    }

    #[test]
    fn client_snapshot_request_parses() {
        let json = r#"{"type": "SNAPSHOT_REQUEST"}"#;
        let msg: ClientMsg = serde_json::from_str(json).unwrap();
        assert!(matches!(msg, ClientMsg::SnapshotRequest));
    }

    #[test]
    fn event_digest_detects_change() {
        let d1 = EventDigest { severity: "HIGH".into(), state: "ACTIVE".into() };
        let d2 = EventDigest { severity: "CRITICAL".into(), state: "ACTIVE".into() };
        assert_ne!(d1, d2);
    }
}
```

Run: `cd services && cargo test -p gateway -- ws::events_ws::tests 2>&1 | head -20`
Expected: compile error — types not defined.

- [ ] **Step 2: Add all types to events_ws.rs**

Replace `events_ws.rs` with:

```rust
use std::{collections::HashMap, sync::Arc};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Lightweight event broadcast to all viewport WS handlers when a new event
/// arrives from the Redis stream. Each handler decides independently whether
/// the event falls inside its current bounds.
#[derive(Debug, Clone)]
pub struct ViewportEvent {
    pub id: Uuid,
    pub lat: f64,
    pub lng: f64,
    /// Pre-serialised WsEvent JSON (Arc avoids cloning per subscriber).
    pub event_json: Arc<str>,
}

// ---------------------------------------------------------------------------
// DB projection — lighter than SafetyEvent, sized for WS payloads
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct WsEvent {
    pub id: Uuid,
    pub event_type: String,
    pub severity: String,
    pub state: String,
    pub title: String,
    pub lat: f64,
    pub lng: f64,
    pub started_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Per-connection state
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct EventDigest {
    pub severity: String,
    pub state: String,
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Bounds {
    pub north: f64,
    pub south: f64,
    pub east: f64,
    pub west: f64,
}

impl Bounds {
    pub fn contains(&self, lat: f64, lng: f64) -> bool {
        lat >= self.south && lat <= self.north && lng >= self.west && lng <= self.east
    }
}

// ---------------------------------------------------------------------------
// Client → Server messages
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ClientMsg {
    Subscribe {
        bounds: Bounds,
        zoom: f64,
        #[serde(default)]
        filters: Vec<String>,
        #[serde(default)]
        low_bandwidth: bool,
    },
    ViewportChanged {
        bounds: Bounds,
        zoom: f64,
    },
    SnapshotRequest,
}

// ---------------------------------------------------------------------------
// Server → Client messages
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ServerMsg<'a> {
    InitialBatch { events: &'a [WsEvent] },
    DiffPatch { added: Vec<WsEvent>, removed: Vec<Uuid>, updated: Vec<WsEvent> },
    Snapshot { events: Vec<WsEvent> },
    Error { message: &'a str },
}

// ---------------------------------------------------------------------------
// Handler (stub — filled in Task 3 and 4)
// ---------------------------------------------------------------------------

pub async fn ws_events_handler() -> &'static str { "stub" }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_contains_point_inside() {
        let b = Bounds { north: 0.0, south: -2.0, east: 37.0, west: 36.0 };
        assert!(b.contains(-1.0, 36.5));
    }

    #[test]
    fn bounds_does_not_contain_point_outside() {
        let b = Bounds { north: 0.0, south: -2.0, east: 37.0, west: 36.0 };
        assert!(!b.contains(1.0, 36.5));
        assert!(!b.contains(-1.0, 38.0));
    }

    #[test]
    fn bounds_edge_is_inclusive() {
        let b = Bounds { north: 0.0, south: -2.0, east: 37.0, west: 36.0 };
        assert!(b.contains(0.0, 36.0));
        assert!(b.contains(-2.0, 37.0));
    }

    #[test]
    fn client_subscribe_parses() {
        let json = r#"{
            "type": "SUBSCRIBE",
            "bounds": {"north": 0.0, "south": -2.0, "east": 37.0, "west": 36.0},
            "zoom": 12.0,
            "filters": [],
            "low_bandwidth": false
        }"#;
        let msg: ClientMsg = serde_json::from_str(json).unwrap();
        assert!(matches!(msg, ClientMsg::Subscribe { .. }));
    }

    #[test]
    fn client_subscribe_defaults_filters_and_low_bandwidth() {
        let json = r#"{
            "type": "SUBSCRIBE",
            "bounds": {"north": 0.0, "south": -2.0, "east": 37.0, "west": 36.0},
            "zoom": 12.0
        }"#;
        let msg: ClientMsg = serde_json::from_str(json).unwrap();
        if let ClientMsg::Subscribe { filters, low_bandwidth, .. } = msg {
            assert!(filters.is_empty());
            assert!(!low_bandwidth);
        } else {
            panic!("expected Subscribe");
        }
    }

    #[test]
    fn client_viewport_changed_parses() {
        let json = r#"{
            "type": "VIEWPORT_CHANGED",
            "bounds": {"north": 1.0, "south": -1.0, "east": 38.0, "west": 36.0},
            "zoom": 14.0
        }"#;
        let msg: ClientMsg = serde_json::from_str(json).unwrap();
        assert!(matches!(msg, ClientMsg::ViewportChanged { .. }));
    }

    #[test]
    fn client_snapshot_request_parses() {
        let json = r#"{"type": "SNAPSHOT_REQUEST"}"#;
        let msg: ClientMsg = serde_json::from_str(json).unwrap();
        assert!(matches!(msg, ClientMsg::SnapshotRequest));
    }

    #[test]
    fn event_digest_detects_severity_change() {
        let d1 = EventDigest { severity: "HIGH".into(), state: "ACTIVE".into() };
        let d2 = EventDigest { severity: "CRITICAL".into(), state: "ACTIVE".into() };
        assert_ne!(d1, d2);
    }

    #[test]
    fn event_digest_detects_state_change() {
        let d1 = EventDigest { severity: "HIGH".into(), state: "ACTIVE".into() };
        let d2 = EventDigest { severity: "HIGH".into(), state: "RESOLVED".into() };
        assert_ne!(d1, d2);
    }

    #[test]
    fn server_initial_batch_serializes() {
        let events: Vec<WsEvent> = vec![];
        let msg = ServerMsg::InitialBatch { events: &events };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"INITIAL_BATCH\""));
        assert!(json.contains("\"events\":[]"));
    }

    #[test]
    fn server_diff_patch_serializes() {
        let msg = ServerMsg::DiffPatch {
            added: vec![],
            removed: vec![Uuid::nil()],
            updated: vec![],
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"DIFF_PATCH\""));
        assert!(json.contains("\"removed\""));
    }

    #[test]
    fn diff_compute_added_removed_updated() {
        use std::collections::HashMap;
        let old: HashMap<Uuid, EventDigest> = {
            let mut m = HashMap::new();
            m.insert(Uuid::nil(), EventDigest { severity: "HIGH".into(), state: "ACTIVE".into() });
            m
        };
        let id_new = Uuid::from_u128(1);
        let new_events = vec![
            // id_new is new (added)
            WsEvent { id: id_new, event_type: "FIRE".into(), severity: "CRITICAL".into(),
                      state: "ACTIVE".into(), title: "Fire".into(), lat: 0.0, lng: 0.0,
                      started_at: chrono::Utc::now() },
        ];
        // id nil is in old but not new (removed)
        let added: Vec<&WsEvent> = new_events.iter().filter(|e| !old.contains_key(&e.id)).collect();
        let removed: Vec<Uuid> = old.keys().filter(|id| !new_events.iter().any(|e| &e.id == *id)).cloned().collect();

        assert_eq!(added.len(), 1);
        assert_eq!(added[0].id, id_new);
        assert_eq!(removed, vec![Uuid::nil()]);
    }
}
```

- [ ] **Step 3: Run gateway tests**

```
cd services && cargo test -p gateway
```
Expected: all tests pass including the new `ws::events_ws::tests` suite.

- [ ] **Step 4: Commit**

```bash
git add services/gateway/src/ws/events_ws.rs
git commit -m "feat: add ViewportEvent, WsEvent, Bounds, ClientMsg, ServerMsg types with tests"
```

---

## Task 3: query_viewport_events + SUBSCRIBE → INITIAL_BATCH handler

**Files:**
- Modify: `services/gateway/src/ws/events_ws.rs`
- Modify: `services/gateway/src/ws/mod.rs`
- Modify: `services/gateway/src/main.rs`

- [ ] **Step 1: Write test for query_viewport_events bounds parameter ordering**

Add to the tests module in `events_ws.rs`:

```rust
    #[test]
    fn bounds_west_south_east_north_order_for_st_make_envelope() {
        // ST_MakeEnvelope(xmin, ymin, xmax, ymax) = (west, south, east, north)
        let b = Bounds { north: 1.0, south: -1.0, east: 38.0, west: 36.0 };
        // Verify the correct binding order: west, south, east, north
        let (w, s, e, n) = (b.west, b.south, b.east, b.north);
        assert_eq!(w, 36.0);
        assert_eq!(s, -1.0);
        assert_eq!(e, 38.0);
        assert_eq!(n, 1.0);
    }
```

- [ ] **Step 2: Add query_viewport_events to events_ws.rs**

Add after the existing types (before the tests module):

```rust
/// Dynamic row limit based on zoom: denser viewports at low zoom get fewer rows
/// to prevent sending thousands of points to a client that needs clusters.
pub fn viewport_event_limit(zoom: f64) -> i64 {
    ((800.0 / (zoom - 8.0).max(1.0)) as i64).clamp(50, 400)
}

pub async fn query_viewport_events(
    pool: &sqlx::PgPool,
    bounds: &Bounds,
    filters: &[String],
    zoom: f64,
) -> sqlx::Result<Vec<WsEvent>> {
    let limit = viewport_event_limit(zoom);
    // ST_MakeEnvelope(xmin, ymin, xmax, ymax, srid) = (west, south, east, north, 4326)
    if filters.is_empty() {
        sqlx::query_as::<_, WsEvent>(
            "SELECT id, event_type, severity, state, title, lat, lng, started_at
               FROM safety_events
              WHERE geog && ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography
                AND state NOT IN ('RESOLVED', 'EXPIRED')
              ORDER BY
                CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1
                              WHEN 'MEDIUM' THEN 2 ELSE 3 END ASC
              LIMIT $5"
        )
        .bind(bounds.west).bind(bounds.south).bind(bounds.east).bind(bounds.north)
        .bind(limit)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query_as::<_, WsEvent>(
            "SELECT id, event_type, severity, state, title, lat, lng, started_at
               FROM safety_events
              WHERE geog && ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography
                AND state NOT IN ('RESOLVED', 'EXPIRED')
                AND event_type = ANY($5)
              ORDER BY
                CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1
                              WHEN 'MEDIUM' THEN 2 ELSE 3 END ASC
              LIMIT $6"
        )
        .bind(bounds.west).bind(bounds.south).bind(bounds.east).bind(bounds.north)
        .bind(filters)
        .bind(limit)
        .fetch_all(pool)
        .await
    }
}
```

Add tests for `viewport_event_limit`:

```rust
    #[test]
    fn viewport_event_limit_at_low_zoom() {
        assert_eq!(viewport_event_limit(8.0), 400); // 800/1=800, clamp→400
    }

    #[test]
    fn viewport_event_limit_at_mid_zoom() {
        assert_eq!(viewport_event_limit(12.0), 200); // 800/4=200
    }

    #[test]
    fn viewport_event_limit_at_high_zoom() {
        assert_eq!(viewport_event_limit(30.0), 50); // 800/22=36, clamp→50
    }
```

- [ ] **Step 3: Write the real ws_events_handler (SUBSCRIBE path only)**

Replace the stub `ws_events_handler` with the full handler. The handler upgrades to WebSocket, waits for SUBSCRIBE, queries the DB, sends INITIAL_BATCH, then enters the main loop (Task 4 fills in the loop body):

```rust
use axum::{
    extract::{ws::{Message, WebSocket, WebSocketUpgrade}, State},
    response::IntoResponse,
};
use std::time::{Duration, Instant};
use tokio::sync::broadcast;

pub async fn ws_events_handler(
    ws: WebSocketUpgrade,
    State(state): State<crate::AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_events_ws(socket, state))
}

async fn handle_events_ws(mut socket: WebSocket, state: crate::AppState) {
    // --- Phase 1: await SUBSCRIBE message ---
    let (bounds, zoom, filters, low_bandwidth) = loop {
        match socket.recv().await {
            Some(Ok(Message::Text(text))) => {
                match serde_json::from_str::<ClientMsg>(&text) {
                    Ok(ClientMsg::Subscribe { bounds, zoom, filters, low_bandwidth }) => {
                        break (bounds, zoom, filters, low_bandwidth);
                    }
                    Ok(_) => {
                        let err = serde_json::to_string(&ServerMsg::Error {
                            message: "first message must be SUBSCRIBE",
                        }).unwrap();
                        let _ = socket.send(Message::Text(err)).await;
                    }
                    Err(e) => {
                        let err = serde_json::to_string(&ServerMsg::Error {
                            message: &format!("invalid message: {e}"),
                        }).unwrap();
                        let _ = socket.send(Message::Text(err)).await;
                    }
                }
            }
            _ => return, // client disconnected or sent non-text
        }
    };

    // --- Phase 2: send initial batch ---
    let initial = match query_viewport_events(&state.db, &bounds, &filters, zoom).await {
        Ok(events) => events,
        Err(e) => {
            tracing::warn!("viewport WS query failed: {e:#}");
            let err = serde_json::to_string(&ServerMsg::Error { message: "db error" }).unwrap();
            let _ = socket.send(Message::Text(err)).await;
            return;
        }
    };

    let initial_json = serde_json::to_string(&ServerMsg::InitialBatch {
        events: &initial,
    }).unwrap();
    if socket.send(Message::Text(initial_json)).await.is_err() {
        return;
    }

    // --- Phase 3: build known-events map and enter main loop ---
    let mut known: HashMap<Uuid, EventDigest> = initial
        .iter()
        .map(|e| (e.id, EventDigest { severity: e.severity.clone(), state: e.state.clone() }))
        .collect();

    let mut current_bounds = bounds;
    let mut current_zoom = zoom;
    let rate_cap = state.config.ws_events_rate_cap as usize;
    let mut rx = state.event_tx.subscribe();

    // Debounce state
    let debounce_dur = Duration::from_millis(300);
    let mut pending_viewport: Option<(Bounds, f64)> = None;
    let debounce_sleep = tokio::time::sleep(debounce_dur);
    tokio::pin!(debounce_sleep);
    let mut debounce_active = false;

    // Rate limiter state
    let mut rate_window_start = Instant::now();
    let mut rate_count: usize = 0;

    loop {
        tokio::select! {
            // Debounce timer fired — process pending viewport change
            () = &mut debounce_sleep, if debounce_active => {
                debounce_active = false;
                if let Some((new_bounds, new_zoom)) = pending_viewport.take() {
                    if let Ok(new_events) =
                        query_viewport_events(&state.db, &new_bounds, &filters, new_zoom).await
                    {
                        let patch = compute_diff(&known, &new_events);
                        if patch.has_changes() {
                            let json = serde_json::to_string(&ServerMsg::DiffPatch {
                                added: patch.added,
                                removed: patch.removed,
                                updated: patch.updated,
                            }).unwrap();
                            if socket.send(Message::Text(json)).await.is_err() { break; }
                        }
                        known = new_events.into_iter()
                            .map(|e| (e.id, EventDigest {
                                severity: e.severity.clone(),
                                state: e.state.clone(),
                            }))
                            .collect();
                    }
                    current_bounds = new_bounds;
                    current_zoom = new_zoom;
                }
            }

            // New event from broadcast channel
            result = rx.recv() => {
                match result {
                    Ok(vpe) => {
                        if !current_bounds.contains(vpe.lat, vpe.lng) { continue; }

                        // low_bandwidth: skip MEDIUM/LOW events
                        // We'd need severity in ViewportEvent for this check;
                        // for now pass through (Phase 2c can add severity to ViewportEvent)

                        // Rate limiting
                        let now = Instant::now();
                        if now.duration_since(rate_window_start) >= Duration::from_secs(1) {
                            rate_window_start = now;
                            rate_count = 0;
                        }
                        if rate_count >= rate_cap {
                            tracing::debug!("viewport WS rate cap reached, dropping event");
                            continue;
                        }
                        rate_count += 1;

                        // Check if added or updated
                        let id = vpe.id;
                        let digest_from_json = parse_digest_from_json(&vpe.event_json);
                        let (mut added, updated) = (vec![], vec![]);
                        let is_known = known.contains_key(&id);

                        // Deserialise to WsEvent for the patch
                        if let Ok(ws_evt) = serde_json::from_str::<WsEvent>(&vpe.event_json) {
                            let (added, updated) = if is_known {
                                (vec![], vec![ws_evt.clone()])
                            } else {
                                (vec![ws_evt.clone()], vec![])
                            };
                            if added.is_empty() && updated.is_empty() { continue; }

                            if let Some(d) = digest_from_json {
                                known.insert(id, d);
                            }

                            let json = serde_json::to_string(&ServerMsg::DiffPatch {
                                added,
                                removed: vec![],
                                updated,
                            }).unwrap();
                            if socket.send(Message::Text(json)).await.is_err() { break; }
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("viewport WS lagged by {n}, sending snapshot");
                        if let Ok(events) =
                            query_viewport_events(&state.db, &current_bounds, &filters, current_zoom).await
                        {
                            known = events.iter()
                                .map(|e| (e.id, EventDigest {
                                    severity: e.severity.clone(),
                                    state: e.state.clone(),
                                }))
                                .collect();
                            let json = serde_json::to_string(&ServerMsg::Snapshot {
                                events,
                            }).unwrap();
                            if socket.send(Message::Text(json)).await.is_err() { break; }
                        }
                        rx = state.event_tx.subscribe();
                    }
                    Err(_) => break,
                }
            }

            // Message from client
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        match serde_json::from_str::<ClientMsg>(&text) {
                            Ok(ClientMsg::ViewportChanged { bounds, zoom }) => {
                                pending_viewport = Some((bounds, zoom));
                                debounce_sleep
                                    .as_mut()
                                    .reset(tokio::time::Instant::now() + debounce_dur);
                                debounce_active = true;
                            }
                            Ok(ClientMsg::SnapshotRequest) => {
                                if let Ok(events) = query_viewport_events(
                                    &state.db, &current_bounds, &filters, current_zoom
                                ).await {
                                    known = events.iter()
                                        .map(|e| (e.id, EventDigest {
                                            severity: e.severity.clone(),
                                            state: e.state.clone(),
                                        }))
                                        .collect();
                                    let json = serde_json::to_string(
                                        &ServerMsg::Snapshot { events }
                                    ).unwrap();
                                    if socket.send(Message::Text(json)).await.is_err() { break; }
                                }
                            }
                            Ok(ClientMsg::Subscribe { .. }) => {} // ignore re-subscribe
                            Err(_) => {} // ignore unparseable
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

struct DiffResult {
    added: Vec<WsEvent>,
    removed: Vec<Uuid>,
    updated: Vec<WsEvent>,
}

impl DiffResult {
    fn has_changes(&self) -> bool {
        !self.added.is_empty() || !self.removed.is_empty() || !self.updated.is_empty()
    }
}

fn compute_diff(known: &HashMap<Uuid, EventDigest>, new_events: &[WsEvent]) -> DiffResult {
    let mut added = vec![];
    let mut updated = vec![];

    for e in new_events {
        let new_digest = EventDigest { severity: e.severity.clone(), state: e.state.clone() };
        match known.get(&e.id) {
            None => added.push(e.clone()),
            Some(old) if old != &new_digest => updated.push(e.clone()),
            _ => {}
        }
    }

    let new_ids: std::collections::HashSet<Uuid> = new_events.iter().map(|e| e.id).collect();
    let removed = known.keys().filter(|id| !new_ids.contains(id)).copied().collect();

    DiffResult { added, removed, updated }
}

fn parse_digest_from_json(json: &str) -> Option<EventDigest> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    Some(EventDigest {
        severity: v["severity"].as_str()?.to_string(),
        state: v["state"].as_str()?.to_string(),
    })
}
```

Note on `low_bandwidth` mode: `ViewportEvent` does not currently carry `severity`. Add severity to `ViewportEvent` to enable low-bandwidth filtering in the broadcast loop. Do this now:

Update `ViewportEvent` in `events_ws.rs` to add `severity`:

```rust
#[derive(Debug, Clone)]
pub struct ViewportEvent {
    pub id: Uuid,
    pub lat: f64,
    pub lng: f64,
    pub severity: String,
    pub event_json: Arc<str>,
}
```

Update the broadcast path in `event_subscriber.rs` to include severity:

```rust
let _ = event_tx.send(crate::ws::ViewportEvent {
    id: event.id,
    lat: event.lat,
    lng: event.lng,
    severity: event.severity.clone(),
    event_json: ws_event_json.to_string().into(),
});
```

And add the `low_bandwidth` check in the broadcast receive arm:

```rust
// low_bandwidth: only forward CRITICAL and HIGH events
if low_bandwidth && !matches!(vpe.severity.as_str(), "CRITICAL" | "HIGH") {
    continue;
}
```

- [ ] **Step 4: Update ws/mod.rs to re-export properly**

Confirm `services/gateway/src/ws/mod.rs` reads:

```rust
pub mod hub;
pub mod circle_hub;
pub mod events_ws;

pub use events_ws::{ws_events_handler, ViewportEvent};

// ... rest unchanged ...
```

- [ ] **Step 5: Register /ws/events route in main.rs**

In the router construction in `main()`:

```rust
let app = Router::new()
    .route("/health", get(health))
    .route("/health/detailed", get(health_detailed))
    .route("/ws", get(ws::ws_handler))
    .route("/ws/circles", get(ws::ws_circles_handler))
    .route("/ws/events", get(ws::ws_events_handler))
    .merge(routes::build_router())
    .layer(GovernorLayer { config: governor_conf })
    .layer(cors)
    .with_state(state);
```

- [ ] **Step 6: Run all gateway tests**

```
cd services && cargo test -p gateway
```
Expected: all tests pass. The new viewport tests and the type tests from Task 2 all pass.

- [ ] **Step 7: Commit**

```bash
git add services/gateway/src/ws/events_ws.rs \
        services/gateway/src/ws/mod.rs \
        services/gateway/src/main.rs \
        services/gateway/src/subscribers/event_subscriber.rs
git commit -m "feat: implement /ws/events handler — SUBSCRIBE, INITIAL_BATCH, DIFF_PATCH, SNAPSHOT, debounce, rate limit"
```

---

## Task 4: Unit tests for compute_diff and parse_digest_from_json

**Files:**
- Modify: `services/gateway/src/ws/events_ws.rs`

The `compute_diff` and `parse_digest_from_json` helpers are pure functions and fully unit-testable. This task adds focused tests for both.

- [ ] **Step 1: Add tests**

Add to the `#[cfg(test)]` block in `events_ws.rs`:

```rust
    fn make_event(id: u128, severity: &str, state: &str) -> WsEvent {
        WsEvent {
            id: Uuid::from_u128(id),
            event_type: "FIRE".into(),
            severity: severity.into(),
            state: state.into(),
            title: "Test".into(),
            lat: -1.0,
            lng: 36.0,
            started_at: chrono::Utc::now(),
        }
    }

    #[test]
    fn compute_diff_all_added_when_known_empty() {
        let known = HashMap::new();
        let new_events = vec![make_event(1, "HIGH", "ACTIVE")];
        let diff = compute_diff(&known, &new_events);
        assert_eq!(diff.added.len(), 1);
        assert!(diff.removed.is_empty());
        assert!(diff.updated.is_empty());
    }

    #[test]
    fn compute_diff_all_removed_when_new_empty() {
        let mut known = HashMap::new();
        known.insert(Uuid::from_u128(1), EventDigest { severity: "HIGH".into(), state: "ACTIVE".into() });
        let diff = compute_diff(&known, &[]);
        assert!(diff.added.is_empty());
        assert_eq!(diff.removed, vec![Uuid::from_u128(1)]);
        assert!(diff.updated.is_empty());
    }

    #[test]
    fn compute_diff_detects_severity_upgrade() {
        let id = Uuid::from_u128(1);
        let mut known = HashMap::new();
        known.insert(id, EventDigest { severity: "HIGH".into(), state: "ACTIVE".into() });
        let new_events = vec![make_event(1, "CRITICAL", "ACTIVE")];
        let diff = compute_diff(&known, &new_events);
        assert!(diff.added.is_empty());
        assert!(diff.removed.is_empty());
        assert_eq!(diff.updated.len(), 1);
        assert_eq!(diff.updated[0].severity, "CRITICAL");
    }

    #[test]
    fn compute_diff_no_change_produces_empty_diff() {
        let id = Uuid::from_u128(1);
        let mut known = HashMap::new();
        known.insert(id, EventDigest { severity: "HIGH".into(), state: "ACTIVE".into() });
        let new_events = vec![make_event(1, "HIGH", "ACTIVE")];
        let diff = compute_diff(&known, &new_events);
        assert!(!diff.has_changes());
    }

    #[test]
    fn parse_digest_from_valid_json() {
        let json = r#"{"id":"00000000-0000-0000-0000-000000000000","severity":"CRITICAL","state":"ACTIVE","title":"T","event_type":"FIRE","lat":0.0,"lng":0.0,"started_at":"2024-01-01T00:00:00Z"}"#;
        let digest = parse_digest_from_json(json).unwrap();
        assert_eq!(digest.severity, "CRITICAL");
        assert_eq!(digest.state, "ACTIVE");
    }

    #[test]
    fn parse_digest_from_invalid_json_returns_none() {
        assert!(parse_digest_from_json("not json").is_none());
    }

    #[test]
    fn parse_digest_missing_field_returns_none() {
        let json = r#"{"id":"00000000-0000-0000-0000-000000000000","severity":"CRITICAL"}"#;
        // Missing "state" field
        assert!(parse_digest_from_json(json).is_none());
    }
```

- [ ] **Step 2: Run tests**

```
cd services && cargo test -p gateway -- ws::events_ws
```
Expected: all viewport WS tests pass (should now be 20+ tests in the module).

- [ ] **Step 3: Commit**

```bash
git add services/gateway/src/ws/events_ws.rs
git commit -m "test: add compute_diff and parse_digest_from_json unit tests"
```

---

## Task 5: Final integration — run full test suite + verify build

**Files:**
- No code changes in this task — verification only.

- [ ] **Step 1: Run the full gateway test suite**

```
cd services && cargo test -p gateway 2>&1
```
Expected: all tests pass, including:
- `ws::events_ws::tests` (20+ tests)
- `subscribers::event_subscriber::tests` (6 tests)
- All existing routes, hub, circle_hub, config tests

Count: should be 70+ total.

- [ ] **Step 2: Confirm the binary compiles cleanly**

```
cd services && cargo build -p gateway 2>&1 | grep -E "^error"
```
Expected: no errors (warnings about unused variables are acceptable).

- [ ] **Step 3: Verify /ws/events route is registered**

```
cd services && grep -n "ws/events\|ws_events_handler" gateway/src/main.rs gateway/src/ws/mod.rs
```
Expected: route visible in both files.

- [ ] **Step 4: Commit (if any last fixes were needed)**

If no changes: skip commit.

---

## Self-Review

**Spec coverage:**

| Spec requirement (§3) | Covered by |
|---|---|
| One WS connection per client | Task 3 handler — one connection per axum WS upgrade |
| `subscribe({bounds, zoom, filters})` message | Task 2 ClientMsg::Subscribe |
| `initial_batch([events])` response | Task 3 SUBSCRIBE handler |
| `viewport_changed({bounds,...})` debounced 300ms | Task 3 debounce_sleep pattern |
| `diff_patch({added, removed, updated})` | Tasks 3 + 4 compute_diff |
| `snapshot_request` → full batch | Task 3 SnapshotRequest arm |
| Lag recovery → snapshot | Task 3 RecvError::Lagged arm |
| Per-client rate cap | Task 3 rate_count/rate_cap |
| `low_bandwidth` flag | Task 3 severity filter in broadcast arm |
| Subscription state discarded on disconnect | Task 3 — local state, no persistence |

**Placeholder scan:** None.

**Type consistency:**
- `ViewportEvent.severity: String` added to support `low_bandwidth` ✓
- `WsEvent` used consistently in `DiffResult`, `ServerMsg`, `compute_diff` ✓
- `Bounds.contains(lat, lng)` used in broadcast arm ✓
- `ST_MakeEnvelope(west, south, east, north, 4326)` bind order matches field order ✓

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-18-global-map-phase2b.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, spec + quality review between tasks

**2. Inline Execution** — execute in this session using executing-plans

**Which approach?**
