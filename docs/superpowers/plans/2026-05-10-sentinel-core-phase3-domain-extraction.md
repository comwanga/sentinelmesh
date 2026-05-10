# sentinel-core Phase 3: Domain Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the canonical `Event`, `Circle`, `CircleMember`, and `LocationBlob` domain types into `sentinel-core/src/domain/` so both the gateway and blockchain crates share one stable definition — without changing any handler, DB query, or WS payload.

**Architecture:** Four pure structs (serde + uuid + chrono, nothing else) live in `sentinel-core/src/domain/`. The gateway's existing DB structs (`SafetyEvent`, `Circle`, `CircleMember`, `LocationBlob` — all with `sqlx::FromRow`) stay exactly where they are; each gets a `From<DbStruct> for domain::Type` impl that lives in the gateway crate. No handler logic changes, no WS broadcast changes, no DB changes. The blockchain crate is untouched — it has no Circle or LocationBlob types, and its event data path (via `SourceRow`) is independent.

**Tech Stack:** Rust, serde (Serialize/Deserialize), chrono 0.4, uuid 1 — no sqlx, no axum, no async, no serde_json business logic.

---

## File Map

**sentinel-core — new files:**
- Create: `services/sentinel-core/src/domain/mod.rs`
- Create: `services/sentinel-core/src/domain/event.rs`
- Create: `services/sentinel-core/src/domain/circle.rs`
- Create: `services/sentinel-core/src/domain/location.rs`
- Modify: `services/sentinel-core/src/lib.rs`

**gateway — From<> adapters only, no handler changes:**
- Modify: `services/gateway/src/routes/events.rs`
- Modify: `services/gateway/src/routes/circles.rs`
- Modify: `services/gateway/src/routes/location_blobs.rs`

**Do NOT touch:**
- Any handler function body
- Any sqlx query
- Any WebSocket broadcast payload
- `services/blockchain/` (blockchain uses `SourceRow`, not these types)
- `services/sentinel-core/src/crypto.rs`, `jobs.rs`, `retry.rs`

---

### Task 1: Create domain/event.rs in sentinel-core

**Files:**
- Create: `services/sentinel-core/src/domain/event.rs`
- Create: `services/sentinel-core/src/domain/mod.rs` (stub — expanded in Task 2)
- Modify: `services/sentinel-core/src/lib.rs`

- [ ] **Step 1: Create services/sentinel-core/src/domain/event.rs**

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Canonical safety event — transport/domain form.
/// No sqlx::FromRow. The gateway's SafetyEvent DB struct converts to this via From.
/// Fields: only those needed by both services or over the wire. DB-specific tracking
/// fields (nostr_event_id, bitcoin_txid, radius_meters, source_breakdown, updated_at)
/// are intentionally excluded.
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
    pub created_at: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

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
            created_at: Utc::now(),
        }
    }

    #[test]
    fn serde_round_trip() {
        let e = sample();
        let json = serde_json::to_string(&e).unwrap();
        let back: Event = serde_json::from_str(&json).unwrap();
        assert_eq!(e.id, back.id);
        assert_eq!(e.event_type, back.event_type);
        assert_eq!(e.severity, back.severity);
        assert_eq!(e.county, back.county);
        assert_eq!(e.is_active, back.is_active);
    }

    #[test]
    fn optional_fields_absent_round_trip() {
        let mut e = sample();
        e.summary = None;
        e.place_name = None;
        e.county = None;
        let json = serde_json::to_string(&e).unwrap();
        let back: Event = serde_json::from_str(&json).unwrap();
        assert_eq!(back.summary, None);
        assert_eq!(back.place_name, None);
        assert_eq!(back.county, None);
    }
}
```

- [ ] **Step 2: Create stub services/sentinel-core/src/domain/mod.rs**

```rust
pub mod event;
```

- [ ] **Step 3: Update services/sentinel-core/src/lib.rs**

Replace the current content (which is `pub mod crypto; pub mod jobs; pub mod retry;`) with:

```rust
pub mod crypto;
pub mod domain;
pub mod jobs;
pub mod retry;

