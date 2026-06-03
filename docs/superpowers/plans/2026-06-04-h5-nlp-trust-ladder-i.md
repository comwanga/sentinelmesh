# H-5 Phase 2B-i — Trust Contract + HEURISTIC Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the shared trust-contract module and flip NLP ingest so a single keyword detection surfaces as an unverified HEURISTIC event (staged in `nlp_signals`, clustered for later corroboration) instead of an auto-promoted "confirmed" map event with push.

**Architecture:** A new `gateway::trust::contract` module is the single source of truth mapping independence evidence (distinct provenance clusters + distinct channels) to a `TrustTier` (`Heuristic`→`Corroborating`→`Confirmed`). The NLP synthesis worker (Phase 2B-ii) is built against it; acoustic converges onto it later. `event_subscriber::handle_message` is rewritten to compute the H3 cell, stage an `nlp_signals` row, find-or-create a HEURISTIC `safety_events` row for that cell+type+window, broadcast it to the map (labeled by `trust_state`), and — critically — **stop sending push notifications** (push moves to the worker on confirm in 2B-ii).

**Tech Stack:** Rust (Cargo workspace at `services/`, `cargo test`/`cargo build`), PostgreSQL (compose Postgres for integration checks), `h3o` crate (already a dependency).

**Spec:** `docs/superpowers/specs/2026-06-04-h5-nlp-guardrails-design.md` (Part B ladder + shared trust contract; Part D push gating).

**Depends on:** Phase 2A (migration 011 with `nlp_signals` + `safety_events.trust_state`/`origin_class`; payload `source_id`/`origin_channel`). Already merged on this branch.

**Conventions:**
- Commit messages: plain English, NO `Co-Authored-By` trailer.
- Gateway build/test: `cd services/gateway && cargo test` / `cargo build` (workspace at `services/`). Gateway unit tests are DB-free; DB-touching behavior is verified against the compose Postgres.

**Scope note:** This is the first half of Phase 2B. 2B-ii (synthesis worker: promotion + push-on-confirm + TTL expiry, plus surfacing `trust_state` in the map WS) is a separate plan. After 2B-i, NLP events surface as HEURISTIC and never push; they simply never get promoted yet.

---

### Task 1: Shared trust-contract module

**Files:**
- Create: `services/gateway/src/trust/mod.rs`
- Create: `services/gateway/src/trust/contract.rs`
- Modify: `services/gateway/src/main.rs` (add `mod trust;`)

Pure functions, fully unit-testable with `cargo test`. This is the convergence point the spec requires — all trust-tier logic lives here, never inline in the worker.

- [ ] **Step 1: Write the failing tests**

Create `services/gateway/src/trust/contract.rs` with ONLY the test module first (the types it references don't exist yet, so it fails to compile):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn ev(sources: usize, channels: usize) -> Independence {
        Independence { distinct_sources: sources, distinct_channels: channels }
    }

    #[test]
    fn single_source_is_heuristic() {
        assert_eq!(decide(ev(1, 1)), TrustTier::Heuristic);
    }

    #[test]
    fn two_distinct_sources_corroborate() {
        assert_eq!(decide(ev(2, 1)), TrustTier::Corroborating);
        assert_eq!(decide(ev(2, 2)), TrustTier::Corroborating); // sources < CONFIRM_MIN_SOURCES (3)
    }

    #[test]
    fn zero_evidence_is_heuristic_floor() {
        assert_eq!(decide(ev(0, 0)), TrustTier::Heuristic);
        assert_eq!(decide(ev(0, 5)), TrustTier::Heuristic);
    }

    #[test]
    fn tiers_order_ascending() {
        assert!(TrustTier::Heuristic < TrustTier::Corroborating);
        assert!(TrustTier::Corroborating < TrustTier::Confirmed);
    }

    #[test]
    fn three_sources_across_two_channels_confirm() {
        assert_eq!(decide(ev(3, 2)), TrustTier::Confirmed);
    }

    #[test]
    fn three_sources_one_channel_stays_corroborating() {
        // Three accounts reposting one wire: many sources, one channel -> no self-confirm.
        assert_eq!(decide(ev(3, 1)), TrustTier::Corroborating);
    }

    #[test]
    fn tier_strings_match_db_check() {
        assert_eq!(TrustTier::Heuristic.as_str(), "heuristic");
        assert_eq!(TrustTier::Corroborating.as_str(), "corroborating");
        assert_eq!(TrustTier::Confirmed.as_str(), "confirmed");
    }

    #[test]
    fn promotion_is_monotonic_in_sources() {
        // Adding sources (at >=2 channels) never lowers the tier.
        let tiers = [decide(ev(1, 2)), decide(ev(2, 2)), decide(ev(3, 2))];
        assert_eq!(
            tiers,
            [TrustTier::Heuristic, TrustTier::Corroborating, TrustTier::Confirmed]
        );
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd services/gateway && cargo test trust::contract 2>&1 | tail -20
```
Expected: FAIL to compile — `cannot find type Independence`, `cannot find function decide`, etc. (Note: until `mod trust;` is added in Step 3 the file is not part of the crate; that is expected — Step 3 wires it in.)

- [ ] **Step 3: Implement the contract and wire the module into the crate**

Prepend the implementation ABOVE the test module in `services/gateway/src/trust/contract.rs`:

```rust
//! Trust tier ladder and the promotion decision for machine-origin events
//! (NLP now; the acoustic worker is meant to converge onto this contract later).
//!
//! Independence is measured in *provenance clusters* (distinct `source_id`) and
//! *channels* (distinct `origin_channel`), never raw row counts — duplicate
//! ingestion must not inflate trust. Machine-origin events top out at `Confirmed`;
//! a higher human/community `Authoritative` tier is intentionally NOT represented
//! here (reserved for a later unified trust engine). Acoustic is not refactored as
//! part of H-5.

/// Machine-origin trust tier, ordered Heuristic < Corroborating < Confirmed.
/// `Ord` is derived from variant declaration order — keep them in ascending order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum TrustTier {
    Heuristic,     // 0
    Corroborating, // 1
    Confirmed,     // 2
}

