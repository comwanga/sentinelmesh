use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Canonical opaque circle-location envelope transport form.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CircleLocationEnvelopeV1 {
    pub id: Uuid,
    pub version: i16,
    pub circle_id: Uuid,
    pub key_epoch: i32,
    pub ciphertext: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::DateTime;

    #[test]
    fn location_envelope_serde_is_opaque() {
        let id = uuid::Uuid::new_v4();
        let cid = uuid::Uuid::new_v4();
        let created = DateTime::from_timestamp(0, 0).unwrap();
        let expires = DateTime::from_timestamp(600, 0).unwrap();
        let b = CircleLocationEnvelopeV1 {
            id,
            version: 1,
            circle_id: cid,
            key_epoch: 3,
            ciphertext: "cipher".into(),
            created_at: created,
            expires_at: expires,
        };
        let json = serde_json::to_string(&b).unwrap();
        let back: CircleLocationEnvelopeV1 = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, id);
        assert_eq!(back.circle_id, cid);
        assert_eq!(back.version, 1);
        assert_eq!(back.key_epoch, 3);
        assert_eq!(back.ciphertext, "cipher");
        assert!(!json.contains("sender_token") && !json.contains("recipient"));
        assert_eq!(back.created_at, created);
        assert_eq!(back.expires_at, expires);
    }
}
