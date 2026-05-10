/// Returns the new status if a transition applies, None if no transition.
/// Priority: rejection > dispute > positive progression.
pub fn compute_new_status(
    status: &str,
    score: i32,
    confirmation_count: i32,
    denial_count: i32,
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
    // Positive progression
    match status {
        "PENDING"    if score >= 3  => Some("UNVERIFIED".to_string()),
        "UNVERIFIED" if score >= 7  => Some("VERIFIED".to_string()),
        "VERIFIED"   if score >= 15 => Some("AUTHORITATIVE".to_string()),
        _                           => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_advances_to_unverified_at_score_3() {
        assert_eq!(compute_new_status("PENDING", 3, 2, 0), Some("UNVERIFIED".into()));
    }
    #[test]
    fn unverified_advances_to_verified_at_score_7() {
        assert_eq!(compute_new_status("UNVERIFIED", 7, 5, 0), Some("VERIFIED".into()));
    }
    #[test]
    fn verified_advances_to_authoritative_at_score_15() {
        assert_eq!(compute_new_status("VERIFIED", 15, 10, 0), Some("AUTHORITATIVE".into()));
    }
    #[test]
    fn rejected_when_score_minus_5_in_pending() {
        assert_eq!(compute_new_status("PENDING", -5, 0, 3), Some("REJECTED".into()));
    }
    #[test]
    fn rejected_when_score_minus_5_in_disputed() {
        assert_eq!(compute_new_status("DISPUTED", -5, 0, 4), Some("REJECTED".into()));
    }
    #[test]
    fn disputed_when_denial_count_dominates() {
        assert_eq!(compute_new_status("VERIFIED", 3, 1, 4), Some("DISPUTED".into()));
    }
    #[test]
    fn no_transition_below_threshold() {
        assert_eq!(compute_new_status("PENDING", 2, 1, 0), None);
    }
    #[test]
    fn rejection_takes_priority_over_positive() {
        assert_eq!(compute_new_status("PENDING", -5, 5, 0), Some("REJECTED".into()));
    }
}
