//! Trust hygiene worker (C-1b-1). Each tick:
//!   1. SNAPSHOT pass (ALWAYS): write one aggregate trust_metrics_snapshots row +
//!      trim rows past the retention horizon. Runs even when decay is dark-launched,
//!      so the Observatory accrues trend data during the pilot.
//!   2. DECAY pass (gated on `enabled`): recompute effective_reputation_score +
//!      reputation_tier for users past the grace window, via the pure trust::decay curve.
//!
//! Idempotent: snapshot is append-only; decay recomputes from earned + last_verified_at.

use sqlx::{PgPool, Row};
use tokio::time::{interval, Duration};

use crate::reports::service::compute_tier_pub;
use crate::trust::decay::{accuracy_ratio, effective_score};

#[derive(Clone)]
pub struct DecayConfig {
    pub enabled: bool,
    pub grace_days: u32,
    pub horizon_days: u32,
    pub floor: i32,
    pub retention_days: u32,
}

pub async fn run(pool: PgPool, tick_secs: u64, cfg: DecayConfig) {
    let mut ticker = interval(Duration::from_secs(tick_secs.max(1)));
    loop {
        ticker.tick().await;
        if let Err(e) = snapshot_pass(&pool, cfg.retention_days).await {
            tracing::error!("trust_worker snapshot pass failed: {e:#}");
        }
        if cfg.enabled {
            if let Err(e) = decay_pass(&pool, &cfg).await {
                tracing::error!("trust_worker decay pass failed: {e:#}");
            }
        }
    }
}

async fn snapshot_pass(pool: &PgPool, retention_days: u32) -> anyhow::Result<()> {
    let tiers = sqlx::query(
        "SELECT reputation_tier AS k, COUNT(*) AS n FROM users GROUP BY reputation_tier",
    )
    .fetch_all(pool)
    .await?;
    let mut tier_dist = serde_json::Map::new();
    for r in tiers {
        tier_dist.insert(
            r.get::<String, _>("k"),
            serde_json::json!(r.get::<i64, _>("n")),
        );
    }

    let active_vouches: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM vouches WHERE revoked_at IS NULL")
            .fetch_one(pool)
            .await?;
    let vouches_by_basis = sqlx::query(
        "SELECT issuance_basis AS k, COUNT(*) AS n FROM vouches WHERE revoked_at IS NULL GROUP BY issuance_basis",
    )
    .fetch_all(pool)
    .await?;
    let mut basis = serde_json::Map::new();
    for r in vouches_by_basis {
        basis.insert(
            r.get::<String, _>("k"),
            serde_json::json!(r.get::<i64, _>("n")),
        );
    }

    let statuses =
        sqlx::query("SELECT status AS k, COUNT(*) AS n FROM community_reports GROUP BY status")
            .fetch_all(pool)
            .await?;
    let mut status_dist = serde_json::Map::new();
    for r in statuses {
        status_dist.insert(
            r.get::<String, _>("k"),
            serde_json::json!(r.get::<i64, _>("n")),
        );
    }

    let trust_states = sqlx::query(
        "SELECT trust_state AS k, COUNT(*) AS n FROM safety_events GROUP BY trust_state",
    )
    .fetch_all(pool)
    .await?;
    let mut ts_dist = serde_json::Map::new();
    for r in trust_states {
        ts_dist.insert(
            r.get::<String, _>("k"),
            serde_json::json!(r.get::<i64, _>("n")),
        );
    }

    let decayed_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM users WHERE effective_reputation_score IS NOT NULL
           AND effective_reputation_score < reputation_score",
    )
    .fetch_one(pool)
    .await?;
    let max_fanout: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(c), 0) FROM (
           SELECT COUNT(*) c FROM vouches WHERE revoked_at IS NULL GROUP BY voucher_pubkey) s",
    )
    .fetch_one(pool)
    .await?;

    let metrics = serde_json::json!({
        "tier_distribution": tier_dist,
        "active_vouches_total": active_vouches,
        "active_vouches_by_basis": basis,
        "vouch_fanout_max": max_fanout,
        "reports_by_status": status_dist,
        "safety_events_by_trust_state": ts_dist,
        "decayed_count": decayed_count,
    });

    sqlx::query("INSERT INTO trust_metrics_snapshots (metrics) VALUES ($1)")
        .bind(&metrics)
        .execute(pool)
        .await?;
    sqlx::query(
        "DELETE FROM trust_metrics_snapshots WHERE captured_at < now() - ($1 || ' days')::interval",
    )
    .bind((retention_days as i64).to_string())
    .execute(pool)
    .await?;
    Ok(())
}

async fn decay_pass(pool: &PgPool, cfg: &DecayConfig) -> anyhow::Result<()> {
    let rows = sqlx::query(
        "SELECT nostr_pubkey,
                reputation_score,
                accurate_reports,
                total_reports,
                EXTRACT(EPOCH FROM (now() - last_verified_at))::float8 / 86400.0 AS days_inactive
           FROM users
          WHERE last_verified_at IS NOT NULL
            AND last_verified_at < now() - ($1 || ' days')::interval
            AND reputation_score > $2",
    )
    .bind((cfg.grace_days as i64).to_string())
    .bind(cfg.floor)
    .fetch_all(pool)
    .await?;

    for r in rows {
        let pk: String = r.get("nostr_pubkey");
        let earned: i32 = r.get("reputation_score");
        let accurate: i64 = r.get::<i32, _>("accurate_reports") as i64;
        let total: i64 = r.get::<i32, _>("total_reports") as i64;
        let days: f64 = r.get("days_inactive");
        let acc = accuracy_ratio(accurate, total);
        let eff = effective_score(
            earned,
            days as i64,
            acc,
            cfg.grace_days,
            cfg.horizon_days,
            cfg.floor,
        );
        let tier = compute_tier_pub(eff as i64);
        sqlx::query(
            "UPDATE users SET effective_reputation_score = $2, reputation_tier = $3 WHERE nostr_pubkey = $1",
        )
        .bind(&pk)
        .bind(eff)
        .bind(tier)
        .execute(pool)
        .await?;
    }
    Ok(())
}
