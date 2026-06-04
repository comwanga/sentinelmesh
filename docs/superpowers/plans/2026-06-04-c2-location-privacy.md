# C-2 Community Report Location Privacy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `community_reports` from being a precise, identity-linked movement trail: snap report coordinates to H3 r9 (~100 m) centroids, move all identity fields into a separately access-controlled `report_authors` table, and replace stored voter coordinates with a single `voter_was_nearby` boolean.

**Architecture:** App-layer H3 snapping in the Rust gateway (`h3o`, already a dependency) writes coarse centroids; identity (`nostr_pubkey`/`nostr_signature`/`nostr_event_id`) moves to `report_authors`, readable only via a second sqlx pool that `SET ROLE sentinel_reputation` (a `NOLOGIN` restricted role) over the same `DATABASE_URL`. The public reports table and API become identity-free. The reputation pool serves exactly two reads — the self-vote check and the `VERIFIED`-transition accuracy credit.

**Tech Stack:** Rust (Cargo workspace at `services/`, `cargo test`/`cargo build`), `h3o` crate, PostgreSQL (numbered migrations under `infra/postgres/migrations/`, verified against compose Postgres), TypeScript/React PWA (`apps/pwa`, vitest + tsc).

**Spec:** `docs/superpowers/specs/2026-06-04-c2-location-privacy-design.md`.

**Conventions:**
- Commit messages: plain English, NO `Co-Authored-By` trailer.
- Gateway build/test: `cd services/gateway && cargo test` / `cargo build` (workspace at `services/`). DB-touching behavior is verified against compose Postgres.
- PWA: `cd apps/pwa && npx vitest run <files>` and `npx tsc --noEmit`.
- App DB role in dev/compose is `sentinel`.

**Scope note:** Community-report location privacy only. No social-graph (C-3) changes, no `safety_events` coordinate changes. H-4 (signature content-binding) is already implemented in `routes/reports.rs` and is left as-is.

---

### Task 1: Migration 012 — author table, role/RLS, coarse columns, drop identity

**Files:**
- Create: `infra/postgres/migrations/012_report_location_privacy.sql`

This follows the numbered-migration convention (see `011_nlp_trust.sql`). It is applied against the compose Postgres the same way. There is no `cargo`/`pytest` test for raw DDL; Steps 2–4 verify it against compose Postgres.

- [ ] **Step 1: Write the migration**

Create `infra/postgres/migrations/012_report_location_privacy.sql`:

```sql
-- infra/postgres/migrations/012_report_location_privacy.sql
-- C-2: community-report location privacy.
--   * report_authors: identity fields moved off the public community_reports row
--   * sentinel_reputation NOLOGIN role + grants + RLS so only a SET ROLE'd
--     connection can read author identities
--   * h3_r9 coarse cell column on community_reports (populated by the app/backfill)
--   * report_votes: voter coordinates replaced by a voter_was_nearby boolean
-- NOTE: existing community_reports rows keep their (still precise) lat/lng until
-- the gateway one-shot backfill snaps them; h3_r9 is therefore nullable here.

-- 1. Coarse cell column (nullable: legacy rows are backfilled by the gateway,
--    new rows always set it in create_report).
ALTER TABLE community_reports ADD COLUMN IF NOT EXISTS h3_r9 TEXT;

-- 2. Identity table. One row per report; holds every identity-linked field.
CREATE TABLE IF NOT EXISTS report_authors (
    report_id       UUID PRIMARY KEY REFERENCES community_reports(id) ON DELETE CASCADE,
    nostr_pubkey    TEXT NOT NULL,
    nostr_signature TEXT,
    nostr_event_id  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Backfill identity rows from existing community_reports, then drop the
--    identity columns + the pubkey index from the public table.
INSERT INTO report_authors (report_id, nostr_pubkey, nostr_signature, nostr_event_id)
SELECT id, nostr_pubkey, nostr_signature, nostr_event_id
  FROM community_reports
ON CONFLICT (report_id) DO NOTHING;

DROP INDEX IF EXISTS idx_reports_pubkey;
ALTER TABLE community_reports
    DROP COLUMN IF EXISTS nostr_pubkey,
    DROP COLUMN IF EXISTS nostr_signature,
    DROP COLUMN IF EXISTS nostr_event_id;

-- 4. Voter coordinates -> boolean.
ALTER TABLE report_votes ADD COLUMN IF NOT EXISTS voter_was_nearby BOOLEAN;
ALTER TABLE report_votes
    DROP COLUMN IF EXISTS voter_lat,
    DROP COLUMN IF EXISTS voter_lng;

-- 5. Restricted role + access control on report_authors.
--    NOLOGIN: a privilege bucket reached via SET ROLE, not a login identity.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sentinel_reputation') THEN
        CREATE ROLE sentinel_reputation NOLOGIN;
    END IF;
END$$;

REVOKE SELECT ON report_authors FROM PUBLIC;
REVOKE SELECT ON report_authors FROM sentinel;
GRANT  INSERT ON report_authors TO sentinel;          -- app role: write-only
GRANT  SELECT ON report_authors TO sentinel_reputation;
-- Let the app role assume the restricted role for the reputation pool, but do
-- NOT inherit its privileges implicitly (requires an explicit SET ROLE).
GRANT sentinel_reputation TO sentinel;
ALTER ROLE sentinel NOINHERIT;

ALTER TABLE report_authors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS report_authors_select ON report_authors;
CREATE POLICY report_authors_select ON report_authors
    FOR SELECT TO sentinel_reputation USING (true);
DROP POLICY IF EXISTS report_authors_insert ON report_authors;
CREATE POLICY report_authors_insert ON report_authors
    FOR INSERT TO sentinel WITH CHECK (true);
```