pub use domain::event::Event;
```

- [ ] **Step 4: Run the new tests**

```
cd services && cargo test -p sentinel-core domain::event
```

Expected output:
```
running 2 tests
test domain::event::tests::optional_fields_absent_round_trip ... ok
test domain::event::tests::serde_round_trip ... ok
test result: ok. 2 passed; 0 failed
```

- [ ] **Step 5: Commit**

```
git add services/sentinel-core/src/domain/
git add services/sentinel-core/src/lib.rs
git commit -m "feat(sentinel-core): add domain::Event canonical transport type"
```

---

### Task 2: Add domain/circle.rs and domain/location.rs; wire domain/mod.rs and lib.rs

**Files:**
- Create: `services/sentinel-core/src/domain/circle.rs`
- Create: `services/sentinel-core/src/domain/location.rs`
- Modify: `services/sentinel-core/src/domain/mod.rs`
- Modify: `services/sentinel-core/src/lib.rs`

- [ ] **Step 1: Create services/sentinel-core/src/domain/circle.rs**

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Canonical circle — transport/domain form. No sqlx::FromRow.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Circle {
    pub id: Uuid,
    pub owner_pubkey: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
}

/// Canonical circle member — transport/domain form.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CircleMember {
    pub circle_id: Uuid,
    pub member_pubkey: String,
    pub alert_radius_km: Option<f64>,
    pub alert_severity: Option<String>,
    pub joined_at: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn circle_serde_round_trip() {
        let c = Circle {
            id: Uuid::nil(),
            owner_pubkey: "abc123".into(),
            name: "Family".into(),
            created_at: Utc::now(),
        };
        let json = serde_json::to_string(&c).unwrap();
        let back: Circle = serde_json::from_str(&json).unwrap();
        assert_eq!(c.id, back.id);
        assert_eq!(c.owner_pubkey, back.owner_pubkey);
        assert_eq!(c.name, back.name);
    }

    #[test]
    fn circle_member_optional_fields_round_trip() {
        let m = CircleMember {
            circle_id: Uuid::nil(),
            member_pubkey: "def456".into(),
            alert_radius_km: None,
            alert_severity: None,
            joined_at: Utc::now(),
        };
        let json = serde_json::to_string(&m).unwrap();
        let back: CircleMember = serde_json::from_str(&json).unwrap();
        assert_eq!(back.alert_radius_km, None);
        assert_eq!(back.alert_severity, None);
        assert_eq!(back.member_pubkey, "def456");
    }

    #[test]
    fn circle_member_with_alert_settings_round_trip() {
        let m = CircleMember {
            circle_id: Uuid::nil(),
            member_pubkey: "pk".into(),
            alert_radius_km: Some(5.0),
            alert_severity: Some("HIGH".into()),
            joined_at: Utc::now(),
        };
        let json = serde_json::to_string(&m).unwrap();
        let back: CircleMember = serde_json::from_str(&json).unwrap();
        assert_eq!(back.alert_radius_km, Some(5.0));
        assert_eq!(back.alert_severity, Some("HIGH".into()));
    }
}
```

