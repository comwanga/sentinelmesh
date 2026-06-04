//! Per-circle keyed tokenization for the C-3 social-graph privacy work.
//!
//! A circle identifier is stored as `v1:HMAC-SHA256(CIRCLE_TOKEN_SECRET,
//! circle_id_utf8 || pubkey_utf8)` (lowercase hex). Including `circle_id` makes
//! the same pubkey yield a DIFFERENT token in every circle, so a DB dump without
//! the secret can neither reverse a token to a pubkey nor link a person across
//! circles. The `v1:` prefix lives inside the value so a future scheme (BLAKE3,
//! HKDF, rotated secret) can coexist row-by-row.

use hmac::{Hmac, Mac};
use sha2::Sha256;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

/// Current token scheme prefix. Bump when the algorithm or secret derivation changes.
pub const TOKEN_VERSION_PREFIX: &str = "v1:";

/// Compute the per-circle token for `(circle_id, pubkey)`.
/// `circle_id` is fed as its canonical lowercase hyphenated UUID string; `pubkey`
/// as received (lowercase hex Nostr pubkey). Both are byte-fed identically by the
/// live path and the backfill so tokens always agree.
pub fn circle_token(secret: &str, circle_id: Uuid, pubkey: &str) -> String {
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC accepts any key length");
    mac.update(circle_id.to_string().as_bytes());
    mac.update(pubkey.as_bytes());
    let digest = mac.finalize().into_bytes();
    format!("{}{}", TOKEN_VERSION_PREFIX, hex::encode(digest))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cid() -> Uuid {
        Uuid::parse_str("11111111-1111-1111-1111-111111111111").unwrap()
    }

    #[test]
    fn token_is_deterministic() {
        let a = circle_token("secret", cid(), "pubkeyhex");
        let b = circle_token("secret", cid(), "pubkeyhex");
        assert_eq!(a, b);
    }

    #[test]
    fn token_has_version_prefix() {
        assert!(circle_token("secret", cid(), "pk").starts_with("v1:"));
    }

    #[test]
    fn same_pubkey_differs_per_circle() {
        let c1 = Uuid::parse_str("11111111-1111-1111-1111-111111111111").unwrap();
        let c2 = Uuid::parse_str("22222222-2222-2222-2222-222222222222").unwrap();
        assert_ne!(circle_token("secret", c1, "pk"), circle_token("secret", c2, "pk"));
    }

    #[test]
    fn distinct_pubkeys_differ() {
        assert_ne!(
            circle_token("secret", cid(), "alice"),
            circle_token("secret", cid(), "bob")
        );
    }

    #[test]
    fn distinct_secrets_differ() {
        assert_ne!(
            circle_token("secret-a", cid(), "pk"),
            circle_token("secret-b", cid(), "pk")
        );
    }
}
