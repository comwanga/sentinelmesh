//! NLP trust-ladder synthesis worker (H-5 Phase 2B-ii).
//!
//! Sibling to the acoustic `synthesis_worker`, but built against the shared
//! `trust::contract`. Each tick it:
//!   1. expires stale uncorroborated detections (TTL by tier),
//!   2. recomputes independence (distinct provenance clusters + channels) for
//!      every active cluster from the staged `nlp_signals`,
//!   3. promotes the linked `safety_events.trust_state` monotonically via
//!      `contract::decide`, and
//!   4. on the transition into `confirmed` — and only then — fires push
//!      notifications and broadcasts the confirmed event to the map.
//!
//! Heuristic and corroborating events are visible on the map (labeled) but never
//! push, never anchor, never feed reputation. That gating is the core of H-5.
//!
//! The worker is idempotent (recompute + monotonic promotion via `max`), so a
//! duplicate run across replicas is safe — multi-replica leader election is
//! audit item H-7, out of scope here.

use std::sync::Arc;

use anyhow::Result;
use sqlx::{PgPool, Row};
use tokio::time::Duration;
use uuid::Uuid;

use crate::trust::contract::{self, Independence, TrustTier};

const TICK_MS: u64 = 5_000;

/// TTL for an uncorroborated HEURISTIC detection, measured from `started_at`.
/// Matches the 30-minute corroboration window in `event_subscriber`: once a
/// cluster stops accepting new signals it has 0 extra time to gather a second
/// source before it drops off the map.
const HEURISTIC_TTL_SECS: i64 = 30 * 60;
/// TTL for a CORROBORATING detection that never reached CONFIRMED.
const CORROBORATING_TTL_SECS: i64 = 2 * 60 * 60;

/// Config the worker needs to fire push on confirm. Cloned in from `Config` so
/// the worker does not depend on the whole `AppState`.
#[derive(Clone)]
pub struct PushConfig {
    pub vapid_private_key: Option<String>,
    pub vapid_subject: Option<String>,
}

#[derive(Default)]
struct TickSummary {
    clusters_evaluated: usize,
    promoted_to_corroborating: usize,
    promoted_to_confirmed: usize,
    expired_events: usize,
}

/// Recomputed independence for one cluster plus its display row count.
#[derive(Debug, Clone, Copy)]
struct ClusterStats {
    distinct_sources: usize,
    distinct_channels: usize,
    total_signals: usize,
}

impl ClusterStats {
    fn independence(&self) -> Independence {
        Independence {
            distinct_sources: self.distinct_sources,
            distinct_channels: self.distinct_channels,
        }
    }
}

pub async fn run(
    pool: PgPool,
    enabled: bool,
    push: PushConfig,
    event_tx: Arc<tokio::sync::broadcast::Sender<crate::ws::ViewportEvent>>,
) {
    if !enabled {
        tracing::info!("NLP synthesis worker disabled (NLP_SYNTHESIS_ENABLED=false)");
        return;
    }
    tracing::info!("NLP synthesis worker started, tick interval {}ms", TICK_MS);

    loop {
        let start = std::time::Instant::now();
        match tick(&pool, &push, &event_tx).await {
            Ok(summary) => {
                tracing::info!(
                    cycle_ms = start.elapsed().as_millis() as u64,
                    clusters_evaluated = summary.clusters_evaluated,
                    promoted_corr = summary.promoted_to_corroborating,
                    promoted_conf = summary.promoted_to_confirmed,
                    expired = summary.expired_events,
                    "nlp_synthesis_cycle"
                );
            }
            Err(e) => {
                tracing::warn!("NLP synthesis tick error: {e:#}");
            }
        }
        let remaining = Duration::from_millis(TICK_MS).saturating_sub(start.elapsed());
        tokio::time::sleep(remaining).await;
    }
}

#[allow(clippy::field_reassign_with_default)]
async fn tick(
    pool: &PgPool,
    push: &PushConfig,
    event_tx: &Arc<tokio::sync::broadcast::Sender<crate::ws::ViewportEvent>>,
) -> Result<TickSummary> {
    let mut summary = TickSummary::default();

    summary.expired_events = expire_stale_events(pool).await?;

    let clusters = fetch_cluster_stats(pool).await?;
    summary.clusters_evaluated = clusters.len();

    for (event_id, stats) in clusters {
        match promote_cluster(pool, push, event_tx, event_id, stats).await {
            Ok(Promotion::Corroborated) => summary.promoted_to_corroborating += 1,
            Ok(Promotion::Confirmed) => summary.promoted_to_confirmed += 1,
            Ok(Promotion::Unchanged) => {}
            Err(e) => tracing::warn!(%event_id, "NLP synthesis: cluster promote error: {e:#}"),
        }
    }

    Ok(summary)
}

