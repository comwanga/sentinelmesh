# H-5 Phase 2A — NLP Trust Plumbing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the schema, staging table, and event-payload/ingest fields the NLP trust ladder needs — without yet changing how events are promoted or surfaced (behavior-preserving).

**Architecture:** A new SQL migration adds `trust_state`/`origin_class`/`distinct_source_count`/`distinct_channel_count` to `safety_events` (with a monotonic trust-state trigger and a legacy-confirmed backfill) and creates the `nlp_signals` staging table. The Redis event payload (`RedisEventPayload`) and both copies of `event_schema.json` gain optional `source_id` + `origin_channel`. The Python signal service populates those fields per channel (RSS feed domain / Twitter author / radio job). The Rust `event_subscriber` keeps writing `safety_events` as `confirmed` for now — Phase 2B flips it to the HEURISTIC ladder.

**Tech Stack:** PostgreSQL (numbered migrations under `infra/postgres/migrations/`), Rust (Cargo workspace at `services/`, `schemars`-derived schema, `cargo test`), Python 3 (`services/signal`, `pytest`).

**Spec:** `docs/superpowers/specs/2026-06-04-h5-nlp-guardrails-design.md` (Part B schema + ingest).

**Conventions:**
- Commit messages: plain English, NO `Co-Authored-By` trailer.
- Gateway tests: `cd services/gateway && cargo test` (DB-free unit tests). SQL is verified against the docker-compose Postgres.
- Signal tests: `cd services/signal && python -m pytest tests/ -v`.

---

### Task 1: Migration 011 — trust columns, monotonicity trigger, legacy backfill, `nlp_signals`

**Files:**
- Create: `infra/postgres/migrations/011_nlp_trust.sql`

This follows the existing numbered-migration convention (see `007_acoustic_signals.sql`, `008_synthesis.sql`). It is applied against Postgres the same way those were. Verification below applies it to the docker-compose Postgres and inspects the result — there is no `cargo`/`pytest` test for raw DDL.

- [ ] **Step 1: Write the migration**

Create `infra/postgres/migrations/011_nlp_trust.sql`:

```sql
-- infra/postgres/migrations/011_nlp_trust.sql
-- H-5: NLP trust ladder plumbing.
--   * trust_state + origin_class + independence metrics on safety_events
--   * monotonic trust-state trigger (no downgrades)
--   * legacy-confirmed backfill of pre-H-5 rows
--   * nlp_signals staging table feeding the NLP synthesis worker (Phase 2B)

-- 1. Trust columns on safety_events. Existing rows take the column defaults first
--    (trust_state='heuristic'); step 2 then promotes them to legacy-confirmed.
ALTER TABLE safety_events
    ADD COLUMN IF NOT EXISTS trust_state TEXT NOT NULL DEFAULT 'heuristic'
        CHECK (trust_state IN ('heuristic', 'corroborating', 'confirmed')),
    ADD COLUMN IF NOT EXISTS origin_class TEXT NOT NULL DEFAULT 'machine'
        CHECK (origin_class IN ('machine', 'human')),
    ADD COLUMN IF NOT EXISTS distinct_source_count INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS distinct_channel_count INT NOT NULL DEFAULT 1;

-- 2. Legacy-confirmed backfill. Every row that exists at migration time was
--    auto-promoted under the old single-source logic. Keep it visible/trusted
--    (no retroactive demotion) but tag it so analytics and the future trust
--    engine can tell it apart from genuinely corroborated CONFIRMED events.
UPDATE safety_events
   SET trust_state = 'confirmed',
       source_breakdown = jsonb_set(
           COALESCE(source_breakdown, '{}'::jsonb),
           '{provenance}', '"legacy_confirmed"'::jsonb, true);

-- 3. Trust-state monotonicity: heuristic(0) -> corroborating(1) -> confirmed(2),
--    never backwards. Mirrors the acoustic_signals monotonicity trigger (008).
CREATE OR REPLACE FUNCTION enforce_safety_event_trust_monotonicity()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    rank_old INT := CASE OLD.trust_state
        WHEN 'heuristic' THEN 0 WHEN 'corroborating' THEN 1 WHEN 'confirmed' THEN 2 END;
    rank_new INT := CASE NEW.trust_state
        WHEN 'heuristic' THEN 0 WHEN 'corroborating' THEN 1 WHEN 'confirmed' THEN 2 END;
BEGIN
    IF rank_new < rank_old THEN
        RAISE EXCEPTION
            'safety_events: trust_state cannot downgrade from % to % (id=%)',
            OLD.trust_state, NEW.trust_state, OLD.id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_safety_event_trust_monotonicity
    BEFORE UPDATE OF trust_state ON safety_events
    FOR EACH ROW
    WHEN (OLD.trust_state IS DISTINCT FROM NEW.trust_state)
    EXECUTE FUNCTION enforce_safety_event_trust_monotonicity();

-- 4. nlp_signals staging table. One row per ingested NLP detection. The synthesis
--    worker (Phase 2B) groups these by (h3_r9, event_type) to count distinct
--    provenance clusters (source_id) and channels (origin_channel).
CREATE TABLE IF NOT EXISTS nlp_signals (
    id              UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        UUID             REFERENCES safety_events(id),
    source_type     TEXT             NOT NULL,
    source_id       TEXT,
    origin_channel  TEXT             NOT NULL,
    event_type      TEXT             NOT NULL,
    severity        TEXT             NOT NULL,
    title           TEXT,
    summary         TEXT,
    lat             DOUBLE PRECISION NOT NULL,
    lng             DOUBLE PRECISION NOT NULL,
    h3_r9           TEXT,
    h3_r7           TEXT             NOT NULL,
    county          TEXT,
    place_name      TEXT,
    confidence      REAL             NOT NULL,
    received_at     TIMESTAMPTZ      NOT NULL DEFAULT now(),
    trust_state     TEXT             NOT NULL DEFAULT 'pending'
                    CHECK (trust_state IN ('pending', 'corroborating', 'confirmed', 'expired'))
);

-- Synthesis worker lookup: active signals by cell + type within a time window.
CREATE INDEX IF NOT EXISTS nlp_signals_cluster_idx
    ON nlp_signals (h3_r9, event_type, received_at)
    WHERE trust_state IN ('pending', 'corroborating');

-- Join back to the surfaced event.
CREATE INDEX IF NOT EXISTS nlp_signals_event_idx ON nlp_signals (event_id);
```

- [ ] **Step 2: Apply the migration to the compose Postgres and verify it**

Run (from repo root, Docker required):
```bash
docker compose up -d postgres
cat infra/postgres/migrations/011_nlp_trust.sql | docker compose exec -T postgres psql -U sentinel -d sentinelmesh
docker compose exec postgres psql -U sentinel -d sentinelmesh -c "\d safety_events" | grep -E "trust_state|origin_class|distinct_source_count|distinct_channel_count"
docker compose exec postgres psql -U sentinel -d sentinelmesh -c "\dt nlp_signals"
```
Expected: the four new columns are listed on `safety_events`; `nlp_signals` appears in the table list. The migration prints `ALTER TABLE`, `UPDATE n`, `CREATE FUNCTION`, `CREATE TRIGGER`, `CREATE TABLE`, `CREATE INDEX` with no errors. (If the DB has no pre-existing rows, `UPDATE 0` is fine.)

- [ ] **Step 3: Verify the monotonicity trigger rejects a downgrade**

Run:
```bash
docker compose exec postgres psql -U sentinel -d sentinelmesh -c "INSERT INTO safety_events (event_type, severity, title, lat, lng, started_at, trust_state) VALUES ('FIRE','HIGH','trigger test',-1.29,36.82,NOW(),'confirmed') RETURNING id;" 
docker compose exec postgres psql -U sentinel -d sentinelmesh -c "UPDATE safety_events SET trust_state='heuristic' WHERE title='trigger test';"
```
Expected: the INSERT succeeds; the UPDATE fails with `ERROR: safety_events: trust_state cannot downgrade from confirmed to heuristic`. Clean up:
```bash
docker compose exec postgres psql -U sentinel -d sentinelmesh -c "DELETE FROM safety_events WHERE title='trigger test';"
```

