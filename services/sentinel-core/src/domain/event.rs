use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Canonical safety event — transport/domain form.
/// No sqlx::FromRow. The gateway's SafetyEvent DB struct converts to this via From.
/// Fields: only those needed by both services or over the wire. DB-specific tracking
/// fields (nostr_event_id, radius_meters, source_breakdown, updated_at)
/// are intentionally excluded.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Event {
    pub id: Uuid,
    pub event_type: String,
    pub severity: String,
    pub title: String,
    pub lat: f64,
    pub lng: f64,
    pub started_at: DateTime<Utc>,
    pub summary: Option<String>,
    pub place_name: Option<String>,
    pub county: Option<String>,
    pub is_active: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn sample() -> Event {
        Event {
            id: Uuid::nil(),
            event_type: "FIRE".into(),
            severity: "HIGH".into(),
            title: "Test fire".into(),
            lat: 1.23,
            lng: 4.56,
            started_at: Utc::now(),
            summary: Some("summary".into()),
            place_name: Some("Main St".into()),
            county: Some("Nairobi".into()),
            is_active: true,
            state: Some("ACTIVE".into()),
            created_at: Utc::now(),
        }
    }

    #[test]
    fn serde_round_trip() {
        let e = sample();
        let json = serde_json::to_string(&e).unwrap();
        let back: Event = serde_json::from_str(&json).unwrap();
        assert_eq!(e.id, back.id);
        assert_eq!(e.event_type, back.event_type);
        assert_eq!(e.severity, back.severity);
        assert_eq!(e.county, back.county);
        assert_eq!(e.is_active, back.is_active);
    }

    #[test]
    fn optional_fields_absent_round_trip() {
        let mut e = sample();
        e.summary = None;
        e.place_name = None;
        e.county = None;
        let json = serde_json::to_string(&e).unwrap();
        let back: Event = serde_json::from_str(&json).unwrap();
        assert_eq!(back.summary, None);
        assert_eq!(back.place_name, None);
        assert_eq!(back.county, None);
    }

    #[test]
    fn state_field_present_and_roundtrips_absent_key() {
        let json = r#"{"id":"00000000-0000-0000-0000-000000000000","event_type":"FIRE","severity":"HIGH","title":"T","lat":0.0,"lng":0.0,"started_at":"2024-01-01T00:00:00Z","summary":null,"place_name":null,"county":null,"is_active":true,"created_at":"2024-01-01T00:00:00Z"}"#;
        let e: Event = serde_json::from_str(json).unwrap();
        assert_eq!(e.state, None);
    }

    #[test]
    fn state_none_round_trip() {
        let mut e = sample();
        e.state = None;
        let json = serde_json::to_string(&e).unwrap();
        let back: Event = serde_json::from_str(&json).unwrap();
        assert_eq!(back.state, None);
    }

    #[test]
    fn state_some_round_trip() {
        let mut e = sample();
        e.state = Some("ACTIVE".into());
        let json = serde_json::to_string(&e).unwrap();
        let back: Event = serde_json::from_str(&json).unwrap();
        assert_eq!(back.state, Some("ACTIVE".into()));
    }
}
