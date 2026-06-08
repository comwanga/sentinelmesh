# C-1b-1 — Trust Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship reputation decay, advisory voucher accountability, and an operator-facing Trust Observatory (with trend snapshots) — the deterministic trust-hygiene layer that also collects the pilot data C-1b-2 will calibrate against.

**Architecture:** A new `trust_worker` (tokio tick-loop like `nlp_synthesis_worker`) runs two passes each tick: an **unconditional** snapshot pass (writes one `trust_metrics_snapshots` row) and a **flag-gated** decay-apply pass (recomputes `effective_reputation_score` + `reputation_tier` via a pure `trust::decay` curve). Voucher accountability is advisory: a pure `trust::accountability` quality function feeds operator-only Observatory endpoints, and two new `users` fields (`vouching_suspended`, `vouch_budget_override`) — set only by operators — are honored by the C-1a vouch-issue path. The Observatory is operator-only JSON behind `InternalServiceAuth`.

**Tech Stack:** Rust/axum gateway, sqlx (runtime queries), Postgres 16 (JSONB snapshots), tokio workers; `cargo test` / `cargo clippy --all-targets -- -D warnings` / `cargo fmt`.

**Spec:** `docs/superpowers/specs/2026-06-08-c1b1-trust-hygiene-design.md`.

**Conventions:**
- Commit messages: plain English, NO `Co-Authored-By` trailer.
- Gateway from `services/gateway`: `cargo test`, `cargo clippy --all-targets -- -D warnings`, `cargo fmt`.
- Branch: `feat/c1b1-trust-hygiene` (based on C-1a `feat/c1a-sybil-vouching`).

**Codebase facts:**
- `users` (init.sql): `nostr_pubkey`, `reputation_score INT` (earned; `+10`/VERIFIED), `reputation_tier VARCHAR(20)`, `total_reports`, `accurate_reports`, `created_at`, `last_active`. C-1b-1 adds `effective_reputation_score`, `last_verified_at`, `rejected_reports`, `vouching_suspended`, `vouch_budget_override` (migration 018).
- `compute_tier(score: i64) -> &'static str` in `reports/service.rs`: `>=50 SENTINEL`, `>=20 VETERAN`, `>=5 TRUSTED`, else `NEWCOMER`.
- `apply_status_transition(pool, report_id, new_status, reporter_pubkey)` in `reports/service.rs`: on `"VERIFIED"` it bumps `accurate_reports`+`reputation_score`+tier. C-1b-1 extends it.
- Workers are spawned in `main.rs` via `tokio::spawn(async move { subscribers::<x>::run(...).await })`; `subscribers/mod.rs` lists them. `retention_worker` is the "always-on" model. Tick loops use `tokio::time::{interval/sleep, Duration}`.
- `InternalServiceAuth` (`middleware/internal_auth.rs`) is a `FromRequestParts<AppState>` extractor — a handler gated by it just takes `_auth: InternalServiceAuth` as an argument; returns 401 on a missing/invalid `Authorization: Bearer <INTERNAL_SERVICE_SECRET>`.
- Pure trust logic lives in `trust::*` modules (`contract`, `personhood`) with `#[cfg(test)]` unit tests.
- Config fields are parsed in `Config::from_env`; bools `v == "true" || v == "1"`; numbers `.and_then(|v| v.parse().ok()).unwrap_or(default)`.
- The C-1a vouch-issue path: `routes/vouches.rs::post_vouch` resolves eligibility, then calls `vouches::issue_vouch(pool, voucher, vouchee, basis, event_id, budget)` (atomic budget+insert). `config.vouch_budget: u32`.
- `AppState`: `db: PgPool`, `reputation_db: PgPool` (restricted, do NOT use here), `config: Arc<Config>`, `redis`, `http_client`.

---

### Task 1: Migration 018 — trust-hygiene columns + snapshot table

**Files:**
- Create: `infra/postgres/migrations/018_trust_hygiene.sql`

- [ ] **Step 1: Write the migration**

Read `infra/postgres/migrations/017_vouches.sql` for house style first. Create `infra/postgres/migrations/018_trust_hygiene.sql`:
```sql
-- infra/postgres/migrations/018_trust_hygiene.sql
-- C-1b-1: trust hygiene. Reputation decay (earned vs effective + last_verified_at
-- decay clock + rejected_reports), advisory voucher-accountability operator fields,
-- and a periodic aggregate-metrics snapshot table powering the Trust Observatory.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS effective_reputation_score INT,
    ADD COLUMN IF NOT EXISTS last_verified_at           TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejected_reports           INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS vouching_suspended         BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS vouch_budget_override      INT;

-- Existing users start un-decayed: effective = earned.
UPDATE users SET effective_reputation_score = reputation_score
 WHERE effective_reputation_score IS NULL;

-- Aggregate-only operational metrics (no identity linkage), one row per worker tick.
CREATE TABLE IF NOT EXISTS trust_metrics_snapshots (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    metrics     JSONB       NOT NULL
);
CREATE INDEX IF NOT EXISTS trust_metrics_snapshots_captured_idx
    ON trust_metrics_snapshots (captured_at);
```