impl TrustTier {
    /// Lowercase DB/wire form. MUST match the `safety_events.trust_state` CHECK
    /// values from migration 011 (`heuristic`/`corroborating`/`confirmed`).
    pub fn as_str(self) -> &'static str {
        match self {
            TrustTier::Heuristic => "heuristic",
            TrustTier::Corroborating => "corroborating",
            TrustTier::Confirmed => "confirmed",
        }
    }
}

/// Distinct independent evidence backing a cluster.
#[derive(Debug, Clone, Copy)]
pub struct Independence {
    /// Number of distinct provenance clusters (distinct `source_id`).
    pub distinct_sources: usize,
    /// Number of distinct channels (distinct `origin_channel`).
    pub distinct_channels: usize,
}

/// Launch-default thresholds (tunable from operational data).
pub const CORROBORATE_MIN_SOURCES: usize = 2;
pub const CONFIRM_MIN_SOURCES: usize = 3;
pub const CONFIRM_MIN_CHANNELS: usize = 2;

/// Map independence evidence to a tier. Pure and monotonic: adding a distinct
/// source or channel can only raise (never lower) the resulting tier.
pub fn decide(ev: Independence) -> TrustTier {
    if ev.distinct_sources >= CONFIRM_MIN_SOURCES && ev.distinct_channels >= CONFIRM_MIN_CHANNELS {
        TrustTier::Confirmed
    } else if ev.distinct_sources >= CORROBORATE_MIN_SOURCES {
        TrustTier::Corroborating
    } else {
        TrustTier::Heuristic
    }
}
```

Create `services/gateway/src/trust/mod.rs`:

```rust
//! Shared trust contract: the single source of truth for mapping independence
//! evidence to a trust tier. The NLP synthesis worker (Phase 2B-ii) is built
//! against this; acoustic converges onto it in a later migration.
pub mod contract;
```

In `services/gateway/src/main.rs`, add the module declaration alongside the others (keep the list alphabetical-ish; place after `mod subscribers;`):

```rust
mod subscribers;
mod trust;
mod ws;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd services/gateway && cargo test trust::contract 2>&1 | tail -20
```
Expected: PASS — all 6 tests (`single_source_is_heuristic`, `two_distinct_sources_corroborate`, `three_sources_across_two_channels_confirm`, `three_sources_one_channel_stays_corroborating`, `tier_strings_match_db_check`, `promotion_is_monotonic_in_sources`).

- [ ] **Step 5: Commit**

```bash
git add services/gateway/src/trust/mod.rs services/gateway/src/trust/contract.rs services/gateway/src/main.rs
git commit -m "H-5: shared trust contract module (tier ladder + promotion decision)"
```

---

### Task 2: Rewrite `event_subscriber` for HEURISTIC ingest (stage signal, no push)

**Files:**
- Modify: `services/gateway/src/subscribers/event_subscriber.rs` (`handle_message` + a new pure helper + tests)

`handle_message` currently inserts one `safety_events` row keyed by the payload `id` and fires push for HIGH/CRITICAL. The rewrite: compute the H3 cell from lat/lng; find an existing active (heuristic/corroborating) event for the same cell+type within the corroboration window via `nlp_signals`; create a HEURISTIC `safety_events` row if none exists; stage an `nlp_signals` row linked to it; broadcast to the map carrying `trust_state`; and send NO push (push is gated to `confirmed`, applied by the worker in 2B-ii).

Independence note: the payload carries `origin_channel` (optional) but NOT `source_type`; `nlp_signals` requires both `source_type` and `origin_channel` NOT NULL. Use the channel for both, defaulting a missing channel to `"unknown"`.

- [ ] **Step 1: Write the failing test for the channel helper**

In `services/gateway/src/subscribers/event_subscriber.rs`, inside the existing `#[cfg(test)] mod tests`, add:

