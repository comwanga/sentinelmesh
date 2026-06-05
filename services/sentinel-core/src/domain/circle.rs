use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Canonical circle — transport/domain form. No sqlx::FromRow.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Circle {
    pub id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
}

/// Canonical circle member — transport/domain form.
/// No sqlx::FromRow.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CircleMember {
    pub circle_id: Uuid,
    pub member_token: String,
    pub alert_radius_km: Option<f64>,
    pub alert_severity: Option<String>,
    pub joined_at: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::DateTime;
    use uuid::Uuid;

    #[test]
    fn circle_serde_round_trip() {
        let id = Uuid::new_v4();
        let created = DateTime::from_timestamp(0, 0).unwrap();
        let c = Circle {
            id,
            name: "Family".into(),
            created_at: created,
        };
        let json = serde_json::to_string(&c).unwrap();
        let back: Circle = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, id);
        assert_eq!(back.name, "Family");
        assert_eq!(back.created_at, created);
    }

    #[test]
    fn circle_member_optional_fields_round_trip() {
        let cid = Uuid::new_v4();
        let joined = DateTime::from_timestamp(0, 0).unwrap();
        let m = CircleMember {
            circle_id: cid,
            member_token: "v1:def456".into(),
            alert_radius_km: None,
            alert_severity: None,
            joined_at: joined,
        };
        let json = serde_json::to_string(&m).unwrap();
        let back: CircleMember = serde_json::from_str(&json).unwrap();
        assert_eq!(back.circle_id, cid);
        assert_eq!(back.alert_radius_km, None);
        assert_eq!(back.alert_severity, None);
        assert_eq!(back.member_token, "v1:def456");
        assert_eq!(back.joined_at, joined);
    }

    #[test]
    fn circle_member_with_alert_settings_round_trip() {
        let cid = Uuid::new_v4();
        let joined = DateTime::from_timestamp(0, 0).unwrap();
        let m = CircleMember {
            circle_id: cid,
            member_token: "v1:pk".into(),
            alert_radius_km: Some(5.0),
            alert_severity: Some("HIGH".into()),
            joined_at: joined,
        };
        let json = serde_json::to_string(&m).unwrap();
        let back: CircleMember = serde_json::from_str(&json).unwrap();
        assert_eq!(back.circle_id, cid);
        assert_eq!(back.alert_radius_km, Some(5.0));
        assert_eq!(back.alert_severity, Some("HIGH".into()));
        assert_eq!(back.member_token, "v1:pk");
        assert_eq!(back.joined_at, joined);
    }
}
