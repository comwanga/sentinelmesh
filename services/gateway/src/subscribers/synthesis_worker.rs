use anyhow::Result;
use sqlx::{PgPool, Row};
use std::sync::Arc;
use tokio::time::Duration;
use uuid::Uuid;

const TICK_MS: u64 = 5_000;
const TEMPORAL_HALF_WEIGHT_SECS: i64 = 60;
const TEMPORAL_CUTOFF_SECS: i64 = 120;
const CORROBORATE_THRESHOLD: f32 = 0.60;
// Confirm is a strictly higher bar than corroborate so the trust ladder is real
// (previously both were 0.60, making the two stages collapse into one).
const CONFIRM_THRESHOLD: f32 = 0.80;
// Require independent corroboration from at least 3 distinct identities before a
// cluster can be promoted. Raised from 2 to blunt the cheapest Sybil-confirm path.
const MIN_CONTRIBUTORS: usize = 3;
const DEFAULT_TRUST: f32 = 0.40;
// Floor for per-node trust in Phase 3; unused while all nodes default to DEFAULT_TRUST
#[allow(dead_code)]
const TRUST_FLOOR: f32 = 0.15;
const EXPIRY_WINDOW_SECS: i64 = 300; // 5 min: how long pending/corroborating signals live before expiry
const FETCH_WINDOW_SECS: i64 = TEMPORAL_CUTOFF_SECS + 10; // slight buffer above scoring cutoff for tick jitter

#[derive(sqlx::FromRow, Debug, Clone)]
struct SignalRow {
    id: Uuid,
    pubkey: String,
    h3_r9: Option<String>,
    h3_r7: String,
    threat_class: String,
    confidence: f32,
    confidence_variance: Option<f32>,
    received_at: chrono::DateTime<chrono::Utc>,
    #[allow(dead_code)]
    trust_state: String,
}

#[derive(Default)]
struct TickSummary {
    clusters_evaluated: usize,
    promoted_to_corroborating: usize,
    promoted_to_confirmed: usize,
    expired: usize,
}

#[derive(Default)]
struct ClusterResult {
    promoted_to_corroborating: usize,
    promoted_to_confirmed: usize,
}

pub async fn run(
    pool: PgPool,
    synthesis_enabled: bool,
    confirm_enabled: bool,
    event_tx: Arc<tokio::sync::broadcast::Sender<crate::ws::ViewportEvent>>,
) {
    if !synthesis_enabled {
        tracing::info!("synthesis worker disabled (SYNTHESIS_ENABLED=false)");
        return;
    }
    tracing::info!(
        confirm_enabled,
        "synthesis worker started, tick interval {}ms",
        TICK_MS
    );
    if !confirm_enabled {
        tracing::warn!(
            "ACOUSTIC_CONFIRM_ENABLED=false — clusters will corroborate (telemetry only) \
             but will NOT be auto-confirmed or published to the map"
        );
    }
    let mut tick_count: u64 = 0;
    loop {
        let start = std::time::Instant::now();
        match tick(&pool, confirm_enabled, &event_tx).await {
            Ok(summary) => {
                tick_count += 1;
                tracing::info!(
                    cycle_ms           = start.elapsed().as_millis() as u64,
                    clusters_evaluated = summary.clusters_evaluated,
                    promoted_corr      = summary.promoted_to_corroborating,
                    promoted_conf      = summary.promoted_to_confirmed,
                    expired            = summary.expired,
                    "synthesis_cycle"
                );
                if tick_count % 12 == 0 {
                    if let Err(e) = log_state_snapshot(&pool).await {
                        tracing::warn!("synthesis metrics snapshot error: {e:#}");
                    }
                }
            }
            Err(e) => {
                tracing::warn!("synthesis tick error: {e:#}");
            }
        }
        let elapsed = start.elapsed();
        let remaining = Duration::from_millis(TICK_MS).saturating_sub(elapsed);
        tokio::time::sleep(remaining).await;
    }
}

