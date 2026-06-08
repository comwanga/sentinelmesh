//! Personhood signal for Sybil resistance (C-1a). A pubkey is "established" for
//! the consensus gate if it is a genesis ROOT, REPUTATION-established (earned
//! tier >= TRUSTED), or holds an active VOUCH from a CURRENTLY-eligible voucher.
//! Personhood is separate from vote weight: a vouch confers eligibility only.

use sqlx::PgPool;

/// Why a pubkey is established. Computed (not stored): it changes as tiers,
/// vouches, and roots change. Logged for debugging/analytics and for C-1b.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PersonhoodSource {
    None,
    Root,
    Reputation,
    Vouch,
    Multiple,
}

/// Pure classifier from the three independent signals.
pub fn classify(is_root: bool, tier_established: bool, has_active_vouch: bool) -> PersonhoodSource {
    let n = [is_root, tier_established, has_active_vouch]
        .iter()
        .filter(|b| **b)
        .count();
    match n {
        0 => PersonhoodSource::None,
        1 => {
            if is_root {
                PersonhoodSource::Root
            } else if tier_established {
                PersonhoodSource::Reputation
            } else {
                PersonhoodSource::Vouch
            }
        }
        _ => PersonhoodSource::Multiple,
    }
}

/// Established for the gate iff any signal applies.
// used by gate checks (Tasks 5–6) and tests
#[allow(dead_code)]
pub fn is_established(s: PersonhoodSource) -> bool {
    !matches!(s, PersonhoodSource::None)
}

/// Earned-established: tier strictly above NEWCOMER.
pub fn tier_is_established(tier: &str) -> bool {
    matches!(tier, "TRUSTED" | "VETERAN" | "SENTINEL")
}

/// Eligible to ISSUE a vouch: ROOT or REPUTATION only (never vouch-only).
pub fn eligible_from(is_root: bool, tier_established: bool) -> bool {
    is_root || tier_established
}

/// True if `pubkey` is one of the configured genesis roots.
pub fn is_root(roots: &[String], pubkey: &str) -> bool {
    roots.iter().any(|r| r == pubkey)
}

/// Does `pubkey` hold an active vouch from a CURRENTLY-eligible voucher?
/// Active = not revoked, not expired, and the voucher is right-now a genesis
/// root OR reputation-established. (issuance_basis is NOT trusted here.)
pub async fn has_active_vouch(pool: &PgPool, roots: &[String], pubkey: &str) -> sqlx::Result<bool> {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (
           SELECT 1 FROM vouches v
           WHERE v.vouchee_pubkey = $1
             AND v.revoked_at IS NULL
             AND (v.expires_at IS NULL OR v.expires_at > now())
             AND (
               v.voucher_pubkey = ANY($2)
               OR EXISTS (SELECT 1 FROM users u
                          WHERE u.nostr_pubkey = v.voucher_pubkey
                            AND u.reputation_tier IN ('TRUSTED','VETERAN','SENTINEL'))
             )
         )",
    )
    .bind(pubkey)
    .bind(roots)
    .fetch_one(pool)
    .await
}

/// Reputation tier for a pubkey, or "NEWCOMER" if unknown.
pub async fn reputation_tier(pool: &PgPool, pubkey: &str) -> sqlx::Result<String> {
    let tier: Option<String> =
        sqlx::query_scalar("SELECT reputation_tier FROM users WHERE nostr_pubkey = $1")
            .bind(pubkey)
            .fetch_optional(pool)
            .await?;
    Ok(tier.unwrap_or_else(|| "NEWCOMER".to_string()))
}

/// Full personhood resolution: gather the three signals and classify.
// used by Tasks 5–6
#[allow(dead_code)]
pub async fn resolve(pool: &PgPool, roots: &[String], pubkey: &str) -> sqlx::Result<PersonhoodSource> {
    let root = is_root(roots, pubkey);
    let tier_est = tier_is_established(&reputation_tier(pool, pubkey).await?);
    let vouched = has_active_vouch(pool, roots, pubkey).await?;
    Ok(classify(root, tier_est, vouched))
}

/// Eligible to issue a vouch (ROOT or REPUTATION).
// used by Tasks 5–6
#[allow(dead_code)]
pub async fn eligible_to_vouch(pool: &PgPool, roots: &[String], pubkey: &str) -> sqlx::Result<bool> {
    let root = is_root(roots, pubkey);
    let tier_est = tier_is_established(&reputation_tier(pool, pubkey).await?);
    Ok(eligible_from(root, tier_est))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn none_when_no_signal() {
        assert_eq!(classify(false, false, false), PersonhoodSource::None);
        assert!(!is_established(PersonhoodSource::None));
    }
    #[test]
    fn single_signals_classify_distinctly() {
        assert_eq!(classify(true, false, false), PersonhoodSource::Root);
        assert_eq!(classify(false, true, false), PersonhoodSource::Reputation);
        assert_eq!(classify(false, false, true), PersonhoodSource::Vouch);
    }
    #[test]
    fn multiple_when_more_than_one() {
        assert_eq!(classify(true, true, false), PersonhoodSource::Multiple);
        assert_eq!(classify(true, false, true), PersonhoodSource::Multiple);
        assert_eq!(classify(true, true, true), PersonhoodSource::Multiple);
    }
    #[test]
    fn is_established_true_for_any_non_none() {
        for s in [PersonhoodSource::Root, PersonhoodSource::Reputation, PersonhoodSource::Vouch, PersonhoodSource::Multiple] {
            assert!(is_established(s));
        }
    }
    #[test]
    fn tier_established_only_above_newcomer() {
        assert!(!tier_is_established("NEWCOMER"));
        assert!(tier_is_established("TRUSTED"));
        assert!(tier_is_established("VETERAN"));
        assert!(tier_is_established("SENTINEL"));
        assert!(!tier_is_established("unknown"));
    }
    #[test]
    fn eligible_to_vouch_is_root_or_reputation_only() {
        assert!(eligible_from(true, false));
        assert!(eligible_from(false, true));
        assert!(!eligible_from(false, false));
    }
}
