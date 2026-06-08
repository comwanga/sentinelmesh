/// Canonical binding for a vouch. The signed event's content must byte-equal
/// this; domain-separated so a signature from another context can't be replayed
/// as a vouch. MUST match the PWA `vouchBindingContent`.
// used by the vouch handlers (Task 5)
#[allow(dead_code)]
pub fn vouch_binding_content(vouchee_pubkey: &str) -> String {
    format!("sentinelmesh:vouch:v1:{vouchee_pubkey}")
}

/// Canonical binding for a vouch revocation. MUST match `vouchRevokeBindingContent`.
// used by the vouch handlers (Task 5)
#[allow(dead_code)]
pub fn vouch_revoke_binding_content(vouchee_pubkey: &str) -> String {
    format!("sentinelmesh:vouch-revoke:v1:{vouchee_pubkey}")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn vouch_binding_is_domain_separated() {
        assert_eq!(vouch_binding_content("abc"), "sentinelmesh:vouch:v1:abc");
    }
    #[test]
    fn vouch_revoke_binding_is_domain_separated() {
        assert_eq!(vouch_revoke_binding_content("abc"), "sentinelmesh:vouch-revoke:v1:abc");
    }
}
