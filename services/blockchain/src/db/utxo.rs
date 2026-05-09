// services/blockchain/src/db/utxo.rs
use anyhow::Result;
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Utxo {
    pub id: Uuid,
    pub txid: String,
    pub vout: i32,
    pub value_sats: i64,
    pub status: String,
    pub spending_job_id: Option<Uuid>,
    pub creating_job_id: Option<Uuid>,
    pub locked_at: Option<DateTime<Utc>>,
}

/// Claims the highest-value CONFIRMED UTXO for a job. Returns None if pool is empty.
pub async fn claim_utxo(pool: &PgPool, job_id: Uuid) -> Result<Option<Utxo>> {
    let row = sqlx::query_as::<_, Utxo>(
        r#"
        UPDATE utxos
        SET status = 'LOCKED',
            spending_job_id = $1,
            locked_at = NOW(),
            updated_at = NOW()
        WHERE id = (
          SELECT id FROM utxos
          WHERE status = 'CONFIRMED'
          ORDER BY value_sats DESC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING id, txid, vout, value_sats, status, spending_job_id, creating_job_id, locked_at
        "#,
    )
    .bind(job_id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// Releases a LOCKED UTXO back to CONFIRMED (e.g. on pre-broadcast failure).
pub async fn release_utxo(pool: &PgPool, utxo_id: Uuid) -> Result<()> {
    sqlx::query(
        "UPDATE utxos SET status = 'CONFIRMED', spending_job_id = NULL, locked_at = NULL, updated_at = NOW() WHERE id = $1",
    )
    .bind(utxo_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Marks UTXO as SPENT and inserts the change output as UNCONFIRMED, in a single transaction.
pub async fn spend_utxo(
    pool: &PgPool,
    utxo_id: Uuid,
    txid: &str,
    change_vout: u32,
    change_value_sats: i64,
    job_id: Uuid,
) -> Result<()> {
    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE utxos SET status = 'SPENT', updated_at = NOW() WHERE id = $1")
        .bind(utxo_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        r#"INSERT INTO utxos (txid, vout, value_sats, status, creating_job_id)
           VALUES ($1, $2, $3, 'UNCONFIRMED', $4)
           ON CONFLICT (txid, vout) DO NOTHING"#,
    )
    .bind(txid)
    .bind(change_vout as i32)
    .bind(change_value_sats)
    .bind(job_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Releases UTXO locks held for more than 30 minutes with no Bitcoin txid.
pub async fn reclaim_stale_locks(pool: &PgPool) -> Result<()> {
    sqlx::query(
        r#"
        UPDATE utxos
        SET status = 'CONFIRMED', spending_job_id = NULL, locked_at = NULL, updated_at = NOW()
        WHERE status = 'LOCKED'
          AND locked_at < NOW() - INTERVAL '30 minutes'
          AND id IN (
            SELECT u.id FROM utxos u
            JOIN publish_jobs j ON j.id = u.spending_job_id
            WHERE j.bitcoin_txid IS NULL
          )
        "#,
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug)]
pub struct PoolDepth {
    pub available: i64,
    pub locked: i64,
    pub unconfirmed: i64,
}

pub async fn get_pool_depth(pool: &PgPool) -> Result<PoolDepth> {
    let row = sqlx::query_as::<_, (i64, i64, i64)>(
        r#"
        SELECT
          COUNT(*) FILTER (WHERE status = 'CONFIRMED')   AS available,
          COUNT(*) FILTER (WHERE status = 'LOCKED')      AS locked,
          COUNT(*) FILTER (WHERE status = 'UNCONFIRMED') AS unconfirmed
        FROM utxos
        "#,
    )
    .fetch_one(pool)
    .await?;
    Ok(PoolDepth { available: row.0, locked: row.1, unconfirmed: row.2 })
}

pub async fn seed_utxo(pool: &PgPool, txid: &str, vout: u32, value_sats: i64) -> Result<Utxo> {
    let row = sqlx::query_as::<_, Utxo>(
        r#"INSERT INTO utxos (txid, vout, value_sats, status)
           VALUES ($1, $2, $3, 'CONFIRMED')
           ON CONFLICT (txid, vout) DO UPDATE SET value_sats = EXCLUDED.value_sats, updated_at = NOW()
           RETURNING id, txid, vout, value_sats, status, spending_job_id, creating_job_id, locked_at"#,
    )
    .bind(txid)
    .bind(vout as i32)
    .bind(value_sats)
    .fetch_one(pool)
    .await?;
    Ok(row)
}
