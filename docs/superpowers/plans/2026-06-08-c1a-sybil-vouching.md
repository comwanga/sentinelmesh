# C-1a — Sybil Resistance: Web-of-Trust Vouching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the report-consensus engine a real personhood signal — genesis roots + explicit signed vouches — so the established-voter gate can be turned ON and unvouched-newcomer swarms can no longer escalate reports.

**Architecture:** A new append-only `vouches` table (migration 017) records signed vouch attestations. A pure personhood classifier plus a SQL-backed resolver decide whether a pubkey is "established" (ROOT ∨ REPUTATION ∨ active VOUCH, voucher re-checked live). `cast_vote`'s `established_confirmations` is redefined to count personhood-established confirmers, and the `consensus_require_established` gate is flipped ON by default. Vouch issue/revoke is a Nostr-signed endpoint mirroring the existing report/vote pattern. A small PWA surface signs + submits vouches.

**Tech Stack:** Rust/axum gateway, sqlx (runtime queries, no compile-time DB), Postgres 16, Redis (replay guard), nostr-sdk; TypeScript/React PWA (nostr-tools), vitest + tsc; `cargo build --tests` / `cargo test` / `cargo clippy`.

**Spec:** `docs/superpowers/specs/2026-06-08-c1a-sybil-vouching-design.md`.

**Conventions:**
- Commit messages: plain English, NO `Co-Authored-By` trailer.
- Gateway: run from `services/gateway` — `cargo test`, `cargo clippy --all-targets -- -D warnings`, `cargo fmt`.
- PWA: `cd apps/pwa && npx vitest run <files>` and `npx tsc --noEmit`.
- Branch: `feat/c1a-sybil-vouching` (based on `main`).

**Codebase facts the implementer must know:**
- `AppState` (`services/gateway/src/main.rs`): `db: PgPool` (app role — owns `users`, `community_reports`, `report_votes`), `reputation_db: PgPool` (restricted role; reads `report_authors`), `config: Arc<Config>`, `redis`, `http_client`.
- Reputation tiers: `NEWCOMER`/`TRUSTED`/`VETERAN`/`SENTINEL` in `users.reputation_tier`. "Established by reputation" = tier in (`TRUSTED`,`VETERAN`,`SENTINEL`).
- `cast_vote` (`services/gateway/src/reports/service.rs`) reads `users.reputation_tier` via its own `tx` on `state.db` and already computes `established_confirmations`. `compute_new_status` (`reports/consensus.rs`) takes `established_confirmations` + `require_established` and is UNCHANGED by this work.
- Existing nostr verification + binding + replay pattern lives in `routes/reports.rs`: `verify_nostr_event`, `report_binding_content`, `replay_guard` (Redis SET NX), `extract_ip`, and the `RateLimiter`. Reuse these patterns.
- Migrations live in `infra/postgres/migrations/NNN_*.sql`, applied on startup. Latest is `016`; next is `017`. Use `CURRENT_USER` (not a hardcoded role) for any grants; `vouches` is PUBLIC data and needs NO RLS/restricted role.
- Config (`config.rs`): each field parsed from env in `Config::from_env`; booleans via `v == "true" || v == "1"`. `consensus_require_established` currently defaults `false`.
- Binding strings MUST byte-match between Rust (verify) and PWA (sign), exactly like `report_binding_content` ↔ `reportBindingContent`.

---

### Task 1: Config — genesis roots, vouch budget, gate default ON (TDD)

**Files:**
- Modify: `services/gateway/src/config.rs`

- [ ] **Step 1: Write the failing tests**

Add to the `#[cfg(test)] mod tests` in `config.rs` (it already has an `ENV_LOCK` mutex used by other env tests — reuse it):

```rust
    #[test]
    fn vouch_genesis_roots_parses_comma_separated() {
        assert_eq!(
            parse_genesis_roots("aa, bb ,cc"),
            vec!["aa".to_string(), "bb".to_string(), "cc".to_string()]
        );
    }

    #[test]
    fn vouch_genesis_roots_empty_is_empty_vec() {
        assert!(parse_genesis_roots("").is_empty());
        assert!(parse_genesis_roots("  ,  ").is_empty());
    }

    #[test]
    fn vouch_budget_defaults_to_five() {
        assert_eq!(parse_vouch_budget(None), 5);
        assert_eq!(parse_vouch_budget(Some("9".into())), 9);
        assert_eq!(parse_vouch_budget(Some("notanumber".into())), 5);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd services/gateway && cargo test config:: 2>&1 | tail -20
```
Expected: FAIL — `parse_genesis_roots` / `parse_vouch_budget` not found.

- [ ] **Step 3: Add the fields, parsers, and flip the gate default**

In `config.rs`, add fields to `struct Config`:
```rust
    /// Operator-designated web-of-trust roots (C-1a). Hex Nostr pubkeys that can
    /// issue the first vouches; trust propagates outward from them. Empty by
    /// default (dev); seed in production before enabling the consensus gate.
    pub vouch_genesis_roots: Vec<String>,
    /// Max active (non-revoked) vouches a single voucher may hold (C-1a).
    pub vouch_budget: u32,
```

Add the parser helpers (module-level, near the other resolve_* helpers):
```rust
/// Parse a comma-separated genesis-roots list, trimming whitespace and dropping empties.
fn parse_genesis_roots(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Parse the active-vouch budget, defaulting to 5 on absence or a bad value.
fn parse_vouch_budget(raw: Option<String>) -> u32 {
    raw.and_then(|v| v.parse().ok()).unwrap_or(5)
}
```

