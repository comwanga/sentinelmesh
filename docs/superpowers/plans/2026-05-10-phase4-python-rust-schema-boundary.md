# Phase 4: Python–Rust Schema Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `sentinel_core::RedisEventPayload` the authoritative schema for the `sentinel:events:new` Redis channel — generate a JSON Schema artifact from it, align Python to emit flat snake_case payloads validated against that schema, and add compile-time-embedded startup validation plus per-message validation in the Rust subscriber.

**Architecture:** `schemars` derives a JSON Schema from `RedisEventPayload` (a transport struct wrapping all `Event` fields plus `schema_version: 1`). The schema is committed at `services/event_schema.json`. The Rust gateway embeds it via `include_str!` at compile time and compiles a `jsonschema::Validator` at startup (fatal on failure). Each incoming Redis message is validated against that validator before deserialization — invalid messages are warned and dropped, never propagated. Python adds `jsonschema` validation before publishing, and `event_fuser.build_event` is updated to emit the new flat format.

**Tech Stack:** `schemars 0.8` (Rust schema generation), `jsonschema 0.22` (Rust runtime validation), `jsonschema 4.23.0` (Python pre-publish validation)

---

## File Map

**Create:**
- `services/sentinel-core/src/schema.rs` — `RedisEventPayload` struct, `JsonSchema` derive, `From<RedisEventPayload> for Event`
- `services/sentinel-core/src/bin/export_schema.rs` — CLI binary that prints the schema JSON to stdout
- `services/event_schema.json` — generated schema artifact (committed, source of truth for Rust `include_str!`)
- `services/signal/event_schema.json` — copy of schema for Python Docker image (committed)
- `services/signal/tests/test_publisher.py` — publisher validation tests

**Modify:**
- `services/Cargo.toml` — add `schemars` to workspace dependencies
- `services/sentinel-core/Cargo.toml` — add `schemars`
- `services/sentinel-core/src/lib.rs` — `pub mod schema; pub use schema::RedisEventPayload;`
- `services/gateway/Cargo.toml` — add `jsonschema`
- `services/gateway/src/subscribers/event_subscriber.rs` — embed schema, startup validator, per-message validation, new `handle_message` using `RedisEventPayload`
- `services/signal/nlp/event_fuser.py` — new flat format matching schema
- `services/signal/tests/test_event_fuser.py` — update tests to match new format
- `services/signal/publisher.py` — add jsonschema pre-publish validation
- `services/signal/requirements.api.txt` — add `jsonschema==4.23.0`
- `services/signal/requirements.dev.txt` — add `jsonschema==4.23.0`

---

### Task 1: Add schemars, create RedisEventPayload, create export binary

**Files:**
- Create: `services/sentinel-core/src/schema.rs`
- Create: `services/sentinel-core/src/bin/export_schema.rs`
- Modify: `services/Cargo.toml`
- Modify: `services/sentinel-core/Cargo.toml`
- Modify: `services/sentinel-core/src/lib.rs`

- [ ] **Step 1: Write failing test for RedisEventPayload serde round-trip**

Add to the bottom of `services/sentinel-core/src/schema.rs` (create the file with tests first):

```rust
use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

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
            created_at: p.created_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn sample() -> RedisEventPayload {
        RedisEventPayload {
            schema_version: 1,
            id: Uuid::nil(),
            event_type: "FLOOD".into(),
            severity: "CRITICAL".into(),
            title: "Flooding downtown".into(),
            lat: -1.2921,
            lng: 36.8219,
            started_at: Utc::now(),
            summary: Some("Roads impassable".into()),
            place_name: Some("CBD".into()),
            county: Some("Nairobi".into()),
            is_active: true,
            created_at: Utc::now(),
        }
    }

    #[test]
    fn serde_round_trip() {
        let p = sample();
        let json = serde_json::to_string(&p).unwrap();
        let back: RedisEventPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(p.schema_version, back.schema_version);
        assert_eq!(p.id, back.id);
        assert_eq!(p.event_type, back.event_type);
        assert_eq!(p.severity, back.severity);
        assert_eq!(p.lat, back.lat);
        assert_eq!(p.is_active, back.is_active);
        assert_eq!(p.county, back.county);
    }

    #[test]
    fn converts_to_event() {
        let p = sample();
        let e = crate::Event::from(p.clone());
        assert_eq!(e.id, p.id);
        assert_eq!(e.event_type, p.event_type);
        assert_eq!(e.lat, p.lat);
        assert_eq!(e.county, p.county);
        assert_eq!(e.is_active, p.is_active);
    }

    #[test]
    fn optional_fields_absent() {
        let mut p = sample();
        p.summary = None;
        p.place_name = None;
        p.county = None;
        let json = serde_json::to_string(&p).unwrap();
        let back: RedisEventPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(back.summary, None);
        assert_eq!(back.place_name, None);
        assert_eq!(back.county, None);
    }
}
```