- [ ] **Step 4: Commit**

```bash
git add infra/postgres/migrations/011_nlp_trust.sql
git commit -m "H-5: migration 011 — safety_events trust columns, monotonicity trigger, nlp_signals"
```

---

### Task 2: Add `source_id` + `origin_channel` to the Redis event payload and schema

**Files:**
- Modify: `services/sentinel-core/src/schema.rs` (struct + `From` impls + tests)
- Regenerate: `services/event_schema.json` (Rust copy, read by the gateway)
- Sync: `services/signal/event_schema.json` (Python copy, read by `publisher.py`)

The payload struct is the single source of truth; `event_schema.json` is generated from it by the `export_schema` binary. Both copies of the JSON must stay byte-identical. New fields are **optional** (`Option<String>`, `#[serde(default)]`) so existing emitters and stored events keep validating.

- [ ] **Step 1: Write the failing test**

In `services/sentinel-core/src/schema.rs`, add this test inside the existing `mod tests` block (after `deserialise_payload_without_state_key`):

```rust
    #[test]
    fn carries_source_id_and_origin_channel() {
        let mut payload = sample();
        payload.source_id = Some("nation.africa".into());
        payload.origin_channel = Some("rss".into());
        let json = serde_json::to_string(&payload).unwrap();
        let back: RedisEventPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(back.source_id.as_deref(), Some("nation.africa"));
        assert_eq!(back.origin_channel.as_deref(), Some("rss"));
    }

    #[test]
    fn deserialise_payload_without_provenance_fields() {
        // Old payloads with neither field must still deserialise (fields default to None).
        let json = r#"{
            "schema_version": 1,
            "id": "00000000-0000-0000-0000-000000000001",
            "event_type": "FIRE",
            "severity": "HIGH",
            "title": "Test",
            "lat": 0.0,
            "lng": 0.0,
            "started_at": "2024-01-01T00:00:00Z",
            "is_active": true,
            "created_at": "2024-01-01T00:00:00Z"
        }"#;
        let p: RedisEventPayload = serde_json::from_str(json).unwrap();
        assert_eq!(p.source_id, None);
        assert_eq!(p.origin_channel, None);
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd services/gateway && cargo test -p sentinel-core carries_source_id_and_origin_channel
```
Expected: FAIL to compile — `no field 'source_id' on type RedisEventPayload`.

- [ ] **Step 3: Add the fields to the struct and both `From` impls**

In `services/sentinel-core/src/schema.rs`, add the two fields to `RedisEventPayload` immediately after the `state` field:

```rust
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub source_id: Option<String>,
    #[serde(default)]
    pub origin_channel: Option<String>,
    pub created_at: DateTime<Utc>,
```

These fields are **not** propagated into `crate::Event` (the public map DTO) — leave both `From<RedisEventPayload> for crate::Event` and `From<&RedisEventPayload> for crate::Event` unchanged. Also add the two fields to the `sample()` test helper so it still constructs a full struct:

```rust
            is_active: true,
            state: Some("ACTIVE".into()),
            source_id: Some("nation.africa".into()),
            origin_channel: Some("rss".into()),
            created_at: Utc::now(),
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run:
```bash
cd services/gateway && cargo test -p sentinel-core schema::
```
Expected: PASS — including `carries_source_id_and_origin_channel`, `deserialise_payload_without_provenance_fields`, and the pre-existing `serde_round_trip`, `converts_to_event`, `optional_fields_absent`, `deserialise_payload_without_state_key`.

- [ ] **Step 5: Regenerate `event_schema.json` and sync both copies**

Run (from repo root):
```bash
cd services/sentinel-core && cargo run --quiet --bin export_schema > ../event_schema.json
cd ../.. && cp services/event_schema.json services/signal/event_schema.json
git diff --stat services/event_schema.json services/signal/event_schema.json
```
Expected: both files change identically, gaining `source_id` and `origin_channel` properties typed `["string","null"]`, still with `"additionalProperties": false` and the same `required` list (the new fields are NOT required).

- [ ] **Step 6: Verify the two schema copies are byte-identical**

Run:
```bash
diff services/event_schema.json services/signal/event_schema.json && echo "IDENTICAL"
```
Expected: prints `IDENTICAL` (no diff output).

- [ ] **Step 7: Commit**

```bash
git add services/sentinel-core/src/schema.rs services/event_schema.json services/signal/event_schema.json
git commit -m "H-5: add source_id and origin_channel to event payload and schema"
```

---

### Task 3: Populate `source_id` + `origin_channel` in the Python signal pipeline

**Files:**
- Modify: `services/signal/nlp/event_fuser.py` (`build_event` emits the two fields)
- Modify: `services/signal/ingest/rss_parser.py` (feed domain → `source_id`, `rss` channel)
- Modify: `services/signal/ingest/twitter_stream.py` (author handle → `source_id`, `twitter` channel)
- Modify: `services/signal/worker/transcriber.py` (job id → `source_id`, `radio` channel)
- Test: `services/signal/tests/test_event_fuser.py`

`build_event` currently returns a payload validated against `event_schema.json` (Task 2 made the two fields optional). It must pass `source_id`/`origin_channel` straight through from the best signal so the gateway can stage them. Each ingest site sets the channel and a within-channel identity.

- [ ] **Step 1: Write the failing test**

Append to `services/signal/tests/test_event_fuser.py`:

```python
def test_build_event_passes_through_provenance():
    from nlp.event_fuser import build_event
    from datetime import datetime, timezone

    signal = {
        "event_type": "FIRE",
        "severity": "HIGH",
        "title": "Market fire",
        "summary": "Fire at the market",
        "location": {"lat": -1.286, "lng": 36.817, "place_name": "CBD", "county": "Nairobi"},
        "confidence": 0.6,
        "source_type": "rss",
        "source_id": "nation.africa",
        "origin_channel": "rss",
        "timestamp": datetime(2026, 6, 4, tzinfo=timezone.utc),
    }
    event = build_event([signal])
    assert event["source_id"] == "nation.africa"
    assert event["origin_channel"] == "rss"


def test_build_event_provenance_defaults_to_none_when_absent():
    from nlp.event_fuser import build_event
    from datetime import datetime, timezone

    signal = {
        "event_type": "FIRE",
        "severity": "HIGH",
        "title": "Market fire",
        "summary": None,
        "location": {"lat": -1.286, "lng": 36.817, "place_name": None, "county": None},
        "confidence": 0.6,
        "source_type": "rss",
        "timestamp": datetime(2026, 6, 4, tzinfo=timezone.utc),
    }
    event = build_event([signal])
    assert event["source_id"] is None
    assert event["origin_channel"] is None
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd services/signal && python -m pytest tests/test_event_fuser.py::test_build_event_passes_through_provenance -v
```
Expected: FAIL with `KeyError: 'source_id'`.

- [ ] **Step 3: Emit the two fields from `build_event`**

In `services/signal/nlp/event_fuser.py`, inside the dict returned by `build_event`, add the two fields after `"summary": best.get("summary"),`:

```python
        "summary": best.get("summary"),
        "source_id": best.get("source_id"),
        "origin_channel": best.get("origin_channel"),
        "place_name": loc.get("place_name"),
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
cd services/signal && python -m pytest tests/test_event_fuser.py -v
```
Expected: PASS — both new tests plus the pre-existing event-fuser tests.

- [ ] **Step 5: Set provenance at each ingest site**

In `services/signal/ingest/rss_parser.py`, the `signal` dict in `_process_entry` currently sets `"source_type": "rss"`. Add the two provenance fields next to it. Derive the feed domain from `source_url` using the standard library:

At the top of `services/signal/ingest/rss_parser.py`, add to the imports:
```python
from urllib.parse import urlparse
```
Then in `_process_entry`, change the `signal` dict's source section from:
```python
        "confidence": classification["confidence"],
        "source_type": "rss",
        "timestamp": ts,
