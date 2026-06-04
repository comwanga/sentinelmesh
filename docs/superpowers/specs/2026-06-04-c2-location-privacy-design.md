# C-2 — Community Report Location Privacy (Design)

Date: 2026-06-04
Audit ref: C-2 ("'The server never stores readable location data' is FALSE"), FINAL-audit-report.md
Branch goal: close the **community-report** half of C-2 only. No social-graph (C-3) changes, no
`safety_events` coordinate changes, no signature content-binding (H-4). Forward-compatible with a
later C-3 spec and a unified privacy-tier model.

## Problem

`community_reports` stores `lat`/`lng` as plaintext `DECIMAL(10,7)` (~1 cm precision) alongside a
persistent `nostr_pubkey`, with `idx_reports_pubkey` indexing exactly that pair. `report_votes`
stores each voter's exact `voter_lat`/`voter_lng` next to `voter_pubkey`. Both the server operator
and anyone who breaches the DB or reads the public reports API therefore obtain a **timestamped,
precise, identity-linked movement trail** per reporter and per voter. This directly contradicts the
README privacy claim and is the core of audit finding C-2.

The public map does not need exact coordinates or author identity to function; the reputation
system needs author attribution, but only at write time and on the `VERIFIED` transition — never in
the public read path.

## Goals

1. Reduce stored community-report coordinates to **H3 resolution-9 (~100 m) centroids** — exact
   device GPS is never persisted.
2. Make the public `community_reports` table **identity-free**: move `nostr_pubkey`,
   `nostr_signature`, and `nostr_event_id` into a separately access-controlled `report_authors`
   table so the public table cannot be grouped by identity.
3. Enforce the identity separation at the **database level**: a restricted `sentinel_reputation`
   role is the only role that can `SELECT report_authors`; the main app role gets `INSERT`-only.
4. Stop storing voter coordinates: compute the proximity nudge from transient request coordinates
   and persist only a `voter_was_nearby` boolean.
5. Preserve current behaviour: the map still shows reports (at ~100 m), the geographic-distance
   query still works, the flat +1 proximity nudge still applies, and reputation/accuracy crediting
   still works.

## Non-goals (explicitly deferred)

- **C-3 social graph** (`circles`, `circle_members`, `location_blobs` recipient hash) — separate
  spec/cycle.
- **`safety_events.lat/lng`** — these are aggregated public safety events with no reporter pubkey
  attached; they are public by design and out of scope here.
- **H-4** signature content-binding and per-report replay guard — separate finding.
- No change to the consensus thresholds or the reputation tier math.

## Approach (chosen)

App-layer H3 snapping + a two-pool database role split. Coordinate snapping happens in the Rust
gateway at submit time using the `h3o` crate (already a dependency; the same crate the acoustic and
NLP paths use). There is no H3 Postgres extension installed, so DB-side snapping was rejected — it
would require adding `pg_h3` to the stack for no benefit when `h3o` is already in the write path.
The "never persist precise coordinates" invariant is therefore enforced in code and guarded by a
test, while the identity-separation invariant is enforced by Postgres grants + RLS.

## Part A — Data model

### `community_reports` (modify)
- **Drop** `nostr_pubkey`, `nostr_signature`, `nostr_event_id`.
- **Add** `h3_r9 TEXT NOT NULL` — the resolution-9 cell of the report.
- `lat`/`lng` are repurposed to the **r9 cell centroid** (kept so the existing
  `earth_distance(ll_to_earth(lat,lng))` geo filter and the map markers keep working without a new
  query path). They are no longer exact.
- `place_name` is unchanged (already coarse, human-entered).

### `report_authors` (new)
```
report_id       UUID PRIMARY KEY REFERENCES community_reports(id) ON DELETE CASCADE
nostr_pubkey    TEXT NOT NULL
nostr_signature TEXT
nostr_event_id  TEXT
created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
```
One row per report. Holds every identity-linked field. `nostr_event_id` lives here (not on the
public report) because it dereferences via Nostr relays back to the author pubkey — leaving it on
the public report would re-leak authorship.