In `Config::from_env`, add to the returned struct:
```rust
            vouch_genesis_roots: parse_genesis_roots(
                &std::env::var("VOUCH_GENESIS_ROOTS").unwrap_or_default(),
            ),
            vouch_budget: parse_vouch_budget(std::env::var("VOUCH_BUDGET").ok()),
```

Flip the gate default to ON — change the existing `consensus_require_established` parse from `.unwrap_or(false)` to `.unwrap_or(true)`:
```rust
            consensus_require_established: std::env::var("CONSENSUS_REQUIRE_ESTABLISHED")
                .map(|v| v == "true" || v == "1")
                .unwrap_or(true),
```
Also update its doc comment on the struct field to say "Default **true** (C-1a): the gate is on; personhood (genesis/earned/vouched) seeds the established cohort. Set `CONSENSUS_REQUIRE_ESTABLISHED=false` to disable."

- [ ] **Step 4: Run the tests + clippy**

```bash
cd services/gateway && cargo test config:: 2>&1 | tail -20 && cargo clippy --all-targets -- -D warnings 2>&1 | tail -5
```
Expected: the three new tests PASS; clippy clean. (Any test elsewhere that constructs `Config { .. }` literally must add the two new fields — grep `Config {` in tests and fix; most tests build via `from_env`.)

- [ ] **Step 5: Commit**

```bash
git add services/gateway/src/config.rs
git commit -m "C-1a: config genesis roots + vouch budget; default the consensus gate ON"
```

---

### Task 2: Migration 017 — vouches table

**Files:**
- Create: `infra/postgres/migrations/017_vouches.sql`

- [ ] **Step 1: Write the migration**

Create `infra/postgres/migrations/017_vouches.sql`:
```sql
-- infra/postgres/migrations/017_vouches.sql
-- C-1a: web-of-trust vouching. Append-only attestation graph backing the
-- personhood signal that gates report-consensus escalation. Rows are NEVER
-- physically deleted: revocation sets revoked_at, preserving a full audit trail
-- for C-1b detection. vouches is PUBLIC data (the voucher opts in to disclosing
-- the single edge), so no RLS / restricted role — unlike report_authors.

CREATE TABLE IF NOT EXISTS vouches (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    voucher_pubkey  TEXT         NOT NULL,
    vouchee_pubkey  TEXT         NOT NULL,
    -- Voucher's basis AT ISSUANCE ('EARNED' == the reputation-based path).
    -- Informational/audit only; active-vouch validity re-checks CURRENT
    -- eligibility (see personhood resolver), never this stored value.
    issuance_basis  TEXT         NOT NULL CHECK (issuance_basis IN ('ROOT', 'EARNED')),
    nostr_event_id  TEXT         NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    revoked_at      TIMESTAMPTZ,                 -- soft delete; NULL = active
    expires_at      TIMESTAMPTZ,                 -- DORMANT seam (always NULL in C-1a)
    CHECK (voucher_pubkey <> vouchee_pubkey)
);

-- At most ONE active edge per (voucher, vouchee); unlimited historical (revoked) rows.
CREATE UNIQUE INDEX IF NOT EXISTS vouches_active_unique
    ON vouches (voucher_pubkey, vouchee_pubkey) WHERE revoked_at IS NULL;

-- Personhood lookup: active vouches for a given vouchee.
CREATE INDEX IF NOT EXISTS vouches_vouchee_active_idx
    ON vouches (vouchee_pubkey) WHERE revoked_at IS NULL;

-- Budget lookup: active vouches held by a given voucher.
CREATE INDEX IF NOT EXISTS vouches_voucher_active_idx
    ON vouches (voucher_pubkey) WHERE revoked_at IS NULL;
```

- [ ] **Step 2: Verify it applies on a fresh database**

Apply against a throwaway DB the same way CI does (a non-superuser app role). If a local Postgres is available:
```bash
cd services/gateway && cargo test 2>&1 | tail -5   # startup migration runner applies it in integration context
```
If migrations are applied by a script, run that script against a fresh DB and confirm `\d vouches` shows the three partial indexes and the two CHECKs. Expected: applies cleanly, idempotent on re-run (all `IF NOT EXISTS`).

- [ ] **Step 3: Commit**

```bash
git add infra/postgres/migrations/017_vouches.sql
git commit -m "C-1a: migration 017 — append-only vouches attestation table"
```

---

### Task 3: Personhood classifier + resolver (TDD)

**Files:**
- Create: `services/gateway/src/trust/personhood.rs`
- Modify: `services/gateway/src/trust/mod.rs` (add `pub mod personhood;`)

A pure classifier (unit-tested) plus a thin SQL-backed resolver that gathers the three booleans.

- [ ] **Step 1: Write the failing tests**

