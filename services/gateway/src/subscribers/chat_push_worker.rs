use anyhow::Result;
use futures::{stream, StreamExt};
use serde_json::Value;
use sqlx::PgPool;
use tokio::time::{interval, Duration};
use uuid::Uuid;
use web_push::{
    ContentEncoding, HyperWebPushClient, SubscriptionInfo, VapidSignatureBuilder, WebPushClient,
    WebPushMessageBuilder, URL_SAFE_NO_PAD,
};

const BATCH_SIZE: i64 = 50;
const MAX_ATTEMPTS: i32 = 8;

#[derive(sqlx::FromRow)]
struct Delivery {
    id: Uuid,
    endpoint: String,
    p256dh: String,
    auth: String,
    payload: Value,
}

pub async fn run(pool: PgPool, private_key: String, subject: String) {
    let worker_id = Uuid::new_v4();
    let mut ticker = interval(Duration::from_secs(2));
    loop {
        ticker.tick().await;
        if let Err(error) = process_batch(&pool, &private_key, &subject, worker_id).await {
            tracing::warn!(%error, "chat push outbox cycle failed");
        }
    }
}

async fn process_batch(
    pool: &PgPool,
    private_key: &str,
    subject: &str,
    worker_id: Uuid,
) -> Result<()> {
    let deliveries: Vec<Delivery> = sqlx::query_as(
        "WITH claim AS (
           SELECT id FROM chat_push_deliveries
            WHERE (status = 'pending' AND available_at <= now())
               OR (status = 'processing' AND locked_at < now() - interval '15 minutes')
            ORDER BY available_at, created_at
            FOR UPDATE SKIP LOCKED LIMIT $1
         )
         UPDATE chat_push_deliveries d SET status = 'processing', worker_id = $2, locked_at = now(), updated_at = now()
          FROM claim, push_subscriptions s
         WHERE d.id = claim.id AND s.id = d.subscription_id
         RETURNING d.id, s.endpoint, s.p256dh, s.auth, d.payload",
    )
    .bind(BATCH_SIZE)
    .bind(worker_id)
    .fetch_all(pool)
    .await?;

    stream::iter(deliveries)
        .for_each_concurrent(10, |delivery| async move {
            match send(private_key, subject, &delivery).await {
                Ok(()) => {
                    if let Err(error) = mark_sent(pool, delivery.id, worker_id).await {
                        tracing::warn!(%error, "chat push completion write failed");
                    }
                }
                Err(error) => {
                    if let Err(db_error) = mark_failed(pool, delivery.id, worker_id, &error).await {
                        tracing::warn!(%db_error, "chat push retry write failed");
                    }
                }
            }
        })
        .await;
    Ok(())
}

async fn send(private_key: &str, subject: &str, delivery: &Delivery) -> Result<()> {
    let info = SubscriptionInfo::new(&delivery.endpoint, &delivery.p256dh, &delivery.auth);
    let mut signature = VapidSignatureBuilder::from_base64(private_key, URL_SAFE_NO_PAD, &info)?;
    signature.add_claim("sub", subject);
    let mut message = WebPushMessageBuilder::new(&info);
    let payload = delivery.payload.to_string();
    message.set_payload(ContentEncoding::Aes128Gcm, payload.as_bytes());
    message.set_vapid_signature(signature.build()?);
    tokio::time::timeout(
        Duration::from_secs(30),
        HyperWebPushClient::new().send(message.build()?),
    )
    .await
    .map_err(|_| anyhow::anyhow!("push provider timed out"))??;
    Ok(())
}

async fn mark_sent(pool: &PgPool, id: Uuid, worker_id: Uuid) -> Result<()> {
    sqlx::query(
        "UPDATE chat_push_deliveries SET status='sent', sent_at=now(), locked_at=NULL, worker_id=NULL, updated_at=now()
         WHERE id=$1 AND worker_id=$2",
    )
    .bind(id)
    .bind(worker_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn mark_failed(
    pool: &PgPool,
    id: Uuid,
    worker_id: Uuid,
    error: &anyhow::Error,
) -> Result<()> {
    sqlx::query(
        "UPDATE chat_push_deliveries
            SET attempts = attempts + 1,
                status = CASE WHEN attempts + 1 >= $3 THEN 'dead' ELSE 'pending' END,
                available_at = now() + (LEAST(3600, power(2, attempts + 1)::integer) * interval '1 second'),
                last_error = left($4, 1000), locked_at=NULL, worker_id=NULL, updated_at=now()
          WHERE id=$1 AND worker_id=$2",
    )
    .bind(id)
    .bind(worker_id)
    .bind(MAX_ATTEMPTS)
    .bind(error.to_string())
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queue_bounds_are_deliberate() {
        assert_eq!(BATCH_SIZE, 50);
        assert_eq!(MAX_ATTEMPTS, 8);
    }
}