- [ ] **Step 2: Verify it applies on a fresh database**

Apply migrations `001..018` to a throwaway DB as a non-superuser role (the CI parity check), or `psql -f` into a running container. Confirm `\d users` shows the five new columns, `effective_reputation_score` backfilled to `reputation_score`, and `trust_metrics_snapshots` + its index exist. Run twice for idempotency (all `IF NOT EXISTS`). If no Postgres is reachable, syntactically validate and state clearly that live apply must be confirmed in CI.

- [ ] **Step 3: Commit**
```bash
git add infra/postgres/migrations/018_trust_hygiene.sql
git commit -m "C-1b-1: migration 018 — decay columns, accountability fields, metrics snapshots"
```

---

### Task 2: Config — decay + observatory knobs (TDD)

**Files:**
- Modify: `services/gateway/src/config.rs`

- [ ] **Step 1: Write the failing tests**

Add to `config.rs`'s `#[cfg(test)] mod tests` (reuse `ENV_LOCK` if a test sets env):
```rust
    #[test]
    fn decay_defaults_are_conservative() {
        assert_eq!(parse_u32_env_or(None, 90), 90);
        assert_eq!(parse_u32_env_or(Some("30".into()), 90), 30);
        assert_eq!(parse_u32_env_or(Some("bad".into()), 90), 90);
    }
    #[test]
    fn decay_floor_parses() {
        assert_eq!(parse_i32_env_or(None, 0), 0);
        assert_eq!(parse_i32_env_or(Some("5".into()), 0), 5);
    }
```

- [ ] **Step 2: Run to verify failure**
```bash
cd services/gateway && cargo test config:: 2>&1 | tail -15
```
Expected: FAIL — `parse_u32_env_or` / `parse_i32_env_or` not found.

- [ ] **Step 3: Add fields, helpers, wiring**

Add to `struct Config`:
```rust
    /// Trust worker tick interval (snapshot + decay passes). Default 3600s.
    pub trust_worker_tick_secs: u64,
    /// Apply reputation decay (default false — dark-launch; snapshots still run).
    pub reputation_decay_enabled: bool,
    /// Days since last VERIFIED before decay begins. Default 90.
    pub reputation_decay_grace_days: u32,
    /// Days over which a past-grace score decays toward the floor (1x..2x by accuracy). Default 180.
    pub reputation_decay_horizon_days: u32,
    /// Lowest score decay can reach. Default 0.
    pub reputation_decay_floor: i32,
    /// Min vouchees before a voucher_quality ratio is shown without a low-confidence flag. Default 5.
    pub quality_min_sample: u32,
    /// Days of metrics snapshots to retain. Default 180.
    pub observatory_snapshot_retention_days: u32,
```
Add module-level helpers (near the other parsers):
```rust
fn parse_u32_env_or(raw: Option<String>, default: u32) -> u32 {
    raw.and_then(|v| v.parse().ok()).unwrap_or(default)
}
fn parse_i32_env_or(raw: Option<String>, default: i32) -> i32 {
    raw.and_then(|v| v.parse().ok()).unwrap_or(default)
}
fn parse_u64_env_or(raw: Option<String>, default: u64) -> u64 {
    raw.and_then(|v| v.parse().ok()).unwrap_or(default)
}
```
In `Config::from_env`, add to the struct literal:
```rust
            trust_worker_tick_secs: parse_u64_env_or(std::env::var("TRUST_WORKER_TICK_SECS").ok(), 3600),
            reputation_decay_enabled: std::env::var("REPUTATION_DECAY_ENABLED")
                .map(|v| v == "true" || v == "1").unwrap_or(false),
            reputation_decay_grace_days: parse_u32_env_or(std::env::var("REPUTATION_DECAY_GRACE_DAYS").ok(), 90),
            reputation_decay_horizon_days: parse_u32_env_or(std::env::var("REPUTATION_DECAY_HORIZON_DAYS").ok(), 180),
            reputation_decay_floor: parse_i32_env_or(std::env::var("REPUTATION_DECAY_FLOOR").ok(), 0),
            quality_min_sample: parse_u32_env_or(std::env::var("QUALITY_MIN_SAMPLE").ok(), 5),
            observatory_snapshot_retention_days: parse_u32_env_or(std::env::var("OBSERVATORY_SNAPSHOT_RETENTION_DAYS").ok(), 180),
```

- [ ] **Step 4: Run tests + build + clippy**
```bash
cd services/gateway && cargo test config:: 2>&1 | tail -15 && cargo build --tests 2>&1 | tail -8 && cargo clippy --all-targets -- -D warnings 2>&1 | tail -6
```
Expected: new tests pass; build + clippy clean. Add the 7 new fields to any `Config { .. }` literal in tests (grep `Config {` in `services/gateway/src`; the middleware fixtures need them — use the defaults above).

- [ ] **Step 5: Commit**
```bash
git add services/gateway/src/config.rs
git commit -m "C-1b-1: config for decay curve, trust worker cadence, observatory retention"
```