- [ ] **Step 2: Apply the migration to compose Postgres and verify schema**

Run (repo root, Docker required):
```bash
docker compose up -d postgres
cat infra/postgres/migrations/012_report_location_privacy.sql | docker compose exec -T postgres psql -U sentinel -d sentinelmesh
docker compose exec postgres psql -U sentinel -d sentinelmesh -c "\d community_reports" | grep -E "h3_r9|nostr_"
docker compose exec postgres psql -U sentinel -d sentinelmesh -c "\dt report_authors"
docker compose exec postgres psql -U sentinel -d sentinelmesh -c "\d report_votes" | grep -E "voter_"
```
Expected: `community_reports` has `h3_r9` and **no** `nostr_*` columns; `report_authors` exists; `report_votes` has `voter_was_nearby` and **no** `voter_lat/voter_lng`. The script prints `ALTER TABLE`/`CREATE TABLE`/`INSERT 0 N`/`CREATE ROLE`/`GRANT`/`CREATE POLICY` with no errors.

- [ ] **Step 3: Verify the access control with a non-superuser probe role**

The dev `sentinel` role is a superuser and bypasses GRANT/RLS, so prove the control with a throwaway non-superuser role. Run:
```bash
docker compose exec postgres psql -U sentinel -d sentinelmesh -v ON_ERROR_STOP=0 <<'SQL'
CREATE ROLE c2_probe NOSUPERUSER NOINHERIT;
GRANT sentinel_reputation TO c2_probe;
-- As the probe (no SET ROLE): SELECT must be denied.
SET ROLE c2_probe;
SELECT count(*) FROM report_authors;   -- expect: ERROR permission denied
RESET ROLE;
-- After SET ROLE to the restricted role: SELECT must succeed.
SET ROLE sentinel_reputation;
SELECT count(*) FROM report_authors;   -- expect: a count (0 on empty db)
RESET ROLE;
DROP ROLE c2_probe;
SQL
```
Expected: the first `SELECT` fails with `permission denied for table report_authors`; the second returns a count. (This proves REVOKE + non-inherited membership; the second proves the restricted role can read.)

- [ ] **Step 4: Commit**

```bash
git add infra/postgres/migrations/012_report_location_privacy.sql
git commit -m "C-2: migration 012 — report_authors table, restricted role/RLS, coarse cell, voter boolean"
```

---

### Task 2: H3 snapping helper

**Files:**
- Create: `services/gateway/src/reports/geo.rs`
- Modify: `services/gateway/src/reports/mod.rs` (add `pub mod geo;`)

A pure, unit-testable function that snaps a coordinate to its r9 cell hex string + centroid. Mirrors the existing `h3_cells` helper in `subscribers/event_subscriber.rs` but returns the centroid (reports store the centroid as their display coordinate).

- [ ] **Step 1: Write the failing test**

Create `services/gateway/src/reports/geo.rs` with the implementation and tests together (it is a tiny pure module):

