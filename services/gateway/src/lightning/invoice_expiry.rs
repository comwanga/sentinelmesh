use sqlx::PgPool;
use tokio::time::{interval, Duration};

const POLL_INTERVAL_SECS: u64 = 300; // every 5 minutes

pub async fn run(pool: PgPool) {
    let mut tick = interval(Duration::from_secs(POLL_INTERVAL_SECS));
    loop {
        tick.tick().await;
        if let Err(e) = expire_stale_invoices(&pool).await {
            tracing::warn!("invoice expiry worker error: {e:#}");
        }
    }
}

async fn expire_stale_invoices(pool: &PgPool) -> anyhow::Result<()> {
    let result = sqlx::query(
        "UPDATE lightning_zaps
         SET status = 'expired'
         WHERE status = 'pending'
           AND expires_at < NOW()",
    )
    .execute(pool)
    .await?;

    let count = result.rows_affected();
    if count > 0 {
        tracing::info!(count, "marked invoices as expired");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn poll_interval_is_reasonable() {
        assert!(super::POLL_INTERVAL_SECS >= 60);
        assert!(super::POLL_INTERVAL_SECS <= 3600);
    }
}
