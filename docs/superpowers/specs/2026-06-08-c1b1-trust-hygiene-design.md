# C-1b-1 — Trust Hygiene: Decay, Voucher Accountability, Observatory (Design)

Date: 2026-06-08
Audit ref: C-1 ("Sybil resistance"), C-1b follow-up to C-1a (web-of-trust vouching, PR #59)
Builds on: `docs/superpowers/specs/2026-06-08-c1a-sybil-vouching-design.md` (the `vouches` graph,
the personhood gate, `config.vouch_budget`, `trust::personhood`).
Branch goal: ship the **deterministic** trust-hygiene layer — reputation decay, advisory voucher
accountability, and an operator-facing Trust Observatory with **trend** data — so that (a) abandoned
accounts stop being permanent trust anchors, (b) operators can see and act on bad vouchers, and (c) the
pilot generates the real distributions needed to calibrate the **heuristic** layer (C-1b-2:
coordinated-voting risk scoring + influence caps).

This is **C-1b-1**. Coordinated-voting detection, influence caps, the automatic voucher-penalty curve,
and re-enabling on-chain anchoring are **C-1b-2** (a separate later cycle, calibrated on this cycle's
Observatory data).

## Problem

C-1a made consensus escalation require distinct personhood-established confirmers. But:

- **Trust never decays.** A pubkey that reaches TRUSTED/VETERAN/SENTINEL stays there forever, even if
  abandoned. A dormant high-tier key (later compromised, or a farm that aged keys then went quiet) remains
  a permanent trust anchor — and, under C-1a, a permanent *voucher* and established confirmer.
- **Voucher behaviour is invisible.** C-1a deliberately retained the append-only vouch graph +
  `issuance_basis`, but nothing computes or surfaces whether a voucher's vouchees turn out to be accurate
  or abusive, and operators have no lever to throttle a bad voucher.
- **There is no operator visibility.** Decay windows, risk thresholds, and influence-cap limits are all
  guesses until real distributions are observed; without instrumentation the pilot teaches nothing
  measurable and C-1b-2 would be calibrated against fiction.

## Goal

1. Inactive trusted accounts **gradually** lose standing; trust reflects *recent demonstrated
   reliability*, not a one-time achievement. Decay is safe to automate because it only removes trust from
   inactive accounts and a false decay self-heals (re-earn by contributing again).
2. Operators can see each voucher's quality (with sample size) and **manually** suspend or budget-limit a
   voucher. No automatic penalties yet (advisory-only).
3. An operator-only Trust Observatory exposes point-in-time **and trend** metrics, collecting the pilot
   data C-1b-2 needs — collected even while decay is dark-launched.

## Non-goals (C-1b-2 / later)

- Coordinated-voting risk scoring (timing/geo/graph clustering), influence caps.
- The *automatic* voucher-penalty curve (C-1b-1 builds the enforcement fields + manual levers; C-1b-2 adds
  the automatic decision-maker that sets them).
- Re-enabling on-chain anchoring (stays off).
- A dashboard UI — the Observatory is JSON consumed by operators/curl; a UI is future.

## Architecture

Three deterministic pieces over existing data (`users`, the C-1a `vouches` graph, `community_reports`,
`safety_events`), no heuristic clustering:

- **Reputation decay** — an idempotent background worker (the `tokio::spawn` tick-loop pattern of
  `subscribers::nlp_synthesis_worker`). The decay *curve* is a pure, unit-tested function in a new
  `trust::decay` module (mirroring `trust::contract` / `trust::personhood`).
- **Voucher accountability (advisory)** — a computed `voucher_quality` (with sample size) plus
  operator-set `vouching_suspended` / `vouch_budget_override` fields that the C-1a issue endpoint honors.
- **Trust Observatory** — operator-only (behind the existing `InternalServiceAuth`) read-only JSON
  endpoints for snapshot + trend metrics, plus the few operator control endpoints, backed by a periodic
  `trust_metrics_snapshots` table.

**Synergy with C-1a:** decay needs no bespoke cascade. Because C-1a's personhood resolver re-checks
voucher eligibility *live*, the instant the worker drops a voucher below TRUSTED, every vouch they issued
goes dormant automatically.

## Part A — Reputation decay

Separate **earned** from **effective** so decay is idempotent and the curve is independent of worker
cadence:

- `users.reputation_score` remains the **earned** score (monotonic; `+10` per VERIFIED, unchanged). A new
  `effective_reputation_score INT` holds the decayed value the worker maintains. `reputation_tier` is
  computed from **effective**.
- **Decay clock is `last_verified_at`, not `last_active`.** A new `users.last_verified_at TIMESTAMPTZ`
  is set to `now()` in `apply_status_transition` when a report transitions to VERIFIED (the same place
  `reputation_score += 10` happens). Decay measures inactivity as time since the user last *contributed
  verified value* — not since they last did anything. This closes the cheap-activity loophole: spamming
  low-value votes/reports (which bump `last_active`) does **not** stave off decay; only a report of theirs
  reaching VERIFIED does. `last_active` is retained as-is (informational; shown in the Observatory) but is
  **not** the decay input. A NULL `last_verified_at` means the user never had a VERIFIED report — they are
  NEWCOMER (earned 0) with nothing to decay, so the worker skips them.
- **Pure curve** (`trust::decay`):
  `effective_score(earned: i32, days_since_verified: i64, accuracy_ratio: f64) -> i32`. Within the grace
  window the effective score equals earned (no decay). Past grace it declines gradually toward a floor over
  a horizon; a higher `accuracy_ratio` (= `accurate_reports / max(total_reports,1)`) lengthens the horizon
  so accurate users decay slower. Deterministic and idempotent: effective is always recomputed from earned
  + the timestamp, never decremented in place, so a change in worker cadence can never double-apply. Config
  thresholds (`REPUTATION_DECAY_GRACE_DAYS` default 90, `REPUTATION_DECAY_HORIZON_DAYS`, decay floor) carry
  documented defaults **explicitly meant to be recalibrated from Observatory data**.
- **Decay-apply pass (worker):** for users with `last_verified_at` older than the grace window, compute
  effective + `compute_tier(effective)` in Rust and `UPDATE` both columns. Activity resets decay: on a new
  VERIFIED, `apply_status_transition` sets `last_verified_at = now()`, `effective_reputation_score =
  reputation_score` (earned), and `reputation_tier = compute_tier(reputation_score)` — so effective and
  tier are immediately consistent (not stale until the next tick), and an actively-contributing user never
  decays. `apply_status_transition` also increments `accurate_reports` on VERIFIED (as today) and now
  increments `rejected_reports` on a transition to REJECTED (the new counter feeds voucher quality, Part B).
- **Gated:** the decay-apply pass runs only when `REPUTATION_DECAY_ENABLED` is true (default **false** —
  dark-launch). The worker's *snapshot* pass (Part C) runs **unconditionally**, so the Observatory
  accrues trend data during the dark-launch window.

## Part B — Voucher accountability (advisory)

Compute and surface; operators act. No automatic penalty in C-1b-1.

- **`voucher_quality`** — derived live (never stored, so it always reflects current outcomes). It is
  computed from the **`users` reputation aggregates** of the voucher's vouchees, **not** from
  `report_authors` — that keeps the Observatory in the main pool and avoids the C-2-restricted author
  table. For a voucher, gather **all** their vouchees (active *and* historically revoked — the append-only
  graph), join each vouchee to its `users` row, and sum `accurate_reports` and `rejected_reports` across
  them. The Observatory returns the **components, not a lone score**:
  `{ vouchee_count, accurate_count, rejected_count, quality_ratio }` where
  `quality_ratio = accurate_count / max(accurate_count + rejected_count, 1)`. A `quality_ratio` is
  meaningless at small N, so the response also flags `low_confidence = vouchee_count < QUALITY_MIN_SAMPLE`
  (default 5) — operators judge with the sample size visible, never a single number.
- **Operator controls** — two new per-user fields: `vouching_suspended BOOLEAN DEFAULT false` and
  `vouch_budget_override INT NULL`. The **C-1a issue endpoint honors them**: a suspended voucher → 403;
  the effective budget = `vouch_budget_override ?? config.vouch_budget`. These are set **only** by
  operators via the Part C control endpoints — nothing automatic flips them.
- **Genesis roots** are review-only by policy: the Observatory surfaces their quality like anyone's, but
  no automatic action exists; an operator may still manually act at their discretion.
- **C-1b-2 seam:** the automatic penalty curve, when later calibrated, sets these *same* fields — so the
  enforcement plumbing built here is reused; C-1b-2 only adds the automatic decision-maker.

## Part C — Trust Observatory

Operator-only (behind the existing `InternalServiceAuth` / `INTERNAL_SERVICE_SECRET`), read-only JSON
(plus a few control writes). New module `routes/observatory.rs`, nested at `/api/admin/observatory`. No
new public surface; a dashboard UI is out of scope (operators consume JSON).

**Snapshot table.** A new `trust_metrics_snapshots` table holds one aggregate row per worker tick:
captured-at timestamp plus the summary counters below (tier distribution earned + effective, active-vouch
counts by basis, vouch fan-out stats, report status funnel, `safety_events` trust_state counts, decayed
count). The worker writes it **every tick regardless of `REPUTATION_DECAY_ENABLED`**, so trends accrue
during dark-launch. A retention guard trims rows older than `OBSERVATORY_SNAPSHOT_RETENTION_DAYS`
(default 180).

**Read endpoints:**
- `GET …/summary` — the latest snapshot's aggregate: genesis-root count; user counts by tier (earned vs.
  effective, so decay impact is visible); active vouches (total + by `issuance_basis`); vouch-graph
  fan-out (max/avg active vouchees per voucher); reports by status (the escalation funnel);
  `safety_events` by `trust_state` (NLP promotions); count of currently-decayed/inactive accounts. Carries
  a `clusters` field that is `null` in C-1b-1 and populated by C-1b-2 — so the shape is stable across both.
