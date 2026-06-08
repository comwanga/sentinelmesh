//! Vouch issuance + revocation (C-1a). Personhood eligibility and budget are
//! enforced here; the route layer handles nostr signature/binding/replay.
use anyhow::Result;
use sqlx::PgPool;

/// How many active (non-revoked) vouches a voucher currently holds.
pub async fn active_vouch_count(pool: &PgPool, voucher: &str) -> Result<i64> {
    let n: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM vouches WHERE voucher_pubkey = $1 AND revoked_at IS NULL",
    )
    .bind(voucher)
    .fetch_one(pool)
    .await?;
    Ok(n)
}

/// Insert a vouch. Caller has already verified signature, eligibility, and that
/// voucher != vouchee. `basis` is 'ROOT' or 'EARNED'. Returns false if an active
/// edge already exists (partial unique index conflict).
pub async fn insert_vouch(
    pool: &PgPool,
    voucher: &str,
    vouchee: &str,
    basis: &str,
    event_id: &str,
) -> Result<bool> {
    let res = sqlx::query(
        "INSERT INTO vouches (voucher_pubkey, vouchee_pubkey, issuance_basis, nostr_event_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (voucher_pubkey, vouchee_pubkey) WHERE revoked_at IS NULL DO NOTHING",
    )
    .bind(voucher)
    .bind(vouchee)
    .bind(basis)
    .bind(event_id)
    .execute(pool)
    .await?;
    Ok(res.rows_affected() == 1)
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
