//! Vouch issuance + revocation (C-1a). Personhood eligibility is enforced by the
//! route layer (signature/binding/replay); the budget check + insert are made
//! ATOMIC here so concurrent requests from the same voucher cannot exceed the
//! active-vouch budget (a TOCTOU race if the count and insert were separate).
use anyhow::Result;
use sqlx::PgPool;

/// Outcome of an issue attempt (distinguishes the two 409 cases from success).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IssueOutcome {
    Inserted,
    BudgetExhausted,
    Duplicate,
}

/// Atomically check the voucher's active-vouch budget and insert. Caller has
/// already verified signature, eligibility, and that voucher != vouchee; `basis`
/// is 'ROOT' or 'EARNED'. A per-voucher transaction advisory lock serializes
/// concurrent issues by the same voucher, so the budget can never be overrun.
pub async fn issue_vouch(
    pool: &PgPool,
    voucher: &str,
    vouchee: &str,
    basis: &str,
    event_id: &str,
    budget: i64,
) -> Result<IssueOutcome> {
    let mut tx = pool.begin().await?;

    // Serialize concurrent issues by THIS voucher for the duration of the tx, so
    // the count-then-insert below is atomic against another of their requests.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)")
        .bind(voucher)
        .execute(&mut *tx)
        .await?;

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM vouches WHERE voucher_pubkey = $1 AND revoked_at IS NULL",
    )
    .bind(voucher)
    .fetch_one(&mut *tx)
    .await?;
    if count >= budget {
        tx.rollback().await?;
        return Ok(IssueOutcome::BudgetExhausted);
    }

    let res = sqlx::query(
        "INSERT INTO vouches (voucher_pubkey, vouchee_pubkey, issuance_basis, nostr_event_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (voucher_pubkey, vouchee_pubkey) WHERE revoked_at IS NULL DO NOTHING",
    )
    .bind(voucher)
    .bind(vouchee)
    .bind(basis)
    .bind(event_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(if res.rows_affected() == 1 {
        IssueOutcome::Inserted
    } else {
        IssueOutcome::Duplicate
    })
}

/// Soft-revoke the active vouch from `voucher` to `vouchee`. Returns true if a
/// row was revoked. Never deletes.
pub async fn revoke_vouch(pool: &PgPool, voucher: &str, vouchee: &str) -> Result<bool> {
    let res = sqlx::query(
        "UPDATE vouches SET revoked_at = now()
         WHERE voucher_pubkey = $1 AND vouchee_pubkey = $2 AND revoked_at IS NULL",
    )
    .bind(voucher)
    .bind(vouchee)
    .execute(pool)
    .await?;
    Ok(res.rows_affected() >= 1)
}