- `GET …/trends?metric=<name>&window=<days>` — a time series read from `trust_metrics_snapshots` for a
  named metric over a window (e.g. tier distribution over time, escalation rate, active-vouch growth).
  This is the data C-1b-2 calibrates against.
- `GET …/vouchers` — per-voucher review list: active vouch count, `voucher_quality` components +
  `low_confidence`, and current `vouching_suspended` / `vouch_budget_override` — sortable so operators can
  find the worst actors.

**Control endpoints (the only writes):**
- `POST …/vouchers/:pubkey/suspend` (+ `…/unsuspend`) — set/clear `vouching_suspended`.
- `POST …/vouchers/:pubkey/budget` — set or clear `vouch_budget_override` (clear = back to config default).

## Part D — Schema (migration 018)

```sql
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS effective_reputation_score INT,
    ADD COLUMN IF NOT EXISTS last_verified_at           TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejected_reports           INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS vouching_suspended         BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS vouch_budget_override       INT;
-- Existing users start un-decayed: effective = earned.
UPDATE users SET effective_reputation_score = reputation_score
 WHERE effective_reputation_score IS NULL;

CREATE TABLE IF NOT EXISTS trust_metrics_snapshots (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    captured_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    metrics       JSONB       NOT NULL          -- the summary counters for this tick
);
CREATE INDEX IF NOT EXISTS trust_metrics_snapshots_captured_idx
    ON trust_metrics_snapshots (captured_at);
```
`last_verified_at` is NULL for existing rows; it is backfill-free by design (decay treats NULL as "never
verified → skip"), and starts populating as reports reach VERIFIED after deploy. `trust_metrics_snapshots`
is public/operational data (no identity linkage — pure aggregates), so no RLS.

## Part E — Worker structure

A new `subscribers::trust_worker` spawned in `main.rs` like the NLP worker, ticking on a slow interval
(`TRUST_WORKER_TICK_SECS`, default 3600 — decay + snapshots are slow-moving). Each tick, in order:
1. **Snapshot pass (unconditional):** compute the aggregate counters, INSERT one `trust_metrics_snapshots`
   row, and trim rows past the retention horizon.
2. **Decay-apply pass (gated on `REPUTATION_DECAY_ENABLED`):** for users past the grace window, recompute
   `effective_reputation_score` + `reputation_tier` via `trust::decay`.
Idempotent end to end (snapshot is append-only; decay recomputes from earned + timestamp). Safe across a
duplicate run (multi-replica leader election remains audit H-7, out of scope), matching the NLP worker's
stated posture.

## Part F — Error handling

- Observatory endpoints require valid internal auth → 401/403 otherwise (reuse `InternalServiceAuth`).
- Control endpoints: unknown target pubkey → 404; a negative `vouch_budget_override` → 400; clearing an
  override is idempotent.
- The C-1a issue path gains: `vouching_suspended` → 403 (a clear message); effective budget =
  `vouch_budget_override ?? config.vouch_budget`.
- Worker DB errors are logged per-tick and the loop continues (a transient failure must not kill the
  worker), matching the NLP worker.

## Part G — Testing

- **`trust::decay` (pure unit):** within grace → effective == earned; past grace → gradual decline; higher
  `accuracy_ratio` → slower decay (longer horizon); floor is respected; recomputation is idempotent
  (same inputs → same output, no in-place decrement); NULL/zero earned → no-op.
- **`voucher_quality` (pure unit):** aggregation over vouchee outcome counts produces the right
  components + ratio; `low_confidence` flips at the sample-size threshold; a voucher with zero vouchees is
  handled (ratio defined, low_confidence true).
- **Issue-endpoint integration:** a `vouching_suspended` voucher gets 403; setting `vouch_budget_override`
  changes the effective cap (e.g. override 0 blocks all new vouches; override > default raises it).
- **Worker / Observatory / migration:** verified by build + a fresh-DB migration apply (the repo's
  posture for DB-backed code); a snapshot row is written each tick regardless of the decay flag; the
  decay-apply pass is a no-op when the flag is off.

## Part H — Rollout / config

- New config: `TRUST_WORKER_TICK_SECS` (3600), `REPUTATION_DECAY_ENABLED` (**false** — dark-launch),
  `REPUTATION_DECAY_GRACE_DAYS` (90), `REPUTATION_DECAY_HORIZON_DAYS`, decay floor, `QUALITY_MIN_SAMPLE`
  (5), `OBSERVATORY_SNAPSHOT_RETENTION_DAYS` (180).
- Migration 018 adds the columns + snapshot table (fresh-DB apply verified as a non-superuser role).
- **Operator runbook:** deploy with `REPUTATION_DECAY_ENABLED=false`. The worker immediately begins
  snapshotting trends and the Observatory is live. After watching the reputation/escalation distributions
  for a representative window, set sensible decay thresholds and flip `REPUTATION_DECAY_ENABLED=true`.
  Voucher accountability is advisory throughout — operators use the Observatory + the suspend/budget
  controls manually.

## C-1b-2 follow-ups (out of scope)

Coordinated-voting risk scoring, influence caps, the automatic voucher-penalty curve (sets the *same*
`vouching_suspended` / `vouch_budget_override` fields built here), the `clusters` field on the Observatory
summary, and the eventual re-enable-anchoring decision — all calibrated against the trend data this cycle
collects.