```rust
//! Coordinate coarsening for community reports (C-2). Reports are stored at the
//! H3 resolution-9 (~100 m) cell centroid; exact device GPS is never persisted.

use h3o::{LatLng, Resolution};

/// Snap an exact coordinate to its r9 cell hex string and the cell centroid
/// (lat, lng). The centroid is what the report stores and the map renders.
pub fn snap_to_r9(lat: f64, lng: f64) -> (String, f64, f64) {
    let cell = LatLng::new(lat, lng)
        .expect("report lat/lng out of range")
        .to_cell(Resolution::Nine);
    let centroid = LatLng::from(cell);
    (cell.to_string(), centroid.lat(), centroid.lng())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snap_returns_nonempty_cell_and_centroid_near_input() {
        let (cell, lat, lng) = snap_to_r9(-1.286389, 36.817223);
        assert!(!cell.is_empty());
        // Centroid is within ~100 m of the input (well under 0.01 deg).
        assert!((lat - -1.286389).abs() < 0.01);
        assert!((lng - 36.817223).abs() < 0.01);
    }

    #[test]
    fn nearby_points_share_a_cell_far_points_do_not() {
        let (c_a, _, _) = snap_to_r9(-1.286389, 36.817223);
        let (c_b, _, _) = snap_to_r9(-1.286400, 36.817230); // ~2 m away
        let (c_far, _, _) = snap_to_r9(-1.300000, 36.900000); // several km away
        assert_eq!(c_a, c_b);
        assert_ne!(c_a, c_far);
    }

    #[test]
    fn snapping_is_idempotent_on_the_centroid() {
        let (c1, lat1, lng1) = snap_to_r9(-1.286389, 36.817223);
        let (c2, _, _) = snap_to_r9(lat1, lng1);
        assert_eq!(c1, c2);
    }
}
```

Add `pub mod geo;` to `services/gateway/src/reports/mod.rs` (alongside the existing `pub mod consensus;` / `pub mod service;` lines).

- [ ] **Step 2: Run the tests**

Run:
```bash
cd services/gateway && cargo test reports::geo 2>&1 | tail -20
```
Expected: PASS — `snap_returns_nonempty_cell_and_centroid_near_input`, `nearby_points_share_a_cell_far_points_do_not`, `snapping_is_idempotent_on_the_centroid`.

- [ ] **Step 3: Commit**

```bash
git add services/gateway/src/reports/geo.rs services/gateway/src/reports/mod.rs
git commit -m "C-2: add r9 coordinate snapping helper for community reports"
```

---

### Task 3: Reputation pool (second pool via SET ROLE) + wiring

**Files:**
- Modify: `services/gateway/src/db/mod.rs` (add `create_reputation_pool`)
- Modify: `services/gateway/src/main.rs` (`AppState.reputation_db` + construction + legacy backfill call)
- Modify: `services/gateway/src/middleware/internal_auth.rs`, `services/gateway/src/middleware/nostr_auth.rs` (test `AppState` constructors gain `reputation_db`)

- [ ] **Step 1: Add the reputation pool constructor**

In `services/gateway/src/db/mod.rs`, add below `create_pool`:

```rust
/// A pool whose every connection runs `SET ROLE sentinel_reputation`, so it
/// operates with the restricted role's privileges (the only role granted SELECT
/// on `report_authors`). Built over the SAME DATABASE_URL as the main pool — no
/// second credential. The main pool never SET ROLEs and therefore cannot read
/// report_authors when the app connects as a non-superuser (production posture).
pub async fn create_reputation_pool(database_url: &str) -> Result<PgPool> {
    use sqlx::Executor;
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .after_connect(|conn, _meta| {
            Box::pin(async move {
                conn.execute("SET ROLE sentinel_reputation").await?;
                Ok(())
            })
        })
        .connect(database_url)
        .await?;
    Ok(pool)
}
```

- [ ] **Step 2: Thread `reputation_db` through `AppState`**

In `services/gateway/src/main.rs`, add the field to `AppState`:

```rust
    pub db: sqlx::PgPool,
    pub reputation_db: sqlx::PgPool,
    pub config: Arc<config::Config>,
```

Construct it right after the main pool is created (find `let db = db::create_pool(...)`):

```rust
    let db = db::create_pool(&config.database_url, config.max_db_connections).await?;
    let reputation_db = db::create_reputation_pool(&config.database_url).await?;
```

Add it to the `AppState { ... }` initializer (next to `db: db.clone(),`):

```rust
        db: db.clone(),
        reputation_db: reputation_db.clone(),
```

- [ ] **Step 3: Backfill legacy report cells at startup**

Still in `main.rs`, add this function (e.g. below `shutdown_signal`) and call it once after `reputation_db` is built and before `axum::serve`:

```rust
/// One-shot: snap any pre-C-2 community_reports rows (h3_r9 IS NULL) to their r9
/// centroid, coarsening their stored lat/lng in place. Idempotent and a no-op on
/// a fresh database.
async fn backfill_report_cells(pool: &sqlx::PgPool) -> anyhow::Result<()> {
    let rows: Vec<(uuid::Uuid, f64, f64)> =
        sqlx::query_as("SELECT id, lat, lng FROM community_reports WHERE h3_r9 IS NULL")
            .fetch_all(pool)
            .await?;
    for (id, lat, lng) in rows {
        let (cell, clat, clng) = reports::geo::snap_to_r9(lat, lng);
        sqlx::query("UPDATE community_reports SET h3_r9 = $2, lat = $3, lng = $4 WHERE id = $1")
            .bind(id)
            .bind(&cell)
            .bind(clat)
            .bind(clng)
            .execute(pool)
            .await?;
    }
    Ok(())
}
```