Create `services/gateway/src/trust/personhood.rs` with ONLY the tests first (so it compiles to a failing state), then add the impl in Step 3. Tests:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn none_when_no_signal() {
        assert_eq!(classify(false, false, false), PersonhoodSource::None);
        assert!(!is_established(PersonhoodSource::None));
    }
    #[test]
    fn single_signals_classify_distinctly() {
        assert_eq!(classify(true, false, false), PersonhoodSource::Root);
        assert_eq!(classify(false, true, false), PersonhoodSource::Reputation);
        assert_eq!(classify(false, false, true), PersonhoodSource::Vouch);
    }
    #[test]
    fn multiple_when_more_than_one() {
        assert_eq!(classify(true, true, false), PersonhoodSource::Multiple);
        assert_eq!(classify(true, false, true), PersonhoodSource::Multiple);
        assert_eq!(classify(true, true, true), PersonhoodSource::Multiple);
    }
    #[test]
    fn is_established_true_for_any_non_none() {
        for s in [PersonhoodSource::Root, PersonhoodSource::Reputation, PersonhoodSource::Vouch, PersonhoodSource::Multiple] {
            assert!(is_established(s));
        }
    }
    #[test]
    fn tier_established_only_above_newcomer() {
        assert!(!tier_is_established("NEWCOMER"));
        assert!(tier_is_established("TRUSTED"));
        assert!(tier_is_established("VETERAN"));
        assert!(tier_is_established("SENTINEL"));
        assert!(!tier_is_established("unknown"));
    }
    #[test]
    fn eligible_to_vouch_is_root_or_reputation_only() {
        // root, not-established-tier -> eligible (root)
        assert!(eligible_from(true, false));
        // not-root, established tier -> eligible (reputation)
        assert!(eligible_from(false, true));
        // neither -> not eligible (a vouch-only key can't vouch)
        assert!(!eligible_from(false, false));
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
cd services/gateway && cargo test personhood:: 2>&1 | tail -20
```
Expected: FAIL — module/items not defined (after adding `pub mod personhood;` to `trust/mod.rs`).

- [ ] **Step 3: Implement the classifier + resolver**

Prepend to `services/gateway/src/trust/personhood.rs` (above the test module):
```rust
//! Personhood signal for Sybil resistance (C-1a). A pubkey is "established" for
//! the consensus gate if it is a genesis ROOT, REPUTATION-established (earned
//! tier >= TRUSTED), or holds an active VOUCH from a CURRENTLY-eligible voucher.
//! Personhood is separate from vote weight: a vouch confers eligibility only.

use sqlx::PgPool;

/// Why a pubkey is established. Computed (not stored): it changes as tiers,
/// vouches, and roots change. Logged for debugging/analytics and for C-1b.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PersonhoodSource {
    None,
    Root,
    Reputation,
    Vouch,
    Multiple,
}

/// Pure classifier from the three independent signals.
pub fn classify(is_root: bool, tier_established: bool, has_active_vouch: bool) -> PersonhoodSource {
    let n = [is_root, tier_established, has_active_vouch]
        .iter()
        .filter(|b| **b)
        .count();
    match n {
        0 => PersonhoodSource::None,
        1 => {
            if is_root {
                PersonhoodSource::Root
            } else if tier_established {
                PersonhoodSource::Reputation
            } else {
                PersonhoodSource::Vouch
            }
        }
        _ => PersonhoodSource::Multiple,
    }
}

/// Established for the gate iff any signal applies.
pub fn is_established(s: PersonhoodSource) -> bool {
    !matches!(s, PersonhoodSource::None)
}

/// Earned-established: tier strictly above NEWCOMER.
pub fn tier_is_established(tier: &str) -> bool {
    matches!(tier, "TRUSTED" | "VETERAN" | "SENTINEL")
}

/// Eligible to ISSUE a vouch: ROOT or REPUTATION only (never vouch-only).
pub fn eligible_from(is_root: bool, tier_established: bool) -> bool {
    is_root || tier_established
}

/// True if `pubkey` is one of the configured genesis roots.
pub fn is_root(roots: &[String], pubkey: &str) -> bool {
    roots.iter().any(|r| r == pubkey)
}

/// Does `pubkey` hold an active vouch from a CURRENTLY-eligible voucher?
/// Active = not revoked, not expired, and the voucher is right-now a genesis
/// root OR reputation-established. (issuance_basis is NOT trusted here.)
pub async fn has_active_vouch(pool: &PgPool, roots: &[String], pubkey: &str) -> sqlx::Result<bool> {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (
           SELECT 1 FROM vouches v
           WHERE v.vouchee_pubkey = $1
             AND v.revoked_at IS NULL
             AND (v.expires_at IS NULL OR v.expires_at > now())
             AND (
               v.voucher_pubkey = ANY($2)
               OR EXISTS (SELECT 1 FROM users u
                          WHERE u.nostr_pubkey = v.voucher_pubkey
                            AND u.reputation_tier IN ('TRUSTED','VETERAN','SENTINEL'))
             )
         )",
    )
    .bind(pubkey)
    .bind(roots)
    .fetch_one(pool)
    .await
}

/// Reputation tier for a pubkey, or "NEWCOMER" if unknown.
pub async fn reputation_tier(pool: &PgPool, pubkey: &str) -> sqlx::Result<String> {
    let tier: Option<String> =
        sqlx::query_scalar("SELECT reputation_tier FROM users WHERE nostr_pubkey = $1")
            .bind(pubkey)
            .fetch_optional(pool)
            .await?;
    Ok(tier.unwrap_or_else(|| "NEWCOMER".to_string()))
}

/// Full personhood resolution: gather the three signals and classify.
pub async fn resolve(pool: &PgPool, roots: &[String], pubkey: &str) -> sqlx::Result<PersonhoodSource> {
    let root = is_root(roots, pubkey);
    let tier_est = tier_is_established(&reputation_tier(pool, pubkey).await?);
    let vouched = has_active_vouch(pool, roots, pubkey).await?;
    Ok(classify(root, tier_est, vouched))
}