/// Expire HEURISTIC/CORROBORATING machine events past their TTL: drop them off
/// the map (`is_active=false`, `state='EXPIRED'`) and move their still-pending
/// staging signals to `expired` so they can never rejoin a dead cluster.
/// Idempotent: already-inactive rows are skipped by the `is_active` guard.
async fn expire_stale_events(pool: &PgPool) -> Result<usize> {
    let expired_ids: Vec<Uuid> = sqlx::query_scalar(
        "UPDATE safety_events
            SET is_active = false, state = 'EXPIRED', updated_at = now()
          WHERE origin_class = 'machine'
            AND is_active = true
            AND (
                  (trust_state = 'heuristic'
                     AND started_at < now() - ($1 * interval '1 second'))
               OR (trust_state = 'corroborating'
                     AND started_at < now() - ($2 * interval '1 second'))
                )
          RETURNING id",
    )
    .bind(HEURISTIC_TTL_SECS)
    .bind(CORROBORATING_TTL_SECS)
    .fetch_all(pool)
    .await?;

    if !expired_ids.is_empty() {
        sqlx::query(
            "UPDATE nlp_signals SET trust_state = 'expired'
              WHERE trust_state IN ('pending', 'corroborating')
                AND event_id = ANY($1)",
        )
        .bind(&expired_ids)
        .execute(pool)
        .await?;
    }

    Ok(expired_ids.len())
}

/// Recompute independence per active cluster from the still-pending staged
/// signals. Independence is distinct **provenance clusters** (distinct non-null
/// `source_id`) and distinct `origin_channel`s — never the raw row count, so a
/// duplicate-ingestion bug cannot inflate trust. `total_signals` is display only.
async fn fetch_cluster_stats(pool: &PgPool) -> Result<Vec<(Uuid, ClusterStats)>> {
    let rows = sqlx::query(
        "SELECT event_id,
                COUNT(DISTINCT source_id) FILTER (WHERE source_id IS NOT NULL) AS distinct_sources,
                COUNT(DISTINCT origin_channel)                                  AS distinct_channels,
                COUNT(*)                                                        AS total_signals
           FROM nlp_signals
          WHERE trust_state = 'pending'
            AND event_id IS NOT NULL
          GROUP BY event_id",
    )
    .fetch_all(pool)
    .await?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let event_id: Uuid = row.try_get("event_id")?;
        let distinct_sources: i64 = row.try_get("distinct_sources")?;
        let distinct_channels: i64 = row.try_get("distinct_channels")?;
        let total_signals: i64 = row.try_get("total_signals")?;
        out.push((
            event_id,
            ClusterStats {
                distinct_sources: distinct_sources.max(0) as usize,
                distinct_channels: distinct_channels.max(0) as usize,
                total_signals: total_signals.max(0) as usize,
            },
        ));
    }
    Ok(out)
}

enum Promotion {
    Unchanged,
    Corroborated,
    Confirmed,
}

async fn promote_cluster(
    pool: &PgPool,
    push: &PushConfig,
    event_tx: &Arc<tokio::sync::broadcast::Sender<crate::ws::ViewportEvent>>,
    event_id: Uuid,
    stats: ClusterStats,
) -> Result<Promotion> {
    // Read the event's current tier + the fields needed for a confirm broadcast.
    let Some(row) = sqlx::query(
        "SELECT trust_state, severity, title, event_type, lat, lng, started_at
           FROM safety_events
          WHERE id = $1 AND is_active = true",
    )
    .bind(event_id)
    .fetch_optional(pool)
    .await?
    else {
        // Event was expired/removed between the stats query and now — skip.
        return Ok(Promotion::Unchanged);
    };

    let current_str: String = row.try_get("trust_state")?;
    let Some(current) = TrustTier::from_db_str(&current_str) else {
        tracing::warn!(%event_id, current = %current_str, "NLP synthesis: unknown trust_state, skipping");
        return Ok(Promotion::Unchanged);
    };

    let computed = contract::decide(stats.independence());
    // Monotonic: never lower an already-higher stored tier (the DB trigger would
    // reject it anyway; max() avoids ever triggering that path).
    let target = std::cmp::max(current, computed);

    // Always refresh the independence metrics + display counts. Set trust_state
    // to the (>=) target; equal values do not fire the monotonicity trigger.
    let breakdown = source_breakdown(&stats);
    sqlx::query(
        "UPDATE safety_events
            SET trust_state = $2,
                distinct_source_count = $3,
                distinct_channel_count = $4,
                source_count = $5,
                source_breakdown = $6,
                updated_at = now()
          WHERE id = $1",
    )
    .bind(event_id)
    .bind(target.as_str())
    .bind(stats.distinct_sources as i32)
    .bind(stats.distinct_channels as i32)
    .bind(stats.total_signals as i32)
    .bind(&breakdown)
    .execute(pool)
    .await?;

    if target == current {
        return Ok(Promotion::Unchanged);
    }

    if should_confirm(current, target) {
        on_confirm(pool, push, event_tx, event_id, &row).await?;
        return Ok(Promotion::Confirmed);
    }

    Ok(Promotion::Corroborated)
}