```rust
    #[test]
    fn channel_defaults_to_unknown_when_absent() {
        assert_eq!(channel_or_unknown(&None), "unknown");
        assert_eq!(channel_or_unknown(&Some("rss".to_string())), "rss");
    }

    #[test]
    fn h3_cells_resolve_from_coordinates() {
        let (r9, r7) = h3_cells(-1.286, 36.817);
        // Resolution-9 and -7 strings are non-empty and differ.
        assert!(!r9.is_empty() && !r7.is_empty());
        assert_ne!(r9, r7);
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd services/gateway && cargo test event_subscriber 2>&1 | tail -20
```
Expected: FAIL to compile — `cannot find function channel_or_unknown` / `h3_cells`.

- [ ] **Step 3: Add the pure helpers**

At the top of `services/gateway/src/subscribers/event_subscriber.rs`, add the `h3o` import alongside the existing `use` lines:

```rust
use h3o::{LatLng, Resolution};
```

Add these two free functions just above `handle_message`:

```rust
/// Channel for a payload, defaulting to "unknown" when the emitter set none.
/// Used for BOTH source_type and origin_channel on the staged nlp_signals row,
/// which are NOT NULL. (The payload carries origin_channel but no source_type;
/// for current emitters the two are identical.)
fn channel_or_unknown(origin_channel: &Option<String>) -> String {
    origin_channel.clone().unwrap_or_else(|| "unknown".to_string())
}

/// Resolution-9 (~100 m clustering cell) and resolution-7 (~5 km region) H3 cells
/// for a coordinate, as the lowercase hex strings stored in nlp_signals.
fn h3_cells(lat: f64, lng: f64) -> (String, String) {
    let ll = LatLng::new(lat, lng).expect("event lat/lng out of range");
    (
        ll.to_cell(Resolution::Nine).to_string(),
        ll.to_cell(Resolution::Seven).to_string(),
    )
}
```

- [ ] **Step 4: Run the helper tests to verify they pass**

Run:
```bash
cd services/gateway && cargo test event_subscriber 2>&1 | tail -20
```
Expected: PASS — `channel_defaults_to_unknown_when_absent`, `h3_cells_resolve_from_coordinates`, plus the pre-existing schema tests in this module.

- [ ] **Step 5: Rewrite `handle_message` for HEURISTIC ingest**

Replace the entire body of `handle_message` (the function signature stays the same) in `services/gateway/src/subscribers/event_subscriber.rs` with:

```rust
async fn handle_message(
    pool: &PgPool,
    hub: &Arc<WsHub>,
    event: &sentinel_core::RedisEventPayload,
    event_tx: &Arc<tokio::sync::broadcast::Sender<crate::ws::ViewportEvent>>,
) -> Result<()> {
    let county = event.county.clone();
    let (h3_r9, h3_r7) = h3_cells(event.lat, event.lng);
    let channel = channel_or_unknown(&event.origin_channel);

    // Corroboration window: how long an active cluster keeps accepting new signals.
    const CLUSTER_WINDOW_SECS: i64 = 1800; // 30 min, matches the Python fuse window

    // 1. Find an existing active (heuristic/corroborating) event for this cell+type
    //    within the window, via already-staged signals. None -> we create one.
    let existing: Option<uuid::Uuid> = sqlx::query_scalar(
        "SELECT event_id FROM nlp_signals
          WHERE h3_r9 = $1 AND event_type = $2 AND event_id IS NOT NULL
            AND trust_state IN ('pending', 'corroborating')
            AND received_at > now() - ($3 * interval '1 second')
          ORDER BY received_at DESC
          LIMIT 1",
    )
    .bind(&h3_r9)
    .bind(&event.event_type)
    .bind(CLUSTER_WINDOW_SECS)
    .fetch_optional(pool)
    .await?;

    // 2. Resolve the surfaced event id: reuse the cluster's event, or insert a new
    //    HEURISTIC one. New machine events are heuristic + origin_class=machine.
    let event_id: uuid::Uuid = match existing {
        Some(id) => id,
        None => sqlx::query_scalar(
            "INSERT INTO safety_events
               (event_type, severity, title, lat, lng, started_at, summary,
                place_name, county, is_active, trust_state, origin_class,
                distinct_source_count, distinct_channel_count, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,'heuristic','machine',1,1,$10)
             RETURNING id",
        )
        .bind(&event.event_type)
        .bind(&event.severity)
        .bind(&event.title)
        .bind(event.lat)
        .bind(event.lng)
        .bind(event.started_at)
        .bind(event.summary.as_deref())
        .bind(event.place_name.as_deref())
        .bind(county.as_deref())
        .bind(event.created_at)
        .fetch_one(pool)
        .await?,
    };

    // 3. Stage the raw signal (pending) linked to the surfaced event. The synthesis
    //    worker (2B-ii) recomputes distinct sources/channels and promotes.
    sqlx::query(
        "INSERT INTO nlp_signals
           (event_id, source_type, source_id, origin_channel, event_type, severity,
            title, summary, lat, lng, h3_r9, h3_r7, county, place_name, confidence,
            trust_state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pending')",
    )
    .bind(event_id)
    .bind(&channel)
    .bind(event.source_id.as_deref())
    .bind(&channel)
    .bind(&event.event_type)
    .bind(&event.severity)
    .bind(&event.title)
    .bind(event.summary.as_deref())
    .bind(event.lat)
    .bind(event.lng)
    .bind(&h3_r9)
    .bind(&h3_r7)
    .bind(county.as_deref())
    .bind(event.place_name.as_deref())
    .bind(event.confidence_or_default())
    .execute(pool)
    .await?;

    // 4. Read back the event's current trust_state so the broadcast is labeled
    //    correctly (it may already be corroborating/confirmed from earlier signals).
    let trust_state: String =
        sqlx::query_scalar("SELECT trust_state FROM safety_events WHERE id = $1")
            .bind(event_id)
            .fetch_one(pool)
            .await?;

    // 5. Broadcast to the map viewport channel (fire-and-forget). Heuristic events
    //    ARE shown — labeled — but never push. Push is gated to confirmed and is
    //    applied by the synthesis worker on the confirm transition (Phase 2B-ii).
    let ws_event_json = serde_json::json!({
        "id": event_id,
        "event_type": event.event_type,
        "severity": event.severity,
        "state": "ACTIVE",
        "trust_state": trust_state,
        "title": event.title,
        "lat": event.lat,
        "lng": event.lng,
        "started_at": event.started_at,
    });
    let _ = event_tx.send(crate::ws::ViewportEvent {
        id: event_id,
        lat: event.lat,
        lng: event.lng,
        severity: event.severity.clone(),
        event_json: ws_event_json.to_string().into(),
    });

    let ws_msg = serde_json::json!({
        "type": "NEW_EVENT",
        "payload": {
            "id": event_id,
            "event_type": event.event_type,
            "severity": event.severity,
            "title": event.title,
            "lat": event.lat,
            "lng": event.lng,
            "started_at": event.started_at,
            "trust_state": trust_state,
        }
    });
    hub.broadcast(
        county.as_deref(),
        serde_json::to_string(&ws_msg).unwrap().into(),
    );

    Ok(())
}
```

This removes the old direct `safety_events` upsert keyed by `event.id`, the hardcoded `trust_state: "confirmed"` in the broadcast, and the entire push-notification block. `event.confidence_or_default()` is added in the next step.

- [ ] **Step 6: Add the `confidence_or_default` helper to the payload**

`RedisEventPayload` has no `confidence` field, but `nlp_signals.confidence` is NOT NULL. The Python signal carries confidence but `build_event` does not currently put it on the payload, so default it here rather than widening the schema in this slice. Add this impl block in `services/gateway/src/subscribers/event_subscriber.rs` (just below the `use` lines):

```rust
trait ConfidenceDefault {
    fn confidence_or_default(&self) -> f32;
}

impl ConfidenceDefault for sentinel_core::RedisEventPayload {
    /// The payload does not carry the classifier confidence; stage a neutral
    /// midpoint so the NOT NULL column is satisfied. (Promotion in 2B-ii is driven
    /// by independence, not this value, so a constant is acceptable for now.)
    fn confidence_or_default(&self) -> f32 {
        0.5
    }
}
```

