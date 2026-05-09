use sha2::{Digest, Sha256};

/// Reproduces the TypeScript buildAnchorHash function.
/// Input key order must match: event_id, nostr_event_id, severity.
/// Returns 64-char lowercase hex (32 bytes).
pub fn build_anchor_hash(event_id: &str, nostr_event_id: &str, severity: &str) -> String {
    let canonical = format!(
        r#"{{"event_id":"{}","nostr_event_id":"{}","severity":"{}"}}"#,
        event_id, nostr_event_id, severity
    );
    let hash = Sha256::digest(canonical.as_bytes());
    hex::encode(hash)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    #[test]
    fn anchor_hash_format() {
        let h = build_anchor_hash("abc", "def", "HIGH");
        assert_eq!(h.len(), 64, "must be 64 hex chars");
        assert!(h.chars().all(|c| c.is_ascii_hexdigit()), "must be hex");
        assert!(h.chars().all(|c| !c.is_uppercase()), "must be lowercase");
    }

    #[test]
    fn anchor_hash_is_deterministic() {
        let a = build_anchor_hash("id1", "nid1", "CRITICAL");
        let b = build_anchor_hash("id1", "nid1", "CRITICAL");
        assert_eq!(a, b);
    }

    #[test]
    fn anchor_hash_differs_on_input_change() {
        let a = build_anchor_hash("id1", "nid1", "HIGH");
        let b = build_anchor_hash("id1", "nid1", "LOW");
        assert_ne!(a, b);
    }

    #[test]
    fn anchor_hash_matches_canonical_json() {
        // Verify the canonical JSON string we hash is exactly what TypeScript produces.
        let canonical = r#"{"event_id":"abc","nostr_event_id":"def","severity":"HIGH"}"#;
        let expected = hex::encode(Sha256::digest(canonical.as_bytes()));
        let actual = build_anchor_hash("abc", "def", "HIGH");
        assert_eq!(actual, expected);
    }
}