/// Eligible to issue a vouch (ROOT or REPUTATION).
pub async fn eligible_to_vouch(pool: &PgPool, roots: &[String], pubkey: &str) -> sqlx::Result<bool> {
    let root = is_root(roots, pubkey);
    let tier_est = tier_is_established(&reputation_tier(pool, pubkey).await?);
    Ok(eligible_from(root, tier_est))
}
```

Add `pub mod personhood;` to `services/gateway/src/trust/mod.rs`.

- [ ] **Step 4: Run the tests + clippy**

```bash
cd services/gateway && cargo test personhood:: 2>&1 | tail -20 && cargo clippy --all-targets -- -D warnings 2>&1 | tail -5
```
Expected: the pure-classifier tests PASS; clippy clean. (The async DB fns aren't unit-tested here — they're exercised by Tasks 5–6 + manual/integration; they compile under `cargo build --tests`.)

- [ ] **Step 5: Commit**

```bash
git add services/gateway/src/trust/personhood.rs services/gateway/src/trust/mod.rs
git commit -m "C-1a: personhood classifier + SQL resolver (root/reputation/vouch, live voucher re-check)"
```

---

### Task 4: Vouch binding strings — shared Rust↔PWA contract (TDD)

**Files:**
- Modify: `services/gateway/src/routes/reports.rs` (or a small shared module — see note) — Rust binding helpers
- Modify: `apps/pwa/src/services/nostrService.ts` — PWA binding helpers
- Modify: `apps/pwa/src/__tests__/nostrService.test.ts`

The vouch + revoke binding strings must byte-match between server (verify) and client (sign), exactly like the report/vote bindings.

> Note: the Rust vouch route (Task 5) will live in `routes/vouches.rs`; define the binding helpers there. This task adds them with byte-match unit tests on both sides so the contract is locked before the handler exists.

- [ ] **Step 1: Write the failing Rust test**

In a NEW file `services/gateway/src/routes/vouches.rs`, start with the binding helpers + their tests only (the handlers come in Task 5):
```rust
/// Canonical binding for a vouch. The signed event's content must byte-equal
/// this; domain-separated so a signature from another context can't be replayed
/// as a vouch. MUST match the PWA `vouchBindingContent`.
pub fn vouch_binding_content(vouchee_pubkey: &str) -> String {
    format!("sentinelmesh:vouch:v1:{vouchee_pubkey}")
}

/// Canonical binding for a vouch revocation. MUST match `vouchRevokeBindingContent`.
pub fn vouch_revoke_binding_content(vouchee_pubkey: &str) -> String {
    format!("sentinelmesh:vouch-revoke:v1:{vouchee_pubkey}")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn vouch_binding_is_domain_separated() {
        assert_eq!(vouch_binding_content("abc"), "sentinelmesh:vouch:v1:abc");
    }
    #[test]
    fn vouch_revoke_binding_is_domain_separated() {
        assert_eq!(vouch_revoke_binding_content("abc"), "sentinelmesh:vouch-revoke:v1:abc");
    }
}
```
Add `pub mod vouches;` to `services/gateway/src/routes/mod.rs` (the module list at the top).

- [ ] **Step 2: Write the failing PWA test**

In `apps/pwa/src/__tests__/nostrService.test.ts`, add `vouchBindingContent, vouchRevokeBindingContent` to the `'../services/nostrService'` import and a describe:
```ts
describe('vouch binding strings (must byte-match the gateway)', () => {
  it('vouchBindingContent is domain-separated', () => {
    expect(vouchBindingContent('abc')).toBe('sentinelmesh:vouch:v1:abc')
  })
  it('vouchRevokeBindingContent is domain-separated', () => {
    expect(vouchRevokeBindingContent('abc')).toBe('sentinelmesh:vouch-revoke:v1:abc')
  })
})
```

- [ ] **Step 3: Run both to verify failure**

```bash
cd services/gateway && cargo test vouches:: 2>&1 | tail -10
cd ../../apps/pwa && npx vitest run src/__tests__/nostrService.test.ts 2>&1 | tail -10
```
Expected: Rust binding tests PASS already (helpers defined in Step 1); PWA FAILS — helpers not exported.

- [ ] **Step 4: Implement the PWA helpers**

In `apps/pwa/src/services/nostrService.ts`, add (next to `reportBindingContent`/`voteBindingContent`):
```ts
/** Canonical binding for a vouch — must byte-match the gateway `vouch_binding_content`. */
export function vouchBindingContent(voucheePubkey: string): string {
  return `sentinelmesh:vouch:v1:${voucheePubkey}`
}

/** Canonical binding for a vouch revocation — must byte-match `vouch_revoke_binding_content`. */
export function vouchRevokeBindingContent(voucheePubkey: string): string {
  return `sentinelmesh:vouch-revoke:v1:${voucheePubkey}`
}
```

- [ ] **Step 5: Run both to verify pass**

```bash
cd services/gateway && cargo test vouches:: 2>&1 | tail -10
cd ../../apps/pwa && npx vitest run src/__tests__/nostrService.test.ts 2>&1 | tail -10 && npx tsc --noEmit 2>&1 | grep nostrService; echo "ts-done"
```
Expected: both PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add services/gateway/src/routes/vouches.rs services/gateway/src/routes/mod.rs apps/pwa/src/services/nostrService.ts apps/pwa/src/__tests__/nostrService.test.ts
git commit -m "C-1a: domain-separated vouch/revoke binding strings (Rust + PWA, byte-matched)"
```

