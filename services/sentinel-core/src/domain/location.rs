use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Canonical encrypted location blob — transport/domain form.
/// The server never inspects encrypted_payload; it is opaque ciphertext.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LocationBlob {
    pub id: Uuid,
    pub circle_id: Uuid,
    pub sender_pubkey: String,
    pub encrypted_payload: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::DateTime;

    #[test]
    fn location_blob_serde_round_trip() {
        let id = uuid::Uuid::new_v4();
        let cid = uuid::Uuid::new_v4();
        let created = DateTime::from_timestamp(0, 0).unwrap();
        let expires = DateTime::from_timestamp(600, 0).unwrap();
        let b = LocationBlob {
            id,
            circle_id: cid,
            sender_pubkey: "pubkey".into(),
            encrypted_payload: "cipher".into(),
            created_at: created,
            expires_at: expires,
        };
        let json = serde_json::to_string(&b).unwrap();
        let back: LocationBlob = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, id);
        assert_eq!(back.circle_id, cid);
        assert_eq!(back.sender_pubkey, "pubkey");
        assert_eq!(back.encrypted_payload, "cipher");
        assert_eq!(back.created_at, created);
        assert_eq!(back.expires_at, expires);
    }
}
