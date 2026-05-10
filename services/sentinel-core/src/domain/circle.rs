use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Canonical circle — transport/domain form. No sqlx::FromRow.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Circle {
    pub id: Uuid,
    pub owner_pubkey: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
}

/// Canonical circle member — transport/domain form.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CircleMember {
    pub circle_id: Uuid,
    pub member_pubkey: String,
    pub alert_radius_km: Option<f64>,
    pub alert_severity: Option<String>,
    pub joined_at: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn circle_serde_round_trip() {
        let c = Circle {
            id: Uuid::nil(),
            owner_pubkey: "abc123".into(),
            name: "Family".into(),
            created_at: Utc::now(),
        };
        let json = serde_json::to_string(&c).unwrap();
        let back: Circle = serde_json::from_str(&json).unwrap();
        assert_eq!(c.id, back.id);
        assert_eq!(c.owner_pubkey, back.owner_pubkey);
        assert_eq!(c.name, back.name);
    }

    #[test]
    fn circle_member_optional_fields_round_trip() {
        let m = CircleMember {
            circle_id: Uuid::nil(),
            member_pubkey: "def456".into(),
            alert_radius_km: None,
            alert_severity: None,
            joined_at: Utc::now(),
        };
        let json = serde_json::to_string(&m).unwrap();
        let back: CircleMember = serde_json::from_str(&json).unwrap();
        assert_eq!(back.alert_radius_km, None);
        assert_eq!(back.alert_severity, None);
        assert_eq!(back.member_pubkey, "def456");
    }

    #[test]
    fn circle_member_with_alert_settings_round_trip() {
        let m = CircleMember {
            circle_id: Uuid::nil(),
            member_pubkey: "pk".into(),
            alert_radius_km: Some(5.0),
            alert_severity: Some("HIGH".into()),
            joined_at: Utc::now(),
        };
        let json = serde_json::to_string(&m).unwrap();
        let back: CircleMember = serde_json::from_str(&json).unwrap();
        assert_eq!(back.alert_radius_km, Some(5.0));
        assert_eq!(back.alert_severity, Some("HIGH".into()));
    }
}