---

### Task 5: Vouch service + issue/revoke routes

**Files:**
- Create: `services/gateway/src/vouches/mod.rs` (service: issue + revoke + budget)
- Modify: `services/gateway/src/main.rs` (add `mod vouches;`)
- Modify: `services/gateway/src/routes/vouches.rs` (handlers + router; binding helpers from Task 4 stay)
- Modify: `services/gateway/src/routes/mod.rs` (nest the vouches router)

- [ ] **Step 1: Write the service layer**

Create `services/gateway/src/vouches/mod.rs`:
```rust
//! Vouch issuance + revocation (C-1a). Personhood eligibility and budget are
//! enforced here; the route layer handles nostr signature/binding/replay.
use anyhow::Result;
use sqlx::PgPool;

/// How many active (non-revoked) vouches a voucher currently holds.
pub async fn active_vouch_count(pool: &PgPool, voucher: &str) -> Result<i64> {
    let n: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM vouches WHERE voucher_pubkey = $1 AND revoked_at IS NULL",
    )
    .bind(voucher)
    .fetch_one(pool)
    .await?;
    Ok(n)
}

/// Insert a vouch. Caller has already verified the signature, eligibility, and
/// that voucher != vouchee. `basis` is 'ROOT' or 'EARNED'. Returns false if an
/// active edge already exists (the partial unique index conflict).
pub async fn insert_vouch(
    pool: &PgPool,
    voucher: &str,
    vouchee: &str,
    basis: &str,
    event_id: &str,
) -> Result<bool> {
    let res = sqlx::query(
        "INSERT INTO vouches (voucher_pubkey, vouchee_pubkey, issuance_basis, nostr_event_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (voucher_pubkey, vouchee_pubkey) WHERE revoked_at IS NULL DO NOTHING",
    )
    .bind(voucher)
    .bind(vouchee)
    .bind(basis)
    .bind(event_id)
    .execute(pool)
    .await?;
    Ok(res.rows_affected() == 1)
}

/// Soft-revoke the active vouch from `voucher` to `vouchee`. Returns true if a
/// row was revoked (false if there was no active vouch). Never deletes.
pub async fn revoke_vouch(pool: &PgPool, voucher: &str, vouchee: &str) -> Result<bool> {
    let res = sqlx::query(
        "UPDATE vouches SET revoked_at = now()
         WHERE voucher_pubkey = $1 AND vouchee_pubkey = $2 AND revoked_at IS NULL",
    )
    .bind(voucher)
    .bind(vouchee)
    .execute(pool)
    .await?;
    Ok(res.rows_affected() >= 1)
}
```
Add `mod vouches;` to `services/gateway/src/main.rs` (next to the other `mod` declarations).

- [ ] **Step 2: Write the handlers + router in `routes/vouches.rs`**

Keep the binding helpers from Task 4; add above them the imports and below them the handlers. Reuse the report pattern for nostr verification + replay + rate limiting. Because `verify_nostr_event`, `replay_guard`, `extract_ip`, and `RateLimiter` are currently `fn`/types private to `routes/reports.rs`, make them reusable: change `verify_nostr_event`, `replay_guard`, and `extract_ip` in `routes/reports.rs` to `pub(crate)`, and move `RateLimiter` to `pub(crate)` (or re-create a local limiter). Then:

```rust
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::Json,
    routing::post,
    Router,
};
use serde::Deserialize;
use std::{sync::Arc, time::Duration};

use crate::{
    error::AppError,
    routes::reports::{extract_ip, replay_guard, verify_nostr_event, RateLimiter},
    trust::personhood,
    AppState,
};

#[derive(Clone)]
struct VouchRl(Arc<RateLimiter>);

#[derive(Deserialize)]
struct IssueVouchBody {
    voucher_pubkey: String,
    vouchee_pubkey: String,
    nostr_event: serde_json::Value,
}

#[derive(Deserialize)]
struct RevokeVouchBody {
    voucher_pubkey: String,
    nostr_event: serde_json::Value,
}

/// POST /api/vouches
async fn post_vouch(
    State(state): State<AppState>,
    axum::Extension(VouchRl(rl)): axum::Extension<VouchRl>,
    headers: HeaderMap,
    Json(body): Json<IssueVouchBody>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let ip = extract_ip(&headers, state.config.trust_proxy);
    if !rl.check(&format!("vouch:{}", body.voucher_pubkey)) && !rl.check(&format!("ip:{ip}")) {
        return Err(AppError::RateLimited);
    }
    if body.voucher_pubkey == body.vouchee_pubkey {
        return Err(AppError::BadRequest("cannot vouch for yourself".into()));
    }

    verify_nostr_event(&body.nostr_event, &body.voucher_pubkey, 300)?;
    let expected = vouch_binding_content(&body.vouchee_pubkey);
    if body.nostr_event["content"].as_str() != Some(expected.as_str()) {
        return Err(AppError::BadRequest(
            "nostr_event content is not bound to this vouch".into(),
        ));
    }
    let event_id = body.nostr_event["id"].as_str().unwrap_or("").to_string();
    replay_guard(&state.redis, &event_id).await?;

    // Eligibility + issuance basis (live re-check).
    let roots = &state.config.vouch_genesis_roots;
    let is_root = personhood::is_root(roots, &body.voucher_pubkey);
    let tier_est =
        personhood::tier_is_established(&personhood::reputation_tier(&state.db, &body.voucher_pubkey).await.map_err(|e| AppError::Internal(e.into()))?);
    if !personhood::eligible_from(is_root, tier_est) {
        return Err(AppError::Forbidden(
            "only genesis roots or established users may vouch".into(),
        ));
    }
    let basis = if is_root { "ROOT" } else { "EARNED" };

    // Budget.
    let count = crate::vouches::active_vouch_count(&state.db, &body.voucher_pubkey)
        .await
        .map_err(AppError::Internal)?;
    if count >= state.config.vouch_budget as i64 {
        return Err(AppError::Conflict("vouch budget exhausted".into()));
    }

    let inserted = crate::vouches::insert_vouch(
        &state.db,
        &body.voucher_pubkey,
        &body.vouchee_pubkey,
        basis,
        &event_id,
    )
    .await
    .map_err(AppError::Internal)?;
    if !inserted {
        return Err(AppError::Conflict("already vouching for this key".into()));
    }

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({ "vouchee_pubkey": body.vouchee_pubkey, "issuance_basis": basis })),
    ))
}

/// DELETE /api/vouches/:vouchee
async fn delete_vouch(
    State(state): State<AppState>,
    axum::Extension(VouchRl(rl)): axum::Extension<VouchRl>,
    headers: HeaderMap,
    Path(vouchee): Path<String>,
    Json(body): Json<RevokeVouchBody>,
) -> Result<StatusCode, AppError> {
    let ip = extract_ip(&headers, state.config.trust_proxy);
    if !rl.check(&format!("vouch:{}", body.voucher_pubkey)) && !rl.check(&format!("ip:{ip}")) {
        return Err(AppError::RateLimited);
    }
    verify_nostr_event(&body.nostr_event, &body.voucher_pubkey, 300)?;
    let expected = vouch_revoke_binding_content(&vouchee);
    if body.nostr_event["content"].as_str() != Some(expected.as_str()) {
        return Err(AppError::BadRequest(
            "nostr_event content is not bound to this revocation".into(),
        ));
    }
    let event_id = body.nostr_event["id"].as_str().unwrap_or("").to_string();
    replay_guard(&state.redis, &event_id).await?;

    let revoked = crate::vouches::revoke_vouch(&state.db, &body.voucher_pubkey, &vouchee)
        .await
        .map_err(AppError::Internal)?;
    if !revoked {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

pub fn router() -> Router<AppState> {
    let vouch_rl = VouchRl(Arc::new(RateLimiter::new(20, Duration::from_secs(3600))));
    Router::new()
        .route("/", post(post_vouch))
        .route("/:vouchee", axum::routing::delete(delete_vouch))
        .layer(axum::Extension(vouch_rl))
}
```

If `AppError` lacks `Forbidden`/`Conflict` variants, add them to `services/gateway/src/error.rs` mapping to 403/409 (mirror the existing `BadRequest`/`RateLimited` variants and their `IntoResponse` arms). Nest the router in `routes/mod.rs`:
```rust
        .nest("/api/vouches", vouches::router())
```

- [ ] **Step 3: Build + clippy + the binding tests**

```bash
cd services/gateway && cargo build --tests 2>&1 | tail -20 && cargo test vouches:: 2>&1 | tail -10 && cargo clippy --all-targets -- -D warnings 2>&1 | tail -8
```
Expected: builds; binding tests pass; clippy clean. (Handler behavior is covered by manual/integration testing against a DB; the unit-testable logic — binding, classifier, config — is already covered.)

- [ ] **Step 4: Commit**

```bash
git add services/gateway/src/vouches/mod.rs services/gateway/src/main.rs services/gateway/src/routes/vouches.rs services/gateway/src/routes/mod.rs services/gateway/src/routes/reports.rs services/gateway/src/error.rs
git commit -m "C-1a: vouch issue/revoke endpoints with eligibility, budget, replay guards"
```

---

### Task 6: Redefine `established_confirmations` to count personhood (TDD where pure)

**Files:**
- Modify: `services/gateway/src/reports/service.rs` (the `established_confirmations` query in `cast_vote`)
- Modify: `services/gateway/src/routes/reports.rs` (thread `vouch_genesis_roots` into `cast_vote`)

- [ ] **Step 1: Redefine the established-confirmers query**

In `cast_vote` (`reports/service.rs`), replace the `established_confirmations` query so it counts distinct CONFIRM voters who are **personhood-established** (root ∨ reputation ∨ active vouch from a currently-eligible voucher). Add a `genesis_roots: &[String]` parameter to `cast_vote` and bind it:
```rust
    let established_confirmations: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT rv.voter_pubkey)
         FROM report_votes rv
         WHERE rv.report_id = $1 AND rv.vote = 'CONFIRM'
           AND (
             rv.voter_pubkey = ANY($2)
             OR EXISTS (SELECT 1 FROM users u
                        WHERE u.nostr_pubkey = rv.voter_pubkey
                          AND u.reputation_tier IN ('TRUSTED','VETERAN','SENTINEL'))
             OR EXISTS (SELECT 1 FROM vouches v
                        WHERE v.vouchee_pubkey = rv.voter_pubkey
                          AND v.revoked_at IS NULL
                          AND (v.expires_at IS NULL OR v.expires_at > now())
                          AND (
                            v.voucher_pubkey = ANY($2)
                            OR EXISTS (SELECT 1 FROM users u2
                                       WHERE u2.nostr_pubkey = v.voucher_pubkey
                                         AND u2.reputation_tier IN ('TRUSTED','VETERAN','SENTINEL'))
                          ))
           )",
    )
    .bind(report_id)
    .bind(genesis_roots)
    .fetch_one(&mut *tx)
    .await?;
```
Update the `cast_vote` signature to `pub async fn cast_vote(pool: &PgPool, report_id: Uuid, input: CastVoteInput, genesis_roots: &[String]) -> Result<(Report, i32, i32)>`.