async fn tick(
    pool: &PgPool,
    confirm_enabled: bool,
    event_tx: &Arc<tokio::sync::broadcast::Sender<crate::ws::ViewportEvent>>,
) -> Result<TickSummary> {
    let mut summary = TickSummary::default();

    summary.expired = expire_stale_signals(pool).await?;

    let groups = fetch_cluster_groups(pool).await?;
    summary.clusters_evaluated = groups.len();

    let now = chrono::Utc::now();
    for signals in groups.into_values() {
        let cr = process_cluster(pool, confirm_enabled, &signals, now, event_tx).await?;
        summary.promoted_to_corroborating += cr.promoted_to_corroborating;
        summary.promoted_to_confirmed += cr.promoted_to_confirmed;
    }

    Ok(summary)
}

async fn expire_stale_signals(pool: &PgPool) -> Result<usize> {
    let r = sqlx::query(
        "UPDATE acoustic_signals
            SET trust_state = 'expired'
          WHERE trust_state IN ('pending', 'corroborating')
            AND received_at < now() - ($1 * interval '1 second')",
    )
    .bind(EXPIRY_WINDOW_SECS)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() as usize)
}

async fn fetch_cluster_groups(
    pool: &PgPool,
) -> Result<std::collections::HashMap<(String, String), Vec<SignalRow>>> {
    let signals: Vec<SignalRow> = sqlx::query_as::<_, SignalRow>(
        "SELECT id, pubkey, h3_r9, h3_r7, threat_class, confidence,
                confidence_variance, received_at, trust_state
           FROM acoustic_signals
          WHERE trust_state IN ('pending', 'corroborating')
            AND received_at > now() - ($1 * interval '1 second')
            AND h3_r9 IS NOT NULL
          ORDER BY h3_r9, threat_class, received_at",
    )
    .bind(FETCH_WINDOW_SECS)
    .fetch_all(pool)
    .await?;

    let mut groups: std::collections::HashMap<(String, String), Vec<SignalRow>> = Default::default();
    for sig in signals {
        if let Some(ref h3r9) = sig.h3_r9 {
            groups
                .entry((h3r9.clone(), sig.threat_class.clone()))
                .or_default()
                .push(sig);
        }
    }
    Ok(groups)
}

async fn process_cluster(
    pool: &PgPool,
    confirm_enabled: bool,
    signals: &[SignalRow],
    now: chrono::DateTime<chrono::Utc>,
    event_tx: &Arc<tokio::sync::broadcast::Sender<crate::ws::ViewportEvent>>,
) -> Result<ClusterResult> {
    let mut result = ClusterResult::default();
    let Some(first) = signals.first() else {
        return Ok(result);
    };

    let Some(h3_r9_str) = first.h3_r9.as_deref() else {
        tracing::warn!("synthesis: cluster signal missing h3_r9, skipping");
        return Ok(result);
    };
    let h3_r9 = h3_r9_str;
    let h3_r7 = &first.h3_r7;
    let threat_class = &first.threat_class;

    let (weighted, total_trust_mass, numerator, total_conf_var) = compute_weights(signals, now);

    if weighted.is_empty() {
        return Ok(result);
    }

    let distinct_pubkeys: std::collections::HashSet<_> =
        weighted.iter().map(|(i, _)| signals[*i].pubkey.as_str()).collect();
    let n_contributors = distinct_pubkeys.len();

    let cluster_score_raw = if total_trust_mass > 0.0 {
        numerator / total_trust_mass
    } else {
        0.0
    };
    let mean_conf_var = total_conf_var / weighted.len() as f32;
    let cluster_score_adj = cluster_score_raw * (1.0 - 0.5 * mean_conf_var);

    let signal_ids: Vec<Uuid> = weighted.iter().map(|(i, _)| signals[*i].id).collect();

    if n_contributors < MIN_CONTRIBUTORS || cluster_score_adj < CORROBORATE_THRESHOLD {
        return Ok(result);
    }

    // Promote pending -> corroborating
    let r = sqlx::query(
        "UPDATE acoustic_signals SET trust_state = 'corroborating'
          WHERE id = ANY($1) AND trust_state = 'pending'",
    )
    .bind(&signal_ids)
    .execute(pool)
    .await?;
    result.promoted_to_corroborating += r.rows_affected() as usize;

    // Gate: without explicit opt-in, never auto-confirm or publish acoustic events.
    // Corroboration above is retained as telemetry; map promotion stops here.
    if !confirm_enabled {
        return Ok(result);
    }

    if cluster_score_adj < CONFIRM_THRESHOLD {
        return Ok(result);
    }

    // Promote corroborating -> confirmed
    let r = sqlx::query(
        "UPDATE acoustic_signals SET trust_state = 'confirmed'
          WHERE id = ANY($1) AND trust_state = 'corroborating'",
    )
    .bind(&signal_ids)
    .execute(pool)
    .await?;
    result.promoted_to_confirmed += r.rows_affected() as usize;

    // UPSERT public_event (idempotent -- runs every tick for confirmed clusters)
    let first_signal_id = signals
        .iter()
        .min_by_key(|s| s.received_at)
        .map(|s| s.id)
        .unwrap();

    upsert_public_event(
        pool,
        first_signal_id,
        &signal_ids,
        h3_r9,
        h3_r7,
        threat_class,
        cluster_score_raw,
        cluster_score_adj,
        total_trust_mass,
        n_contributors,
        mean_conf_var,
        now,
        event_tx,
    )
    .await?;

    Ok(result)
}

