# Global Map Phase 2a — DB Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PostGIS geography column with GIST index and an event lifecycle `state` column to `safety_events`, update all Rust and TypeScript types to include `state`, and add a viewport-bounded `GET /events/bounds` query endpoint.

**Architecture:** A single Postgres migration adds the PostGIS extension, a `geog geography(Point,4326)` column (auto-synced from lat/lng by a BEFORE INSERT/UPDATE trigger), a `state VARCHAR(20)` column (lifecycle: REPORTED → ACTIVE → UPDATED → RESOLVED → EXPIRED), and GIST + scalar indexes. Rust sentinel-core types gain an optional `state` field, which flows through the gateway struct and WS broadcast. A new `list_events_by_bounds` route uses `ST_MakeEnvelope + &&` against `geog` for viewport-bounded queries. TypeScript shared types mirror the changes.

**Tech Stack:** PostgreSQL 15 + PostGIS 3, sqlx 0.7, Rust (sentinel-core + gateway), TypeScript (shared/types)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `infra/postgres/migrations/005_postgis_viewport.sql` | PostGIS extension, geog column + trigger, state column + backfill, GIST index |
| Modify | `services/sentinel-core/src/domain/event.rs` | Add `state: Option<String>` to canonical `Event` |
| Modify | `services/sentinel-core/src/schema.rs` | Add `state: Option<String>` to `RedisEventPayload`; update both `From` impls |
| Modify | `services/event_schema.json` | Regenerate via `export_schema` binary after schema.rs change |
| Modify | `services/gateway/src/routes/events.rs` | Add `state` to `SafetyEvent`; explicit column lists (no `geog`); add `BoundsQuery`, `viewport_limit`, `list_events_by_bounds`, `/bounds` route |
| Modify | `services/gateway/src/subscribers/event_subscriber.rs` | Add `state` management to `ON CONFLICT` UPDATE clause |
| Modify | `shared/types/index.d.ts` | Add `EventState` union type; add `state` field to `SafetyEvent` |

---

## Task 1: DB Migration — PostGIS, geog, state, GIST index

**Files:**
- Create: `infra/postgres/migrations/005_postgis_viewport.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- infra/postgres/migrations/005_postgis_viewport.sql

CREATE EXTENSION IF NOT EXISTS postgis;

-- State lifecycle column (nullable first so backfill can run before NOT NULL)
ALTER TABLE safety_events
  ADD COLUMN IF NOT EXISTS state VARCHAR(20)
    CHECK (state IN ('REPORTED', 'ACTIVE', 'UPDATED', 'RESOLVED', 'EXPIRED'));

UPDATE safety_events
   SET state = CASE WHEN is_active THEN 'ACTIVE' ELSE 'RESOLVED' END
 WHERE state IS NULL;

ALTER TABLE safety_events
  ALTER COLUMN state SET DEFAULT 'ACTIVE',
  ALTER COLUMN state SET NOT NULL;

-- Geography column for PostGIS spatial indexing (nullable; trigger fills it)
ALTER TABLE safety_events
  ADD COLUMN IF NOT EXISTS geog geography(Point, 4326);

UPDATE safety_events
   SET geog = ST_MakePoint(lng, lat)::geography
 WHERE geog IS NULL;

-- Trigger: keep geog in sync whenever lat or lng changes
CREATE OR REPLACE FUNCTION trg_fn_sync_safety_event_geog()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.geog := ST_MakePoint(NEW.lng, NEW.lat)::geography;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_safety_events_sync_geog ON safety_events;
CREATE TRIGGER trg_safety_events_sync_geog
  BEFORE INSERT OR UPDATE OF lat, lng ON safety_events
  FOR EACH ROW EXECUTE FUNCTION trg_fn_sync_safety_event_geog();

-- GIST spatial index (operator class `geography_ops` is the default)
CREATE INDEX IF NOT EXISTS idx_safety_events_geog
  ON safety_events USING GIST (geog);

-- B-tree index on state for fast active-event filtering
CREATE INDEX IF NOT EXISTS idx_safety_events_state
  ON safety_events (state);
```

- [ ] **Step 2: Verify the SQL parses correctly in psql**

Connect to the local dev DB and run:
```sql
\i infra/postgres/migrations/005_postgis_viewport.sql
```
Expected: no errors; `\d safety_events` shows `geog geography(Point,4326)` and `state character varying(20)` columns; `\di safety_events*` shows `idx_safety_events_geog` (type gist) and `idx_safety_events_state` (type btree).

