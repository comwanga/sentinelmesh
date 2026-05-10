use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct RedisEventPayload {
    pub schema_version: u32,
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
    pub created_at: DateTime<Utc>,
}

impl From<RedisEventPayload> for crate::Event {
    fn from(p: RedisEventPayload) -> Self {
        Self {
            id: p.id,
            event_type: p.event_type,
            severity: p.severity,
            title: p.title,
            lat: p.lat,
            lng: p.lng,
            started_at: p.started_at,
            summary: p.summary,
            place_name: p.place_name,
            county: p.county,
            is_active: p.is_active,
            created_at: p.created_at,
        }
    }
}

impl From<&RedisEventPayload> for crate::Event {
    fn from(p: &RedisEventPayload) -> Self {
        Self {
            id: p.id,
            event_type: p.event_type.clone(),
            severity: p.severity.clone(),
            title: p.title.clone(),
            lat: p.lat,
            lng: p.lng,
            started_at: p.started_at,
            summary: p.summary.clone(),
            place_name: p.place_name.clone(),
            county: p.county.clone(),
            is_active: p.is_active,
            created_at: p.created_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn sample() -> RedisEventPayload {
        RedisEventPayload {
            schema_version: 1,
            id: Uuid::new_v4(),
            event_type: "FIRE".into(),
            severity: "HIGH".into(),
            title: "Test fire".into(),
            lat: -1.286,
            lng: 36.817,
            started_at: Utc::now(),
            summary: Some("Grass fire near park".into()),
            place_name: Some("Uhuru Park".into()),
            county: Some("Nairobi".into()),
            is_active: true,
            created_at: Utc::now(),
        }
    }

    #[test]
    fn serde_round_trip() {
        let payload = sample();
        let json = serde_json::to_string(&payload).unwrap();
        let back: RedisEventPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(payload.id, back.id);
        assert_eq!(payload.event_type, back.event_type);
        assert_eq!(payload.severity, back.severity);
        assert_eq!(payload.lat, back.lat);
        assert_eq!(payload.is_active, back.is_active);
        assert_eq!(payload.county, back.county);
        assert_eq!(payload.schema_version, back.schema_version);
    }

    #[test]
    fn converts_to_event() {
        let payload = sample();
        let event = crate::Event::from(payload.clone());
        assert_eq!(payload.id, event.id);
        assert_eq!(payload.event_type, event.event_type);
        assert_eq!(payload.lat, event.lat);
        assert_eq!(payload.lng, event.lng);
        assert_eq!(payload.county, event.county);
        assert_eq!(payload.is_active, event.is_active);
        assert_eq!(payload.severity, event.severity);
        assert_eq!(payload.title, event.title);
        assert_eq!(payload.summary, event.summary);
        assert_eq!(payload.place_name, event.place_name);
        assert_eq!(payload.started_at, event.started_at);
        assert_eq!(payload.created_at, event.created_at);
    }

    #[test]
    fn optional_fields_absent() {
        let mut payload = sample();
        payload.summary = None;
        payload.place_name = None;
        payload.county = None;
        let json = serde_json::to_string(&payload).unwrap();
        let back: RedisEventPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(back.summary, None);
        assert_eq!(back.place_name, None);
        assert_eq!(back.county, None);
    }
}