- [ ] **Step 2: Run test to verify it fails (schemars not yet added)**

Run: `cargo test -p sentinel-core 2>&1 | head -20`
Expected: compile error about `schemars::JsonSchema` not in scope

- [ ] **Step 3: Add schemars to workspace and sentinel-core Cargo.toml**

In `services/Cargo.toml`, add to `[workspace.dependencies]`:

```toml
schemars = { version = "0.8", features = ["uuid1", "chrono"] }
```

In `services/sentinel-core/Cargo.toml`, add to `[dependencies]`:

```toml
schemars = { workspace = true }
```

- [ ] **Step 4: Add `pub mod schema` to sentinel-core lib.rs**

`services/sentinel-core/src/lib.rs` should read:

```rust
pub mod crypto;
pub mod domain;
pub mod jobs;
pub mod retry;
pub mod schema;

pub use domain::circle::{Circle, CircleMember};
pub use domain::event::Event;
pub use domain::location::LocationBlob;
pub use schema::RedisEventPayload;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p sentinel-core`
Expected: all tests pass including the 3 new ones in `schema.rs`

- [ ] **Step 6: Create the export binary**

Create `services/sentinel-core/src/bin/export_schema.rs`:

```rust
use schemars::schema::Schema;

fn main() {
    let mut root = schemars::schema_for!(sentinel_core::RedisEventPayload);
    if let Some(obj) = root.schema.object.as_mut() {
        obj.additional_properties = Some(Box::new(Schema::Bool(false)));
    }
    println!("{}", serde_json::to_string_pretty(&root).unwrap());
}
```

- [ ] **Step 7: Verify the binary compiles**

Run: `cargo build --bin export_schema -p sentinel-core`
Expected: PASS (binary produced at `target/debug/export_schema`)

- [ ] **Step 8: Commit**

```bash
git add services/Cargo.toml services/sentinel-core/Cargo.toml services/sentinel-core/src/schema.rs services/sentinel-core/src/bin/export_schema.rs services/sentinel-core/src/lib.rs
git commit -m "feat(sentinel-core): add RedisEventPayload with JsonSchema derive and export_schema binary"
```

---

### Task 2: Generate and commit event_schema.json

**Files:**
- Create: `services/event_schema.json`
- Create: `services/signal/event_schema.json`

- [ ] **Step 1: Generate the schema from sentinel-core**

Run from `services/`:

```bash
cargo run --bin export_schema -p sentinel-core > event_schema.json
```

- [ ] **Step 2: Inspect the schema**

Run: `cat services/event_schema.json | python -m json.tool --no-ensure-ascii | head -40`

Expected output should contain:
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "RedisEventPayload",
  "type": "object",
  "required": [
    "schema_version",
    "id",
    "event_type",
    "severity",
    "title",
    "lat",
    "lng",
    "started_at",
    "is_active",
    "created_at"
  ],
  "properties": {
    "schema_version": { "type": "integer", "minimum": 0.0 },
    "id": { "type": "string", "format": "uuid" },
    ...
  },
  "additionalProperties": false
}
```

Verify `additionalProperties: false` is present and `summary`, `place_name`, `county` are listed as non-required properties.

- [ ] **Step 3: Copy schema to signal service directory**

Run: `cp services/event_schema.json services/signal/event_schema.json`

- [ ] **Step 4: Commit both schema files**

```bash
git add services/event_schema.json services/signal/event_schema.json
git commit -m "feat: commit generated event_schema.json — schema_version + Event fields, additionalProperties false"
```

---

### Task 3: Update Python to emit flat snake_case format, add publisher validation

**Files:**
- Modify: `services/signal/nlp/event_fuser.py`
- Modify: `services/signal/tests/test_event_fuser.py`
- Modify: `services/signal/publisher.py`
- Modify: `services/signal/requirements.api.txt`
- Modify: `services/signal/requirements.dev.txt`
- Create: `services/signal/tests/test_publisher.py`

- [ ] **Step 1: Write failing tests for the new build_event format**

Replace `services/signal/tests/test_event_fuser.py` with:

```python
import pytest
from nlp.event_fuser import should_fuse, build_event
from datetime import datetime, timezone

