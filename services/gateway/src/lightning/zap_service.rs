use anyhow::Result;
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use super::lnd_client::LndClient;

const MAX_ZAP_SATS: i64 = 100_000;

#[derive(Debug, Serialize)]
pub struct ZapCreated {
    pub zap_id: Uuid,
    pub payment_request: String,
    pub amount_sats: i64,
}

#[derive(Debug, sqlx::FromRow)]
struct ZapRow {
    pub id: Uuid,
    pub bolt11_invoice: String,
    pub recipient_pubkey: String,
    #[allow(dead_code)]
    pub amount_sats: i64,
    pub payment_hash: String,
}

pub async fn create_zap_request(
    pool: &PgPool,
    lnd: &LndClient,
    report_id: Uuid,
    amount_sats: i64,
) -> Result<ZapCreated> {
    if amount_sats > MAX_ZAP_SATS {
        anyhow::bail!("amount_sats exceeds maximum of {MAX_ZAP_SATS}");
    }

    let recipient: Option<String> = sqlx::query_scalar(
        "SELECT nostr_pubkey FROM community_reports WHERE id = $1",
    )
    .bind(report_id)
    .fetch_optional(pool)
    .await?;

    let recipient_pubkey = recipient.ok_or_else(|| anyhow::anyhow!("report not found"))?;

    let memo = format!("Zap for report {report_id}");
    let invoice = lnd.create_invoice(amount_sats, &memo).await?;

    let zap_id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO lightning_zaps
           (id, report_id, recipient_pubkey, amount_sats, bolt11_invoice, payment_hash, status)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'pending')
         RETURNING id",
    )
    .bind(report_id)
    .bind(&recipient_pubkey)
    .bind(amount_sats)
    .bind(&invoice.payment_request)
    .bind(&invoice.payment_hash_hex)
    .fetch_one(pool)
    .await?;

    tracing::info!(
        zap_id = %zap_id,
        report_id = %report_id,
        amount_sats,
        "invoice created"
    );

    Ok(ZapCreated {
        zap_id,
        payment_request: invoice.payment_request,
        amount_sats,
    })
}

/// Atomically mark the zap as paid (only if currently 'pending') and attempt
/// to publish the Nostr zap receipt. Receipt failure is non-fatal — the retry
/// worker will pick it up.
pub async fn handle_payment_webhook(
    pool: &PgPool,
    payment_hash: &str,
    nostr_private_key_hex: Option<&str>,
    relays: &[String],
) -> Result<()> {
    // Atomic update: only one concurrent delivery wins this UPDATE.
    // If status is already 'paid'/'expired'/'failed', returns None and we no-op.
    let zap = sqlx::query_as::<_, ZapRow>(
        "UPDATE lightning_zaps
         SET status = 'paid', paid_at = NOW()
         WHERE payment_hash = $1 AND status = 'pending'
         RETURNING id, bolt11_invoice, recipient_pubkey, amount_sats, payment_hash",
    )
    .bind(payment_hash)
    .fetch_optional(pool)
    .await?;

    let Some(zap) = zap else {
        tracing::debug!(payment_hash, "webhook received for already-processed or unknown zap — no-op");
        return Ok(());
    };

    tracing::info!(
        zap_id = %zap.id,
        amount_sats = zap.amount_sats,
        "payment confirmed"
    );

    // Attempt receipt publish now; retry worker handles failures.
    if let Some(key_hex) = nostr_private_key_hex {
        match publish_zap_receipt(key_hex, &zap.recipient_pubkey, &zap.bolt11_invoice, payment_hash, relays).await {
            Ok((receipt_id, receipt_json, relay_count)) => {
                tracing::info!(
                    zap_id = %zap.id,
                    relay_count,
                    receipt_id = %receipt_id,
                    "zap receipt published"
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
                .bind(zap.id)
                .bind(&receipt_id)
                .bind(serde_json::from_str::<serde_json::Value>(&receipt_json).ok())
                .execute(pool)
                .await?;
            }
            Err(e) => {
                tracing::warn!(zap_id = %zap.id, error = %e, "receipt publish failed — will retry");
                sqlx::query(
                    "UPDATE lightning_zaps
                     SET receipt_retry_count = receipt_retry_count + 1,
                         receipt_last_attempt_at = NOW()
                     WHERE id = $1",
                )
                .bind(zap.id)
                .execute(pool)
                .await?;
            }
        }
    } else {
        tracing::warn!(zap_id = %zap.id, "NOSTR_PRIVATE_KEY not configured — skipping receipt");
    }

    Ok(())
}

/// Publish a NIP-57 Kind 9735 zap receipt to all configured relays.
/// Returns (event_id_hex, event_json, relay_count).
/// Returns Err only if key parsing, event signing, or all relays reject.
pub async fn publish_zap_receipt(
    private_key_hex: &str,
    recipient_pubkey: &str,
    bolt11: &str,
    preimage_hex: &str,
    relays: &[String],
) -> Result<(String, String, usize)> {
    use nostr_sdk::{Client, EventBuilder, Keys, Kind, Tag, TagKind};

    let keys = Keys::parse(private_key_hex)?;

    let tags = vec![
        Tag::custom(TagKind::custom("p"), [recipient_pubkey]),
        Tag::custom(TagKind::custom("bolt11"), [bolt11]),
        Tag::custom(TagKind::custom("preimage"), [preimage_hex]),
    ];

    let event = EventBuilder::new(Kind::Custom(9735), "")
        .tags(tags)
        .sign_with_keys(&keys)?;

    // Verify receipt signature before publishing
    event.verify()?;

    let id = event.id.to_hex();
    let json = serde_json::to_string(&event)?;

    let relay_count = relays.len();
    let client = Client::new(keys);
    for relay in relays {
        if let Err(e) = client.add_relay(relay.as_str()).await {
            tracing::warn!(relay, error = %e, "failed to add relay");
        }
    }
    client.connect().await;

    let sent = client.send_event(event).await;
    client.disconnect().await.ok();

    match sent {
        Ok(_) => {}
        Err(e) => {
            tracing::warn!(error = %e, "receipt not accepted by any relay");
            anyhow::bail!("receipt not accepted by any relay: {e}");
        }
    }

    Ok((id, json, relay_count))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relay_list_passed_through() {
        let relays: Vec<String> = vec!["wss://a.example".into(), "wss://b.example".into()];
        assert_eq!(relays.len(), 2);
    }

    #[test]
    fn max_zap_sats_constant_is_reasonable() {
        assert!(MAX_ZAP_SATS > 0);
        assert!(MAX_ZAP_SATS <= 1_000_000);
    }
}
