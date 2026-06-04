use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::broadcast;
use uuid::Uuid;

/// Lightweight event broadcast to all viewport WS handlers when a new event
/// arrives from the Redis stream. Each handler decides independently whether
/// the event falls inside its current bounds.
#[derive(Debug, Clone)]
pub struct ViewportEvent {
    pub id: Uuid,
    pub lat: f64,
    pub lng: f64,
    pub severity: String,
    /// Pre-serialised WsEvent JSON (Arc avoids cloning per subscriber).
    pub event_json: Arc<str>,
}

// ---------------------------------------------------------------------------
// DB projection — lighter than SafetyEvent, sized for WS payloads
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct WsEvent {
    pub id: Uuid,
    pub event_type: String,
    pub severity: String,
    pub state: String,
    #[serde(default = "default_trust_state")]
    pub trust_state: String,
    pub title: String,
    pub lat: f64,
    pub lng: f64,
    pub started_at: DateTime<Utc>,
}

fn default_trust_state() -> String {
    "confirmed".to_string()
}

// ---------------------------------------------------------------------------
// Per-connection state
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct EventDigest {
    pub severity: String,
    pub state: String,
    pub trust_state: String,
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
    InitialBatch {
        events: &'a [WsEvent],
    },
    DiffPatch {
        added: Vec<WsEvent>,
        removed: Vec<Uuid>,
        updated: Vec<WsEvent>,
    },
    Snapshot {
        events: Vec<WsEvent>,
    },
    Error {
        message: &'a str,
    },
}

// ---------------------------------------------------------------------------
// viewport_event_limit
// ---------------------------------------------------------------------------

/// Dynamic row limit based on zoom: denser viewports at low zoom get fewer rows.
pub fn viewport_event_limit(zoom: f64) -> i64 {
    ((800.0 / (zoom - 8.0).max(1.0)) as i64).clamp(50, 400)
}

// ---------------------------------------------------------------------------
// query_viewport_events
// ---------------------------------------------------------------------------

pub async fn query_viewport_events(
    pool: &PgPool,
    bounds: &Bounds,
    filters: &[String],
    zoom: f64,
) -> sqlx::Result<Vec<WsEvent>> {
    let limit = viewport_event_limit(zoom);
    // Table uses lat/lng numerics — no PostGIS. Simple bounding-box range filter.
    // $1=west $2=south $3=east $4=north; state derived from is_active.
    if filters.is_empty() {
        sqlx::query_as::<_, WsEvent>(
            "SELECT id, event_type, severity,
                    CASE WHEN is_active THEN 'ACTIVE' ELSE 'INACTIVE' END AS state,
                    trust_state,
                    title, lat::float8 AS lat, lng::float8 AS lng, started_at
               FROM safety_events
              WHERE lat BETWEEN $2 AND $4
                AND lng BETWEEN $1 AND $3
                AND is_active = true
              ORDER BY
                CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1
                              WHEN 'MEDIUM' THEN 2 ELSE 3 END ASC
              LIMIT $5",
        )
        .bind(bounds.west)
        .bind(bounds.south)
        .bind(bounds.east)
        .bind(bounds.north)
        .bind(limit)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query_as::<_, WsEvent>(
            "SELECT id, event_type, severity,
                    CASE WHEN is_active THEN 'ACTIVE' ELSE 'INACTIVE' END AS state,
                    trust_state,
                    title, lat::float8 AS lat, lng::float8 AS lng, started_at
               FROM safety_events
              WHERE lat BETWEEN $2 AND $4
                AND lng BETWEEN $1 AND $3
                AND is_active = true
                AND event_type = ANY($5)
              ORDER BY
                CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1
                              WHEN 'MEDIUM' THEN 2 ELSE 3 END ASC
              LIMIT $6",
        )
        .bind(bounds.west)
        .bind(bounds.south)
        .bind(bounds.east)
        .bind(bounds.north)
        .bind(filters)
        .bind(limit)
        .fetch_all(pool)
        .await
    }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

pub async fn ws_events_handler(
    ws: WebSocketUpgrade,
    State(state): State<crate::AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_events_ws(socket, state))
}