BASE_TIME = datetime(2026, 4, 28, 9, 0, 0, tzinfo=timezone.utc)

SIGNAL_A = {
    "event_type": "FLOOD",
    "severity": "HIGH",
    "location": {"lat": -1.2572, "lng": 36.8572, "place_name": "mathare", "county": "Nairobi"},
    "title": "Flooding in Mathare",
    "summary": "Water levels rising",
    "confidence": 0.80,
    "source_type": "news",
    "timestamp": BASE_TIME,
}

SIGNAL_B = {
    "event_type": "FLOOD",
    "severity": "HIGH",
    "location": {"lat": -1.2580, "lng": 36.8560, "place_name": "mathare", "county": "Nairobi"},
    "title": "Mathare river flooding",
    "summary": "Residents fleeing",
    "confidence": 0.75,
    "source_type": "twitter",
    "timestamp": BASE_TIME,
}

DISTANT_SIGNAL = {
    "event_type": "FLOOD",
    "severity": "HIGH",
    "location": {"lat": -4.0435, "lng": 39.6682, "place_name": "mombasa", "county": "Mombasa"},
    "title": "Flooding in Mombasa",
    "summary": "Coast flooding",
    "confidence": 0.70,
    "source_type": "rss",
    "timestamp": BASE_TIME,
}

def test_nearby_same_type_should_fuse():
    assert should_fuse(SIGNAL_A, SIGNAL_B) is True

def test_distant_signals_should_not_fuse():
    assert should_fuse(SIGNAL_A, DISTANT_SIGNAL) is False

def test_different_type_should_not_fuse():
    fire_signal = {**SIGNAL_B, "event_type": "FIRE"}
    assert should_fuse(SIGNAL_A, fire_signal) is False

def test_build_event_schema_fields_present():
    event = build_event([SIGNAL_A, SIGNAL_B])
    assert event["schema_version"] == 1
    assert "id" in event
    assert event["event_type"] == "FLOOD"
    assert event["severity"] == "HIGH"
    assert "title" in event
    assert "started_at" in event
    assert event["is_active"] is True
    assert "created_at" in event

def test_build_event_flat_location():
    event = build_event([SIGNAL_A])
    assert event["lat"] == -1.2572
    assert event["lng"] == 36.8572
    assert event["place_name"] == "mathare"
    assert event["county"] == "Nairobi"
    assert "location" not in event

def test_build_event_started_at_is_earliest():
    earlier = {**SIGNAL_A, "timestamp": datetime(2026, 4, 28, 8, 0, tzinfo=timezone.utc)}
    later = {**SIGNAL_B, "timestamp": datetime(2026, 4, 28, 9, 0, tzinfo=timezone.utc)}
    event = build_event([later, earlier])
    assert event["started_at"] == earlier["timestamp"].isoformat()

def test_build_event_no_extra_fields():
    event = build_event([SIGNAL_A])
    allowed = {"schema_version", "id", "event_type", "severity", "title", "lat", "lng",
               "started_at", "summary", "place_name", "county", "is_active", "created_at"}
    assert set(event.keys()) == allowed
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `services/signal/`): `pytest tests/test_event_fuser.py -v`
Expected: several failures — `schema_version` not in event, `id` not present, `lat` not present, `location` key still present

- [ ] **Step 3: Update event_fuser.py**

Replace `services/signal/nlp/event_fuser.py` with:

```python
import uuid
import math
from datetime import datetime, timezone

FUSE_RADIUS_KM = 2.0
FUSE_WINDOW_MINUTES = 30

SEVERITY_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def should_fuse(signal_a: dict, signal_b: dict) -> bool:
    if signal_a["event_type"] != signal_b["event_type"]:
        return False

    loc_a = signal_a.get("location")
    loc_b = signal_b.get("location")
    if not loc_a or not loc_b:
        return False

    dist = _haversine_km(loc_a["lat"], loc_a["lng"], loc_b["lat"], loc_b["lng"])
    if dist > FUSE_RADIUS_KM:
        return False

    delta_minutes = abs(
        (signal_a["timestamp"] - signal_b["timestamp"]).total_seconds() / 60
    )
    return delta_minutes <= FUSE_WINDOW_MINUTES


def build_event(signals: list[dict]) -> dict:
    """
    Merge a cluster of signals into one RedisEventPayload.
    Output matches services/event_schema.json exactly.
    """
    best = max(signals, key=lambda s: s["confidence"])
    highest_severity = max(
        (s["severity"] for s in signals),
        key=lambda sv: SEVERITY_ORDER.index(sv),
    )

    loc = best.get("location") or {}

    return {
        "schema_version": 1,
        "id": str(uuid.uuid4()),
        "event_type": best["event_type"],
        "severity": highest_severity,
        "title": best["title"],
        "lat": loc.get("lat"),
        "lng": loc.get("lng"),
        "started_at": min(s["timestamp"] for s in signals).isoformat(),
        "summary": best.get("summary"),
        "place_name": loc.get("place_name"),
        "county": loc.get("county"),
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
```

- [ ] **Step 4: Run event_fuser tests to verify they pass**

Run: `pytest tests/test_event_fuser.py -v`
Expected: all 9 tests pass

- [ ] **Step 5: Add jsonschema to requirements**

In `services/signal/requirements.api.txt`, add:
```
jsonschema==4.23.0
```

In `services/signal/requirements.dev.txt`, add:
```
jsonschema==4.23.0
```

- [ ] **Step 6: Write failing tests for publisher validation**

Create `services/signal/tests/test_publisher.py`:

```python
import pytest
from unittest.mock import AsyncMock, patch

VALID_EVENT = {
    "schema_version": 1,
    "id": "00000000-0000-0000-0000-000000000001",
    "event_type": "FLOOD",
    "severity": "CRITICAL",
    "title": "Flooding downtown",
    "lat": -1.2921,
    "lng": 36.8219,
    "started_at": "2026-01-01T00:00:00+00:00",
    "summary": "Roads impassable",
    "place_name": "CBD",
    "county": "Nairobi",
    "is_active": True,
    "created_at": "2026-01-01T00:00:00+00:00",
}


def _reset_schema_cache():
    import publisher
    publisher._schema = None


@pytest.mark.asyncio
async def test_valid_event_is_published():
    mock_client = AsyncMock()
    _reset_schema_cache()
    with patch("publisher.get_client", return_value=mock_client):
        import publisher
        await publisher.emit_event(VALID_EVENT.copy())
    mock_client.publish.assert_awaited_once()


@pytest.mark.asyncio
async def test_missing_required_field_drops_event():
    bad = {k: v for k, v in VALID_EVENT.items() if k != "event_type"}
    mock_client = AsyncMock()
    _reset_schema_cache()
    with patch("publisher.get_client", return_value=mock_client):
        import publisher
        await publisher.emit_event(bad)
    mock_client.publish.assert_not_called()


@pytest.mark.asyncio
async def test_extra_field_drops_event():
    bad = {**VALID_EVENT, "extra_field": "not_allowed"}
    mock_client = AsyncMock()
    _reset_schema_cache()
    with patch("publisher.get_client", return_value=mock_client):
        import publisher
        await publisher.emit_event(bad)
    mock_client.publish.assert_not_called()


@pytest.mark.asyncio
async def test_null_lat_drops_event():
    bad = {**VALID_EVENT, "lat": None}
    mock_client = AsyncMock()
    _reset_schema_cache()
    with patch("publisher.get_client", return_value=mock_client):
        import publisher
        await publisher.emit_event(bad)
    mock_client.publish.assert_not_called()


@pytest.mark.asyncio
async def test_optional_fields_absent_still_publishes():
    event = {k: v for k, v in VALID_EVENT.items()
             if k not in ("summary", "place_name", "county")}
    mock_client = AsyncMock()
    _reset_schema_cache()
    with patch("publisher.get_client", return_value=mock_client):
        import publisher
        await publisher.emit_event(event)
    mock_client.publish.assert_awaited_once()
```

