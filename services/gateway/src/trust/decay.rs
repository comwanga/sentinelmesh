//! Reputation decay curve (C-1b-1). Pure + idempotent: effective standing is a
//! function of EARNED score, days since the user's last VERIFIED contribution,
//! and their accuracy ratio. Never decrements in place, so worker cadence cannot
//! double-apply. Decay only ever lowers an inactive user's effective score toward
//! a floor; a false decay self-heals when they contribute again.

/// accuracy = accurate / total, clamped; 0 when no reports.
#[allow(dead_code)] // used by trust_worker (Task 8)
pub fn accuracy_ratio(accurate: i64, total: i64) -> f64 {
    if total <= 0 {
        0.0
    } else {
        ((accurate as f64) / (total as f64)).clamp(0.0, 1.0)
    }
}

/// Effective (decayed) score. Within `grace_days` of the last VERIFIED → earned.
/// Past grace, linearly decays toward `floor` over an accuracy-extended horizon
/// (`horizon_days` at accuracy 0, up to `2 * horizon_days` at accuracy 1).
#[allow(dead_code)] // used by trust_worker (Task 8)
pub fn effective_score(
    earned: i32,
    days_since_verified: i64,
    accuracy: f64,
    grace_days: u32,
    horizon_days: u32,
    floor: i32,
) -> i32 {
    if earned <= floor {
        return earned;
    }
    let grace = grace_days as i64;
    if days_since_verified <= grace {
        return earned;
    }
    let over = (days_since_verified - grace) as f64;
    let effective_horizon = (horizon_days as f64) * (1.0 + accuracy.clamp(0.0, 1.0));
    if effective_horizon <= 0.0 {
        return floor;
    }
    let frac = (over / effective_horizon).clamp(0.0, 1.0);
    // Cast to f64 BEFORE subtracting so `earned - floor` cannot overflow i32 (which
    // would wrap in release and let `decayed` escape [floor, earned]).
    let decayed = (earned as f64) - frac * ((earned as f64) - (floor as f64));
    decayed.round() as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accuracy_ratio_is_safe_at_zero_total() {
        assert_eq!(accuracy_ratio(0, 0), 0.0);
        assert_eq!(accuracy_ratio(3, 6), 0.5);
    }
    #[test]
    fn within_grace_is_undecayed() {
        assert_eq!(effective_score(50, 30, 1.0, 90, 180, 0), 50);
        assert_eq!(effective_score(50, 90, 0.0, 90, 180, 0), 50); // boundary: == grace, no decay
    }
    #[test]
    fn past_grace_decays_below_earned() {
        let e = effective_score(50, 90 + 90, 0.0, 90, 180, 0); // halfway through 180d horizon
        assert!(e < 50 && e > 0);
    }
    #[test]
    fn full_horizon_reaches_floor() {
        assert_eq!(effective_score(50, 90 + 180, 0.0, 90, 180, 5), 5);
        assert_eq!(effective_score(50, 90 + 9999, 0.0, 90, 180, 5), 5);
    }
    #[test]
    fn accuracy_slows_decay() {
        let low = effective_score(50, 90 + 90, 0.0, 90, 180, 0);
        let high = effective_score(50, 90 + 90, 1.0, 90, 180, 0); // 2x horizon => less decayed
        assert!(high > low);
    }
    #[test]
    fn at_or_below_floor_is_noop() {
        assert_eq!(effective_score(0, 9999, 0.0, 90, 180, 0), 0);
        assert_eq!(effective_score(3, 9999, 0.0, 90, 180, 5), 3); // earned below floor stays earned
    }
    #[test]
    fn recompute_from_earned_is_stable_and_bounded() {
        // The worker always recomputes from EARNED (never from a prior effective),
        // so repeated ticks at the same inputs give the same value (no compounding)
        // and the result stays within [floor, earned].
        let floor = 0;
        let earned = 40;
        let a = effective_score(earned, 200, 0.5, 90, 180, floor);
        let b = effective_score(earned, 200, 0.5, 90, 180, floor);
        assert_eq!(a, b);
        assert!(a >= floor && a <= earned);
        assert!(a < earned); // 200 days inactive => actually decayed
    }

    #[test]
    fn stays_bounded_when_earned_minus_floor_overflows_i32() {
        // earned - floor = 4_000_000_000 > i32::MAX: subtracting as i32 first would
        // wrap (release) and let effective escape [floor, earned]. With the f64-first
        // cast, a fully-decayed score lands exactly on the floor.
        let earned = 2_000_000_000;
        let floor = -2_000_000_000;
        let e = effective_score(earned, 9999, 0.0, 90, 180, floor);
        assert!(e >= floor && e <= earned);
        assert_eq!(e, floor); // full decay => floor, not wrapped garbage
    }
}
