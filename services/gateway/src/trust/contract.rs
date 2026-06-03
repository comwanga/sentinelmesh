//! Trust tier ladder and the promotion decision for machine-origin events
//! (NLP now; the acoustic worker is meant to converge onto this contract later).
//!
//! Independence is measured in *provenance clusters* (distinct `source_id`) and
//! *channels* (distinct `origin_channel`), never raw row counts — duplicate
//! ingestion must not inflate trust. Machine-origin events top out at `Confirmed`;
//! a higher human/community `Authoritative` tier is intentionally NOT represented
//! here (reserved for a later unified trust engine). Acoustic is not refactored
//! as part of H-5.

/// Machine-origin trust tier, ordered Heuristic < Corroborating < Confirmed.
/// `Ord` is derived from variant declaration order — keep them in ascending order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum TrustTier {
    Heuristic,     // 0
    Corroborating, // 1
    Confirmed,     // 2
}

impl TrustTier {
    /// Lowercase DB/wire form. MUST match the `safety_events.trust_state` CHECK
    /// values from migration 011 (`heuristic`/`corroborating`/`confirmed`).
    pub fn as_str(self) -> &'static str {
        match self {
            TrustTier::Heuristic => "heuristic",
            TrustTier::Corroborating => "corroborating",
            TrustTier::Confirmed => "confirmed",
        }
    }
}

/// Distinct independent evidence backing a cluster.
#[derive(Debug, Clone, Copy)]
pub struct Independence {
    /// Number of distinct provenance clusters (distinct `source_id`).
    pub distinct_sources: usize,
    /// Number of distinct channels (distinct `origin_channel`).
    pub distinct_channels: usize,
}

/// Launch-default thresholds (tunable from operational data).
pub const CORROBORATE_MIN_SOURCES: usize = 2;
pub const CONFIRM_MIN_SOURCES: usize = 3;
pub const CONFIRM_MIN_CHANNELS: usize = 2;

/// Map independence evidence to a tier. Pure and monotonic: adding a distinct
/// source or channel can only raise (never lower) the resulting tier.
pub fn decide(ev: Independence) -> TrustTier {
    if ev.distinct_sources >= CONFIRM_MIN_SOURCES && ev.distinct_channels >= CONFIRM_MIN_CHANNELS {
        TrustTier::Confirmed
    } else if ev.distinct_sources >= CORROBORATE_MIN_SOURCES {
        TrustTier::Corroborating
    } else {
        TrustTier::Heuristic
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(sources: usize, channels: usize) -> Independence {
        Independence { distinct_sources: sources, distinct_channels: channels }
    }

    #[test]
    fn single_source_is_heuristic() {
        assert_eq!(decide(ev(1, 1)), TrustTier::Heuristic);
    }

    #[test]
    fn two_distinct_sources_corroborate() {
        assert_eq!(decide(ev(2, 1)), TrustTier::Corroborating);
        assert_eq!(decide(ev(2, 2)), TrustTier::Corroborating); // sources < CONFIRM_MIN_SOURCES (3)
    }

    #[test]
    fn three_sources_across_two_channels_confirm() {
        assert_eq!(decide(ev(3, 2)), TrustTier::Confirmed);
    }

    #[test]
    fn three_sources_one_channel_stays_corroborating() {
        // Three accounts reposting one wire: many sources, one channel -> no self-confirm.
        assert_eq!(decide(ev(3, 1)), TrustTier::Corroborating);
    }

    #[test]
    fn tier_strings_match_db_check() {
        assert_eq!(TrustTier::Heuristic.as_str(), "heuristic");
        assert_eq!(TrustTier::Corroborating.as_str(), "corroborating");
        assert_eq!(TrustTier::Confirmed.as_str(), "confirmed");
    }

    #[test]
    fn zero_evidence_is_heuristic_floor() {
        assert_eq!(decide(ev(0, 0)), TrustTier::Heuristic);
        assert_eq!(decide(ev(0, 5)), TrustTier::Heuristic);
    }

    #[test]
    fn tiers_order_ascending() {
        assert!(TrustTier::Heuristic < TrustTier::Corroborating);
        assert!(TrustTier::Corroborating < TrustTier::Confirmed);
    }

    #[test]
    fn promotion_is_monotonic_in_sources() {
        // Adding sources (at >=2 channels) never lowers the tier.
        let tiers = [decide(ev(1, 2)), decide(ev(2, 2)), decide(ev(3, 2))];
        assert_eq!(
            tiers,
            [TrustTier::Heuristic, TrustTier::Corroborating, TrustTier::Confirmed]
        );
    }
}