- [ ] **Step 7: Run publisher tests to verify they fail**

Run: `pytest tests/test_publisher.py -v`
Expected: failures — publisher doesn't have validation yet, valid events publish but invalid ones also publish instead of being dropped

- [ ] **Step 8: Update publisher.py to add jsonschema validation**

Replace `services/signal/publisher.py` with:

```python
import json
import logging
from pathlib import Path

import jsonschema
import redis.asyncio as aioredis
import config

logger = logging.getLogger(__name__)

_client: aioredis.Redis | None = None
_schema: dict | None = None
_SCHEMA_PATH = Path(__file__).parent / "event_schema.json"


def _get_schema() -> dict:
    global _schema
    if _schema is None:
        _schema = json.loads(_SCHEMA_PATH.read_text())
    return _schema


async def get_client() -> aioredis.Redis:
    global _client
    if _client is None:
        _client = aioredis.from_url(config.REDIS_URL, decode_responses=True)
    return _client


async def emit_event(event: dict) -> None:
    """Validate against event_schema.json then publish to Redis. Drops invalid events."""
    try:
        jsonschema.validate(instance=event, schema=_get_schema())
    except jsonschema.ValidationError as e:
        logger.warning("dropping event that failed schema validation: %s", e.message)
        return

    client = await get_client()
    await client.publish("sentinel:events:new", json.dumps(event))
```

- [ ] **Step 9: Run all signal tests**

Run: `pytest -v`
Expected: all tests pass (event_fuser, publisher, and existing tests)

- [ ] **Step 10: Commit**

```bash
git add services/signal/nlp/event_fuser.py \
        services/signal/tests/test_event_fuser.py \
        services/signal/tests/test_publisher.py \
        services/signal/publisher.py \
        services/signal/requirements.api.txt \
        services/signal/requirements.dev.txt
git commit -m "feat(signal): emit flat snake_case RedisEventPayload, add jsonschema pre-publish validation"
```

---

### Task 4: Update Rust subscriber with embedded schema validation

**Files:**
- Modify: `services/gateway/Cargo.toml`
- Modify: `services/gateway/src/subscribers/event_subscriber.rs`

- [ ] **Step 1: Write failing unit tests first**

Add this test module at the bottom of `services/gateway/src/subscribers/event_subscriber.rs`:

```rust
#[cfg(test)]
mod tests {
    const SCHEMA_JSON: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../event_schema.json"
    ));

    fn make_validator() -> jsonschema::Validator {
        let schema: serde_json::Value = serde_json::from_str(SCHEMA_JSON).unwrap();
        jsonschema::validator_for(&schema).unwrap()
    }

    fn valid_payload() -> serde_json::Value {
        serde_json::json!({
            "schema_version": 1,
            "id": "00000000-0000-0000-0000-000000000001",
            "event_type": "FLOOD",
            "severity": "CRITICAL",
            "title": "Flooding downtown",
            "lat": -1.2921,
            "lng": 36.8219,
            "started_at": "2026-01-01T00:00:00Z",
            "summary": "Roads impassable",
            "place_name": "CBD",
            "county": "Nairobi",
            "is_active": true,
            "created_at": "2026-01-01T00:00:00Z"
        })
    }

    #[test]
    fn schema_loads_and_compiles() {
        make_validator();
    }

    #[test]
    fn valid_event_passes_validation() {
        let v = make_validator();
        assert!(v.validate(&valid_payload()).is_ok());
    }

    #[test]
    fn missing_required_field_fails_validation() {
        let v = make_validator();
        let mut bad = valid_payload();
        bad.as_object_mut().unwrap().remove("event_type");
        assert!(v.validate(&bad).is_err());
    }

    #[test]
    fn extra_field_fails_due_to_additional_properties_false() {
        let v = make_validator();
        let mut bad = valid_payload();
        bad["extra"] = serde_json::json!("not allowed");
        assert!(v.validate(&bad).is_err());
    }

    #[test]
    fn malformed_json_is_caught_before_validation() {
        let bad_json = "not json at all {{";
        let parse_result = serde_json::from_str::<serde_json::Value>(bad_json);
        assert!(parse_result.is_err());
    }

    #[test]
    fn optional_fields_absent_passes_validation() {
        let v = make_validator();
        let mut event = valid_payload();
        let obj = event.as_object_mut().unwrap();
        obj.remove("summary");
        obj.remove("place_name");
        obj.remove("county");
        assert!(v.validate(&event).is_ok());
    }
}
```