- [ ] **Step 2: Thread the roots from the handler**

In `routes/reports.rs` `vote` handler, pass the configured roots:
```rust
    let (updated, old_score, established_confirmations) = cast_vote(
        &state.db,
        report_id,
        CastVoteInput { /* unchanged */ },
        &state.config.vouch_genesis_roots,
    )
```

- [ ] **Step 3: Build + the unchanged consensus tests + clippy**

```bash
cd services/gateway && cargo build --tests 2>&1 | tail -20 && cargo test consensus:: 2>&1 | tail -15 && cargo clippy --all-targets -- -D warnings 2>&1 | tail -8
```
Expected: builds; the existing `compute_new_status` tests still pass unchanged (the gate logic is untouched; only the input count's source changed). clippy clean.

- [ ] **Step 4: Add a consensus test asserting the gate-on default behavior**

In `reports/consensus.rs` tests, add an explicit case documenting the C-1a default (the gate now defaults ON; a vouched/established cohort satisfies it, an unestablished one does not — expressed through the existing `require_established=true` arg):
```rust
    #[test]
    fn c1a_gate_on_blocks_unestablished_cohort() {
        // require_established=true (C-1a default): 0 established confirmers -> no VERIFIED.
        assert_eq!(compute_new_status("UNVERIFIED", 9, 4, 0, 0, true), None);
    }
    #[test]
    fn c1a_gate_on_allows_established_cohort() {
        assert_eq!(
            compute_new_status("UNVERIFIED", 9, 4, 0, 2, true),
            Some("VERIFIED".into())
        );
    }
```

```bash
cd services/gateway && cargo test consensus:: 2>&1 | tail -10
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/gateway/src/reports/service.rs services/gateway/src/routes/reports.rs services/gateway/src/reports/consensus.rs
git commit -m "C-1a: count personhood-established confirmers for the consensus gate"
```

---

### Task 7: PWA vouch service + minimal UI

**Files:**
- Create: `apps/pwa/src/services/vouchService.ts`
- Create: `apps/pwa/src/services/__tests__/vouchService.test.ts`
- Modify: `apps/pwa/src/pages/SettingsPage.tsx` (a minimal vouch affordance)

- [ ] **Step 1: Write the failing service test**

Create `apps/pwa/src/services/__tests__/vouchService.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { issueVouch, revokeVouch } from '../vouchService'

vi.mock('../nostrService', () => ({
  getCachedKeypair: () => ({ publicKey: 'voucherpk', secretKey: new Uint8Array(32) }),
  vouchBindingContent: (v: string) => `sentinelmesh:vouch:v1:${v}`,
  vouchRevokeBindingContent: (v: string) => `sentinelmesh:vouch-revoke:v1:${v}`,
  signReport: () => ({ id: 'ev1', pubkey: 'voucherpk', created_at: 1, kind: 30078, tags: [], content: 'x', sig: 's' }),
}))

describe('vouchService', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('issueVouch POSTs the signed attestation', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({}) })
    vi.stubGlobal('fetch', fetchMock)
    const ok = await issueVouch('voucheepk')
    expect(ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/api\/vouches$/)
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body.voucher_pubkey).toBe('voucherpk')
    expect(body.vouchee_pubkey).toBe('voucheepk')
    expect(body.nostr_event.content).toBe('sentinelmesh:vouch:v1:voucheepk')
  })

  it('revokeVouch DELETEs', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchMock)
    const ok = await revokeVouch('voucheepk')
    expect(ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/api\/vouches\/voucheepk$/)
    expect(init.method).toBe('DELETE')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd apps/pwa && npx vitest run src/services/__tests__/vouchService.test.ts 2>&1 | tail -12
```
Expected: FAIL — `vouchService` not found.

- [ ] **Step 3: Implement `vouchService.ts`**

Create `apps/pwa/src/services/vouchService.ts`:
```ts
// Issue / revoke a web-of-trust vouch (C-1a). The vouch is an explicit, signed,
// PUBLIC attestation — it does not touch the E2EE circle graph.
import { getCachedKeypair, vouchBindingContent, vouchRevokeBindingContent, signReport } from './nostrService'

const API_BASE = import.meta.env['VITE_API_BASE_URL'] ?? ''

/** Sign and submit a vouch for `voucheePubkey` (hex). Resolves true on success. */
export async function issueVouch(voucheePubkey: string): Promise<boolean> {
  const kp = getCachedKeypair()
  const event = signReport(vouchBindingContent(voucheePubkey), kp.secretKey)
  const res = await fetch(`${API_BASE}/api/vouches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voucher_pubkey: kp.publicKey, vouchee_pubkey: voucheePubkey, nostr_event: event }),
  })
  return res.ok
}