```
to:
```python
        "confidence": classification["confidence"],
        "source_type": "rss",
        "source_id": urlparse(source_url).netloc or source_url,
        "origin_channel": "rss",
        "timestamp": ts,
```

In `services/signal/ingest/twitter_stream.py`, change the `signal` dict's source section from:
```python
                                "confidence": classification["confidence"],
                                "source_type": "twitter",
                                "timestamp": datetime.now(timezone.utc),
```
to:
```python
                                "confidence": classification["confidence"],
                                "source_type": "twitter",
                                "source_id": tweet.get("author_id") or (data.get("includes", {}).get("users", [{}])[0].get("username")),
                                "origin_channel": "twitter",
                                "timestamp": datetime.now(timezone.utc),
```
NOTE: author-level identity is a deliberate temporary heuristic (documented in the spec); `author_id` is the stable Twitter field, falling back to a username from the stream's `includes` when present, else `None`.

In `services/signal/worker/transcriber.py`, change the `signal` dict's source section from:
```python
            "confidence": classification["confidence"],
            "source_type": "radio",
            "timestamp": datetime.now(timezone.utc).isoformat(),
```
to:
```python
            "confidence": classification["confidence"],
            "source_type": "radio",
            "source_id": job_id,
            "origin_channel": "radio",
            "timestamp": datetime.now(timezone.utc).isoformat(),
```

- [ ] **Step 6: Verify the full signal suite still passes**

Run:
```bash
cd services/signal && python -m pytest tests/ -v
```
Expected: PASS (all tests, including the new event-fuser tests). The transcriber teardown may print a benign `Future exception was never retrieved` line from a pre-existing async-mock test — that is unrelated and does not fail the run.

- [ ] **Step 7: Commit**

```bash
git add services/signal/nlp/event_fuser.py services/signal/ingest/rss_parser.py services/signal/ingest/twitter_stream.py services/signal/worker/transcriber.py services/signal/tests/test_event_fuser.py
git commit -m "H-5: populate source_id and origin_channel across NLP ingest sites"
```

---

## Self-Review

- **Spec coverage (Part B plumbing):** trust_state/origin_class/distinct_source_count/distinct_channel_count columns + monotonicity trigger (Task 1); legacy-confirmed backfill with `{"provenance":"legacy_confirmed"}` marker (Task 1 Step 1 §2); `nlp_signals` staging table with h3 + provenance columns and cluster index (Task 1); `source_id`/`origin_channel` on the payload + both schema copies (Task 2); Python ingest populating them per channel — RSS feed domain, Twitter author, radio job id (Task 3). Deferred to Phase 2B (correctly out of scope here): the shared trust-contract module, the HEURISTIC-ingest rewrite of `event_subscriber`, the NLP synthesis worker (promotion + TTL), and push/anchor/reputation/route gating. This plan is intentionally behavior-preserving: `event_subscriber` is NOT modified, so events still surface exactly as today; the new columns sit unused until 2B.
- **Placeholder scan:** none — every step has full SQL/Rust/Python plus exact commands and expected output.
- **Type consistency:** `source_id`/`origin_channel` are `Option<String>` in Rust (Task 2), `["string","null"]` in both schema copies (Task 2 Step 5), and plain optional dict keys defaulting to `None` via `.get()` in Python (Task 3). The `nlp_signals` columns (`source_id TEXT`, `origin_channel TEXT NOT NULL`) match the field names used in the payload and ingest. `build_event` reads `best.get("source_id")`/`best.get("origin_channel")`, matching the keys set in each ingest `signal` dict.
- **Known follow-up for 2B:** `origin_channel` is `NOT NULL` in `nlp_signals` but optional in the payload; Phase 2B's staging insert must default a missing channel (e.g. to `source_type`) — noted here so the 2B plan handles it rather than letting an insert fail.
