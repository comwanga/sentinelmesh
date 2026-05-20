use sqlx::PgPool;
use tokio::time::{interval, Duration};
use uuid::Uuid;

const POLL_INTERVAL_SECS: u64 = 60;
const MAX_RETRIES: i32 = 3;

#[derive(sqlx::FromRow)]
struct PendingReceipt {
    id: Uuid,
    bolt11_invoice: String,
    recipient_pubkey: String,
    payment_hash: String,
}

pub async fn run(pool: PgPool, relays: Vec<String>, nostr_key_hex: String) {
    let mut tick = interval(Duration::from_secs(POLL_INTERVAL_SECS));
    loop {
        tick.tick().await;
        if let Err(e) = retry_once(&pool, &relays, &nostr_key_hex).await {
            tracing::warn!("receipt retry worker error: {e:#}");
        }
    }
}

async fn retry_once(pool: &PgPool, relays: &[String], nostr_key_hex: &str) -> anyhow::Result<()> {
    // Query receipts that failed and are due for a retry.
    // Backoff formula: wait 2^retry_count minutes between attempts.
    let pending = sqlx::query_as::<_, PendingReceipt>(
        "SELECT id, bolt11_invoice, recipient_pubkey, payment_hash
         FROM lightning_zaps
         WHERE status = 'paid'
           AND receipt_published = false
           AND receipt_retry_count < $1
           AND (
             receipt_last_attempt_at IS NULL
             OR receipt_last_attempt_at < NOW() - (INTERVAL '1 minute') * POWER(2, receipt_retry_count)
           )
         ORDER BY receipt_last_attempt_at ASC NULLS FIRST
         LIMIT 20",
    )
    .bind(MAX_RETRIES)
    .fetch_all(pool)
    .await?;

    if pending.is_empty() {
        return Ok(());
    }

    tracing::info!(count = pending.len(), "retrying pending zap receipts");

    for row in pending {
        match super::zap_service::publish_zap_receipt(
            nostr_key_hex,
            &row.recipient_pubkey,
            &row.bolt11_invoice,
            &row.payment_hash,
            relays,
        )
        .await
        {
            Ok((receipt_id, receipt_json, relay_count)) => {
                tracing::info!(
                    zap_id = %row.id,
                    relay_count,
                    "retry: receipt published"
                );
                sqlx::query(
                    "UPDATE lightning_zaps
                     SET receipt_published = true,
                         receipt_retry_count = receipt_retry_count + 1,
                         receipt_last_attempt_at = NOW(),
                         zap_receipt_id = $2,
                         zap_receipt_json = $3
                     WHERE id = $1",
                )
                .bind(row.id)
                .bind(&receipt_id)
                .bind(serde_json::from_str::<serde_json::Value>(&receipt_json).ok())
                .execute(pool)
                .await?;
            }
            Err(e) => {
                tracing::warn!(zap_id = %row.id, error = %e, "retry: receipt still failing");
                sqlx::query(
                    "UPDATE lightning_zaps
                     SET receipt_retry_count = receipt_retry_count + 1,
                         receipt_last_attempt_at = NOW()
                     WHERE id = $1",
                )
                .bind(row.id)
                .execute(pool)
                .await?;
            }
        }
    }

    Ok(())
}