/// True on the transition *into* confirmed (push/anchor fire exactly once here).
fn should_confirm(previous: TrustTier, target: TrustTier) -> bool {
    previous < TrustTier::Confirmed && target == TrustTier::Confirmed
}

fn source_breakdown(stats: &ClusterStats) -> serde_json::Value {
    serde_json::json!({
        "distinct_sources": stats.distinct_sources,
        "distinct_channels": stats.distinct_channels,
        "signal_count": stats.total_signals,
        "provenance": "nlp_corroborated",
    })
}

/// Side effects gated to the confirm transition: push notification + map
/// broadcast. Failure to push is logged, not fatal — the trust_state is already
/// committed, so a later tick will not re-push (it is no longer a transition).
async fn on_confirm(
    pool: &PgPool,
    push: &PushConfig,
    event_tx: &Arc<tokio::sync::broadcast::Sender<crate::ws::ViewportEvent>>,
    event_id: Uuid,
    row: &sqlx::postgres::PgRow,
) -> Result<()> {
    let severity: String = row.try_get("severity")?;
    let title: String = row.try_get("title")?;
    let event_type: String = row.try_get("event_type")?;
    let lat: f64 = row.try_get("lat")?;
    let lng: f64 = row.try_get("lng")?;
    let started_at: chrono::DateTime<chrono::Utc> = row.try_get("started_at")?;

    // Broadcast the now-confirmed event to viewport WS clients (labeled confirmed).
    let ws_json = serde_json::json!({
        "id": event_id,
        "event_type": event_type,
        "severity": severity,
        "state": "ACTIVE",
        "trust_state": "confirmed",
        "title": title,
        "lat": lat,
        "lng": lng,
        "started_at": started_at,
    });
    let _ = event_tx.send(crate::ws::ViewportEvent {
        id: event_id,
        lat,
        lng,
        severity: severity.clone(),
        event_json: ws_json.to_string().into(),
    });

    // Push only for HIGH/CRITICAL confirmed events, and only if VAPID is configured.
    if matches!(severity.as_str(), "HIGH" | "CRITICAL") {
        match (&push.vapid_private_key, &push.vapid_subject) {
            (Some(key), Some(subject)) => {
                crate::routes::push::broadcast_push(
                    pool,
                    key,
                    subject,
                    &title,
                    &format!("Confirmed {event_type} nearby"),
                    &event_id.to_string(),
                )
                .await;
            }
            _ => {
                tracing::warn!(
                    %event_id,
                    "NLP synthesis: event confirmed but VAPID keys unset — push skipped"
                );
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn confirm_fires_only_on_transition_into_confirmed() {
        assert!(should_confirm(TrustTier::Heuristic, TrustTier::Confirmed));
        assert!(should_confirm(
            TrustTier::Corroborating,
            TrustTier::Confirmed
        ));
        // Already confirmed -> not a transition, must not re-fire.
        assert!(!should_confirm(TrustTier::Confirmed, TrustTier::Confirmed));
        // Lower targets never confirm.
        assert!(!should_confirm(
            TrustTier::Heuristic,
            TrustTier::Corroborating
        ));
        assert!(!should_confirm(TrustTier::Heuristic, TrustTier::Heuristic));
    }

    #[test]
    fn cluster_stats_map_onto_contract_independence() {
        // 3 distinct sources across 2 channels -> contract says confirmed.
        let stats = ClusterStats {
            distinct_sources: 3,
            distinct_channels: 2,
            total_signals: 7,
        };
        assert_eq!(contract::decide(stats.independence()), TrustTier::Confirmed);

        // 3 sources but 1 channel -> corroborating (no self-confirm), even though
        // the raw signal count is high.
        let one_channel = ClusterStats {
            distinct_sources: 3,
            distinct_channels: 1,
            total_signals: 9,
        };
        assert_eq!(
            contract::decide(one_channel.independence()),
            TrustTier::Corroborating
        );

        // Single source -> heuristic regardless of how many duplicate rows.
        let dup = ClusterStats {
            distinct_sources: 1,
            distinct_channels: 1,
            total_signals: 50,
        };
        assert_eq!(contract::decide(dup.independence()), TrustTier::Heuristic);
    }

    #[test]
    fn source_breakdown_records_independence_not_raw_trust() {
        let stats = ClusterStats {
            distinct_sources: 2,
            distinct_channels: 2,
            total_signals: 5,
        };
        let b = source_breakdown(&stats);
        assert_eq!(b["distinct_sources"], 2);
        assert_eq!(b["distinct_channels"], 2);
        assert_eq!(b["signal_count"], 5);
        assert_eq!(b["provenance"], "nlp_corroborated");
    }

    #[test]
    #[allow(clippy::assertions_on_constants)]
    fn ttls_are_ordered_and_sane() {
        // Corroborating gets longer to find a third source than heuristic does
        // to find a second.
        assert!(CORROBORATING_TTL_SECS > HEURISTIC_TTL_SECS);
        assert_eq!(HEURISTIC_TTL_SECS, 1800);
    }
}