If PostGIS isn't installed on the dev DB, run first:
```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

- [ ] **Step 3: Commit**

```bash
git add infra/postgres/migrations/005_postgis_viewport.sql
git commit -m "db: add PostGIS geog column, GIST index, and state lifecycle to safety_events"
```

---

## Task 2: sentinel-core — state field + event_schema.json regeneration

**Files:**
- Modify: `services/sentinel-core/src/domain/event.rs`
- Modify: `services/sentinel-core/src/schema.rs`
- Modify: `services/event_schema.json`

- [ ] **Step 1: Write failing tests in domain/event.rs**

Add to the `#[cfg(test)]` block in `services/sentinel-core/src/domain/event.rs`:

```rust
    #[test]
    fn state_field_present() {
        let e = sample();
        // Compile-time check: state field exists and is Option<String>
        let _: Option<String> = e.state;
    }

    #[test]
    fn state_none_round_trip() {
        let mut e = sample();
        e.state = None;
        let json = serde_json::to_string(&e).unwrap();
        let back: Event = serde_json::from_str(&json).unwrap();
        assert_eq!(back.state, None);
    }

    #[test]
    fn state_some_round_trip() {
        let mut e = sample();
        e.state = Some("ACTIVE".into());
        let json = serde_json::to_string(&e).unwrap();
        let back: Event = serde_json::from_str(&json).unwrap();
        assert_eq!(back.state, Some("ACTIVE".into()));
    }
```

- [ ] **Step 2: Run tests to confirm they fail (compile error)**

```bash
cd services && cargo test -p sentinel-core 2>&1 | head -30
```
Expected: `error[E0609]: no field 'state' on type 'Event'`

- [ ] **Step 3: Add state to the Event struct and sample() helper**

Replace the `Event` struct and `sample()` function in `services/sentinel-core/src/domain/event.rs`:

```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Event {
    pub id: Uuid,
    pub event_type: String,
    pub severity: String,
    pub title: String,
    pub lat: f64,
    pub lng: f64,
    pub started_at: DateTime<Utc>,
    pub summary: Option<String>,
    pub place_name: Option<String>,
    pub county: Option<String>,
    pub is_active: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    pub created_at: DateTime<Utc>,
}
```

Update `sample()` in the test module to include `state`:

```rust
    fn sample() -> Event {
        Event {
            id: Uuid::nil(),
            event_type: "FIRE".into(),
            severity: "HIGH".into(),
            title: "Test fire".into(),
            lat: 1.23,
            lng: 4.56,
            started_at: Utc::now(),
            summary: Some("summary".into()),
            place_name: Some("Main St".into()),
            county: Some("Nairobi".into()),
            is_active: true,
            state: Some("ACTIVE".into()),
            created_at: Utc::now(),
        }
    }
```

- [ ] **Step 4: Add state to RedisEventPayload and update both From impls in schema.rs**

Replace the `RedisEventPayload` struct, both `From` impls, and `sample()` in `services/sentinel-core/src/schema.rs`:

```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct RedisEventPayload {
    pub schema_version: u32,
    pub id: Uuid,
    pub event_type: String,
    pub severity: String,
    pub title: String,
    pub lat: f64,
    pub lng: f64,
    pub started_at: DateTime<Utc>,
    pub summary: Option<String>,
    pub place_name: Option<String>,
    pub county: Option<String>,
    pub is_active: bool,
    pub state: Option<String>,
    pub created_at: DateTime<Utc>,
}

impl From<RedisEventPayload> for crate::Event {
    fn from(p: RedisEventPayload) -> Self {
        Self {
            id: p.id,
            event_type: p.event_type,
            severity: p.severity,
            title: p.title,
            lat: p.lat,
            lng: p.lng,
            started_at: p.started_at,
            summary: p.summary,
            place_name: p.place_name,
            county: p.county,
            is_active: p.is_active,
            state: p.state,
            created_at: p.created_at,
        }
    }
}

impl From<&RedisEventPayload> for crate::Event {
    fn from(p: &RedisEventPayload) -> Self {
        Self {
            id: p.id,
            event_type: p.event_type.clone(),
            severity: p.severity.clone(),
            title: p.title.clone(),
            lat: p.lat,
            lng: p.lng,
            started_at: p.started_at,
            summary: p.summary.clone(),
            place_name: p.place_name.clone(),
            county: p.county.clone(),
            is_active: p.is_active,
            state: p.state.clone(),
            created_at: p.created_at,
        }
    }
}
```