### `report_votes` (modify)
- **Drop** `voter_lat`, `voter_lng`.
- **Add** `voter_was_nearby BOOLEAN` (nullable; `NULL` = the voter sent no coordinates).
- `voter_pubkey` is unchanged — it is the vote identity backing the `UNIQUE(report_id,
  voter_pubkey)` one-vote-per-key constraint and the reputation-weighting join, not a location
  field.

## Part B — Access control (database role split)

The migration provisions a restricted role and grants:

- `CREATE ROLE sentinel_reputation LOGIN` with **no password set in the migration** (no secrets in
  tracked SQL). The deploy sets the password out-of-band (`ALTER ROLE ... PASSWORD` / managed
  secret), exactly as the app role's credential is provisioned today.
- On `report_authors`: `GRANT INSERT` to the app role; **no** `SELECT`/`UPDATE`/`DELETE` to the app
  role. `GRANT SELECT` to `sentinel_reputation`.
- `ALTER TABLE report_authors ENABLE ROW LEVEL SECURITY` with a policy that admits
  `sentinel_reputation` for `SELECT` (defense-in-depth on top of the table grant). The app role's
  `INSERT` is covered by an `INSERT` policy / `WITH CHECK (true)`.

Rationale: an SQL-injection, an accidental join, or a leaked app-role connection in any public read
path structurally cannot read author identities — only the dedicated reputation pool can. A
full-DB-superuser breach is still out of reach of any application control and is acknowledged, not
solved, here.

### Gateway connection wiring
- New env var `REPUTATION_DATABASE_URL` (the `sentinel_reputation` DSN). Required in production;
  in non-production it may fall back to the main `DATABASE_URL` with a `warn!` (so local/dev still
  works without provisioning a second role) — mirroring the existing fail-closed/​dev-fallback
  pattern in `config.rs`.
- `AppState` gains a second `sqlx::PgPool` (`reputation_db`) built from that DSN, with a small
  connection cap (it serves one low-frequency path).
- Exactly one code path uses `reputation_db`: resolving a report's author pubkey on the `VERIFIED`
  transition (Part E). The submit-time `report_authors` INSERT uses the **main** pool (INSERT-only
  grant).

## Part C — Write path (submit report)

In the report-submit handler/service:
1. Validate coordinates are in range (unchanged).
2. Snap to H3: `let cell = LatLng::new(lat, lng)?.to_cell(Resolution::Nine); let centroid =
   LatLng::from(cell);` → store `h3_r9 = cell.to_string()`, `lat = centroid.lat()`, `lng =
   centroid.lng()`. The exact submitted coordinates are never written.
3. In one transaction: `INSERT INTO community_reports (...) RETURNING id`, then `INSERT INTO
   report_authors (report_id, nostr_pubkey, nostr_signature, nostr_event_id) VALUES (...)`.

Signature verification still happens against the submitted Nostr event before the insert (unchanged
path); only the *storage* of the identity fields moves.

## Part D — Read path

- The `Report` `sqlx::FromRow` struct drops `nostr_pubkey`, `nostr_signature`, `nostr_event_id`.
  `list_reports` and the single-report read change `SELECT *` to an explicit non-identity column
  list (so a future re-add of an identity column to the table cannot silently leak through `*`).
- The geo-distance query is unchanged (operates on the centroid `lat/lng`).
- `shared/types` `CommunityReport` drops the three identity fields; the PWA stops reading/displaying
  them. Any UI that showed a reporter pubkey/signature is updated to omit it.

## Part E — Voter proximity

In the vote handler:
- Read the report's centroid (`lat/lng` from `community_reports`).
- `voter_was_nearby = match (req.voter_lat, req.voter_lng) { (Some(a), Some(o)) =>
  Some(distance_m((a,o), centroid) <= PROXIMITY_RADIUS_M), _ => None }`.