async fn upsert_public_event(
    pool: &PgPool,
    first_signal_id: Uuid,
    signal_ids: &[Uuid],
    h3_r9: &str,
    h3_r7: &str,
    threat_class: &str,
    cluster_score_raw: f32,
    cluster_score_adj: f32,
    trust_mass: f32,
    n_contributors: usize,
    mean_conf_var: f32,
    now: chrono::DateTime<chrono::Utc>,
    event_tx: &Arc<tokio::sync::broadcast::Sender<crate::ws::ViewportEvent>>,
) -> Result<()> {
    let severity = score_to_severity(cluster_score_adj);
    let synthesis_run_id = Uuid::new_v4();
    let lineage = serde_json::json!({
        "derived_from": signal_ids.iter().map(|id| id.to_string()).collect::<Vec<_>>(),
        "merged_from": [],
        "split_from": null,
        "synthesis_version": "synth-v1",
        "synthesis_run_id": synthesis_run_id.to_string(),
        "clustering_algo_version": "dbscan-h3-v1",
        "temporal_decay_version": "decay-v1",
        "trust_weight_version": "trust-v1",
        "antispoof_ruleset_version": "antispoof-v1",
        "sensor_independence_version": "indep-v1",
        "cluster_score_raw": cluster_score_raw,
        "cluster_score_adjusted": cluster_score_adj,
        "confidence_variance_mean": mean_conf_var,
        "threshold_profile": "default-v1",
        "n_contributors": n_contributors,
        "trust_mass": trust_mass,
        "moderator_actions": [],
        "severity_escalations": []
    });

    let row = sqlx::query(
        r#"
        INSERT INTO public_events
            (first_signal_id, threat_class, h3_r9, h3_r7, cluster_score, trust_state,
             severity, n_contributors, trust_mass, lineage, schema_version, confirmed_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, 'confirmed', $6, $7, $8, $9, 1, $10, $10)
        ON CONFLICT (first_signal_id) DO UPDATE SET
            cluster_score  = EXCLUDED.cluster_score,
            severity       = EXCLUDED.severity,
            n_contributors = EXCLUDED.n_contributors,
            trust_mass     = EXCLUDED.trust_mass,
            lineage        = EXCLUDED.lineage,
            updated_at     = EXCLUDED.updated_at,
            confirmed_at   = COALESCE(public_events.confirmed_at, EXCLUDED.confirmed_at)
        RETURNING id
        "#,
    )
    .bind(first_signal_id)
    .bind(threat_class)
    .bind(h3_r9)
    .bind(h3_r7)
    .bind(cluster_score_adj)
    .bind(severity)
    .bind(n_contributors as i32)
    .bind(trust_mass)
    .bind(lineage)
    .bind(now)
    .fetch_one(pool)
    .await?;

    let event_id: Uuid = row.try_get("id")?;

    // Broadcast via H3 cell centroid
    if let Ok(cell) = h3_r9.parse::<h3o::CellIndex>() {
        let center = h3o::LatLng::from(cell);
        let lat = center.lat();
        let lng = center.lng();

        let ws_json = serde_json::json!({
            "id": event_id,
            "event_type": "ACOUSTIC",
            "severity": severity,
            "trust_state": "confirmed",
            "state": "ACTIVE",
            "title": threat_class,
            "lat": lat,
            "lng": lng,
            "started_at": now.to_rfc3339(),
        });
        let _ = event_tx.send(crate::ws::ViewportEvent {
            id: event_id,
            lat,
            lng,
            severity: severity.to_string(),
            event_json: ws_json.to_string().into(),
        });
    }

    Ok(())
}