- [ ] **Step 7: Build and run the gateway tests**

Run:
```bash
cd services/gateway && cargo test event_subscriber 2>&1 | tail -25
```
Expected: PASS — the two helper tests and the pre-existing schema-validation tests (`schema_loads_and_compiles`, `valid_event_passes_validation`, etc.) all still pass, and the crate compiles with the rewritten `handle_message`.

- [ ] **Step 8: Integration smoke check against compose Postgres + Redis**

This verifies the end-to-end DB behavior the unit tests can't (the gateway container must be rebuilt to pick up the new binary first). Run:
```bash
docker compose up -d --build gateway-rs postgres redis
# Publish one NLP event to the stream the gateway consumes:
docker compose exec -T redis redis-cli XADD sentinel:events:stream '*' payload '{"schema_version":1,"id":"00000000-0000-0000-0000-0000000000aa","event_type":"FIRE","severity":"HIGH","title":"Smoke test fire","lat":-1.286,"lng":36.817,"started_at":"2026-06-04T00:00:00Z","is_active":true,"created_at":"2026-06-04T00:00:00Z","source_id":"nation.africa","origin_channel":"rss"}'
sleep 3
docker compose exec postgres psql -U sentinel -d sentinelmesh -c "SELECT trust_state, origin_class, distinct_source_count FROM safety_events WHERE title='Smoke test fire';"
docker compose exec postgres psql -U sentinel -d sentinelmesh -c "SELECT source_id, origin_channel, h3_r9 IS NOT NULL AS has_cell, trust_state FROM nlp_signals WHERE source_id='nation.africa' ORDER BY received_at DESC LIMIT 1;"
```
Expected: the `safety_events` row exists with `trust_state = heuristic`, `origin_class = machine`, `distinct_source_count = 1`; the `nlp_signals` row exists with `origin_channel = rss`, `has_cell = t`, `trust_state = pending`. Clean up:
```bash
docker compose exec postgres psql -U sentinel -d sentinelmesh -c "DELETE FROM nlp_signals WHERE source_id='nation.africa'; DELETE FROM safety_events WHERE title='Smoke test fire';"
```
If the gateway image cannot be rebuilt in this environment, record that and rely on Step 7's build + unit tests; the smoke check can run in CI.

- [ ] **Step 9: Commit**

```bash
git add services/gateway/src/subscribers/event_subscriber.rs
git commit -m "H-5: event_subscriber stages NLP signals as heuristic, stops auto-push"
```

---

## Self-Review

- **Spec coverage:** shared trust contract as the single source of truth, tiers + thresholds + monotonic `decide` (Task 1); independence measured in distinct provenance clusters + channels, never row counts (Task 1 `Independence`/`decide`); single detection surfaces as HEURISTIC, staged in `nlp_signals`, clustered by cell+type+window (Task 2 `handle_message`); machine origin recorded (`origin_class='machine'`); push notifications stopped below confirmed (Task 2 removes the push block — push returns in 2B-ii gated to confirmed); map still shows the event, labeled by `trust_state` (Task 2 broadcast). Deferred to 2B-ii (correctly out of scope): promotion ticks, push-on-confirm, TTL expiry, and surfacing `trust_state` in `query_viewport_events`.
- **Placeholder scan:** none — full Rust in every code step, exact commands + expected output. The `0.5` confidence default and `"unknown"` channel default are explicit, justified decisions, not placeholders.
- **Type consistency:** `TrustTier::as_str()` returns exactly the `safety_events.trust_state` CHECK strings from migration 011. `channel_or_unknown(&Option<String>) -> String` and `h3_cells(f64,f64) -> (String,String)` signatures match their call sites in `handle_message`. `nlp_signals` insert columns/types match migration 011 (h3_r9/h3_r7 NOT NULL satisfied by `h3_cells`; source_type/origin_channel NOT NULL satisfied by `channel`; confidence NOT NULL satisfied by `confidence_or_default`).
- **Known follow-ups for 2B-ii:** (1) the worker must recompute `distinct_source_count`/`distinct_channel_count` from `nlp_signals` and call `contract::decide`, updating `safety_events.trust_state` (monotonic trigger allows only upgrades); (2) push fires only on the heuristic/corroborating→confirmed transition; (3) TTL expiry (HEURISTIC 30 min, CORROBORATING 2 h) flips `is_active=false`/`state='EXPIRED'` and moves staged signals to `expired`; (4) `query_viewport_events` must SELECT and emit `trust_state` so the Phase 3 frontend can style markers; (5) revisit radio `source_id` (stream id vs job id) per the 2A follow-up before relying on radio independence.