async fn handle_events_ws(mut socket: WebSocket, state: crate::AppState) {
    use std::collections::HashMap;

    // --- Phase 1: await SUBSCRIBE message ---
    let (bounds, zoom, filters, low_bandwidth) = loop {
        match socket.recv().await {
            Some(Ok(Message::Text(text))) => match serde_json::from_str::<ClientMsg>(&text) {
                Ok(ClientMsg::Subscribe {
                    bounds,
                    zoom,
                    filters,
                    low_bandwidth,
                }) => {
                    break (bounds, zoom, filters, low_bandwidth);
                }
                Ok(_) => {
                    let err = serde_json::to_string(&ServerMsg::Error {
                        message: "first message must be SUBSCRIBE",
                    })
                    .unwrap();
                    let _ = socket.send(Message::Text(err)).await;
                }
                Err(e) => {
                    let err = serde_json::to_string(&ServerMsg::Error {
                        message: &format!("invalid message: {e}"),
                    })
                    .unwrap();
                    let _ = socket.send(Message::Text(err)).await;
                }
            },
            _ => return, // client disconnected or sent non-text
        }
    };

    // --- Phase 2: send initial batch ---
    let initial = match query_viewport_events(&state.db, &bounds, &filters, zoom).await {
        Ok(events) => events,
        Err(e) => {
            tracing::warn!("viewport WS query failed: {e:#}");
            let err = serde_json::to_string(&ServerMsg::Error {
                message: "db error",
            })
            .unwrap();
            let _ = socket.send(Message::Text(err)).await;
            return;
        }
    };

    let initial_json =
        serde_json::to_string(&ServerMsg::InitialBatch { events: &initial }).unwrap();
    if socket.send(Message::Text(initial_json)).await.is_err() {
        return;
    }

    // --- Phase 3: build known-events map and enter main loop ---
    let mut known: HashMap<Uuid, EventDigest> = initial
        .iter()
        .map(|e| {
            (
                e.id,
                EventDigest {
                    severity: e.severity.clone(),
                    state: e.state.clone(),
                    trust_state: e.trust_state.clone(),
                },
            )
        })
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
                                trust_state: e.trust_state.clone(),
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

                        // low_bandwidth: only forward CRITICAL and HIGH events
                        if low_bandwidth && !matches!(vpe.severity.as_str(), "CRITICAL" | "HIGH") {
                            continue;
                        }

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

                        let id = vpe.id;
                        let is_known = known.contains_key(&id);

                        if let Ok(ws_evt) = serde_json::from_str::<WsEvent>(&vpe.event_json) {
                            let digest = EventDigest { severity: ws_evt.severity.clone(), state: ws_evt.state.clone(), trust_state: ws_evt.trust_state.clone() };
                            let (added, updated) = if is_known {
                                (vec![], vec![ws_evt])
                            } else {
                                (vec![ws_evt], vec![])
                            };

                            known.insert(id, digest);

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
                        // Resubscribe first so we don't miss events published during the DB query
                        rx = state.event_tx.subscribe();
                        if let Ok(events) =
                            query_viewport_events(&state.db, &current_bounds, &filters, current_zoom).await
                        {
                            known = events.iter()
                                .map(|e| (e.id, EventDigest {
                                    severity: e.severity.clone(),
                                    state: e.state.clone(),
                                    trust_state: e.trust_state.clone(),
                                }))
                                .collect();
                            let json = serde_json::to_string(&ServerMsg::Snapshot {
                                events,
                            }).unwrap();
                            if socket.send(Message::Text(json)).await.is_err() { break; }
                        }
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
                                            trust_state: e.trust_state.clone(),
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
// DiffResult and helpers
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

fn compute_diff(
    known: &std::collections::HashMap<Uuid, EventDigest>,
    new_events: &[WsEvent],
) -> DiffResult {
    let mut added = vec![];
    let mut updated = vec![];

    for e in new_events {
        let new_digest = EventDigest {
            severity: e.severity.clone(),
            state: e.state.clone(),
            trust_state: e.trust_state.clone(),
        };
        match known.get(&e.id) {
            None => added.push(e.clone()),
            Some(old) if old != &new_digest => updated.push(e.clone()),
            _ => {}
        }
    }

    let new_ids: std::collections::HashSet<Uuid> = new_events.iter().map(|e| e.id).collect();
    let removed = known
        .keys()
        .filter(|id| !new_ids.contains(id))
        .copied()
        .collect();

    DiffResult {
        added,
        removed,
        updated,
    }
}

#[cfg(test)]
fn parse_digest_from_json(json: &str) -> Option<EventDigest> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    Some(EventDigest {
        severity: v["severity"].as_str()?.to_string(),
        state: v["state"].as_str()?.to_string(),
        trust_state: v
            .get("trust_state")
            .and_then(|t| t.as_str())
            .unwrap_or("confirmed")
            .to_string(),
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn bounds_contains_point_inside() {
        let b = Bounds {
            north: 0.0,
            south: -2.0,
            east: 37.0,
            west: 36.0,
        };
        assert!(b.contains(-1.0, 36.5));
    }

    #[test]
    fn bounds_does_not_contain_point_outside() {
        let b = Bounds {
            north: 0.0,
            south: -2.0,
            east: 37.0,
            west: 36.0,
        };
        assert!(!b.contains(1.0, 36.5));
        assert!(!b.contains(-1.0, 38.0));
    }

    #[test]
    fn bounds_edge_is_inclusive() {
        let b = Bounds {
            north: 0.0,
            south: -2.0,
            east: 37.0,
            west: 36.0,
        };
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
        if let ClientMsg::Subscribe {
            filters,
            low_bandwidth,
            ..
        } = msg
        {
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
        let d1 = EventDigest {
            severity: "HIGH".into(),
            state: "ACTIVE".into(),
            trust_state: "confirmed".into(),
        };
        let d2 = EventDigest {
            severity: "CRITICAL".into(),
            state: "ACTIVE".into(),
            trust_state: "confirmed".into(),
        };
        assert_ne!(d1, d2);
    }

    #[test]
    fn event_digest_detects_state_change() {
        let d1 = EventDigest {
            severity: "HIGH".into(),
            state: "ACTIVE".into(),
            trust_state: "confirmed".into(),
        };
        let d2 = EventDigest {
            severity: "HIGH".into(),
            state: "RESOLVED".into(),
            trust_state: "confirmed".into(),
        };
        assert_ne!(d1, d2);
    }

    #[test]
    fn event_digest_detects_trust_state_change() {
        let d1 = EventDigest {
            severity: "HIGH".into(),
            state: "ACTIVE".into(),
            trust_state: "corroborating".into(),
        };
        let d2 = EventDigest {
            severity: "HIGH".into(),
            state: "ACTIVE".into(),
            trust_state: "confirmed".into(),
        };
        assert_ne!(d1, d2);
    }

    #[test]
    fn compute_diff_detects_trust_state_upgrade() {
        let mut known = std::collections::HashMap::new();
        let id = Uuid::from_u128(1);
        known.insert(
            id,
            EventDigest {
                severity: "HIGH".into(),
                state: "ACTIVE".into(),
                trust_state: "corroborating".into(),
            },
        );
        let new_events = vec![WsEvent {
            id,
            event_type: "ACOUSTIC".into(),
            severity: "HIGH".into(),
            state: "ACTIVE".into(),
            trust_state: "confirmed".into(),
            title: "gunshot".into(),
            lat: -1.0,
            lng: 36.0,
            started_at: chrono::Utc::now(),
        }];
        let diff = compute_diff(&known, &new_events);
        assert!(diff.added.is_empty());
        assert!(diff.removed.is_empty());
        assert_eq!(diff.updated.len(), 1);
        assert_eq!(diff.updated[0].trust_state, "confirmed");
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
        let old: HashMap<Uuid, EventDigest> = {
            let mut m = HashMap::new();
            m.insert(
                Uuid::nil(),
                EventDigest {
                    severity: "HIGH".into(),
                    state: "ACTIVE".into(),
                    trust_state: "confirmed".into(),
                },
            );
            m
        };
        let id_new = Uuid::from_u128(1);
        let new_events = [WsEvent {
            id: id_new,
            event_type: "FIRE".into(),
            severity: "CRITICAL".into(),
            state: "ACTIVE".into(),
            trust_state: "confirmed".into(),
            title: "Fire".into(),
            lat: 0.0,
            lng: 0.0,
            started_at: chrono::Utc::now(),
        }];
        let added: Vec<&WsEvent> = new_events
            .iter()
            .filter(|e| !old.contains_key(&e.id))
            .collect();
        let removed: Vec<Uuid> = old
            .keys()
            .filter(|id| !new_events.iter().any(|e| &e.id == *id))
            .cloned()
            .collect();

        assert_eq!(added.len(), 1);
        assert_eq!(added[0].id, id_new);
        assert_eq!(removed, vec![Uuid::nil()]);
    }

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

    #[test]
    fn bounds_west_south_east_north_order_for_st_make_envelope() {
        // ST_MakeEnvelope(xmin, ymin, xmax, ymax) = (west, south, east, north)
        let b = Bounds {
            north: 1.0,
            south: -1.0,
            east: 38.0,
            west: 36.0,
        };
        let (w, s, e, n) = (b.west, b.south, b.east, b.north);
        assert_eq!(w, 36.0);
        assert_eq!(s, -1.0);
        assert_eq!(e, 38.0);
        assert_eq!(n, 1.0);
    }

    fn make_event(id: u128, severity: &str, state: &str) -> WsEvent {
        WsEvent {
            id: Uuid::from_u128(id),
            event_type: "FIRE".into(),
            severity: severity.into(),
            state: state.into(),
            trust_state: "confirmed".into(),
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
        known.insert(
            Uuid::from_u128(1),
            EventDigest {
                severity: "HIGH".into(),
                state: "ACTIVE".into(),
                trust_state: "confirmed".into(),
            },
        );
        let diff = compute_diff(&known, &[]);
        assert!(diff.added.is_empty());
        assert_eq!(diff.removed, vec![Uuid::from_u128(1)]);
        assert!(diff.updated.is_empty());
    }

    #[test]
    fn compute_diff_detects_severity_upgrade() {
        let id = Uuid::from_u128(1);
        let mut known = HashMap::new();
        known.insert(
            id,
            EventDigest {
                severity: "HIGH".into(),
                state: "ACTIVE".into(),
                trust_state: "confirmed".into(),
            },
        );
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
        known.insert(
            id,
            EventDigest {
                severity: "HIGH".into(),
                state: "ACTIVE".into(),
                trust_state: "confirmed".into(),
            },
        );
        let new_events = vec![make_event(1, "HIGH", "ACTIVE")];
        let diff = compute_diff(&known, &new_events);
        assert!(!diff.has_changes());
    }

    #[test]
    fn parse_digest_from_valid_json() {
        let json = r#"{"id":"00000000-0000-0000-0000-000000000000","severity":"CRITICAL","state":"ACTIVE","trust_state":"CONFIRMED","title":"T","event_type":"FIRE","lat":0.0,"lng":0.0,"started_at":"2024-01-01T00:00:00Z"}"#;
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
        assert!(parse_digest_from_json(json).is_none());
    }
}
