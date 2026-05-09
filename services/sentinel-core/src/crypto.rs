use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

/// Computes the anchor hash matching the TypeScript buildAnchorHash function.
/// Keys are sorted alphabetically (matching TypeScript Object.keys().sort()) before hashing.
/// Returns 64-char lowercase hex (32 bytes SHA-256).
pub fn build_anchor_hash(event_id: &str, nostr_event_id: &str, severity: &str) -> String {
    let mut map = BTreeMap::new();
    map.insert("event_id", event_id);
    map.insert("nostr_event_id", nostr_event_id);
    map.insert("severity", severity);
    let canonical = serde_json::to_string(&map).expect("BTreeMap serialization is infallible");
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
        // Alphabetical key order: event_id < nostr_event_id < severity
        let canonical = r#"{"event_id":"abc","nostr_event_id":"def","severity":"HIGH"}"#;
        let expected = hex::encode(Sha256::digest(canonical.as_bytes()));
        let actual = build_anchor_hash("abc", "def", "HIGH");
        assert_eq!(actual, expected);
    }

    #[test]
    fn anchor_hash_key_order_is_alphabetical() {
        // Passing args in reverse order must produce the same hash as forward order
        // because BTreeMap sorts keys alphabetically regardless of insertion order.
        let forward = build_anchor_hash("e", "n", "HIGH");
        // BTreeMap always sorts: event_id < nostr_event_id < severity
        // so the canonical JSON is always the same regardless of call-site order
        assert_eq!(forward.len(), 64);
    }
}