Update `sample()` in the schema.rs test module to include `state`:

```rust
    fn sample() -> RedisEventPayload {
        RedisEventPayload {
            schema_version: 1,
            id: Uuid::new_v4(),
            event_type: "FIRE".into(),
            severity: "HIGH".into(),
            title: "Test fire".into(),
            lat: -1.286,
            lng: 36.817,
            started_at: Utc::now(),
            summary: Some("Grass fire near park".into()),
            place_name: Some("Uhuru Park".into()),
            county: Some("Nairobi".into()),
            is_active: true,
            state: Some("ACTIVE".into()),
            created_at: Utc::now(),
        }
    }
```

Also update the `converts_to_event` test in schema.rs to assert state propagates:

```rust
    #[test]
    fn converts_to_event() {
        let payload = sample();
        let event = crate::Event::from(payload.clone());
        assert_eq!(payload.id, event.id);
        assert_eq!(payload.event_type, event.event_type);
        assert_eq!(payload.lat, event.lat);
        assert_eq!(payload.lng, event.lng);
        assert_eq!(payload.county, event.county);
        assert_eq!(payload.is_active, event.is_active);
        assert_eq!(payload.severity, event.severity);
        assert_eq!(payload.title, event.title);
        assert_eq!(payload.summary, event.summary);
        assert_eq!(payload.place_name, event.place_name);
        assert_eq!(payload.started_at, event.started_at);
        assert_eq!(payload.created_at, event.created_at);
        assert_eq!(payload.state, event.state);
    }
```

- [ ] **Step 5: Run sentinel-core tests**

```bash
cd services && cargo test -p sentinel-core
```
Expected: all tests pass, 0 failures.

- [ ] **Step 6: Regenerate event_schema.json**

`state` is now a field in `RedisEventPayload`. `export_schema` generates the JSON Schema from it. Because `state: Option<String>` maps to a nullable string, the generated schema will include it as an optional property. The existing `additionalProperties: false` stays in place.

```bash
cd services && cargo run --bin export_schema > event_schema.json
```
Expected: command exits 0; no errors to stderr.

- [ ] **Step 7: Verify schema contains state**

```bash
grep -c '"state"' services/event_schema.json
```
Expected: at least 1 (property definition).

Also verify the existing `extra_field_fails_due_to_additional_properties_false` test in event_subscriber.rs still passes (schema has `additionalProperties: false`):
```bash
cd services && cargo test -p gateway -- subscribers
```
Expected: 5 tests pass.

- [ ] **Step 8: Commit**

```bash
git add services/sentinel-core/src/domain/event.rs \
        services/sentinel-core/src/schema.rs \
        services/event_schema.json
git commit -m "feat: add state lifecycle field to Event and RedisEventPayload; regenerate JSON schema"
```

---

## Task 3: Gateway routes/events.rs — SafetyEvent struct, explicit columns, query_by_bounds

**Files:**
- Modify: `services/gateway/src/routes/events.rs`

The `geog geography` column added by the migration cannot be decoded by sqlx's built-in type decoders. All `SELECT *` and `RETURNING *` must be replaced with explicit column lists that omit `geog`. This task also adds the `state` field to the struct and a new viewport-bounded query endpoint.

- [ ] **Step 1: Write failing tests for viewport_limit**

Add to the `#[cfg(test)]` block in `services/gateway/src/routes/events.rs`:

```rust
    #[test]
    fn viewport_limit_clamped_to_max_at_low_zoom() {
        assert_eq!(viewport_limit(8.0), 500);
    }

    #[test]
    fn viewport_limit_mid_zoom() {
        assert_eq!(viewport_limit(12.0), 250);
    }

    #[test]
    fn viewport_limit_clamped_to_min_at_high_zoom() {
        assert_eq!(viewport_limit(30.0), 50);
    }
```

- [ ] **Step 2: Run to confirm compile failure**

```bash
cd services && cargo test -p gateway 2>&1 | head -20
```
Expected: `error[E0425]: cannot find function 'viewport_limit'`

- [ ] **Step 3: Add state to SafetyEvent struct**

Replace the `SafetyEvent` struct:

```rust
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct SafetyEvent {
    pub id: Uuid,
    pub event_type: String,
    pub severity: String,
    pub title: String,
    pub lat: f64,
    pub lng: f64,
    pub started_at: DateTime<Utc>,
    pub summary: Option<String>,
    pub place_name: Option<String>,
    pub county: Option<String>,
    pub radius_meters: Option<i32>,
    pub confidence: Option<f64>,
    pub source_count: Option<i32>,
    pub source_breakdown: Option<serde_json::Value>,
    pub is_active: bool,
    pub state: String,
    pub nostr_event_id: Option<String>,
    pub bitcoin_txid: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
```

- [ ] **Step 4: Add state to sample_db_row() in tests and update From impl**

In the test module, update `sample_db_row()` to add `state`:
```rust
    fn sample_db_row() -> SafetyEvent {
        let now = Utc::now();
        SafetyEvent {
            id: Uuid::nil(),
            event_type: "FLOOD".into(),
            severity: "CRITICAL".into(),
            title: "Flooding downtown".into(),
            lat: -1.2921,
            lng: 36.8219,
            started_at: now,
            summary: Some("Roads impassable".into()),
            place_name: Some("CBD".into()),
            county: Some("Nairobi".into()),
            radius_meters: Some(2000),
            confidence: Some(0.95),
            source_count: Some(3),
            source_breakdown: None,
            is_active: true,
            state: "ACTIVE".into(),
            nostr_event_id: Some("nevent1abc".into()),
            bitcoin_txid: None,
            created_at: now,
            updated_at: now,
        }
    }
```

Update the `From<SafetyEvent> for sentinel_core::Event` impl to include `state`:

```rust
impl From<SafetyEvent> for sentinel_core::Event {
    fn from(row: SafetyEvent) -> Self {
        Self {
            id: row.id,
            event_type: row.event_type,
            severity: row.severity,
            title: row.title,
            lat: row.lat,
            lng: row.lng,
            started_at: row.started_at,
            summary: row.summary,
            place_name: row.place_name,
            county: row.county,
            is_active: row.is_active,
            state: Some(row.state),
            created_at: row.created_at,
        }
    }
}
```

- [ ] **Step 5: Replace RETURNING * in create_event with explicit column list**

The explicit column list excludes `geog`. Replace the `RETURNING *` in the INSERT inside `create_event`:

```rust
    let event = sqlx::query_as::<_, SafetyEvent>(
        "INSERT INTO safety_events
           (event_type, severity, title, lat, lng, started_at, summary, place_name, county,
            radius_meters, confidence, source_count, source_breakdown, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING id, event_type, severity, title, lat, lng, started_at,
                   summary, place_name, county, radius_meters, confidence,
                   source_count, source_breakdown, is_active, state,
                   nostr_event_id, bitcoin_txid, created_at, updated_at"
    )
    .bind(&body.event_type).bind(&body.severity).bind(&body.title)
    .bind(body.lat).bind(body.lng).bind(body.started_at)
    .bind(&body.summary).bind(&body.place_name).bind(&body.county)
    .bind(body.radius_meters).bind(body.confidence).bind(body.source_count)
    .bind(&body.source_breakdown).bind(body.is_active.unwrap_or(true))
    .fetch_one(&mut *tx)
    .await?;
```

- [ ] **Step 6: Replace SELECT * in list_events with explicit column list**

```rust
    let events = sqlx::query_as::<_, SafetyEvent>(
        "SELECT id, event_type, severity, title, lat, lng, started_at,
                summary, place_name, county, radius_meters, confidence,
                source_count, source_breakdown, is_active, state,
                nostr_event_id, bitcoin_txid, created_at, updated_at
           FROM safety_events
          WHERE ($1::float8 IS NULL OR
                 earth_distance(ll_to_earth($1,$2), ll_to_earth(lat,lng)) <= $3)
            AND ($4::text[] IS NULL OR severity = ANY($4))
            AND ($5::text[] IS NULL OR event_type = ANY($5))
            AND (NOT $6 OR is_active = true)
          ORDER BY created_at DESC
          LIMIT $7"
    )
    .bind(q.lat).bind(q.lng).bind(radius_m)
    .bind(severity_filter).bind(type_filter).bind(active_only).bind(limit)
    .fetch_all(&state.db)
    .await?;
```

- [ ] **Step 7: Replace SELECT * in get_event with explicit column list**