---

### Task 3: `trust::decay` — pure decay curve (TDD)

**Files:**
- Create: `services/gateway/src/trust/decay.rs`
- Modify: `services/gateway/src/trust/mod.rs` (add `pub mod decay;`)

- [ ] **Step 1: Write the failing tests**

Create `services/gateway/src/trust/decay.rs` with the test module first:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accuracy_ratio_is_safe_at_zero_total() {
        assert_eq!(accuracy_ratio(0, 0), 0.0);
        assert_eq!(accuracy_ratio(3, 6), 0.5);
    }
    #[test]
    fn within_grace_is_undecayed() {
        assert_eq!(effective_score(50, 30, 1.0, 90, 180, 0), 50);
        assert_eq!(effective_score(50, 90, 0.0, 90, 180, 0), 50); // boundary: == grace, no decay
    }
    #[test]
    fn past_grace_decays_below_earned() {
        let e = effective_score(50, 90 + 90, 0.0, 90, 180, 0); // halfway through 180d horizon
        assert!(e < 50 && e > 0);
    }
    #[test]
    fn full_horizon_reaches_floor() {
        // 0 accuracy => horizon = 180; grace+180 days inactive => floor.
        assert_eq!(effective_score(50, 90 + 180, 0.0, 90, 180, 5), 5);
        // beyond horizon clamps at floor, never below.
        assert_eq!(effective_score(50, 90 + 9999, 0.0, 90, 180, 5), 5);
    }
    #[test]
    fn accuracy_slows_decay() {
        let low = effective_score(50, 90 + 90, 0.0, 90, 180, 0);
        let high = effective_score(50, 90 + 90, 1.0, 90, 180, 0); // 2x horizon => less decayed
        assert!(high > low);
    }
    #[test]
    fn at_or_below_floor_is_noop() {
        assert_eq!(effective_score(0, 9999, 0.0, 90, 180, 0), 0);
        assert_eq!(effective_score(3, 9999, 0.0, 90, 180, 5), 3); // earned below floor stays earned
    }
    #[test]
    fn is_idempotent() {
        let a = effective_score(40, 200, 0.5, 90, 180, 0);
        let b = effective_score(40, 200, 0.5, 90, 180, 0);
        assert_eq!(a, b);
    }
}
```

- [ ] **Step 2: Run to verify failure**

Add `pub mod decay;` to `trust/mod.rs`, then:
```bash
cd services/gateway && cargo test decay:: 2>&1 | tail -15
```
Expected: FAIL — items not defined.

- [ ] **Step 3: Implement the curve**

Prepend to `trust/decay.rs`:
```rust
//! Reputation decay curve (C-1b-1). Pure + idempotent: effective standing is a
//! function of EARNED score, days since the user's last VERIFIED contribution,
//! and their accuracy ratio. Never decrements in place, so worker cadence cannot
//! double-apply. Decay only ever lowers an inactive user's effective score toward
//! a floor; a false decay self-heals when they contribute again.

/// accuracy = accurate / total, clamped; 0 when no reports.
pub fn accuracy_ratio(accurate: i64, total: i64) -> f64 {
    if total <= 0 {
        0.0
    } else {
        ((accurate as f64) / (total as f64)).clamp(0.0, 1.0)
    }
}

