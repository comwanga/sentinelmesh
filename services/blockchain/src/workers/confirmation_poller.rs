// services/blockchain/src/workers/confirmation_poller.rs
use anyhow::{anyhow, Result};
use sqlx::PgPool;
use std::sync::Arc;
use tokio::time::{interval, Duration};
use uuid::Uuid;

use crate::config::Config;
use crate::db::jobs;

#[derive(serde::Deserialize)]
struct MempoolTxStatus {
    confirmed: bool,
    block_height: Option<i32>,
}

#[derive(serde::Deserialize)]
struct MempoolTxResponse {
    status: MempoolTxStatus,
}

#[derive(Debug, sqlx::FromRow)]
struct AnchoredJob {
    id: Uuid,
    source_type: String,
    source_id: Uuid,
    bitcoin_txid: String,
    retry_count: i32,
}

pub async fn run(pool: Arc<PgPool>, config: Arc<Config>) {
    let mut ticker = interval(Duration::from_secs(60));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .expect("failed to build reqwest client for confirmation poller");
    loop {
        ticker.tick().await;
        if let Err(e) = poll_confirmations(&pool, &config, &client).await {
            tracing::error!("confirmation poller error: {}", e);
        }
    }
}

async fn poll_confirmations(pool: &PgPool, config: &Config, client: &reqwest::Client) -> Result<()> {
    let jobs = sqlx::query_as::<_, AnchoredJob>(
        "SELECT id, source_type, source_id, bitcoin_txid, retry_count FROM publish_jobs WHERE status = 'BITCOIN_ANCHORED' LIMIT 50",
    )
    .fetch_all(pool)
    .await?;

    for job in jobs {
        if let Err(e) = check_and_confirm(pool, client, config, &job).await {
            tracing::warn!("confirmation check failed for job {}: {}", job.id, e);
        }
    }
    Ok(())
}

async fn check_and_confirm(
    pool: &PgPool,
    client: &reqwest::Client,
    config: &Config,
    job: &AnchoredJob,
) -> Result<()> {
    let url = config.bitcoin_network.mempool_tx_url(&job.bitcoin_txid);
    let response = client.get(&url).send().await?;

    let http_status = response.status();

    // 404 means the txid is unknown to the network — definitive failure, not transient.
    if http_status == reqwest::StatusCode::NOT_FOUND {
        let error_message = format!("txid not found on network (404): {}", job.bitcoin_txid);
        tracing::error!("job {} txid {} returned 404 — marking FAILED", job.id, job.bitcoin_txid);
        jobs::mark_failed(pool, job.id, &error_message, job.retry_count).await?;
        return Ok(());
    }

    // Any other non-2xx (5xx, other 4xx) is a transient API error — skip this cycle.
    if !http_status.is_success() {
        return Ok(());
    }

    let resp: MempoolTxResponse = response.json().await?;

    if !resp.status.confirmed {
        return Ok(());
    }

    // mempool.space guarantees block_height is present when confirmed=true; treat absence as unexpected.
    let block_height = match resp.status.block_height {
        Some(h) => h,
        None => {
            tracing::warn!("txid {} confirmed but block_height missing in API response, skipping", job.bitcoin_txid);
            return Ok(());
        }
    };

    // table is bounded to two compile-time-known values — no SQL injection risk.
    let table = match job.source_type.as_str() {
        "SAFETY_EVENT" => "safety_events",
        "COMMUNITY_REPORT" => "community_reports",
        other => {
            tracing::warn!("unknown source_type '{}' for job {}, skipping source table update", other, job.id);
            return Err(anyhow!("unknown source_type: {}", other));
        }
    };

    // Wrap both writes in a transaction so the job is never COMPLETE without the source table updated.
    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE publish_jobs SET status = 'COMPLETE', updated_at = NOW() WHERE id = $1")
        .bind(job.id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(&format!(
        "UPDATE {} SET bitcoin_block = $2 WHERE id = $1 AND bitcoin_block IS NULL",
        table
    ))
    .bind(job.source_id)
    .bind(block_height)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    tracing::info!("job {} confirmed in block {} (txid: {})", job.id, block_height, job.bitcoin_txid);
    Ok(())
}
