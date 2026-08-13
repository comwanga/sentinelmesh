//! Acoustic data retention + event expiry (audit AC-5, AC-7).
//!
//! AC-5 (ADR-001 coordinate precision degradation): the documented retention
//! schedule was never implemented, so exact coordinates persisted indefinitely.
//! This worker nulls exact lat/lng after 24h and the ~100m H3 cell after 7d.
//! The ~5km H3 r7 cell is the permanent precision floor and is never nulled.
//!
//! AC-7 (event expiry): confirmed acoustic `public_events` previously never
//! expired, so a single false confirmed event stayed ACTIVE on the map forever.
//! This worker expires confirmed events that have had no fresh corroboration.
//!
//! All statements are idempotent UPDATEs, so running on multiple replicas is safe.

use sqlx::PgPool;
use tokio::time::{interval, Duration};

const TICK_SECS: u64 = 300; // 5 minutes
const COORD_RETENTION_SECS: i64 = 24 * 60 * 60; // 24h: null exact lat/lng
const H3R9_RETENTION_SECS: i64 = 7 * 24 * 60 * 60; // 7d: null ~100m cell
const PUBLIC_EVENT_TTL_SECS: i64 = 30 * 60; // 30m idle: expire confirmed events

pub async fn run(pool: PgPool) {
    tracing::info!(
        coord_retention_h = COORD_RETENTION_SECS / 3600,
        h3r9_retention_d = H3R9_RETENTION_SECS / 86_400,
        event_ttl_min = PUBLIC_EVENT_TTL_SECS / 60,
        "retention worker started, tick interval {}s",
        TICK_SECS
    );
    let mut tick = interval(Duration::from_secs(TICK_SECS));
    loop {
        tick.tick().await;
        if let Err(e) = run_once(&pool).await {
            tracing::warn!("retention worker error: {e:#}");
        }
    }
}

async fn run_once(pool: &PgPool) -> anyhow::Result<()> {
    // AC-5: degrade exact coordinates past the retention window.
    let coords = sqlx::query(
        "UPDATE acoustic_signals
            SET lat = NULL, lng = NULL
          WHERE lat IS NOT NULL
            AND received_at < now() - ($1 * interval '1 second')",
    )
    .bind(COORD_RETENTION_SECS)
    .execute(pool)
    .await?;

    let cells = sqlx::query(
        "UPDATE acoustic_signals
            SET h3_r9 = NULL
          WHERE h3_r9 IS NOT NULL
            AND received_at < now() - ($1 * interval '1 second')",
    )
    .bind(H3R9_RETENTION_SECS)
    .execute(pool)
    .await?;

    // AC-7: expire confirmed acoustic events with no fresh corroboration.
    let expired = sqlx::query(
        "UPDATE public_events
            SET trust_state = 'expired', expired_at = now()
          WHERE trust_state = 'confirmed'
            AND updated_at < now() - ($1 * interval '1 second')",
    )
    .bind(PUBLIC_EVENT_TTL_SECS)
    .execute(pool)
    .await?;

    sqlx::query(
        "DELETE FROM push_deliveries
          WHERE (status = 'sent' AND sent_at < now() - interval '30 days')
             OR (status = 'dead' AND updated_at < now() - interval '30 days')",
    )
    .execute(pool)
    .await?;

    let (c, h, e) = (
        coords.rows_affected(),
        cells.rows_affected(),
        expired.rows_affected(),
    );
    if c > 0 || h > 0 || e > 0 {
        tracing::info!(
            coords_nulled = c,
            h3r9_nulled = h,
            events_expired = e,
            "retention pass applied"
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[allow(clippy::assertions_on_constants)]
    fn retention_windows_are_ordered_and_sane() {
        // Exact coords degrade before the coarser cell; both before "never".
        assert!(COORD_RETENTION_SECS < H3R9_RETENTION_SECS);
        assert_eq!(COORD_RETENTION_SECS, 86_400);
        assert_eq!(H3R9_RETENTION_SECS, 604_800);
        assert!(PUBLIC_EVENT_TTL_SECS > 0 && PUBLIC_EVENT_TTL_SECS < COORD_RETENTION_SECS);
    }
}