/// Effective (decayed) score. Within `grace_days` of the last VERIFIED → earned.
/// Past grace, linearly decays toward `floor` over an accuracy-extended horizon
/// (`horizon_days` at accuracy 0, up to `2 * horizon_days` at accuracy 1).
pub fn effective_score(
    earned: i32,
    days_since_verified: i64,
    accuracy: f64,
    grace_days: u32,
    horizon_days: u32,
    floor: i32,
) -> i32 {
    if earned <= floor {
        return earned;
    }
    let grace = grace_days as i64;
    if days_since_verified <= grace {
        return earned;
    }
    let over = (days_since_verified - grace) as f64;
    let effective_horizon = (horizon_days as f64) * (1.0 + accuracy.clamp(0.0, 1.0));
    if effective_horizon <= 0.0 {
        return floor;
    }
    let frac = (over / effective_horizon).clamp(0.0, 1.0);
    let decayed = (earned as f64) - frac * ((earned - floor) as f64);
    decayed.round() as i32
}
```
Add `pub mod decay;` to `trust/mod.rs` (done in Step 2).

- [ ] **Step 4: Run tests + clippy**
```bash
cd services/gateway && cargo test decay:: 2>&1 | tail -15 && cargo clippy --all-targets -- -D warnings 2>&1 | tail -6
```
Expected: 7 tests pass; clippy clean.

- [ ] **Step 5: Commit**
```bash
git add services/gateway/src/trust/decay.rs services/gateway/src/trust/mod.rs
git commit -m "C-1b-1: pure reputation decay curve (grace, accuracy-extended horizon, floor)"
```

---

### Task 4: `apply_status_transition` — reset effective on VERIFIED, count REJECTED (TDD-by-build)

**Files:**
- Modify: `services/gateway/src/reports/service.rs`

- [ ] **Step 1: Extend the VERIFIED branch + add a REJECTED branch**

In `apply_status_transition`, the `if new_status == "VERIFIED"` block currently bumps `accurate_reports`, `reputation_score`, then sets `reputation_tier`. Replace that block so it ALSO resets `effective_reputation_score = reputation_score` and stamps `last_verified_at = now()` (decay reset), and add a `REJECTED` branch that increments `rejected_reports`:
```rust
    if new_status == "VERIFIED" {
        let new_score: i64 = sqlx::query_scalar(
            "UPDATE users
             SET accurate_reports = accurate_reports + 1,
                 reputation_score = reputation_score + 10,
                 effective_reputation_score = reputation_score + 10,
                 last_verified_at = NOW()
             WHERE nostr_pubkey = $1
             RETURNING reputation_score",
        )
        .bind(reporter_pubkey)
        .fetch_one(&mut *tx)
        .await?;

        let new_tier = compute_tier(new_score);
        sqlx::query("UPDATE users SET reputation_tier = $2 WHERE nostr_pubkey = $1")
            .bind(reporter_pubkey)
            .bind(new_tier)
            .execute(&mut *tx)
            .await?;
    } else if new_status == "REJECTED" {
        // Feeds advisory voucher_quality (C-1b-1). The report author keeps no
        // reputation penalty here (consensus already rejected the report); only
        // the rejected counter is bumped for accountability analytics.
        sqlx::query("UPDATE users SET rejected_reports = rejected_reports + 1 WHERE nostr_pubkey = $1")
            .bind(reporter_pubkey)
            .execute(&mut *tx)
            .await?;
    }
```

- [ ] **Step 2: Build + run the reports tests**
```bash
cd services/gateway && cargo build --tests 2>&1 | tail -10 && cargo test reports:: 2>&1 | tail -10 && cargo clippy --all-targets -- -D warnings 2>&1 | tail -6
```
Expected: builds; existing reports tests still pass; clippy clean. (`apply_status_transition` is DB-backed; behavior is integration/manually verified — the build + unchanged tests are the bar, matching the C-1a posture.)

- [ ] **Step 3: Commit**
```bash
git add services/gateway/src/reports/service.rs
git commit -m "C-1b-1: reset effective score + last_verified_at on VERIFIED; count REJECTED"
```

---

### Task 5: `trust::accountability` — pure voucher-quality components (TDD)

**Files:**
- Create: `services/gateway/src/trust/accountability.rs`
- Modify: `services/gateway/src/trust/mod.rs` (add `pub mod accountability;`)

- [ ] **Step 1: Write the failing tests**

Create `services/gateway/src/trust/accountability.rs` with the test module first:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ratio_and_components() {
        let q = quality_components(8, 30, 10, 5);
        assert_eq!(q.vouchee_count, 8);
        assert_eq!(q.accurate_count, 30);
        assert_eq!(q.rejected_count, 10);
        assert!((q.quality_ratio - 0.75).abs() < 1e-9);
        assert!(!q.low_confidence); // 8 >= 5
    }
    #[test]
    fn low_confidence_below_sample() {
        assert!(quality_components(2, 5, 0, 5).low_confidence);
        assert!(!quality_components(5, 5, 0, 5).low_confidence);
    }
    #[test]
    fn zero_outcomes_is_defined() {
        let q = quality_components(0, 0, 0, 5);
        assert_eq!(q.quality_ratio, 0.0); // denom max(0,1) => 0/1
        assert!(q.low_confidence);
    }
}
```

- [ ] **Step 2: Run to verify failure**

Add `pub mod accountability;` to `trust/mod.rs`, then:
```bash
cd services/gateway && cargo test accountability:: 2>&1 | tail -15
```
Expected: FAIL — items not defined.

- [ ] **Step 3: Implement**

Prepend to `trust/accountability.rs`:
```rust
//! Advisory voucher accountability (C-1b-1). Pure quality scoring over a voucher's
//! vouchees' report outcomes. Surfaced (with sample size) in the Observatory; never
//! auto-enforced in C-1b-1 — operators act via vouching_suspended / vouch_budget_override.

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct QualityComponents {
    pub vouchee_count: i64,
    pub accurate_count: i64,
    pub rejected_count: i64,
    pub quality_ratio: f64,
    pub low_confidence: bool,
}

/// Quality components for a voucher: ratio over accurate vs rejected vouchee
/// reports, with sample size, and a low-confidence flag below `min_sample`.
pub fn quality_components(
    vouchee_count: i64,
    accurate: i64,
    rejected: i64,
    min_sample: u32,
) -> QualityComponents {
    let denom = (accurate + rejected).max(1);
    QualityComponents {
        vouchee_count,
        accurate_count: accurate,
        rejected_count: rejected,
        quality_ratio: accurate as f64 / denom as f64,
        low_confidence: vouchee_count < min_sample as i64,
    }
}
```

