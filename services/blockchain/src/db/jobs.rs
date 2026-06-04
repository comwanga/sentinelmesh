// services/blockchain/src/db/jobs.rs
use anyhow::Result;
use sentinel_core::jobs::{PublishJob, SourceRow};
use sqlx::PgPool;
use uuid::Uuid;

const ORPHAN_TIMEOUT_MINUTES: i64 = 5;
const MAX_RETRIES: i32 = 5;

/// Claims the next eligible job atomically. Returns None if no job is available.
/// Eligible: (PENDING|FAILED with next_retry_at <= NOW) OR NOSTR_PUBLISHED.
pub async fn claim_next_job(pool: &PgPool, worker_id: &str) -> Result<Option<PublishJob>> {
    let mut tx = pool.begin().await?;
    let row = sqlx::query_as::<
        _,
        (
            Uuid,
            String,
            Uuid,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            i32,
        ),
    >(
        r#"
        UPDATE publish_jobs
        SET status = 'PROCESSING',
            worker_id = $1,
            locked_at = NOW(),
            updated_at = NOW()
        WHERE id = (
          SELECT id FROM publish_jobs
          WHERE (
            status IN ('PENDING', 'FAILED') AND next_retry_at <= NOW()
            OR status = 'NOSTR_PUBLISHED'
          )
          ORDER BY next_retry_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING id, source_type, source_id, status,
                  nostr_kind1_id, nostr_kind30078_id, bitcoin_txid, anchor_hash, retry_count
        "#,
    )
    .bind(worker_id)
    .fetch_optional(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(row.map(|r| PublishJob {
        id: r.0,
        source_type: r.1,
        source_id: r.2,
        status: r.3,
        nostr_kind1_id: r.4,
        nostr_kind30078_id: r.5,
        bitcoin_txid: r.6,
        anchor_hash: r.7,
        retry_count: r.8,
    }))
}

/// Marks job FAILED with exponential backoff. Inserts a publish_failures row.
/// Both writes are in a single transaction — failure row must not appear without the status update.
pub async fn mark_failed(
    pool: &PgPool,
    job_id: Uuid,
    error_message: &str,
    retry_count: i32,
) -> Result<()> {
    let backoff_minutes = 2i64.pow(retry_count as u32);
    let mut tx = pool.begin().await?;
    sqlx::query(
        r#"
        UPDATE publish_jobs
        SET status = 'FAILED',
            retry_count = retry_count + 1,
            next_retry_at = NOW() + ($3 * INTERVAL '1 minute'),
            error_message = $2,
            worker_id = NULL,
            locked_at = NULL,
            updated_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(job_id)
    .bind(error_message)
    .bind(backoff_minutes)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO publish_failures (job_id, step, error_message) VALUES ($1, 'PUBLISH', $2)",
    )
    .bind(job_id)
    .bind(error_message)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn mark_dead(pool: &PgPool, job_id: Uuid) -> Result<()> {
    sqlx::query("UPDATE publish_jobs SET status = 'DEAD', updated_at = NOW() WHERE id = $1")
        .bind(job_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn release_job_for_retry(pool: &PgPool, job_id: Uuid) -> Result<()> {
    sqlx::query(
        r#"UPDATE publish_jobs
           SET status = 'PENDING', worker_id = NULL, locked_at = NULL,
               next_retry_at = NOW() + INTERVAL '1 minute', updated_at = NOW()
           WHERE id = $1"#,
    )
    .bind(job_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn set_nostr_published(
    pool: &PgPool,
    job_id: Uuid,
    kind1_id: &str,
    kind30078_id: &str,
) -> Result<()> {
    sqlx::query(
        r#"UPDATE publish_jobs
           SET status = 'NOSTR_PUBLISHED', nostr_kind1_id = $2, nostr_kind30078_id = $3, updated_at = NOW()
           WHERE id = $1"#,
    )
    .bind(job_id)
    .bind(kind1_id)
    .bind(kind30078_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn set_bitcoin_anchored(
    pool: &PgPool,
    job_id: Uuid,
    txid: &str,
    anchor_hash: &str,
) -> Result<()> {
    sqlx::query(
        r#"UPDATE publish_jobs
           SET status = 'BITCOIN_ANCHORED', bitcoin_txid = $2, anchor_hash = $3,
               locked_at = NULL, worker_id = NULL, updated_at = NOW()
           WHERE id = $1"#,
    )
    .bind(job_id)
    .bind(txid)
    .bind(anchor_hash)
    .execute(pool)
    .await?;
    Ok(())
}

/// Fetches severity/type/lat/lng/place_name from safety_events or community_reports.
/// NOTE: community_reports has no severity column — callers handle this case.
pub async fn fetch_source_row(pool: &PgPool, job: &PublishJob) -> Result<Option<SourceRow>> {
    let (table, type_col, severity_expr) = if job.source_type == "SAFETY_EVENT" {
        ("safety_events", "event_type", "severity")
    } else {
        ("community_reports", "report_type", "''")
    };
    let sql = format!(
        "SELECT {} AS severity, {} AS event_type, lat::float8, lng::float8, place_name FROM {} WHERE id = $1",
        severity_expr, type_col, table
    );
    let row = sqlx::query_as::<_, (String, String, f64, f64, Option<String>)>(&sql)
        .bind(job.source_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|r| SourceRow {
        severity: r.0,
        event_type: r.1,
        lat: r.2,
        lng: r.3,
        place_name: r.4,
    }))
}

pub async fn update_source_nostr_id(
    pool: &PgPool,
    job: &PublishJob,
    kind30078_id: &str,
) -> Result<()> {
    // Only safety_events carries nostr_event_id now. C-2 moved the community-report
    // identity (including nostr_event_id) into the access-controlled report_authors
    // table and dropped the column from community_reports, so the old write-back to
    // community_reports would fail. Community-report anchoring is default-off (audit
    // H-8/C-1) and will set this via the identity tier when it is reworked.
    if job.source_type == "SAFETY_EVENT" {
        sqlx::query(
            "UPDATE safety_events SET nostr_event_id = $2 WHERE id = $1 AND nostr_event_id IS NULL",
        )
        .bind(job.source_id)
        .bind(kind30078_id)
        .execute(pool)
        .await?;
    }
    Ok(())
}

pub async fn update_source_bitcoin_txid(pool: &PgPool, job: &PublishJob, txid: &str) -> Result<()> {
    if job.source_type == "SAFETY_EVENT" {
        sqlx::query(
            "UPDATE safety_events SET bitcoin_txid = $2 WHERE id = $1 AND bitcoin_txid IS NULL",
        )
        .bind(job.source_id)
        .bind(txid)
        .execute(pool)
        .await?;
    }
    Ok(())
}

/// Reclaims jobs stuck in PROCESSING/NOSTR_PUBLISHED for more than ORPHAN_TIMEOUT_MINUTES.
pub async fn reclaim_orphans(pool: &PgPool) -> Result<()> {
    sqlx::query(
        r#"
        UPDATE publish_jobs
        SET status = 'FAILED',
            worker_id = NULL,
            locked_at = NULL,
            retry_count = retry_count + 1,
            next_retry_at = NOW(),
            error_message = 'orphan reclaim after timeout',
            updated_at = NOW()
        WHERE status IN ('PROCESSING', 'NOSTR_PUBLISHED')
          AND locked_at < NOW() - ($1 * INTERVAL '1 minute')
        "#,
    )
    .bind(ORPHAN_TIMEOUT_MINUTES)
    .execute(pool)
    .await?;
    Ok(())
}

pub fn is_exhausted(retry_count: i32) -> bool {
    retry_count >= MAX_RETRIES
}
