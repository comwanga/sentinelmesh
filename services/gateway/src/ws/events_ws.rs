use std::sync::Arc;
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
    pub severity: String,
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
// Handler (stub — filled in Task 3)
// ---------------------------------------------------------------------------

pub async fn ws_events_handler() -> &'static str { "stub" }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

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
        let old: HashMap<Uuid, EventDigest> = {
            let mut m = HashMap::new();
            m.insert(Uuid::nil(), EventDigest { severity: "HIGH".into(), state: "ACTIVE".into() });
            m
        };
        let id_new = Uuid::from_u128(1);
        let new_events = vec![
            WsEvent { id: id_new, event_type: "FIRE".into(), severity: "CRITICAL".into(),
                      state: "ACTIVE".into(), title: "Fire".into(), lat: 0.0, lng: 0.0,
                      started_at: chrono::Utc::now() },
        ];
        let added: Vec<&WsEvent> = new_events.iter().filter(|e| !old.contains_key(&e.id)).collect();
        let removed: Vec<Uuid> = old.keys().filter(|id| !new_events.iter().any(|e| &e.id == *id)).cloned().collect();

        assert_eq!(added.len(), 1);
        assert_eq!(added[0].id, id_new);
        assert_eq!(removed, vec![Uuid::nil()]);
    }
}