Call site (after the pools exist, before the router is served):

```rust
    if let Err(e) = backfill_report_cells(&db).await {
        tracing::warn!("report cell backfill failed: {e:#}");
    }
```

Ensure `mod reports;` is already declared in `main.rs` (it is — `reports` is an existing module).

- [ ] **Step 4: Fix the test `AppState` constructors**

In `services/gateway/src/middleware/internal_auth.rs` and `services/gateway/src/middleware/nostr_auth.rs`, every test builds an `AppState`. Add `reputation_db` next to the existing `db:` field in each (there are multiple in `nostr_auth.rs`). Use the same pool value the test already builds for `db`:

```rust
            db: pool.clone(),
            reputation_db: pool.clone(),
```
(Match the exact local variable each constructor uses for `db` — it may be `pool`, `db`, or a `PgPool::connect_lazy(...)` expression; mirror it.)

- [ ] **Step 5: Build and run gateway tests**

Run:
```bash
cd services/gateway && cargo build 2>&1 | tail -20 && cargo test --lib 2>&1 | tail -15
```
Expected: compiles; existing tests pass (no behavior change yet — the new pool/backfill are wired but unused until Task 4).

- [ ] **Step 6: Commit**

```bash
git add services/gateway/src/db/mod.rs services/gateway/src/main.rs services/gateway/src/middleware/internal_auth.rs services/gateway/src/middleware/nostr_auth.rs
git commit -m "C-2: add reputation pool (SET ROLE) and legacy report-cell backfill"
```

---

### Task 4: Identity-free write path (`create_report` + `Report` struct + author lookup)

**Files:**
- Modify: `services/gateway/src/reports/service.rs` (`Report` struct, `create_report`, new `report_author`)

- [ ] **Step 1: Drop identity fields from `Report` and add the author lookup (write the failing test)**

In `services/gateway/src/reports/service.rs`, remove `nostr_pubkey`, `nostr_signature`, `nostr_event_id` from the `Report` struct (leave `CreateReportInput` unchanged — it still carries them to write `report_authors`). Then add the lookup function and a compile-guard test at the bottom of the file's `#[cfg(test)] mod tests` (create the module if absent):

```rust
/// Resolve a report's author pubkey via the reputation pool (the only pool that
/// can read report_authors). `None` if the report does not exist.
pub async fn report_author(reputation_pool: &PgPool, report_id: Uuid) -> Result<Option<String>> {
    let pk: Option<String> =
        sqlx::query_scalar("SELECT nostr_pubkey FROM report_authors WHERE report_id = $1")
            .bind(report_id)
            .fetch_optional(reputation_pool)
            .await?;
    Ok(pk)
}
```

```rust
#[cfg(test)]
mod tests {
    use super::*;

    // Compile-time guard: Report must not carry identity fields (C-2). If someone
    // re-adds one, constructing this literal fails to compile.
    #[test]
    fn report_struct_has_no_identity_fields() {
        let r = Report {
            id: Uuid::nil(),
            report_type: "FIRE".into(),
            description: None,
            lat: 0.0,
            lng: 0.0,
            place_name: None,
            reporter_tier: "NEWCOMER".into(),
            consensus_score: 0,
            confirmation_count: 0,
            denial_count: 0,
            status: "PENDING".into(),
            photo_ipfs_cid: None,
            linked_event_id: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        };
        assert_eq!(r.report_type, "FIRE");
    }
}
```

- [ ] **Step 2: Run the test — expect a compile failure first**

Run:
```bash
cd services/gateway && cargo test -p gateway reports::service 2>&1 | tail -25
```
Expected at this point: FAIL to compile, because `create_report` still binds the now-removed `Report` fields via `RETURNING *` mapping and references them. Step 3 fixes `create_report`.

- [ ] **Step 3: Rewrite `create_report` to snap coordinates and split identity out**

Replace the `create_report` function body. It keeps the `users` upsert + tier read, snaps the coordinates, inserts the public row (no identity, with `h3_r9`) using an explicit `RETURNING` column list, then inserts the identity row, all in one transaction:

```rust
pub async fn create_report(pool: &PgPool, input: CreateReportInput) -> Result<Report> {
    let mut tx = pool.begin().await?;

    sqlx::query(
        "INSERT INTO users (nostr_pubkey, total_reports, last_active, reputation_score, reputation_tier, accurate_reports)
         VALUES ($1, 1, NOW(), 0, 'NEWCOMER', 0)
         ON CONFLICT (nostr_pubkey) DO UPDATE
           SET total_reports = users.total_reports + 1, last_active = NOW()"
    )
    .bind(&input.nostr_pubkey)
    .execute(&mut *tx)
    .await?;

    let tier: String =
        sqlx::query_scalar("SELECT reputation_tier FROM users WHERE nostr_pubkey = $1")
            .bind(&input.nostr_pubkey)
            .fetch_one(&mut *tx)
            .await?;

    let initial_score = tier_score(&tier);

    // C-2: persist only the r9 centroid + cell, never the exact submitted GPS.
    let (h3_r9, lat, lng) = crate::reports::geo::snap_to_r9(input.lat, input.lng);

    let report = sqlx::query_as::<_, Report>(
        "INSERT INTO community_reports
           (report_type, description, lat, lng, h3_r9, place_name, reporter_tier,
            consensus_score, confirmation_count, denial_count, status, photo_ipfs_cid,
            linked_event_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,0,'PENDING',$9,$10)
         RETURNING id, report_type, description, lat, lng, place_name, reporter_tier,
                   consensus_score, confirmation_count, denial_count, status,
                   photo_ipfs_cid, linked_event_id, created_at, updated_at",
    )
    .bind(&input.report_type)
    .bind(&input.description)
    .bind(lat)
    .bind(lng)
    .bind(&h3_r9)
    .bind(&input.place_name)
    .bind(&tier)
    .bind(initial_score)
    .bind(&input.photo_ipfs_cid)
    .bind(input.linked_event_id)
    .fetch_one(&mut *tx)
    .await?;

    // C-2: identity fields live in the access-controlled author table, written
    // here via the app role's INSERT grant (it cannot read them back).
    sqlx::query(
        "INSERT INTO report_authors (report_id, nostr_pubkey, nostr_signature, nostr_event_id)
         VALUES ($1, $2, $3, $4)",
    )
    .bind(report.id)
    .bind(&input.nostr_pubkey)
    .bind(&input.nostr_signature)
    .bind(&input.nostr_event_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(report)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
cd services/gateway && cargo test -p gateway reports::service 2>&1 | tail -25
```
Expected: PASS (compiles; `report_struct_has_no_identity_fields` passes). `cast_vote`/`list_reports` still reference the removed fields and/or `SELECT *` — they are fixed in Tasks 5–6, so if the crate as a whole does not yet compile, that is expected; this step only requires the `service.rs` changes shown to be internally consistent. If `cast_vote` blocks compilation, proceed to Task 5 before re-running the full build.

- [ ] **Step 5: Commit**

```bash
git add services/gateway/src/reports/service.rs
git commit -m "C-2: write report identity to report_authors, store r9 centroid, drop identity from Report"
```

---

### Task 5: Voter boolean + author-gated vote path

**Files:**
- Modify: `services/gateway/src/reports/service.rs` (`cast_vote`)
- Modify: `services/gateway/src/routes/reports.rs` (`vote` handler)

- [ ] **Step 1: Rewrite `cast_vote` to drop the self-vote check and store the boolean**

In `services/gateway/src/reports/service.rs`, change `cast_vote` so it (a) no longer reads `report.nostr_pubkey` (the self-vote check moves to the handler, which has the reputation pool), and (b) inserts `voter_was_nearby` instead of `voter_lat/voter_lng`. Replace the function with:

```rust
/// Returns (updated_report, old_score, established_confirmations). The caller must
/// have already rejected self-votes (the author pubkey lives in report_authors,
/// reachable only via the reputation pool).
pub async fn cast_vote(
    pool: &PgPool,
    report_id: Uuid,
    input: CastVoteInput,
) -> Result<(Report, i32, i32)> {
    let mut tx = pool.begin().await?;

    let report = sqlx::query_as::<_, Report>(
        "SELECT id, report_type, description, lat, lng, place_name, reporter_tier,
                consensus_score, confirmation_count, denial_count, status,
                photo_ipfs_cid, linked_event_id, created_at, updated_at
           FROM community_reports WHERE id = $1 FOR UPDATE",
    )
    .bind(report_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| anyhow::anyhow!("report not found"))?;

    let old_score = report.consensus_score;

    sqlx::query(
        "INSERT INTO users (nostr_pubkey, last_active)
         VALUES ($1, NOW())
         ON CONFLICT (nostr_pubkey) DO UPDATE SET last_active = NOW()",
    )
    .bind(&input.voter_pubkey)
    .execute(&mut *tx)
    .await?;

    let voter_tier: String =
        sqlx::query_scalar("SELECT reputation_tier FROM users WHERE nostr_pubkey = $1")
            .bind(&input.voter_pubkey)
            .fetch_one(&mut *tx)
            .await?;

    let weight = vote_weight(&voter_tier);

    // Proximity is a WEAK signal: a flat +1 for established voters near the report.
    // The voter's coordinates are used transiently here and never stored — only
    // the resulting boolean is persisted (C-2).
    let nearby = match (input.voter_lat, input.voter_lng) {
        (Some(vlat), Some(vlng)) => {
            let dist: f64 =
                sqlx::query_scalar("SELECT earth_distance(ll_to_earth($1,$2), ll_to_earth($3,$4))")
                    .bind(vlat)
                    .bind(vlng)
                    .bind(report.lat)
                    .bind(report.lng)
                    .fetch_one(&mut *tx)
                    .await?;
            dist <= 1000.0
        }
        _ => false,
    };
    let proximity_bonus = if nearby && voter_tier != "NEWCOMER" { 1 } else { 0 };
    let magnitude = weight + proximity_bonus;

    let (score_delta, conf_delta, deny_delta) = match input.vote.as_str() {
        "CONFIRM" => (magnitude, 1i32, 0i32),
        "DENY" => (-magnitude, 0i32, 1i32),
        _ => anyhow::bail!("vote must be CONFIRM or DENY"),
    };

    sqlx::query(
        "INSERT INTO report_votes (report_id, voter_pubkey, vote, voter_was_nearby)
         VALUES ($1, $2, $3, $4)",
    )
    .bind(report_id)
    .bind(&input.voter_pubkey)
    .bind(&input.vote)
    .bind(nearby)
    .execute(&mut *tx)
    .await?;

    let updated = sqlx::query_as::<_, Report>(
        "UPDATE community_reports
         SET consensus_score    = consensus_score + $2,
             confirmation_count = confirmation_count + $3,
             denial_count       = denial_count + $4,
             updated_at         = NOW()
         WHERE id = $1
         RETURNING id, report_type, description, lat, lng, place_name, reporter_tier,
                   consensus_score, confirmation_count, denial_count, status,
                   photo_ipfs_cid, linked_event_id, created_at, updated_at",
    )
    .bind(report_id)
    .bind(score_delta)
    .bind(conf_delta)
    .bind(deny_delta)
    .fetch_one(&mut *tx)
    .await?;

    let established_confirmations: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT rv.voter_pubkey)
         FROM report_votes rv
         JOIN users u ON u.nostr_pubkey = rv.voter_pubkey
         WHERE rv.report_id = $1 AND rv.vote = 'CONFIRM' AND u.reputation_tier <> 'NEWCOMER'",
    )
    .bind(report_id)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok((updated, old_score, established_confirmations as i32))
}
```
(`list_reports` is updated in Task 6 — its `SELECT *` keeps working against the now-identity-free table, but Task 6 makes it an explicit column list for safety.)

- [ ] **Step 2: Update the `vote` handler to resolve the author and gate self-votes**

In `services/gateway/src/routes/reports.rs`, in the `vote` handler, **before** calling `cast_vote`, resolve the author via the reputation pool and reject self-votes; **after**, pass the resolved author to `apply_status_transition`. Replace the block from the `let (updated, old_score, established_confirmations) = cast_vote(` call through the `apply_status_transition(...)` call with:

```rust
    // C-2: the report author lives in report_authors, readable only via the
    // reputation pool. Resolve it once: it gates self-votes and credits accuracy.
    let author = crate::reports::service::report_author(&state.reputation_db, report_id)
        .await
        .map_err(AppError::Internal)?
        .ok_or(AppError::NotFound)?;
    if author == body.voter_pubkey {
        return Err(AppError::BadRequest("cannot vote on your own report".into()));
    }

    let (updated, old_score, established_confirmations) = cast_vote(
        &state.db,
        report_id,
        CastVoteInput {
            voter_pubkey: body.voter_pubkey,
            vote: body.vote,
            voter_lat: body.voter_lat,
            voter_lng: body.voter_lng,
        },
    )
    .await
    .map_err(|e| {
        let msg = e.to_string();
        if msg.contains("unique") || msg.contains("duplicate") {
            AppError::BadRequest("already voted on this report".into())
        } else if msg.contains("not found") {
            AppError::NotFound
        } else {
            AppError::Internal(e)
        }
    })?;

    if let Some(new_status) = compute_new_status(
        &updated.status,
        updated.consensus_score,
        updated.confirmation_count,
        updated.denial_count,
        established_confirmations,
        state.config.consensus_require_established,
    ) {
        apply_status_transition(&state.db, report_id, &new_status, &author).await?;
```
(Leave the `anchoring_enabled` block and everything after it unchanged. Note `body.voter_pubkey` is moved into `CastVoteInput`, so the self-vote comparison above must run before that move — it does.)