- [ ] **Step 4: Run tests + clippy**
```bash
cd services/gateway && cargo test accountability:: 2>&1 | tail -12 && cargo clippy --all-targets -- -D warnings 2>&1 | tail -6
```
Expected: 3 tests pass; clippy clean. (If `quality_components` is flagged dead until Task 7 uses it, add `#[allow(dead_code)] // used by the Observatory (Task 7)` to the fn.)

- [ ] **Step 5: Commit**
```bash
git add services/gateway/src/trust/accountability.rs services/gateway/src/trust/mod.rs
git commit -m "C-1b-1: pure voucher_quality components (with sample size + low-confidence flag)"
```

---

### Task 6: C-1a issue path honors suspend + budget override

**Files:**
- Modify: `services/gateway/src/routes/vouches.rs` (`post_vouch`)

- [ ] **Step 1: Add a per-voucher override lookup + suspend check**

In `post_vouch`, AFTER the eligibility check (`eligible_from`) and BEFORE the `issue_vouch` call, fetch the voucher's accountability fields and apply them. Replace the budget value passed to `issue_vouch` with the effective budget, and reject suspended vouchers:
```rust
    // Advisory accountability (C-1b-1): operators can suspend a voucher or set a
    // per-voucher budget override. Genesis roots are never auto-acted-on, but an
    // operator may still set these fields manually.
    let (suspended, override_budget): (bool, Option<i32>) = sqlx::query_as(
        "SELECT vouching_suspended, vouch_budget_override FROM users WHERE nostr_pubkey = $1",
    )
    .bind(&body.voucher_pubkey)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| AppError::Internal(e.into()))?
    .unwrap_or((false, None));
    if suspended {
        return Err(AppError::Forbidden);
    }
    let effective_budget = override_budget
        .map(|b| b as i64)
        .unwrap_or(state.config.vouch_budget as i64);
```
Then change the `issue_vouch(..., state.config.vouch_budget as i64)` call to pass `effective_budget`.

- [ ] **Step 2: Build + clippy + the vouches tests**
```bash
cd services/gateway && cargo build --tests 2>&1 | tail -10 && cargo test vouches:: 2>&1 | tail -8 && cargo clippy --all-targets -- -D warnings 2>&1 | tail -6
```
Expected: builds; the existing vouch binding tests still pass; clippy clean. (Suspend/override behavior is integration-verified in Task 9 / manually; the unit-testable binding/classifier/decay/accountability logic is covered.)

- [ ] **Step 3: Commit**
```bash
git add services/gateway/src/routes/vouches.rs
git commit -m "C-1b-1: vouch issue honors operator vouching_suspended + vouch_budget_override"
```

---

### Task 7: Trust Observatory routes (operator-only)

**Files:**
- Create: `services/gateway/src/routes/observatory.rs`
- Modify: `services/gateway/src/routes/mod.rs` (add `pub mod observatory;` + nest)

- [ ] **Step 1: Implement the read + control handlers**