- [ ] **Step 2: Create services/sentinel-core/src/domain/location.rs**

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Canonical encrypted location blob — transport/domain form.
/// The server never inspects encrypted_payload; it is opaque ciphertext.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LocationBlob {
    pub id: Uuid,
    pub circle_id: Uuid,
    pub sender_pubkey: String,
    pub encrypted_payload: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn location_blob_serde_round_trip() {
        let b = LocationBlob {
            id: Uuid::nil(),
            circle_id: Uuid::nil(),
            sender_pubkey: "pubkey".into(),
            encrypted_payload: "cipher".into(),
            created_at: Utc::now(),
            expires_at: Utc::now(),
        };
        let json = serde_json::to_string(&b).unwrap();
        let back: LocationBlob = serde_json::from_str(&json).unwrap();
        assert_eq!(b.id, back.id);
        assert_eq!(b.sender_pubkey, back.sender_pubkey);
        assert_eq!(b.encrypted_payload, back.encrypted_payload);
    }
}
```

- [ ] **Step 3: Update services/sentinel-core/src/domain/mod.rs**

```rust
pub mod circle;
pub mod event;
pub mod location;
```

- [ ] **Step 4: Update services/sentinel-core/src/lib.rs with all re-exports**

```rust
pub mod crypto;
pub mod domain;
pub mod jobs;
pub mod retry;

pub use domain::circle::{Circle, CircleMember};
pub use domain::event::Event;
pub use domain::location::LocationBlob;
```

- [ ] **Step 5: Run the full sentinel-core test suite**

```
cd services && cargo test -p sentinel-core
```

Expected: all pre-existing tests pass (crypto: 5, retry: 3, jobs: 2) plus the new domain tests (event: 2, circle: 3, location: 1) = 16 total.

```
running 16 tests
test crypto::tests::... ok  (×5)
test domain::circle::tests::circle_member_optional_fields_round_trip ... ok
test domain::circle::tests::circle_member_with_alert_settings_round_trip ... ok
test domain::circle::tests::circle_serde_round_trip ... ok
test domain::event::tests::optional_fields_absent_round_trip ... ok
test domain::event::tests::serde_round_trip ... ok
test domain::location::tests::location_blob_serde_round_trip ... ok
test jobs::tests::... ok  (×2)
test retry::tests::... ok  (×3)
test result: ok. 16 passed; 0 failed
```

- [ ] **Step 6: Commit**

```
git add services/sentinel-core/src/domain/circle.rs
git add services/sentinel-core/src/domain/location.rs
git add services/sentinel-core/src/domain/mod.rs
git add services/sentinel-core/src/lib.rs
git commit -m "feat(sentinel-core): add domain::Circle, CircleMember, LocationBlob types"
```

---

### Task 3: Gateway From<> adapters for Event, Circle, CircleMember

**Files:**
- Modify: `services/gateway/src/routes/events.rs` (append impl + test module)
- Modify: `services/gateway/src/routes/circles.rs` (append impls + test module)

Context: In `events.rs`, the local struct is `SafetyEvent` (has sqlx::FromRow, radius_meters, nostr_event_id, etc.). The domain `Event` is the slimmer canonical form. The From impl maps only the shared fields. In `circles.rs`, both the local `Circle` and `sentinel_core::Circle` have the same field names — the impl routes between them unambiguously because Rust distinguishes by crate path.

- [ ] **Step 1: Append From<SafetyEvent> impl and test to events.rs**

At the bottom of `services/gateway/src/routes/events.rs`, after the `pub fn router()` block, add:

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
            created_at: row.created_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use uuid::Uuid;

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
            nostr_event_id: Some("nevent1abc".into()),
            bitcoin_txid: None,
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn from_safety_event_maps_core_fields() {
        let row = sample_db_row();
        let e = sentinel_core::Event::from(row);
        assert_eq!(e.id, Uuid::nil());
        assert_eq!(e.event_type, "FLOOD");
        assert_eq!(e.severity, "CRITICAL");
        assert_eq!(e.lat, -1.2921);
        assert_eq!(e.county, Some("Nairobi".into()));
        assert!(e.is_active);
    }

    #[test]
    fn from_safety_event_drops_db_only_fields() {
        // DB-only fields (radius_meters, nostr_event_id, bitcoin_txid, updated_at,
        // confidence, source_count, source_breakdown) do not exist on domain::Event.
        // This test verifies the conversion compiles and produces a valid domain type.
        let row = sample_db_row();
        let e = sentinel_core::Event::from(row);
        // These fields exist on the domain type:
        let _: Uuid = e.id;
        let _: String = e.event_type;
        let _: String = e.severity;
        let _: bool = e.is_active;
    }
}
```

