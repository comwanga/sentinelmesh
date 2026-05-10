// services/blockchain/src/workers/confirmation_poller.rs
use anyhow::Result;
use sqlx::PgPool;
use std::sync::Arc;
use tokio::time::{interval, Duration};
use uuid::Uuid;

use crate::config::Config;

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
}

pub async fn run(pool: Arc<PgPool>, config: Arc<Config>) {
    let mut ticker = interval(Duration::from_secs(60)); // check every minute
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap_or_default();
    loop {
        ticker.tick().await;
        if let Err(e) = poll_confirmations(&pool, &config, &client).await {
            tracing::error!("confirmation poller error: {}", e);
        }
    }
}

async fn poll_confirmations(pool: &PgPool, config: &Config, client: &reqwest::Client) -> Result<()> {
    let jobs = sqlx::query_as::<_, AnchoredJob>(
        "SELECT id, source_type, source_id, bitcoin_txid FROM publish_jobs WHERE status = 'BITCOIN_ANCHORED' LIMIT 50",
    )
    .fetch_all(pool)
    .await?;

    if jobs.is_empty() {
        return Ok(());
    }

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
    let resp: MempoolTxResponse = client.get(&url).send().await?.json().await?;

    if !resp.status.confirmed {
        return Ok(());
    }

    let block_height = resp.status.block_height.unwrap_or(0);

    sqlx::query("UPDATE publish_jobs SET status = 'COMPLETE', updated_at = NOW() WHERE id = $1")
        .bind(job.id)
        .execute(pool)
        .await?;

    let table = if job.source_type == "SAFETY_EVENT" { "safety_events" } else { "community_reports" };
    sqlx::query(&format!(
        "UPDATE {} SET bitcoin_block = $2 WHERE id = $1 AND bitcoin_block IS NULL",
        table
    ))
    .bind(job.source_id)
    .bind(block_height)
    .execute(pool)
    .await?;

    tracing::info!(
        "job {} confirmed in block {} (txid: {})",
        job.id, block_height, job.bitcoin_txid
    );
    Ok(())
}