Create `services/gateway/src/routes/observatory.rs`. Read `routes/vouches.rs` + `middleware/internal_auth.rs` first for patterns. All handlers take `_auth: InternalServiceAuth` to gate on the internal secret.
```rust
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use serde::Deserialize;

use crate::{
    error::AppError, middleware::internal_auth::InternalServiceAuth,
    trust::accountability::quality_components, AppState,
};

/// GET /api/admin/observatory/summary — latest snapshot + static config context.
async fn summary(
    _auth: InternalServiceAuth,
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let latest: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT metrics FROM trust_metrics_snapshots ORDER BY captured_at DESC LIMIT 1",
    )
    .fetch_optional(&state.db)
    .await
    .map_err(|e| AppError::Internal(e.into()))?;
    Ok(Json(serde_json::json!({
        "genesis_root_count": state.config.vouch_genesis_roots.len(),
        "decay_enabled": state.config.reputation_decay_enabled,
        "metrics": latest,        // null if the worker has not ticked yet
        "clusters": serde_json::Value::Null, // populated by C-1b-2
    })))
}

#[derive(Deserialize)]
struct TrendQuery {
    window_days: Option<i64>,
}

/// GET /api/admin/observatory/trends?window_days=30 — snapshot time series.
async fn trends(
    _auth: InternalServiceAuth,
    State(state): State<AppState>,
    Query(q): Query<TrendQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let window = q.window_days.unwrap_or(30).clamp(1, 365);
    let rows: Vec<(chrono::DateTime<chrono::Utc>, serde_json::Value)> = sqlx::query_as(
        "SELECT captured_at, metrics FROM trust_metrics_snapshots
         WHERE captured_at > now() - ($1 || ' days')::interval
         ORDER BY captured_at ASC",
    )
    .bind(window.to_string())
    .fetch_all(&state.db)
    .await
    .map_err(|e| AppError::Internal(e.into()))?;
    let series: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|(t, m)| serde_json::json!({ "captured_at": t, "metrics": m }))
        .collect();
    Ok(Json(serde_json::json!({ "window_days": window, "series": series })))
}

/// GET /api/admin/observatory/vouchers — per-voucher review list with quality.
async fn vouchers(
    _auth: InternalServiceAuth,
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    // For each voucher with at least one vouch (active or revoked), aggregate the
    // vouchees' reputation outcomes from `users` (NOT report_authors — C-2 restricted).
    let rows: Vec<(String, i64, i64, i64, bool, Option<i32>)> = sqlx::query_as(
        "SELECT v.voucher_pubkey,
                COUNT(DISTINCT v.vouchee_pubkey)                       AS vouchee_count,
                COALESCE(SUM(u.accurate_reports), 0)                   AS accurate,
                COALESCE(SUM(u.rejected_reports), 0)                   AS rejected,
                COALESCE(BOOL_OR(vu.vouching_suspended), false)        AS suspended,
                MAX(vu.vouch_budget_override)                          AS budget_override
           FROM vouches v
           LEFT JOIN users u  ON u.nostr_pubkey  = v.vouchee_pubkey
           LEFT JOIN users vu ON vu.nostr_pubkey = v.voucher_pubkey
          GROUP BY v.voucher_pubkey
          ORDER BY rejected DESC, vouchee_count DESC
          LIMIT 500",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| AppError::Internal(e.into()))?;
    let min_sample = state.config.quality_min_sample;
    let list: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|(pk, n, acc, rej, suspended, override_b)| {
            let q = quality_components(n, acc, rej, min_sample);
            serde_json::json!({
                "voucher_pubkey": pk,
                "vouchee_count": q.vouchee_count,
                "accurate_count": q.accurate_count,
                "rejected_count": q.rejected_count,
                "quality_ratio": q.quality_ratio,
                "low_confidence": q.low_confidence,
                "vouching_suspended": suspended,
                "vouch_budget_override": override_b,
            })
        })
        .collect();
    Ok(Json(serde_json::json!({ "vouchers": list })))
}

#[derive(Deserialize)]
struct BudgetBody {
    budget: Option<i32>, // None clears the override (back to config default)
}

async fn suspend(
    _auth: InternalServiceAuth, State(state): State<AppState>, Path(pubkey): Path<String>,
) -> Result<StatusCode, AppError> { set_suspended(&state, &pubkey, true).await }

async fn unsuspend(
    _auth: InternalServiceAuth, State(state): State<AppState>, Path(pubkey): Path<String>,
) -> Result<StatusCode, AppError> { set_suspended(&state, &pubkey, false).await }

async fn set_suspended(state: &AppState, pubkey: &str, val: bool) -> Result<StatusCode, AppError> {
    let n = sqlx::query("UPDATE users SET vouching_suspended = $2 WHERE nostr_pubkey = $1")
        .bind(pubkey).bind(val).execute(&state.db).await
        .map_err(|e| AppError::Internal(e.into()))?;
    if n.rows_affected() == 0 { return Err(AppError::NotFound); }
    Ok(StatusCode::NO_CONTENT)
}

async fn set_budget(
    _auth: InternalServiceAuth, State(state): State<AppState>,
    Path(pubkey): Path<String>, Json(body): Json<BudgetBody>,
) -> Result<StatusCode, AppError> {
    if let Some(b) = body.budget {
        if b < 0 { return Err(AppError::BadRequest("budget must be >= 0".into())); }
    }
    let n = sqlx::query("UPDATE users SET vouch_budget_override = $2 WHERE nostr_pubkey = $1")
        .bind(pubkey).bind(body.budget).execute(&state.db).await
        .map_err(|e| AppError::Internal(e.into()))?;
    if n.rows_affected() == 0 { return Err(AppError::NotFound); }
    Ok(StatusCode::NO_CONTENT)
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/summary", get(summary))
        .route("/trends", get(trends))
        .route("/vouchers", get(vouchers))
        .route("/vouchers/:pubkey/suspend", post(suspend))
        .route("/vouchers/:pubkey/unsuspend", post(unsuspend))
        .route("/vouchers/:pubkey/budget", post(set_budget))
}
```
Add `pub mod observatory;` to `routes/mod.rs` and nest in `build_router()`:
```rust
        .nest("/api/admin/observatory", observatory::router())
```
(`chrono` is already a dependency — `reports/service.rs` uses `chrono::Utc`. If `sqlx::query_as` into `(String, i64, i64, i64, bool, Option<i32>)` needs explicit FromRow, the tuple impl exists for up to 16 columns; keep column order/types aligned with the SELECT.)

- [ ] **Step 2: Build + clippy**
```bash
cd services/gateway && cargo build --tests 2>&1 | tail -15 && cargo clippy --all-targets -- -D warnings 2>&1 | tail -8
```
Expected: builds; clippy clean. Fix any type mismatch in the `query_as` tuples (the `COALESCE(SUM(...),0)` columns come back as `i64`; `MAX(vouch_budget_override)` as `Option<i32>`).

- [ ] **Step 3: Commit**
```bash
git add services/gateway/src/routes/observatory.rs services/gateway/src/routes/mod.rs
git commit -m "C-1b-1: operator-only Trust Observatory (summary, trends, vouchers, controls)"
```