- [ ] **Step 2: Run to verify events.rs compiles and tests pass**

```
cd services && cargo test -p gateway routes::events
```

Expected:
```
running 2 tests
test routes::events::tests::from_safety_event_drops_db_only_fields ... ok
test routes::events::tests::from_safety_event_maps_core_fields ... ok
test result: ok. 2 passed; 0 failed
```

- [ ] **Step 3: Append From impls and test to circles.rs**

At the bottom of `services/gateway/src/routes/circles.rs`, after the `pub fn router()` block, add:

```rust
impl From<Circle> for sentinel_core::domain::circle::Circle {
    fn from(row: Circle) -> Self {
        Self {
            id: row.id,
            owner_pubkey: row.owner_pubkey,
            name: row.name,
            created_at: row.created_at,
        }
    }
}

impl From<CircleMember> for sentinel_core::domain::circle::CircleMember {
    fn from(row: CircleMember) -> Self {
        Self {
            circle_id: row.circle_id,
            member_pubkey: row.member_pubkey,
            alert_radius_km: row.alert_radius_km,
            alert_severity: row.alert_severity,
            joined_at: row.joined_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use uuid::Uuid;

    #[test]
    fn circle_converts_to_domain() {
        let id = Uuid::new_v4();
        let now = Utc::now();
        let row = Circle { id, owner_pubkey: "pk".into(), name: "Home".into(), created_at: now };
        let d = sentinel_core::domain::circle::Circle::from(row);
        assert_eq!(d.id, id);
        assert_eq!(d.name, "Home");
        assert_eq!(d.owner_pubkey, "pk");
    }

    #[test]
    fn circle_member_converts_to_domain() {
        let cid = Uuid::new_v4();
        let now = Utc::now();
        let row = CircleMember {
            circle_id: cid,
            member_pubkey: "mpk".into(),
            alert_radius_km: Some(5.0),
            alert_severity: Some("HIGH".into()),
            joined_at: now,
        };
        let d = sentinel_core::domain::circle::CircleMember::from(row);
        assert_eq!(d.circle_id, cid);
        assert_eq!(d.member_pubkey, "mpk");
        assert_eq!(d.alert_radius_km, Some(5.0));
        assert_eq!(d.alert_severity, Some("HIGH".into()));
    }

    #[test]
    fn circle_member_no_alerts_converts_to_domain() {
        let now = Utc::now();
        let row = CircleMember {
            circle_id: Uuid::nil(),
            member_pubkey: "anon".into(),
            alert_radius_km: None,
            alert_severity: None,
            joined_at: now,
        };
        let d = sentinel_core::domain::circle::CircleMember::from(row);
        assert_eq!(d.alert_radius_km, None);
        assert_eq!(d.alert_severity, None);
    }
}
```

- [ ] **Step 4: Run to verify circles.rs compiles and tests pass**

```
cd services && cargo test -p gateway routes::circles
```

Expected:
```
running 3 tests
test routes::circles::tests::circle_converts_to_domain ... ok
test routes::circles::tests::circle_member_converts_to_domain ... ok
test routes::circles::tests::circle_member_no_alerts_converts_to_domain ... ok
test result: ok. 3 passed; 0 failed
```

- [ ] **Step 5: Commit**

```
git add services/gateway/src/routes/events.rs
git add services/gateway/src/routes/circles.rs
git commit -m "feat(gateway): add From<DbStruct> adapters for domain::Event, Circle, CircleMember"
```

---

### Task 4: Gateway From<> adapter for LocationBlob; full test run; commit

**Files:**
- Modify: `services/gateway/src/routes/location_blobs.rs` (append impl + test module)