- Apply the existing flat +1 to the consensus score when `voter_was_nearby == Some(true)`
  (unchanged magnitude/semantics).
- `INSERT INTO report_votes (..., voter_was_nearby)` — the request coordinates are dropped after the
  boolean is computed.

`PROXIMITY_RADIUS_M` is the existing threshold used by the current nudge (preserve its value).

## Part F — Reputation / accuracy

- `apply_status_transition` no longer takes `reporter_pubkey` from the public report row. On the
  `VERIFIED` transition it fetches the author via the reputation pool:
  `SELECT nostr_pubkey FROM report_authors WHERE report_id = $1` (using `reputation_db`), then
  credits the `users` row exactly as today.
- All other reputation inputs (voter reputation weighting, `established_confirmations`) already key
  on `report_votes.voter_pubkey` + `users` and are unaffected.

## Part G — Existing data migration (one-time, destructive)

Because Postgres has no H3 function, the migration cannot compute `h3_r9`/centroids itself. The
sequence (ordered in the implementation plan) is:

1. Migration: create `report_authors`, the role, grants, RLS, and the new columns
   (`community_reports.h3_r9` added **nullable** initially; `report_votes.voter_was_nearby`).
2. Migration: backfill `report_authors` from existing
   `community_reports.{nostr_pubkey,nostr_signature,nostr_event_id}`.
3. Gateway one-shot backfill step: for each existing report, compute `h3_r9` + centroid with `h3o`
   and `UPDATE` the row (coarsening existing `lat/lng` **in place, irreversibly** — that is the
   privacy fix, not a regression).
4. Migration (after backfill): set `community_reports.h3_r9 NOT NULL`, drop
   `nostr_pubkey`/`nostr_signature`/`nostr_event_id` and `idx_reports_pubkey`, drop
   `report_votes.voter_lat`/`voter_lng`.

For an empty dev database the backfill step is a no-op and the migration can run end-to-end. The
implementation plan will state how steps 3↔4 are sequenced (e.g. a guarded `h3_r9 IS NULL` check)
so a fresh deploy and a populated deploy both converge.

## Part H — Testing

- **Unit (Rust):** the r9 snapping helper (exact coordinate in → cell centroid out; same cell for
  two nearby points; distinct cells for far points). The vote handler computes `voter_was_nearby`
  and binds no coordinate columns.
- **Invariant (Rust):** no public route/DTO serializes `nostr_pubkey`/`nostr_signature`/
  `nostr_event_id` for a report; the `Report` struct has no identity fields (compile-time) and the
  read query column list excludes them.
- **Access (integration, compose Postgres):** the main app role gets a permission error on
  `SELECT FROM report_authors`; `sentinel_reputation` succeeds; the app role can `INSERT`.
- **Migration (compose Postgres):** after migrate + backfill, `community_reports` has `h3_r9` and no
  identity columns, `report_authors` is populated 1:1, `report_votes` has `voter_was_nearby` and no
  `voter_lat/lng`, and existing report coordinates equal their r9 centroids.
- **PWA (vitest/tsc):** `CommunityReport` type compiles without the identity fields; report
  list/detail render without them.

## Rollout / compatibility

- The role split adds `REPUTATION_DATABASE_URL`; production must provision the `sentinel_reputation`
  role, dev falls back to `DATABASE_URL` with a warning.
- The public API response shape for community reports **changes** (identity fields removed) — a
  deliberate, breaking privacy fix. The PWA is updated in the same change.
- Coordinate coarsening of existing rows is irreversible by design.
- Forward-compatible seams for the later C-3 / unified privacy work: the `report_authors`
  access-tier pattern (restricted role + RLS) is the template C-3 membership tokenization can reuse,
  and the second `reputation_db` pool is the place a broader "identity-tier" query path can grow.