---

### Task 8: `trust_worker` — snapshot pass (always) + decay pass (gated)

**Files:**
- Create: `services/gateway/src/subscribers/trust_worker.rs`
- Modify: `services/gateway/src/subscribers/mod.rs` (add `pub mod trust_worker;`)
- Modify: `services/gateway/src/main.rs` (spawn it)

- [ ] **Step 1: Implement the worker**

Create `services/gateway/src/subscribers/trust_worker.rs`. Model the loop on `retention_worker`/`nlp_synthesis_worker`.
```rust
//! Trust hygiene worker (C-1b-1). Each tick:
//!   1. SNAPSHOT pass (ALWAYS): write one aggregate trust_metrics_snapshots row +
//!      trim rows past the retention horizon. Runs even when decay is dark-launched,
//!      so the Observatory accrues trend data during the pilot.
//!   2. DECAY pass (gated on `enabled`): recompute effective_reputation_score +
//!      reputation_tier for users past the grace window, via the pure trust::decay curve.
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
    // Aggregate counters as a single JSON object.
    let tiers = sqlx::query(
        "SELECT reputation_tier AS k, COUNT(*) AS n FROM users GROUP BY reputation_tier",
    ).fetch_all(pool).await?;
    let mut tier_dist = serde_json::Map::new();
    for r in tiers { tier_dist.insert(r.get::<String, _>("k"), serde_json::json!(r.get::<i64, _>("n"))); }

    let active_vouches: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM vouches WHERE revoked_at IS NULL").fetch_one(pool).await?;
    let vouches_by_basis = sqlx::query(
        "SELECT issuance_basis AS k, COUNT(*) AS n FROM vouches WHERE revoked_at IS NULL GROUP BY issuance_basis",
    ).fetch_all(pool).await?;
    let mut basis = serde_json::Map::new();
    for r in vouches_by_basis { basis.insert(r.get::<String, _>("k"), serde_json::json!(r.get::<i64, _>("n"))); }

    let statuses = sqlx::query(
        "SELECT status AS k, COUNT(*) AS n FROM community_reports GROUP BY status",
    ).fetch_all(pool).await?;
    let mut status_dist = serde_json::Map::new();
    for r in statuses { status_dist.insert(r.get::<String, _>("k"), serde_json::json!(r.get::<i64, _>("n"))); }

    let trust_states = sqlx::query(
        "SELECT trust_state AS k, COUNT(*) AS n FROM safety_events GROUP BY trust_state",
    ).fetch_all(pool).await?;
    let mut ts_dist = serde_json::Map::new();
    for r in trust_states { ts_dist.insert(r.get::<String, _>("k"), serde_json::json!(r.get::<i64, _>("n"))); }

    let decayed_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM users WHERE effective_reputation_score IS NOT NULL
           AND effective_reputation_score < reputation_score").fetch_one(pool).await?;
    let max_fanout: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(c), 0) FROM (
           SELECT COUNT(*) c FROM vouches WHERE revoked_at IS NULL GROUP BY voucher_pubkey) s",
    ).fetch_one(pool).await?;

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
        .bind(&metrics).execute(pool).await?;
    sqlx::query("DELETE FROM trust_metrics_snapshots WHERE captured_at < now() - ($1 || ' days')::interval")
        .bind((retention_days as i64).to_string()).execute(pool).await?;
    Ok(())
}

async fn decay_pass(pool: &PgPool, cfg: &DecayConfig) -> anyhow::Result<()> {
    // Candidates: earned above floor and inactive beyond grace (NULL last_verified_at
    // means never-verified NEWCOMER => skipped by the WHERE).
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
        let eff = effective_score(earned, days as i64, acc, cfg.grace_days, cfg.horizon_days, cfg.floor);
        let tier = compute_tier_pub(eff as i64);
        sqlx::query(
            "UPDATE users SET effective_reputation_score = $2, reputation_tier = $3 WHERE nostr_pubkey = $1",
        )
        .bind(&pk).bind(eff).bind(tier).execute(pool).await?;
    }
    Ok(())
}
```
`compute_tier` in `reports/service.rs` is currently private. Expose a thin public wrapper there: add
```rust
/// Public wrapper so the trust worker can map an effective score to a tier.
pub fn compute_tier_pub(score: i64) -> &'static str { compute_tier(score) }
```
Add `pub mod trust_worker;` to `subscribers/mod.rs`.

- [ ] **Step 2: Spawn it in `main.rs`**

After the NLP worker spawn block, add:
```rust
    // Spawn trust-hygiene worker (C-1b-1): periodic metrics snapshot (always) +
    // gated reputation decay. Snapshots run even when decay is dark-launched.
    {
        let pool_trust = db.clone();
        let tick = config.trust_worker_tick_secs;
        let cfg = subscribers::trust_worker::DecayConfig {
            enabled: config.reputation_decay_enabled,
            grace_days: config.reputation_decay_grace_days,
            horizon_days: config.reputation_decay_horizon_days,
            floor: config.reputation_decay_floor,
            retention_days: config.observatory_snapshot_retention_days,
        };
        tokio::spawn(async move {
            subscribers::trust_worker::run(pool_trust, tick, cfg).await;
        });
    }
```

