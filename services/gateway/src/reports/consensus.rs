/// Returns the new status if a transition applies, None if no transition.
/// Priority: rejection > dispute > positive progression.
///
/// `score` is the reputation-weighted consensus score. `confirmation_count` /
/// `denial_count` are distinct-voter counts (one vote per pubkey). Positive
/// progression requires BOTH enough weighted score AND a minimum number of
/// distinct confirmers, so a single high-reputation voter can't escalate alone.
///
/// `established_confirmations` is the number of distinct non-NEWCOMER confirmers.
/// When `require_established` is true, VERIFIED/AUTHORITATIVE additionally require
/// established voters — blocking pure-Sybil (NEWCOMER-only) escalation. The flag
/// defaults off (usable at cold-start); the inputs are always computed, so the
/// gate can be switched on with no code changes.
pub fn compute_new_status(
    status: &str,
    score: i32,
    confirmation_count: i32,
    denial_count: i32,
    established_confirmations: i32,
    require_established: bool,
) -> Option<String> {
    // Rejection (highest priority)
    if matches!(status, "PENDING" | "DISPUTED") && score <= -5 {
        return Some("REJECTED".to_string());
    }
    // Dispute
    if matches!(status, "UNVERIFIED" | "VERIFIED" | "AUTHORITATIVE")
        && denial_count >= 3
        && denial_count > confirmation_count
    {
        return Some("DISPUTED".to_string());
    }
    // Established-voter gate (no-op when require_established is false)
    let established_ok_verified = !require_established || established_confirmations >= 2;
    let established_ok_authoritative = !require_established || established_confirmations >= 3;
    // Positive progression: weighted score AND distinct confirmers AND (optional) gate
    match status {
        "PENDING" if score >= 3 && confirmation_count >= 2 => Some("UNVERIFIED".to_string()),
        "UNVERIFIED" if score >= 7 && confirmation_count >= 3 && established_ok_verified => {
            Some("VERIFIED".to_string())
        }
        "VERIFIED" if score >= 15 && confirmation_count >= 4 && established_ok_authoritative => {
            Some("AUTHORITATIVE".to_string())
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // gate off (require_established = false) — baseline behaviour
    #[test]
    fn pending_advances_to_unverified_at_score_3() {
        assert_eq!(
            compute_new_status("PENDING", 3, 2, 0, 0, false),
            Some("UNVERIFIED".into())
        );
    }
    #[test]
    fn unverified_advances_to_verified_at_score_7() {
        assert_eq!(
            compute_new_status("UNVERIFIED", 7, 5, 0, 0, false),
            Some("VERIFIED".into())
        );
    }
    #[test]
    fn verified_advances_to_authoritative_at_score_15() {
        assert_eq!(
            compute_new_status("VERIFIED", 15, 10, 0, 0, false),
            Some("AUTHORITATIVE".into())
        );
    }
    #[test]
    fn rejected_when_score_minus_5_in_pending() {
        assert_eq!(
            compute_new_status("PENDING", -5, 0, 3, 0, false),
            Some("REJECTED".into())
        );
    }
    #[test]
    fn rejected_when_score_minus_5_in_disputed() {
        assert_eq!(
            compute_new_status("DISPUTED", -5, 0, 4, 0, false),
            Some("REJECTED".into())
        );
    }
    #[test]
    fn disputed_when_denial_count_dominates() {
        assert_eq!(
            compute_new_status("VERIFIED", 3, 1, 4, 0, false),
            Some("DISPUTED".into())
        );
    }
    #[test]
    fn no_transition_below_threshold() {
        assert_eq!(compute_new_status("PENDING", 2, 1, 0, 0, false), None);
    }
    #[test]
    fn rejection_takes_priority_over_positive() {
        assert_eq!(
            compute_new_status("PENDING", -5, 5, 0, 0, false),
            Some("REJECTED".into())
        );
    }

    // distinct-voter minimums: weighted score alone is not enough
    #[test]
    fn single_high_weight_confirm_cannot_reach_unverified() {
        // score from one SENTINEL confirm (10) but only 1 distinct voter
        assert_eq!(compute_new_status("PENDING", 10, 1, 0, 0, false), None);
    }
    #[test]
    fn verified_needs_three_distinct_confirmers() {
        // score high enough but only 2 distinct confirmers
        assert_eq!(compute_new_status("UNVERIFIED", 12, 2, 0, 0, false), None);
    }

    // established-voter gate (require_established = true)
    #[test]
    fn gate_blocks_verified_without_established_voters() {
        assert_eq!(compute_new_status("UNVERIFIED", 7, 5, 0, 0, true), None);
    }
    #[test]
    fn gate_allows_verified_with_two_established_voters() {
        assert_eq!(
            compute_new_status("UNVERIFIED", 7, 5, 0, 2, true),
            Some("VERIFIED".into())
        );
    }
    #[test]
    fn gate_blocks_authoritative_with_only_two_established() {
        assert_eq!(compute_new_status("VERIFIED", 15, 10, 0, 2, true), None);
    }
    #[test]
    fn gate_allows_authoritative_with_three_established() {
        assert_eq!(
            compute_new_status("VERIFIED", 15, 10, 0, 3, true),
            Some("AUTHORITATIVE".into())
        );
    }
}