/** Sign and submit a revocation of a vouch for `voucheePubkey`. */
export async function revokeVouch(voucheePubkey: string): Promise<boolean> {
  const kp = getCachedKeypair()
  const event = signReport(vouchRevokeBindingContent(voucheePubkey), kp.secretKey)
  const res = await fetch(`${API_BASE}/api/vouches/${voucheePubkey}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voucher_pubkey: kp.publicKey, nostr_event: event }),
  })
  return res.ok
}
```
(`signReport(content, secretKey)` already produces a kind-30078 signed event whose `content` is the binding — the same primitive reports/votes use; the gateway only checks the signature + content binding, not the kind.)

- [ ] **Step 4: Minimal Settings affordance**

In `SettingsPage.tsx`, add a small "Vouch for a key" block (an npub/hex input + a Vouch button calling `issueVouch(hexFromNpubOrHex(input))`, with a success/error line). Keep it minimal and consistent with the existing monospace styling; gate the button on a non-empty, valid key. (No new state machine — one input + one handler + one message line.) Import `issueVouch` from `../services/vouchService` and `hexFromNpubOrHex` from `../services/nostrService`.

- [ ] **Step 5: Run tests + tsc**

```bash
cd apps/pwa && npx vitest run src/services/__tests__/vouchService.test.ts 2>&1 | tail -10 && npx tsc --noEmit; echo "tsc:$?"
```
Expected: vouchService tests PASS; `tsc:0`.

- [ ] **Step 6: Commit**

```bash
git add apps/pwa/src/services/vouchService.ts apps/pwa/src/services/__tests__/vouchService.test.ts apps/pwa/src/pages/SettingsPage.tsx
git commit -m "C-1a: PWA vouch service + minimal Settings affordance"
```

---

### Task 8: Final verification + PR

**Files:** none (verification only)

- [ ] **Step 1: Full gateway + PWA checks**

```bash
cd services/gateway && cargo fmt --check && cargo clippy --all-targets -- -D warnings 2>&1 | tail -8 && cargo test 2>&1 | tail -15
cd ../../apps/pwa && npx tsc --noEmit; echo "tsc:$?" && npx vitest run 2>&1 | tail -8
```
Expected: fmt clean, clippy clean, all gateway tests pass; `tsc:0`, all PWA tests pass.

- [ ] **Step 2: Confirm the migration applies on a fresh DB as a non-superuser**

Apply migrations `001..017` to a throwaway database using the same non-superuser app role CI uses (the established migration-parity check). Confirm 017 applies cleanly and `vouches` + its three partial indexes exist. Fix any ordering/grant issue and re-run.

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin feat/c1a-sybil-vouching
```
Then `gh pr create --base main --head feat/c1a-sybil-vouching --title "C-1a: Sybil resistance — web-of-trust vouching" --body-file <path>` (use `--body-file`, not inline `--body`, to avoid apostrophe breakage). Body summarizes: personhood (genesis roots ∨ earned reputation ∨ active vouch, voucher re-checked live) separate from vote weight; signed domain-separated vouch attestations with budget + soft-delete revocation (append-only audit trail); `established_confirmations` redefined to count personhood; the consensus gate turned ON by default; on-chain anchoring stays OFF until C-1b. Note the operator runbook (seed `VOUCH_GENESIS_ROOTS` before enabling the gate) and that C-1b (coordinated-voting detection, decay, caps, voucher penalties) is the follow-up.

---

## Self-Review

- **Spec coverage:** personhood model with live voucher re-check (Task 3, spec Trust model + Part C); vouch attestation + domain-separated bindings (Task 4, spec Part A); schema 017 with append-only soft-delete, partial unique index, dormant `expires_at` (Task 2, spec Part B); genesis roots + budget + gate-default config (Task 1, spec Parts B/E/J); issue/revoke endpoints with eligibility + budget + replay (Task 5, spec Parts A/E/H); `established_confirmations` redefinition + gate ON (Task 6, spec Part D); PWA surface (Task 7, spec Part F); audit-trail retention for C-1b is a property of the append-only table (spec "Data retained for C-1b") needing no extra task; privacy (public opt-in edge, C-3 untouched) is satisfied by not reading the circle graph anywhere (spec Part G). Anchoring stays off — no task re-enables it (spec non-goal).
- **Placeholder scan:** none — every code step has full Rust/TS/SQL and exact commands. The two DB-backed areas that can't be pure-unit-tested (handlers, SQL resolver) are explicitly verified by build + binding/classifier/config unit tests + the fresh-DB migration apply; this matches the repo's existing test posture (pure logic in `consensus.rs`/`config.rs`, no live-DB unit tests).
- **Type/contract consistency:** `vouch_binding_content`/`vouchBindingContent` and the revoke variants are byte-identical across Rust and TS (Task 4 asserts both). `PersonhoodSource`, `classify`, `tier_is_established`, `eligible_from`, `is_root`, `has_active_vouch`, `resolve`, `eligible_to_vouch` (Task 3) are used consistently in Tasks 5–6. `cast_vote`'s new `genesis_roots: &[String]` param is threaded from `state.config.vouch_genesis_roots` (Task 6). `AppError::Forbidden`/`Conflict` are added if missing (Task 5). The `vouches` columns (`issuance_basis` ROOT/EARNED, `revoked_at`, `expires_at`) match the resolver/service queries.
- **Known follow-ups (C-1b, out of scope):** coordinated-voting detection, reputation decay, per-cluster influence caps, automated voucher penalties / auto-revocation, and re-enabling on-chain anchoring.
```