- [ ] **Step 3: Build and run the gateway tests**

Run:
```bash
cd services/gateway && cargo build 2>&1 | tail -25 && cargo test --lib reports 2>&1 | tail -20
```
Expected: the crate compiles; `reports::*` unit tests pass (consensus tests, the `Report` guard, geo tests, and the existing `routes::reports` binding/rate-limiter tests). DB-backed behavior is verified in Step 4.

- [ ] **Step 4: Integration smoke check against compose Postgres + Redis**

Verifies the end-to-end DB behavior unit tests cannot (rebuild the gateway image to pick up the new binary). Run:
```bash
docker compose up -d --build gateway-rs postgres redis
# Submit a report through the public API, then inspect storage:
docker compose exec postgres psql -U sentinel -d sentinelmesh -c \
  "SELECT h3_r9 IS NOT NULL AS has_cell, round(lat::numeric,7) AS lat FROM community_reports ORDER BY created_at DESC LIMIT 1;"
docker compose exec postgres psql -U sentinel -d sentinelmesh -c \
  "SELECT count(*) FROM information_schema.columns WHERE table_name='community_reports' AND column_name LIKE 'nostr_%';"
docker compose exec postgres psql -U sentinel -d sentinelmesh -c \
  "SELECT count(*) FROM information_schema.columns WHERE table_name='report_votes' AND column_name LIKE 'voter_l%';"
```
Expected: the latest report has `has_cell = t` and a centroid-quantized `lat`; the `community_reports` `nostr_%` column count is `0`; the `report_votes` `voter_l%` count is `0`. (If the gateway image cannot be rebuilt here, record that and rely on Step 3 + the compose schema checks in Task 1; the smoke check runs in CI.)

- [ ] **Step 5: Commit**

```bash
git add services/gateway/src/reports/service.rs services/gateway/src/routes/reports.rs
git commit -m "C-2: store voter_was_nearby, gate self-votes via reputation pool, drop voter coords"
```

---

### Task 6: Identity-free read path + shared types + PWA

**Files:**
- Modify: `services/gateway/src/reports/service.rs` (`list_reports` explicit column list)
- Modify: `shared/types/index.d.ts` (`CommunityReport`)
- Modify: `apps/pwa/src/components/ReportList.tsx`

- [ ] **Step 1: Make `list_reports` select explicit non-identity columns**

In `services/gateway/src/reports/service.rs`, change the `list_reports` query from `SELECT * FROM community_reports` to an explicit list (so a future re-added identity column cannot leak through `*`):

```rust
    let reports = sqlx::query_as::<_, Report>(
        "SELECT id, report_type, description, lat, lng, place_name, reporter_tier,
                consensus_score, confirmation_count, denial_count, status,
                photo_ipfs_cid, linked_event_id, created_at, updated_at
         FROM community_reports
         WHERE ($1::float8 IS NULL OR
                earth_distance(ll_to_earth($1,$2), ll_to_earth(lat,lng)) <= $3)
           AND ($4::text IS NULL OR status = $4)
           AND ($5::text IS NULL OR reporter_tier = $5)
           AND ($6::uuid IS NULL OR linked_event_id = $6)
         ORDER BY created_at DESC
         LIMIT $7",
    )
```
(Bindings below are unchanged.)

- [ ] **Step 2: Drop identity fields from the shared `CommunityReport` type**

In `shared/types/index.d.ts`, remove `nostr_pubkey`, `nostr_signature`, and `nostr_event_id` from the `CommunityReport` interface. Leave `nostr_event_id`'s consumers to Step 3. (Keep all other fields, including `linked_event_id` and `photo_ipfs_cid`.)

- [ ] **Step 3: Stop the PWA from reading the removed report field**

In `apps/pwa/src/components/ReportList.tsx`, the `VerificationBadges` usage passes `nostrEventId={report.nostr_event_id}` (around line 104). The public report no longer carries it; pass `null`:

```tsx
          <VerificationBadges
            nostrEventId={null}
            bitcoinTxid={null}
          />
```

- [ ] **Step 4: Typecheck + run the affected PWA tests**

