// services/blockchain/src/workers/publish_worker.rs
use anyhow::Result;
use sentinel_core::jobs::PublishJob;
use sqlx::PgPool;
use std::sync::Arc;
use tokio::time::{interval, Duration};
use uuid::Uuid;

use crate::config::Config;
use crate::db::{jobs as job_db, utxo as utxo_db};
use crate::utils::fee_estimator;
use crate::workers::{
    bitcoin_anchor::{self, AnchorError, AnchorInput},
    nostr_publisher,
};
use sentinel_core::crypto::build_anchor_hash;

pub async fn run(pool: Arc<PgPool>, config: Arc<Config>) {
    let worker_id = format!("worker-{}", Uuid::new_v4());
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap_or_default();
    let mut ticker = interval(Duration::from_millis(config.poll_interval_ms));
    let mut orphan_tick = 0u32;

    loop {
        ticker.tick().await;
        orphan_tick += 1;

        if orphan_tick % 30 == 0 {
            if let Err(e) = job_db::reclaim_orphans(&pool).await {
                tracing::error!("orphan reclaim error: {}", e);
            }
            if let Err(e) = utxo_db::reclaim_stale_locks(&pool).await {
                tracing::error!("stale lock reclaim error: {}", e);
            }
        }

        if let Err(e) = tick(&pool, &config, &worker_id, &http).await {
            tracing::error!("publish worker tick error: {}", e);
        }
    }
}

async fn tick(pool: &PgPool, config: &Config, worker_id: &str, http: &reqwest::Client) -> Result<()> {
    let job = match job_db::claim_next_job(pool, worker_id).await? {
        Some(j) => j,
        None => return Ok(()),
    };

    if job_db::is_exhausted(job.retry_count) {
        job_db::mark_dead(pool, job.id).await?;
        return Ok(());
    }

    if let Err(e) = process_job(pool, config, &job, http).await {
        tracing::error!("job {} failed: {}", job.id, e);
        job_db::mark_failed(pool, job.id, &e.to_string(), job.retry_count).await?;
    }
    Ok(())
}

async fn process_job(pool: &PgPool, config: &Config, job: &PublishJob, http: &reqwest::Client) -> Result<()> {
    let source = match job_db::fetch_source_row(pool, job).await? {
        Some(s) => s,
        None => {
            job_db::mark_dead(pool, job.id).await?;
            return Ok(());
        }
    };

    // Stage 1: publish to Nostr if not done yet
    let (_kind1_id, kind30078_id) = if job.nostr_kind1_id.is_none() || job.nostr_kind30078_id.is_none() {
        let result = nostr_publisher::publish_nostr_events(
            &config.nostr_privkey,
            &config.relay_urls,
            job.source_id,
            &job.source_type,
            &source,
        )
        .await?;

        job_db::set_nostr_published(pool, job.id, &result.kind1_id, &result.kind30078_id).await?;
        job_db::update_source_nostr_id(pool, job, &result.kind30078_id).await?;
        (result.kind1_id, result.kind30078_id)
    } else {
        (
            job.nostr_kind1_id.clone().unwrap(),
            job.nostr_kind30078_id.clone().unwrap(),
        )
    };

    // Stage 2: anchor to Bitcoin if not done yet
    if job.bitcoin_txid.is_none() {
        let anchor_hash = build_anchor_hash(&job.source_id.to_string(), &kind30078_id, &source.severity);
        let fee_sats = fee_estimator::estimate_fee(http, config.bitcoin_network.mempool_fee_url()).await as i64;

        let utxo = match utxo_db::claim_utxo(pool, job.id).await? {
            Some(u) => u,
            None => {
                tracing::warn!("no CONFIRMED UTXOs available, requeueing job {}", job.id);
                job_db::release_job_for_retry(pool, job.id).await?;
                return Ok(());
            }
        };

        let anchor_input = AnchorInput {
            anchor_hash: anchor_hash.clone(),
            wif: config.bitcoin_wif.clone(),
            utxo_txid: utxo.txid.clone(),
            utxo_vout: utxo.vout as u32,
            utxo_value_sats: utxo.value_sats,
            fee_sats,
            network: config.bitcoin_network.to_bitcoin_network(),
            mempool_broadcast_url: config.bitcoin_network.mempool_broadcast_url().into(),
            blockstream_broadcast_url: config.bitcoin_network.blockstream_broadcast_url().into(),
        };

        let (txid_to_record, anchor_hash_to_record) = match bitcoin_anchor::broadcast_anchor(anchor_input).await {
            Ok(result) => {
                // Broadcast succeeded. spend_utxo failure must NOT re-trigger the Bitcoin stage —
                // the tx is already on the network and the UTXO is effectively spent.
                if let Err(e) = utxo_db::spend_utxo(pool, utxo.id, &result.txid, result.change_vout, result.change_value_sats, job.id).await {
                    tracing::error!("spend_utxo failed after broadcast for job {}, txid={}: {}", job.id, result.txid, e);
                }
                (result.txid, anchor_hash.clone())
            }
            Err(AnchorError::PreBroadcast(msg)) => {
                utxo_db::release_utxo(pool, utxo.id).await?;
                return Err(anyhow::anyhow!(msg));
            }
            Err(AnchorError::PostBroadcast { message, txid, change_vout, change_value_sats }) => {
                // Tx was built; may or may not have been broadcast. Record what we know.
                if let Err(e) = utxo_db::spend_utxo(pool, utxo.id, &txid, change_vout, change_value_sats, job.id).await {
                    tracing::error!("spend_utxo failed in PostBroadcast for job {}, txid={}: {}", job.id, txid, e);
                }
                tracing::warn!("post-broadcast error for job {}: {}", job.id, message);
                (txid, anchor_hash.clone())
            }
        };
        job_db::set_bitcoin_anchored(pool, job.id, &txid_to_record, &anchor_hash_to_record).await?;
        job_db::update_source_bitcoin_txid(pool, job, &txid_to_record).await?;
    }
    // Job is now BITCOIN_ANCHORED — confirmation_poller advances it to COMPLETE
    Ok(())
}