- [ ] **Step 2: Run tests to verify they fail (jsonschema not yet added)**

Run: `cargo test -p gateway 2>&1 | head -20`
Expected: compile error — `jsonschema` not in scope

- [ ] **Step 3: Add jsonschema to gateway Cargo.toml**

In `services/gateway/Cargo.toml`, add to `[dependencies]`:

```toml
jsonschema = "0.22"
```

- [ ] **Step 4: Run tests to verify they pass before changing subscriber**

Run: `cargo test -p gateway -- event_subscriber`
Expected: all 6 tests pass (the schema file exists and loads correctly)

- [ ] **Step 5: Update event_subscriber.rs**

Replace the entire content of `services/gateway/src/subscribers/event_subscriber.rs` with:

```rust
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use anyhow::Result;
use futures::StreamExt;
use sqlx::PgPool;
use tokio::time::{sleep, Duration};

use crate::ws::hub::WsHub;

const CHANNEL: &str = "sentinel:events:new";
const BASE_BACKOFF_MS: u64 = 100;
const MAX_BACKOFF_MS: u64 = 30_000;

const SCHEMA_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../event_schema.json"
));

pub async fn run(
    redis_url: String,
    pool: PgPool,
    hub: Arc<WsHub>,
    redis_healthy: Arc<AtomicBool>,
) {
    let mut backoff_ms = BASE_BACKOFF_MS;
    loop {
        match subscribe_loop(&redis_url, &pool, &hub, &redis_healthy).await {
            Ok(()) => break,
            Err(e) => {
                let was_healthy = redis_healthy.swap(false, Ordering::Relaxed);
                if was_healthy {
                    backoff_ms = BASE_BACKOFF_MS;
                }
                tracing::warn!(
                    "redis subscriber error: {e:#}, retrying in {backoff_ms}ms"
                );
                sleep(Duration::from_millis(backoff_ms)).await;
                backoff_ms = (backoff_ms * 2).min(MAX_BACKOFF_MS);
            }
        }
    }
}

async fn subscribe_loop(
    redis_url: &str,
    pool: &PgPool,
    hub: &Arc<WsHub>,
    redis_healthy: &Arc<AtomicBool>,
) -> Result<()> {
    let schema: serde_json::Value = serde_json::from_str(SCHEMA_JSON)
        .expect("event_schema.json is invalid JSON — regenerate with export_schema binary");
    let validator = jsonschema::validator_for(&schema)
        .expect("event_schema.json is not a valid JSON Schema — regenerate with export_schema binary");

    let client = redis::Client::open(redis_url)?;
    let mut pubsub = client.get_async_pubsub().await?;
    pubsub.subscribe(CHANNEL).await?;

    redis_healthy.store(true, Ordering::Relaxed);
    tracing::info!("redis subscriber connected, listening on {CHANNEL}");

    let mut stream = pubsub.into_on_message();
    loop {
        let msg: redis::Msg = match stream.next().await {
            Some(m) => m,
            None => anyhow::bail!("redis pub/sub stream ended unexpectedly"),
        };

        let payload: String = msg.get_payload()?;

        let value: serde_json::Value = match serde_json::from_str(&payload) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!("dropping non-JSON message on {CHANNEL}: {e}");
                continue;
            }
        };

        if let Err(error) = validator.validate(&value) {
            tracing::warn!("dropping schema-invalid event on {CHANNEL}: {error}");
            continue;
        }

        let event: sentinel_core::RedisEventPayload = match serde_json::from_value(value) {
            Ok(e) => e,
            Err(e) => {
                tracing::warn!("dropping event that passed schema but failed deserialization: {e}");
                continue;
            }
        };

        if let Err(e) = handle_message(pool, hub, &event).await {
            tracing::warn!("failed to handle redis message: {e:#}");
        }
    }
}

async fn handle_message(
    pool: &PgPool,
    hub: &Arc<WsHub>,
    event: &sentinel_core::RedisEventPayload,
) -> Result<()> {
    let county = event.county.clone();

    sqlx::query(
        "INSERT INTO safety_events
           (id, event_type, severity, title, lat, lng, started_at,
            summary, place_name, county, is_active, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
         ON CONFLICT (id) DO UPDATE SET
           severity   = EXCLUDED.severity,
           title      = EXCLUDED.title,
           summary    = EXCLUDED.summary,
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

    let ws_msg = serde_json::json!({
        "type": "NEW_EVENT",
        "payload": sentinel_core::Event::from(event.clone())
    });
    hub.broadcast(
        county.as_deref(),
        serde_json::to_string(&ws_msg).unwrap().into(),
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_validator() -> jsonschema::Validator {
        let schema: serde_json::Value = serde_json::from_str(SCHEMA_JSON).unwrap();
        jsonschema::validator_for(&schema).unwrap()
    }

    fn valid_payload() -> serde_json::Value {
        serde_json::json!({
            "schema_version": 1,
            "id": "00000000-0000-0000-0000-000000000001",
            "event_type": "FLOOD",
            "severity": "CRITICAL",
            "title": "Flooding downtown",
            "lat": -1.2921,
            "lng": 36.8219,
            "started_at": "2026-01-01T00:00:00Z",
            "summary": "Roads impassable",
            "place_name": "CBD",
            "county": "Nairobi",
            "is_active": true,
            "created_at": "2026-01-01T00:00:00Z"
        })
    }

    #[test]
    fn schema_loads_and_compiles() {
        make_validator();
    }

    #[test]
    fn valid_event_passes_validation() {
        let v = make_validator();
        assert!(v.validate(&valid_payload()).is_ok());
    }

    #[test]
    fn missing_required_field_fails_validation() {
        let v = make_validator();
        let mut bad = valid_payload();
        bad.as_object_mut().unwrap().remove("event_type");
        assert!(v.validate(&bad).is_err());
    }

    #[test]
    fn extra_field_fails_due_to_additional_properties_false() {
        let v = make_validator();
        let mut bad = valid_payload();
        bad["extra"] = serde_json::json!("not allowed");
        assert!(v.validate(&bad).is_err());
    }

    #[test]
    fn malformed_json_is_caught_before_validation() {
        let bad_json = "not json at all {{";
        let parse_result = serde_json::from_str::<serde_json::Value>(bad_json);
        assert!(parse_result.is_err());
    }

    #[test]
    fn optional_fields_absent_passes_validation() {
        let v = make_validator();
        let mut event = valid_payload();
        let obj = event.as_object_mut().unwrap();
        obj.remove("summary");
        obj.remove("place_name");
        obj.remove("county");
        assert!(v.validate(&event).is_ok());
    }
}
```

- [ ] **Step 6: Run all gateway tests**

Run: `cargo test -p gateway`
Expected: all tests pass including the 6 subscriber tests

- [ ] **Step 7: Run full workspace build to catch any type errors**

Run: `cargo build`
Expected: clean build, no errors

- [ ] **Step 8: Commit**

```bash
git add services/gateway/Cargo.toml services/gateway/src/subscribers/event_subscriber.rs
git commit -m "feat(gateway): embed event_schema.json, validate Redis messages before deserialization"
```

---

## Done

After all 4 tasks pass their two-stage review:

1. Run `cargo test` — all Rust tests pass
2. Run `cd services/signal && pip install jsonschema==4.23.0 && pytest -v` — all Python tests pass
3. Push and create PR

**What changed end-to-end:**
- `sentinel_core::RedisEventPayload` is the canonical wire contract
- Rust gateway compiles the schema once at startup (fatal if broken), validates each message before deserialization (non-fatal: warn + drop)
- Python validates before publishing; invalid events are logged and dropped rather than causing downstream parse failures
- Payload format is now flat snake_case matching `sentinel_core::Event` — no more nested `location` object, no more camelCase fields, no more `event_id` vs `id` ambiguity
