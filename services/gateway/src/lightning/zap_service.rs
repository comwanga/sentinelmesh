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
    pub status: String,
    pub bolt11_invoice: String,
    pub recipient_pubkey: String,
    pub amount_sats: i64,
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

    Ok(ZapCreated {
        zap_id,
        payment_request: invoice.payment_request,
        amount_sats,
    })
}

pub async fn handle_payment_webhook(
    pool: &PgPool,
    payment_hash: &str,
    nostr_private_key_hex: Option<&str>,
) -> Result<()> {
    let zap = sqlx::query_as::<_, ZapRow>(
        "SELECT id, status, bolt11_invoice, recipient_pubkey, amount_sats
         FROM lightning_zaps WHERE payment_hash = $1",
    )
    .bind(payment_hash)
    .fetch_optional(pool)
    .await?;

    let zap = match zap {
        None => return Ok(()),
        Some(z) if z.status != "pending" => return Ok(()),
        Some(z) => z,
    };

    let mut receipt_id: Option<String> = None;
    let mut receipt_json: Option<String> = None;

    if let Some(key_hex) = nostr_private_key_hex {
        match publish_zap_receipt(key_hex, &zap.recipient_pubkey, &zap.bolt11_invoice, payment_hash).await {
            Ok((id, json)) => {
                receipt_id = Some(id);
                receipt_json = Some(json);
            }
            Err(e) => tracing::warn!("failed to publish zap receipt: {e}"),
        }
    } else {
        tracing::warn!("NOSTR_PRIVATE_KEY not set -- skipping kind 9735 receipt");
    }

    sqlx::query(
        "UPDATE lightning_zaps
         SET status = 'paid', paid_at = NOW(), zap_receipt_id = $2, zap_receipt_json = $3
         WHERE id = $1",
    )
    .bind(zap.id)
    .bind(receipt_id)
    .bind(receipt_json)
    .execute(pool)
    .await?;

    Ok(())
}

async fn publish_zap_receipt(
    private_key_hex: &str,
    recipient_pubkey: &str,
    bolt11: &str,
    preimage_hex: &str,
) -> Result<(String, String)> {
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

    let id = event.id.to_hex();
    let json = serde_json::to_string(&event)?;

    let client = Client::new(keys);
    client.add_relay("wss://nos.lol").await?;
    client.connect().await;
    client.send_event(event).await.ok();
    client.disconnect().await.ok();

    Ok((id, json))
}