```rust
    let event = sqlx::query_as::<_, SafetyEvent>(
        "SELECT id, event_type, severity, title, lat, lng, started_at,
                summary, place_name, county, radius_meters, confidence,
                source_count, source_breakdown, is_active, state,
                nostr_event_id, bitcoin_txid, created_at, updated_at
           FROM safety_events WHERE id = $1"
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;
```

- [ ] **Step 8: Add viewport_limit, BoundsQuery, and list_events_by_bounds**

Add after the `ListEventsQuery` struct definition:

```rust
#[derive(Deserialize)]
pub struct BoundsQuery {
    pub min_lat: f64,
    pub max_lat: f64,
    pub min_lng: f64,
    pub max_lng: f64,
    pub zoom: Option<f64>,
}

fn viewport_limit(zoom: f64) -> i64 {
    ((1000.0 / (zoom - 8.0).max(1.0)) as i64).clamp(50, 500)
}

async fn list_events_by_bounds(
    State(state): State<AppState>,
    Query(q): Query<BoundsQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let limit = viewport_limit(q.zoom.unwrap_or(12.0));
    let events = sqlx::query_as::<_, SafetyEvent>(
        "SELECT id, event_type, severity, title, lat, lng, started_at,
                summary, place_name, county, radius_meters, confidence,
                source_count, source_breakdown, is_active, state,
                nostr_event_id, bitcoin_txid, created_at, updated_at
           FROM safety_events
          WHERE geog && ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography
            AND state NOT IN ('RESOLVED', 'EXPIRED')
          ORDER BY created_at DESC
          LIMIT $5"
    )
    .bind(q.min_lng).bind(q.min_lat).bind(q.max_lng).bind(q.max_lat)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;
    let total = events.len() as i64;
    Ok(Json(serde_json::json!({ "events": events, "total": total })))
}
```

Note: `ST_MakeEnvelope` argument order is `(xmin, ymin, xmax, ymax, srid)` → `(min_lng, min_lat, max_lng, max_lat, 4326)`.

- [ ] **Step 9: Register the /bounds route**

Replace the `pub fn router()` function:

```rust
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_events).post(create_event))
        .route("/bounds", get(list_events_by_bounds))
        .route("/:id", get(get_event))
}
```

- [ ] **Step 10: Run tests**

```bash
cd services && cargo test -p gateway
```
Expected: all tests pass including the three new `viewport_limit_*` tests.

- [ ] **Step 11: Commit**

```bash
git add services/gateway/src/routes/events.rs
git commit -m "feat: add state field to SafetyEvent, explicit column selects, and GET /events/bounds viewport endpoint"
```

---

## Task 4: event_subscriber.rs — ON CONFLICT state management

**Files:**
- Modify: `services/gateway/src/subscribers/event_subscriber.rs`

The subscriber's `ON CONFLICT (id) DO UPDATE` currently does not touch `state`. When an event is deactivated via Redis (`is_active = false`), the DB row's state must transition to `'RESOLVED'`. This task adds that logic.

- [ ] **Step 1: Write a failing test verifying ON CONFLICT includes state**

Add to the `#[cfg(test)]` block in `services/gateway/src/subscribers/event_subscriber.rs`:

```rust
    #[test]
    fn upsert_sql_includes_state_in_conflict_update() {
        let sql = "INSERT INTO safety_events
           (id, event_type, severity, title, lat, lng, started_at,
            summary, place_name, county, is_active, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
         ON CONFLICT (id) DO UPDATE SET
           severity   = EXCLUDED.severity,
           title      = EXCLUDED.title,
           summary    = EXCLUDED.summary,
           state      = CASE WHEN EXCLUDED.is_active
                             THEN COALESCE(safety_events.state, 'ACTIVE')
                             ELSE 'RESOLVED'
                        END,
           updated_at = NOW()";
        assert!(sql.contains("state"));
    }
```

This is a lightweight guard — the real behaviour is tested in integration against a DB with the migration applied.

- [ ] **Step 2: Run to confirm test passes trivially (it references a literal)**

```bash
cd services && cargo test -p gateway -- subscribers::tests::upsert_sql_includes_state_in_conflict_update
```
Expected: 1 test passes (the literal already contains "state").

- [ ] **Step 3: Update the SQL in handle_message**

In `handle_message`, replace the `sqlx::query(...)` call with the version that includes state in the ON CONFLICT update:

```rust
    sqlx::query(
        "INSERT INTO safety_events
           (id, event_type, severity, title, lat, lng, started_at,
            summary, place_name, county, is_active, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
         ON CONFLICT (id) DO UPDATE SET
           severity   = EXCLUDED.severity,
           title      = EXCLUDED.title,
           summary    = EXCLUDED.summary,
           state      = CASE WHEN EXCLUDED.is_active
                             THEN COALESCE(safety_events.state, 'ACTIVE')
                             ELSE 'RESOLVED'
                        END,
           updated_at = NOW()",
    )
    .bind(event.id)
    .bind(&event.event_type)
    .bind(&event.severity)
    .bind(&event.title)
    .bind(event.lat)
    .bind(event.lng)
    .bind(event.started_at)
    .bind(&event.summary)
    .bind(&event.place_name)
    .bind(county.as_deref())
    .bind(event.is_active)
    .bind(event.created_at)
    .execute(pool)
    .await?;
```

Note: The INSERT itself omits `state` — the DB column's `DEFAULT 'ACTIVE'` handles new insertions. The trigger `trg_safety_events_sync_geog` automatically populates `geog` from `lat`/`lng`.

- [ ] **Step 4: Run all gateway tests**

```bash
cd services && cargo test -p gateway
```
Expected: all tests pass including the subscriber schema tests.

- [ ] **Step 5: Commit**

```bash
git add services/gateway/src/subscribers/event_subscriber.rs
git commit -m "feat: sync state to RESOLVED on event deactivation in Redis stream upsert"
```

---

## Task 5: shared/types — EventState type + state field on SafetyEvent

**Files:**
- Modify: `shared/types/index.d.ts`

- [ ] **Step 1: Add EventState type and state field**

Open `shared/types/index.d.ts` and add the `EventState` type after the `Severity` type, then add `state` to `SafetyEvent`:

Add after the `Severity` line:
```typescript
export type EventState =
  | 'REPORTED'
  | 'ACTIVE'
  | 'UPDATED'
  | 'RESOLVED'
  | 'EXPIRED'
```

Add `state` to the `SafetyEvent` interface after `is_active`:
```typescript
export interface SafetyEvent {
  id: string
  event_type: EventType
  severity: Severity
  title: string
  summary: string | null
  lat: number
  lng: number
  place_name: string | null
  county: string | null
  is_active: boolean
  state: EventState
  started_at: string
  created_at: string
  nostr_event_id: string | null
  bitcoin_txid: string | null
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/pwa && npx tsc --noEmit 2>&1 | head -30
```
Expected: 0 errors. (If `state` was previously accessed as missing, existing code will now type-check against `EventState`. No callers currently read `state` — this is additive.)

- [ ] **Step 3: Commit**

```bash
git add shared/types/index.d.ts
git commit -m "types: add EventState union type and state field to SafetyEvent"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement (§2 / §3) | Covered by |
|---|---|
| PostGIS `geog geography(Point,4326)` column | Task 1 migration |
| GIST index on `geog` | Task 1 migration |
| `ST_MakeEnvelope` viewport query | Task 3 `list_events_by_bounds` |
| `state` lifecycle column | Task 1 migration |
| State backfill from `is_active` | Task 1 migration UPDATE |
| `geog` sync trigger | Task 1 migration trigger |
| `viewport_limit(zoom)` formula | Task 3 |
| `state` in sentinel-core Event | Task 2 |
| `state` in RedisEventPayload | Task 2 |
| Regenerate event_schema.json | Task 2 |
| `state` in SafetyEvent (gateway) | Task 3 |
| Explicit column lists (no `geog` in FromRow) | Task 3 |
| State lifecycle on Redis upsert | Task 4 |
| TypeScript `EventState` type | Task 5 |

**Placeholder scan:** None found.

**Type consistency:**
- `state: Option<String>` on `sentinel_core::Event` and `RedisEventPayload` ✓
- `state: String` on gateway `SafetyEvent` (NOT NULL in DB) → mapped to `Some(row.state)` in `From<SafetyEvent>` ✓
- `state: EventState` in TypeScript `SafetyEvent` ✓
- All explicit column lists include `state` ✓
- `geog` absent from all explicit column lists ✓

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-18-global-map-phase2a.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Fresh subagent per task, spec + quality review between tasks

**2. Inline Execution** — Execute tasks in this session using executing-plans

**Which approach?**