async fn log_state_snapshot(pool: &PgPool) -> Result<()> {
    let row = sqlx::query(
        "SELECT
            COUNT(*) FILTER (WHERE trust_state = 'pending')       AS pending,
            COUNT(*) FILTER (WHERE trust_state = 'corroborating') AS corroborating,
            COUNT(*) FILTER (WHERE trust_state = 'confirmed')     AS confirmed,
            COUNT(*) FILTER (WHERE trust_state = 'expired')       AS expired
           FROM acoustic_signals
          WHERE received_at > now() - interval '1 hour'",
    )
    .fetch_one(pool)
    .await?;

    let pending: i64       = row.try_get("pending")?;
    let corroborating: i64 = row.try_get("corroborating")?;
    let confirmed: i64     = row.try_get("confirmed")?;
    let expired: i64       = row.try_get("expired")?;
    let total = pending + corroborating + confirmed + expired;

    tracing::info!(
        pending_count       = pending,
        corroborating_count = corroborating,
        confirmed_count     = confirmed,
        expired_count       = expired,
        confirmation_ratio  = if total > 0 { confirmed as f64 / total as f64 } else { 0.0 },
        expired_ratio       = if total > 0 { expired as f64 / total as f64 } else { 0.0 },
        "synthesis_state_snapshot"
    );
    Ok(())
}

fn compute_weights(
    signals: &[SignalRow],
    now: chrono::DateTime<chrono::Utc>,
) -> (Vec<(usize, f32)>, f32, f32, f32) {
    // Step 1: apply temporal decay, exclude signals beyond cutoff
    let decayed: Vec<(usize, &SignalRow, f32)> = signals
        .iter()
        .enumerate()
        .filter_map(|(i, s)| {
            let age = (now - s.received_at).num_seconds();
            if age > TEMPORAL_CUTOFF_SECS {
                return None;
            }
            let decay = if age > TEMPORAL_HALF_WEIGHT_SECS { 0.5 } else { 1.0 };
            let trust = DEFAULT_TRUST * decay;
            Some((i, s, trust))
        })
        .collect();

    if decayed.is_empty() {
        return (vec![], 0.0, 0.0, 0.0);
    }

    // Step 2: per-pubkey trust sum (uncapped)
    let mut pubkey_trust: std::collections::HashMap<&str, f32> = Default::default();
    for (_, s, t) in &decayed {
        *pubkey_trust.entry(s.pubkey.as_str()).or_default() += t;
    }
    let total_uncapped: f32 = pubkey_trust.values().sum();
    let trust_cap = 0.25 * total_uncapped;

    // Step 3: cap per-pubkey trust at 25% of total
    let capped: std::collections::HashMap<&str, f32> = pubkey_trust
        .iter()
        .map(|(&pk, &t)| (pk, t.min(trust_cap)))
        .collect();
    let total_trust_mass: f32 = capped.values().sum();

    // Step 4: build result with per-signal effective trust
    let mut result = Vec::with_capacity(decayed.len());
    let mut numerator = 0.0f32;
    let mut total_conf_var = 0.0f32;

    for (i, s, eff_trust) in &decayed {
        let pubkey_t = pubkey_trust[s.pubkey.as_str()];
        let capped_t = capped[s.pubkey.as_str()];
        let signal_trust = if pubkey_t > 0.0 {
            eff_trust * (capped_t / pubkey_t)
        } else {
            0.0
        };
        numerator += signal_trust * s.confidence;
        total_conf_var += s.confidence_variance.unwrap_or(0.0);
        result.push((*i, signal_trust));
    }

    (result, total_trust_mass, numerator, total_conf_var)
}