- [ ] **Step 3: Build + clippy**
```bash
cd services/gateway && cargo build --tests 2>&1 | tail -15 && cargo clippy --all-targets -- -D warnings 2>&1 | tail -8
```
Expected: builds; clippy clean. Fix any sqlx `Row::get` type mismatch (e.g. `reputation_score` is `INT` → `i32`; `EXTRACT(...)::float8` → `f64`).

- [ ] **Step 4: Commit**
```bash
git add services/gateway/src/subscribers/trust_worker.rs services/gateway/src/subscribers/mod.rs services/gateway/src/main.rs services/gateway/src/reports/service.rs
git commit -m "C-1b-1: trust worker — unconditional metrics snapshot + gated reputation decay"
```

---

### Task 9: Final verification + PR

**Files:** none (verification only)

- [ ] **Step 1: Full gateway checks**
```bash
cd services/gateway && cargo fmt --check && cargo clippy --all-targets -- -D warnings 2>&1 | tail -8 && cargo test 2>&1 | tail -15
```
Expected: fmt clean, clippy clean, all tests pass (incl. the new decay + accountability + config units).

- [ ] **Step 2: Fresh-DB migration apply (non-superuser)**

Apply `001..018` to a throwaway DB as the non-superuser app role; confirm 018 applies, the `users` columns + `trust_metrics_snapshots` exist, and `effective_reputation_score` backfilled. Re-run for idempotency.

- [ ] **Step 3: Push + open PR**
```bash
git push -u origin feat/c1b1-trust-hygiene
```
Then `gh pr create --base main --head feat/c1b1-trust-hygiene --title "C-1b-1: trust hygiene — decay, voucher accountability, Observatory" --body-file <path>` (use `--body-file`). Body summarizes: reputation decay (earned vs effective, `last_verified_at` decay clock that closes the cheap-activity loophole, pure accuracy-extended curve, dark-launched OFF by default); advisory voucher accountability (computed quality with sample size + operator `vouching_suspended`/`vouch_budget_override` honored by the C-1a issue path, no auto-penalty); operator-only Trust Observatory (summary + trends + per-voucher review + controls) backed by a snapshot table the worker writes unconditionally so trend data accrues during dark-launch. Note this builds on C-1a (PR #59) and should merge after it; and that C-1b-2 (coordinated-voting risk scoring, influence caps, automatic penalty curve, re-enable anchoring) is the calibrated follow-up.

---

## Self-Review

- **Spec coverage:** decay columns + snapshot table (Task 1, spec Part D); config knobs incl. dark-launch default (Task 2, spec Part H); pure decay curve (Task 3, spec Part A); `last_verified_at` reset + `effective` reset on VERIFIED + `rejected_reports` on REJECTED (Task 4, spec Parts A/B); pure `voucher_quality` with sample size (Task 5, spec Part B); issue path honors suspend/override (Task 6, spec Part B); Observatory summary+trends+vouchers+controls behind internal auth (Task 7, spec Parts C/F); trust worker with unconditional snapshot + gated decay (Task 8, spec Parts A/C/E). The "trends accrue during dark-launch" requirement is satisfied because Task 8's snapshot pass is unconditional and the decay pass is the only flag-gated part. Anchoring stays off — no task re-enables it (spec non-goal).
- **Placeholder scan:** none — every code step has full Rust/SQL + exact commands. DB-backed handlers/worker/queries that can't be pure-unit-tested are verified by build + clippy + the fresh-DB migration apply (the repo's posture; pure logic in `decay`/`accountability`/`config` is fully TDD'd).
- **Type/contract consistency:** `effective_score(earned: i32, days_since_verified: i64, accuracy: f64, grace_days: u32, horizon_days: u32, floor: i32) -> i32` and `accuracy_ratio(i64,i64)->f64` (Task 3) are used exactly in the worker (Task 8). `quality_components(vouchee_count: i64, accurate: i64, rejected: i64, min_sample: u32) -> QualityComponents` (Task 5) is used in the Observatory vouchers handler (Task 7). `compute_tier_pub(i64)` (added in Task 8) wraps the existing `compute_tier`. The new `users` columns (`effective_reputation_score`, `last_verified_at`, `rejected_reports`, `vouching_suspended`, `vouch_budget_override`) match every query in Tasks 4/6/7/8. The 7 new `Config` fields (Task 2) are consumed in Tasks 7 (`quality_min_sample`, `vouch_genesis_roots`, `reputation_decay_enabled`) and 8 (tick + decay + retention). `DecayConfig` (Task 8) carries exactly the worker's needs.
- **Known follow-ups (C-1b-2, out of scope):** coordinated-voting risk scoring + the `clusters` field, influence caps, the automatic voucher-penalty curve (sets the same suspend/override fields), and re-enabling anchoring.
```