Run:
```bash
cd apps/pwa && npx tsc --noEmit 2>&1 | head -30
```
Expected: exit 0 (no type errors). If `tsc` reports any other file reading `report.nostr_pubkey`/`nostr_signature`/`nostr_event_id`, fix each the same way (the value is no longer available on a `CommunityReport`); re-run until clean. Then:
```bash
cd apps/pwa && npx vitest run src/components/ReportList.test.tsx 2>&1 | tail -15
```
Expected: PASS. If the test asserted on a now-removed field, update the fixture/assertion to match the identity-free shape.

- [ ] **Step 5: Run the full gateway test suite to confirm nothing regressed**

Run:
```bash
cd services/gateway && cargo test 2>&1 | tail -15
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add services/gateway/src/reports/service.rs shared/types/index.d.ts apps/pwa/src/components/ReportList.tsx
git commit -m "C-2: identity-free report read path, shared type, and PWA"
```

---

### Task 7: Final verification — clippy, fmt, full suites

**Files:** none (verification only)

- [ ] **Step 1: Format and lint the gateway exactly as CI does**

Run:
```bash
cd services/gateway && cargo fmt --all && cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings 2>&1 | grep -E "^error|^warning" ; echo "done"
```
Expected: `fmt --check` clean (no diff); clippy prints no `error`/`warning` lines. If `fmt` changed files, include them in the commit below; if clippy flags a lint, fix it (or add a justified `#[allow(...)]` matching existing patterns).

- [ ] **Step 2: Full gateway + PWA suites**

Run:
```bash
cd services/gateway && cargo test 2>&1 | tail -8
cd ../../apps/pwa && npx vitest run 2>&1 | tail -8 && npx tsc --noEmit; echo "tsc exit: $?"
```
Expected: gateway tests all pass; PWA tests all pass; `tsc` exit 0.

- [ ] **Step 3: Commit any fmt/lint fixups and push**

```bash
git add -A
git commit -m "C-2: fmt/lint fixups" || echo "nothing to commit"
git push -u origin feat/c2-location-privacy
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --base main --head feat/c2-location-privacy \
  --title "C-2: community report location privacy (coarse coords + author separation)" \
  --body "Implements docs/superpowers/specs/2026-06-04-c2-location-privacy-design.md. Coarsens community report coordinates to H3 r9 (~100 m) centroids, moves identity (nostr_pubkey/signature/event_id) into an access-controlled report_authors table read only via a SET ROLE reputation pool, and replaces stored voter coordinates with a voter_was_nearby boolean."
```

---

## Self-Review

- **Spec coverage:**
  - Goal 1 (r9 coarsening) — Task 2 (`snap_to_r9`), Task 4 (`create_report` snaps), Task 3 (legacy backfill). ✓
  - Goal 2 (identity-free public table) — Task 1 (`report_authors` + drop columns), Task 4 (Report struct loses identity, author written separately), Task 6 (explicit read columns + shared type). ✓
  - Goal 3 (DB-level separation) — Task 1 (NOLOGIN role, REVOKE/GRANT, RLS, NOINHERIT), Task 3 (`SET ROLE` reputation pool), Task 1 Step 3 (non-superuser probe test). ✓
  - Goal 4 (voter coords → boolean) — Task 1 (column swap), Task 5 (`cast_vote` stores `voter_was_nearby`). ✓
  - Goal 5 (behaviour preserved) — geo query unchanged on centroids (Task 6), flat +1 proximity nudge preserved (Task 5, `dist <= 1000.0`, non-NEWCOMER), reputation/accuracy via reputation pool (Task 5 `report_author` + `apply_status_transition`). ✓
- **Placeholder scan:** none — every code step contains full SQL/Rust/TS; commands have expected output. The `reputation_db` test-constructor mirroring (Task 3 Step 4) is described concretely (mirror the existing `db:` value) because the exact local differs per constructor.
- **Type consistency:** `snap_to_r9(f64,f64) -> (String,f64,f64)` is defined in Task 2 and called identically in Task 3 (backfill) and Task 4 (`create_report`). `report_author(&PgPool, Uuid) -> Result<Option<String>>` defined in Task 4, called in Task 5. The `Report` `RETURNING`/`SELECT` column lists are byte-identical across `create_report` (Task 4), `cast_vote` ×2 (Task 5), and `list_reports` (Task 6), and match the struct after the three identity fields are removed. `report_votes` INSERT uses `voter_was_nearby` (Task 5) matching the column added in Task 1.
- **Known follow-ups (out of scope, documented in spec):** C-3 social graph; `safety_events` coordinates; production must run the gateway as a non-superuser role for the access control to bite (dev `sentinel` is a superuser — proven instead by the Task 1 Step 3 probe).
```