Context: The gateway `LocationBlob` (has sqlx::FromRow) and `sentinel_core::LocationBlob` have identical fields — the From impl is a direct field-for-field copy. This is fine: the two types remain distinct (one is a DB model, one is a domain/transport type). The name collision between `LocationBlob` and `sentinel_core::LocationBlob` is resolved by Rust's path system — `impl From<LocationBlob>` refers to the local struct; `for sentinel_core::LocationBlob` refers to the re-exported domain type.

- [ ] **Step 1: Append From impl and test to location_blobs.rs**

At the bottom of `services/gateway/src/routes/location_blobs.rs`, after the `pub fn router()` block, add:

```rust
impl From<LocationBlob> for sentinel_core::LocationBlob {
    fn from(row: LocationBlob) -> Self {
        Self {
            id: row.id,
            circle_id: row.circle_id,
            sender_pubkey: row.sender_pubkey,
            encrypted_payload: row.encrypted_payload,
            created_at: row.created_at,
            expires_at: row.expires_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use uuid::Uuid;

    #[test]
    fn location_blob_converts_to_domain() {
        let id = Uuid::new_v4();
        let cid = Uuid::new_v4();
        let now = Utc::now();
        let row = LocationBlob {
            id,
            circle_id: cid,
            sender_pubkey: "spk".into(),
            encrypted_payload: "ciphertext".into(),
            created_at: now,
            expires_at: now,
        };
        let d = sentinel_core::LocationBlob::from(row);
        assert_eq!(d.id, id);
        assert_eq!(d.circle_id, cid);
        assert_eq!(d.sender_pubkey, "spk");
        assert_eq!(d.encrypted_payload, "ciphertext");
    }
}
```

- [ ] **Step 2: Run location_blobs tests**

```
cd services && cargo test -p gateway routes::location_blobs
```

Expected:
```
running 1 test
test routes::location_blobs::tests::location_blob_converts_to_domain ... ok
test result: ok. 1 passed; 0 failed
```

- [ ] **Step 3: Run the full workspace test suite**

```
cd services && cargo test
```

Expected: all tests pass across sentinel-core, gateway, blockchain. Count should be the prior 23 gateway tests + 10 pre-existing sentinel-core tests + 6 new domain tests + 6 new gateway adapter tests = at least 45 tests, 0 failures.

If any test fails: check whether a pre-existing test broke (regression) or a new test failed (type mismatch in the adapter). Fix before committing.

- [ ] **Step 4: Verify blockchain still compiles cleanly**

```
cd services && cargo build -p blockchain
```

Expected: `Finished` with no errors. The blockchain crate does not import the new domain types; this step confirms the workspace-level re-exports did not introduce any ambiguity.

- [ ] **Step 5: Commit and push**

```
git add services/gateway/src/routes/location_blobs.rs
git commit -m "feat(gateway): add From<LocationBlob> adapter for domain::LocationBlob"
git push
```

- [ ] **Step 6: Open PR**

```
gh pr create \
  --title "feat: sentinel-core Phase 3 — extract Event, Circle, CircleMember, LocationBlob domain types" \
  --body "$(cat <<'EOF'
## Summary

- Adds sentinel-core/src/domain/ with four pure structs: Event, Circle, CircleMember, LocationBlob
- Types depend only on serde, uuid, chrono — no sqlx, no axum, no async
- Gateway DB structs (SafetyEvent, Circle, CircleMember, LocationBlob) gain From<> impls that convert to the canonical domain types
- No handler, DB query, or WebSocket payload is changed
- Blockchain crate is untouched

## What this enables

Both services now share one authoritative type definition. Future work (Nostr publishing, cross-service event validation, Redis schema contracts) can import from sentinel-core instead of duplicating structs.

## Test plan
- [ ] cargo test -p sentinel-core — 16 tests pass
- [ ] cargo test -p gateway — 29 tests pass (23 existing + 6 new adapter tests)
- [ ] cargo build -p blockchain — compiles clean
EOF
)"
```
