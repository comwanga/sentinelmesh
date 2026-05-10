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
    use chrono::Utc;

    #[test]
    fn location_blob_serde_round_trip() {
        let b = LocationBlob {
            id: Uuid::nil(),
            circle_id: Uuid::nil(),
            sender_pubkey: "pubkey".into(),
            encrypted_payload: "cipher".into(),
            created_at: Utc::now(),
            expires_at: Utc::now(),
        };
        let json = serde_json::to_string(&b).unwrap();
        let back: LocationBlob = serde_json::from_str(&json).unwrap();
        assert_eq!(b.id, back.id);
        assert_eq!(b.sender_pubkey, back.sender_pubkey);
        assert_eq!(b.encrypted_payload, back.encrypted_payload);
    }
}
