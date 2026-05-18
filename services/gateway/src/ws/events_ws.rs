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
    pub severity: String,
    /// Pre-serialised WsEvent JSON ready to embed in a DIFF_PATCH message.
    /// Using Arc<str> avoids cloning the string for each broadcast subscriber.
    pub event_json: Arc<str>,
}

pub async fn ws_events_handler() -> &'static str { "stub" }