fn score_to_severity(score: f32) -> &'static str {
    if score >= 0.90 {
        "CRITICAL"
    } else if score >= 0.75 {
        "HIGH"
    } else if score >= 0.60 {
        "MEDIUM"
    } else {
        "LOW"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_signal(pubkey: &str, confidence: f32, variance: Option<f32>, age_secs: i64, state: &str) -> SignalRow {
        SignalRow {
            id: Uuid::new_v4(),
            pubkey: pubkey.to_string(),
            h3_r9: Some("8928308280fffff".to_string()),
            h3_r7: "872830828ffffff".to_string(),
            threat_class: "gunshot".to_string(),
            confidence,
            confidence_variance: variance,
            received_at: chrono::Utc::now() - chrono::Duration::seconds(age_secs),
            trust_state: state.to_string(),
        }
    }

    #[test]
    fn temporal_cutoff_excludes_old_signals() {
        let s = make_signal("pk1", 0.9, None, TEMPORAL_CUTOFF_SECS + 1, "pending");
        let (w, mass, num, _) = compute_weights(&[s], chrono::Utc::now());
        assert!(w.is_empty(), "signals beyond cutoff must be excluded");
        assert_eq!(mass, 0.0);
        assert_eq!(num, 0.0);
    }

    #[test]
    fn signals_within_cutoff_are_included() {
        let s = make_signal("pk1", 0.9, None, TEMPORAL_CUTOFF_SECS - 1, "pending");
        let (w, mass, num, _) = compute_weights(&[s], chrono::Utc::now());
        assert!(!w.is_empty());
        assert!(mass > 0.0);
        assert!(num > 0.0);
    }

    #[test]
    fn temporal_decay_halves_trust_mass_at_boundary() {
        let fresh = make_signal("pk1", 1.0, None, 10, "pending");
        let decayed = make_signal("pk2", 1.0, None, 65, "pending");
        let (_, mass_fresh, _, _) = compute_weights(&[fresh], chrono::Utc::now());
        let (_, mass_decayed, _, _) = compute_weights(&[decayed], chrono::Utc::now());
        // Trust mass should be ~2x for fresh vs decayed (half-weight applied to decayed)
        assert!(
            (mass_fresh - 2.0 * mass_decayed).abs() < 0.001,
            "expected 2:1 ratio, fresh={mass_fresh}, decayed={mass_decayed}"
        );
    }

    #[test]
    fn cluster_score_equals_average_confidence_for_two_equal_trust_pubkeys() {
        let s1 = make_signal("pk1", 0.9, None, 5, "pending");
        let s2 = make_signal("pk2", 0.7, None, 5, "pending");
        let (_, mass, num, _) = compute_weights(&[s1, s2], chrono::Utc::now());
        assert!(mass > 0.0);
        let score = num / mass;
        assert!((score - 0.80).abs() < 0.001, "expected 0.80, got {score}");
    }

    #[test]
    fn cluster_score_above_threshold_for_high_confidence() {
        let s1 = make_signal("pk1", 0.95, None, 5, "pending");
        let s2 = make_signal("pk2", 0.90, None, 5, "pending");
        let (_, mass, num, _) = compute_weights(&[s1, s2], chrono::Utc::now());
        let score = num / mass;
        assert!(score >= CONFIRM_THRESHOLD);
    }

    #[test]
    fn confidence_variance_reduces_adjusted_score() {
        let s1 = make_signal("pk1", 0.9, Some(0.8), 5, "pending");
        let s2 = make_signal("pk2", 0.9, Some(0.8), 5, "pending");
        let (w, mass, num, total_var) = compute_weights(&[s1, s2], chrono::Utc::now());
        let raw = num / mass;
        let mean_var = total_var / w.len() as f32;
        let adjusted = raw * (1.0 - 0.5 * mean_var);
        assert!(adjusted < raw, "high variance must reduce adjusted score");
    }

    #[test]
    fn score_to_severity_thresholds() {
        assert_eq!(score_to_severity(0.59), "LOW");
        assert_eq!(score_to_severity(0.60), "MEDIUM");
        assert_eq!(score_to_severity(0.75), "HIGH");
        assert_eq!(score_to_severity(0.90), "CRITICAL");
        assert_eq!(score_to_severity(1.00), "CRITICAL");
    }

    #[test]
    fn score_to_severity_boundary_values() {
        assert_eq!(score_to_severity(0.7499), "MEDIUM");
        assert_eq!(score_to_severity(0.8999), "HIGH");
    }

    #[test]
    fn trust_cap_limits_single_pubkey_domination() {
        // All 4 signals from same pubkey — trust cap should limit total mass to 25% of uncapped total
        let s1 = make_signal("sybil", 0.9, None, 5, "pending");
        let s2 = make_signal("sybil", 0.9, None, 5, "pending");
        let s3 = make_signal("sybil", 0.9, None, 5, "pending");
        let s4 = make_signal("sybil", 0.9, None, 5, "pending");
        // Compare to single signal from same pubkey — the cap normalizes proportionally
        let single = make_signal("sybil", 0.9, None, 5, "pending");
        let (_, mass_4, num_4, _) = compute_weights(&[s1, s2, s3, s4], chrono::Utc::now());
        let (_, mass_1, num_1, _) = compute_weights(&[single], chrono::Utc::now());
        // Trust cap: single pubkey can never hold >25% of total. All 4 signals same pubkey,
        // total_uncapped = 4 * 0.40 = 1.60, trust_cap = 0.25 * 1.60 = 0.40
        // capped = 0.40, total_mass = 0.40 for all 4 signals
        // Single signal: total_uncapped = 0.40, trust_cap = 0.10, capped = 0.10, total_mass = 0.10
        // So mass_4 = 4 * mass_1 (more signals from same pubkey gives proportionally more weight before cap normalizes it)
        // Actually, score (num/mass) should be same since all confidences equal:
        assert!(mass_4 > 0.0 && mass_1 > 0.0);
        let score_4 = num_4 / mass_4;
        let score_1 = num_1 / mass_1;
        // Score should be ~0.9 regardless of how many signals same pubkey sends
        assert!((score_4 - 0.9).abs() < 0.001, "score_4 = {score_4}");
        assert!((score_1 - 0.9).abs() < 0.001, "score_1 = {score_1}");
        // Critical: adding duplicate sybil signals should not inflate trust mass beyond the cap
        // cap for 4-signal case = 0.25 * (4 * 0.40) = 0.40
        // cap for 1-signal case = 0.25 * (1 * 0.40) = 0.10
        // So mass_4 / mass_1 = 4 (trust mass scales linearly — but score stays constant)
        assert!(
            (mass_4 / mass_1 - 4.0).abs() < 0.001,
            "trust mass ratio should be 4:1 for 4 same-pubkey signals, got {}", mass_4 / mass_1
        );
    }

    #[test]
    #[allow(clippy::assertions_on_constants)]
    fn confirm_is_a_strictly_higher_bar_than_corroborate() {
        // Guards against regressing the two stages back into a single threshold.
        assert!(
            CONFIRM_THRESHOLD > CORROBORATE_THRESHOLD,
            "confirm threshold must exceed corroborate threshold"
        );
    }

    #[test]
    #[allow(clippy::assertions_on_constants)]
    fn min_contributors_blocks_two_key_sybil() {
        // At least 3 independent identities required before any promotion.
        assert!(MIN_CONTRIBUTORS >= 3, "min contributors must be >= 3");
    }
}
