# Acoustic Trust Pipeline — Phase 1: Secure Ingest

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unauthenticated `/api/reports` acoustic submission path with a dedicated `POST /api/acoustic/signals` endpoint that requires NIP-98 auth, rate-limits by pubkey, deduplicates by `client_id`, and derives H3 cells server-side — storing raw signals in `acoustic_signals` without touching `public_events`.

**Architecture:** New `acoustic_signals` Postgres table receives authenticated signal submissions. The gateway adds a new route file `routes/acoustic.rs` behind the existing `NostrAuth` extractor and a new `acoustic_limiter` (5/min per pubkey). The PWA gains a `signNip98AuthEvent(url, method)` helper in `nostrService.ts` and a new `acousticSignalSubmit.ts` service that replaces the old `reportAutoSubmit` call in both acoustic hooks.

**Tech Stack:** Rust/axum (gateway), `h3o` crate (H3 cell computation), `governor` (rate limiting), `sqlx` (DB), `nostr-tools` (PWA NIP-98 signing), `crypto.randomUUID()` (client_id generation), vitest (frontend tests)

---

## File Map

| File | Change |
|------|--------|
| `infra/postgres/migrations/007_acoustic_signals.sql` | Create |
| `services/gateway/Cargo.toml` | Add `h3o = "0.6"` |
| `services/gateway/src/main.rs` | Add `acoustic_limiter` field to `AppState`; initialise in `main()` |
| `services/gateway/src/routes/acoustic.rs` | Create — handler, validation helpers, tests |
| `services/gateway/src/routes/mod.rs` | Register `acoustic::router()` under `/api/acoustic` |
| `services/gateway/src/middleware/internal_auth.rs` | Update `make_state()` test helper to include `acoustic_limiter` |
| `services/gateway/src/middleware/nostr_auth.rs` | Update any `AppState` literals in tests to include `acoustic_limiter` |
| `apps/pwa/src/services/nostrService.ts` | Add `signNip98AuthEvent(url, method)` |
| `apps/pwa/src/services/acousticSignalSubmit.ts` | Create — NIP-98-authenticated signal submission |
| `apps/pwa/src/hooks/useAcousticEngine.ts` | Replace `autoSubmitAcousticReport` with `submitAcousticSignal` |
| `apps/pwa/src/hooks/useAcousticDetection.ts` | Same replacement |

---

### Task 1: DB migration — `acoustic_signals` table

**Files:**
- Create: `infra/postgres/migrations/007_acoustic_signals.sql`

- [ ] **Step 1: Write the migration**

```sql
-- infra/postgres/migrations/007_acoustic_signals.sql

CREATE TABLE acoustic_signals (
    id                   UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id            UUID             NOT NULL,
    pubkey               TEXT             NOT NULL,
    threat_class         TEXT             NOT NULL,
    confidence           REAL             NOT NULL,
    confidence_variance  REAL,
    lat                  DOUBLE PRECISION NOT NULL,
    lng                  DOUBLE PRECISION NOT NULL,
    h3_r9                TEXT             NOT NULL,
    h3_r7                TEXT             NOT NULL,
    received_at          TIMESTAMPTZ      NOT NULL DEFAULT now(),

    model_version        TEXT             NOT NULL,
    threshold_profile    TEXT             NOT NULL,
    inference_backend    TEXT             NOT NULL,
    processing_latency   INT,
    dropped_frames       INT              NOT NULL DEFAULT 0,
    device_category      TEXT,
    signal_fingerprint   TEXT,

    trust_state          TEXT             NOT NULL DEFAULT 'pending'
                         CHECK (trust_state IN ('pending', 'corroborating', 'confirmed', 'disputed', 'expired'))
);

-- Deduplication: one row per client_id forever (UUIDs never collide in practice)
CREATE UNIQUE INDEX acoustic_signals_client_id_uniq
    ON acoustic_signals (client_id);

-- Synthesis worker: find active signals by cell + class within a time window
CREATE INDEX acoustic_signals_synthesis_idx
    ON acoustic_signals (h3_r9, threat_class, received_at)
    WHERE trust_state IN ('pending', 'corroborating');

-- Reputation worker: signals by pubkey
CREATE INDEX acoustic_signals_pubkey_idx
    ON acoustic_signals (pubkey, received_at DESC);
```

- [ ] **Step 2: Apply the migration**

```bash
cd services/gateway
sqlx migrate run --source ../../infra/postgres/migrations
```

Expected: `Applied 007_acoustic_signals.sql`

- [ ] **Step 3: Verify the table exists**

```bash
psql "$DATABASE_URL" -c "\d acoustic_signals"
```

Expected: column list including `id`, `client_id`, `trust_state`, `h3_r9`, `h3_r7`.

- [ ] **Step 4: Commit**

```bash
git add infra/postgres/migrations/007_acoustic_signals.sql
git commit -m "feat: acoustic_signals table — Phase 1 signal staging"
```

---

### Task 2: Add `h3o` crate and `acoustic_limiter` to AppState

**Files:**
- Modify: `services/gateway/Cargo.toml`
- Modify: `services/gateway/src/main.rs`
- Modify: `services/gateway/src/middleware/internal_auth.rs` (test helper)
- Modify: `services/gateway/src/middleware/nostr_auth.rs` (test helpers)

The `h3o` crate computes H3 cells in pure Rust with no C FFI. The `acoustic_limiter` follows the same governor pattern as the existing `zap_limiter`.

- [ ] **Step 1: Add `h3o` to Cargo.toml**

In `services/gateway/Cargo.toml`, add after the `base64` line:

```toml
h3o          = "0.6"
```

- [ ] **Step 2: Verify it compiles**

```bash
cd services/gateway
cargo check
```

Expected: no errors.

- [ ] **Step 3: Add `acoustic_limiter` to `AppState` in `main.rs`**

In `services/gateway/src/main.rs`, add the field to the `AppState` struct:

```rust
#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::PgPool,
    pub config: Arc<config::Config>,
    pub http_client: reqwest::Client,
    pub hub: Arc<WsHub>,
    pub circle_hub: Arc<CircleHub>,
    pub redis_healthy: Arc<AtomicBool>,
    pub map_provider: std::sync::Arc<dyn maps::MapProvider>,
    pub zap_limiter: Arc<DefaultKeyedRateLimiter<String>>,
    pub acoustic_limiter: Arc<DefaultKeyedRateLimiter<String>>,
    pub event_tx: Arc<broadcast::Sender<ws::ViewportEvent>>,
    pub redis: redis::aio::ConnectionManager,
}
```

- [ ] **Step 4: Initialise `acoustic_limiter` in `main()`**

In `main()`, after the `zap_limiter` initialisation block, add:

```rust
let acoustic_quota = Quota::per_minute(
    NonZeroU32::new(5).unwrap(),
);
let acoustic_limiter: Arc<DefaultKeyedRateLimiter<String>> =
    Arc::new(RateLimiter::keyed(acoustic_quota));
```

And add `acoustic_limiter: acoustic_limiter.clone(),` to the `AppState { ... }` literal.

- [ ] **Step 5: Update `make_state()` in `internal_auth.rs`**

In `services/gateway/src/middleware/internal_auth.rs`, add `acoustic_limiter` to the `AppState` literal inside `make_state()`:

```rust
let acoustic_limiter = Arc::new(RateLimiter::keyed(
    Quota::per_minute(NonZeroU32::new(5).unwrap()),
));
// …then in AppState { … }:
acoustic_limiter,
```

The full updated `make_state` body (add these two lines in the appropriate places, following the `zap_limiter` pattern directly above):

```rust
async fn make_state(secret: &str) -> AppState {
    use crate::{config::Config, maps::{MapboxAdapter, MapProvider}, ws::{hub::WsHub, circle_hub::CircleHub}};
    use governor::{Quota, RateLimiter};
    use std::num::NonZeroU32;
    let http_client = reqwest::Client::new();
    let map_provider: Arc<dyn MapProvider> = Arc::new(
        MapboxAdapter::new(http_client.clone(), String::new())
    );
    let zap_limiter = Arc::new(RateLimiter::keyed(
        Quota::per_minute(NonZeroU32::new(10).unwrap()),
    ));
    let acoustic_limiter = Arc::new(RateLimiter::keyed(
        Quota::per_minute(NonZeroU32::new(5).unwrap()),
    ));
    let (event_tx_inner, _) = tokio::sync::broadcast::channel::<crate::ws::ViewportEvent>(1);
    let redis_client = redis::Client::open("redis://localhost").unwrap();
    let redis = redis::aio::ConnectionManager::new(redis_client)
        .await
        .expect("Redis required for gateway tests — ensure Redis is running on localhost:6379");
    AppState {
        db: sqlx::PgPool::connect_lazy("postgres://localhost/test").unwrap(),
        config: Arc::new(Config {
            database_url: "postgres://localhost/test".into(),
            redis_url: "redis://localhost".into(),
            port: 3000,
            zap_webhook_secret: "test".into(),
            blockchain_service_url: None,
            lnd_rest_url: None,
            lnd_macaroon_hex: None,
            lnd_tls_skip_verify: false,
            lnd_tls_cert_pem: None,
            nostr_private_key: None,
            nostr_relays: vec!["wss://nos.lol".into()],
            zap_rate_limit_per_minute: 10,
            internal_service_secret: secret.into(),
            trust_proxy: false,
            max_db_connections: 5,
            mapbox_token: None,
            vapid_private_key: None,
            vapid_public_key: None,
            vapid_subject: None,
            ws_events_rate_cap: 30,
            public_base_url: None,
        }),
        http_client,
        hub: Arc::new(WsHub::new()),
        circle_hub: Arc::new(CircleHub::new()),
        redis_healthy: Arc::new(AtomicBool::new(false)),
        map_provider,
        zap_limiter,
        acoustic_limiter,
        event_tx: Arc::new(event_tx_inner),
        redis,
    }
}
```

- [ ] **Step 6: Update `AppState` literals in `nostr_auth.rs` tests**

In `services/gateway/src/middleware/nostr_auth.rs`, find every `AppState { ... }` literal in the `#[cfg(test)]` module and add `acoustic_limiter` following the same pattern as Step 5. Search for all occurrences:

```bash
grep -n "acoustic_limiter\|AppState {" services/gateway/src/middleware/nostr_auth.rs
```

Add `acoustic_limiter` to each one. For each existing `make_state`-style helper, add:

```rust
let acoustic_limiter = Arc::new(RateLimiter::keyed(
    Quota::per_minute(NonZeroU32::new(5).unwrap()),
));
```

And `acoustic_limiter,` in the struct literal.

- [ ] **Step 7: Verify compilation and all existing tests pass**

```bash
cd services/gateway
cargo test 2>&1 | tail -20
```

Expected: all tests pass, no compilation errors.

- [ ] **Step 8: Commit**

```bash
git add services/gateway/Cargo.toml services/gateway/src/main.rs \
        services/gateway/src/middleware/internal_auth.rs \
        services/gateway/src/middleware/nostr_auth.rs
git commit -m "feat: add h3o crate and acoustic_limiter to AppState"
```

---

### Task 3: Backend route — `POST /api/acoustic/signals`

**Files:**
- Create: `services/gateway/src/routes/acoustic.rs`
- Modify: `services/gateway/src/routes/mod.rs`

The handler extracts the pubkey from `NostrAuth` (NIP-98 is already validated by the extractor — kind, timestamp, signature, URL match, method match, replay guard). Then it applies acoustic-specific validation and writes to `acoustic_signals`.

- [ ] **Step 1: Write failing unit tests first**

Create `services/gateway/src/routes/acoustic.rs` with just the test module and helper functions:

```rust
use axum::{extract::State, http::StatusCode, response::Json, routing::post, Router};
use h3o::{CellIndex, LatLng, Resolution};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{error::AppError, middleware::nostr_auth::NostrAuth, AppState};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_THREAT_CLASSES: &[&str] = &[
    "Gunshot", "Explosion", "Screaming", "Yell", "Glass breaking",
    "Crowd", "Fire alarm", "Smoke detector", "Crash", "Car crash",
];

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct SubmitSignalBody {
    pub client_id: Uuid,
    pub threat_class: String,
    pub confidence: f32,
    pub confidence_variance: Option<f32>,
    pub lat: f64,
    pub lng: f64,
    pub model_version: String,
    pub threshold_profile: String,
    pub inference_backend: String,
    pub processing_latency: Option<i32>,
    pub dropped_frames: i32,
    pub device_category: Option<String>,
    pub signal_fingerprint: Option<String>,
}

// ---------------------------------------------------------------------------
// Pure helpers — testable without DB or auth
// ---------------------------------------------------------------------------

pub fn h3_cells_from(lat: f64, lng: f64) -> Result<(String, String), AppError> {
    let ll = LatLng::new(lat, lng)
        .map_err(|_| AppError::BadRequest("invalid coordinates".into()))?;
    let r9 = ll.to_cell(Resolution::Nine).to_string();
    let r7 = ll.to_cell(Resolution::Seven).to_string();
    Ok((r9, r7))
}

pub fn validate_signal_body(body: &SubmitSignalBody) -> Result<(), AppError> {
    if !((-90.0..=90.0).contains(&body.lat)) || !((-180.0..=180.0).contains(&body.lng)) {
        return Err(AppError::BadRequest(
            "lat must be in -90..90, lng in -180..180".into(),
        ));
    }
    if !(0.0..=1.0).contains(&body.confidence) {
        return Err(AppError::BadRequest("confidence must be in 0.0..1.0".into()));
    }
    if let Some(v) = body.confidence_variance {
        if !(0.0..=1.0).contains(&v) {
            return Err(AppError::BadRequest(
                "confidence_variance must be in 0.0..1.0".into(),
            ));
        }
    }
    if !VALID_THREAT_CLASSES.contains(&body.threat_class.as_str()) {
        return Err(AppError::BadRequest(format!(
            "unknown threat_class: {}",
            body.threat_class
        )));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async fn submit_signal(
    State(state): State<AppState>,
    auth: NostrAuth,
    Json(body): Json<SubmitSignalBody>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    if state.acoustic_limiter.check_key(&auth.pubkey).is_err() {
        return Err(AppError::RateLimited);
    }

    validate_signal_body(&body)?;

    let (h3_r9, h3_r7) = h3_cells_from(body.lat, body.lng)?;

    let row = sqlx::query!(
        r#"
        INSERT INTO acoustic_signals
            (client_id, pubkey, threat_class, confidence, confidence_variance,
             lat, lng, h3_r9, h3_r7,
             model_version, threshold_profile, inference_backend,
             processing_latency, dropped_frames, device_category, signal_fingerprint)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (client_id) DO NOTHING
        RETURNING id
        "#,
        body.client_id,
        auth.pubkey,
        body.threat_class,
        body.confidence,
        body.confidence_variance,
        body.lat,
        body.lng,
        h3_r9,
        h3_r7,
        body.model_version,
        body.threshold_profile,
        body.inference_backend,
        body.processing_latency,
        body.dropped_frames,
        body.device_category,
        body.signal_fingerprint,
    )
    .fetch_optional(&state.db)
    .await?;

    match row {
        Some(r) => Ok((
            StatusCode::CREATED,
            Json(serde_json::json!({ "id": r.id, "trust_state": "pending" })),
        )),
        None => Ok((
            StatusCode::OK,
            Json(serde_json::json!({ "deduplicated": true })),
        )),
    }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> Router<AppState> {
    Router::new().route("/signals", post(submit_signal))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // --- Pure unit tests (no DB, no auth) -----------------------------------

    #[test]
    fn h3_cells_singapore() {
        let (r9, r7) = h3_cells_from(1.3521, 103.8198).unwrap();
        // H3 cell IDs are 15 hex characters
        assert_eq!(r9.len(), 15, "r9 should be 15 hex chars, got: {r9}");
        assert_eq!(r7.len(), 15, "r7 should be 15 hex chars, got: {r7}");
        // r7 is coarser — its first character encodes resolution
        assert_ne!(r9, r7);
    }

    #[test]
    fn h3_cells_new_york() {
        let (r9, r7) = h3_cells_from(40.7128, -74.0060).unwrap();
        assert_eq!(r9.len(), 15);
        assert_eq!(r7.len(), 15);
    }

    #[test]
    fn invalid_lat_rejected() {
        let err = h3_cells_from(91.0, 0.0).unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
    }

    #[test]
    fn invalid_lng_rejected() {
        let err = h3_cells_from(0.0, 181.0).unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
    }

    #[test]
    fn body_lat_out_of_range_rejected() {
        let body = SubmitSignalBody {
            client_id: Uuid::new_v4(),
            threat_class: "Gunshot".into(),
            confidence: 0.85,
            confidence_variance: None,
            lat: 91.0,
            lng: 0.0,
            model_version: "yamnet-tfjs-1".into(),
            threshold_profile: "default-v1".into(),
            inference_backend: "webgl".into(),
            processing_latency: None,
            dropped_frames: 0,
            device_category: None,
            signal_fingerprint: None,
        };
        assert!(matches!(validate_signal_body(&body), Err(AppError::BadRequest(_))));
    }

    #[test]
    fn body_confidence_out_of_range_rejected() {
        let body = SubmitSignalBody {
            client_id: Uuid::new_v4(),
            threat_class: "Gunshot".into(),
            confidence: 1.1,
            confidence_variance: None,
            lat: 1.0,
            lng: 1.0,
            model_version: "yamnet-tfjs-1".into(),
            threshold_profile: "default-v1".into(),
            inference_backend: "webgl".into(),
            processing_latency: None,
            dropped_frames: 0,
            device_category: None,
            signal_fingerprint: None,
        };
        assert!(matches!(validate_signal_body(&body), Err(AppError::BadRequest(_))));
    }

    #[test]
    fn body_unknown_threat_class_rejected() {
        let body = SubmitSignalBody {
            client_id: Uuid::new_v4(),
            threat_class: "NotAThreat".into(),
            confidence: 0.85,
            confidence_variance: None,
            lat: 1.0,
            lng: 1.0,
            model_version: "yamnet-tfjs-1".into(),
            threshold_profile: "default-v1".into(),
            inference_backend: "webgl".into(),
            processing_latency: None,
            dropped_frames: 0,
            device_category: None,
            signal_fingerprint: None,
        };
        assert!(matches!(validate_signal_body(&body), Err(AppError::BadRequest(_))));
    }

    #[test]
    fn valid_body_passes_validation() {
        let body = SubmitSignalBody {
            client_id: Uuid::new_v4(),
            threat_class: "Gunshot".into(),
            confidence: 0.85,
            confidence_variance: Some(0.03),
            lat: 1.3521,
            lng: 103.8198,
            model_version: "yamnet-tfjs-1".into(),
            threshold_profile: "default-v1".into(),
            inference_backend: "webgl".into(),
            processing_latency: Some(312),
            dropped_frames: 0,
            device_category: Some("mobile".into()),
            signal_fingerprint: None,
        };
        assert!(validate_signal_body(&body).is_ok());
    }

    // --- Integration tests (require Postgres + Redis) -----------------------
    // Run with: cargo test -- --ignored
    // These tests insert real rows and require DATABASE_URL + REDIS_URL env vars.

    async fn make_test_state() -> AppState {
        use crate::{
            config::Config,
            maps::{MapboxAdapter, MapProvider},
            ws::{circle_hub::CircleHub, hub::WsHub},
        };
        use governor::{Quota, RateLimiter};
        use std::{
            num::NonZeroU32,
            sync::{atomic::AtomicBool, Arc},
        };

        let http_client = reqwest::Client::new();
        let map_provider: Arc<dyn MapProvider> =
            Arc::new(MapboxAdapter::new(http_client.clone(), String::new()));
        let zap_limiter = Arc::new(RateLimiter::keyed(
            Quota::per_minute(NonZeroU32::new(10).unwrap()),
        ));
        let acoustic_limiter = Arc::new(RateLimiter::keyed(
            Quota::per_minute(NonZeroU32::new(5).unwrap()),
        ));
        let (event_tx_inner, _) =
            tokio::sync::broadcast::channel::<crate::ws::ViewportEvent>(1);

        let db_url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgres://localhost/sentinelmesh_test".into());
        let redis_url = std::env::var("REDIS_URL")
            .unwrap_or_else(|_| "redis://localhost".into());

        let redis_client = redis::Client::open(redis_url.as_str()).unwrap();
        let redis = redis::aio::ConnectionManager::new(redis_client)
            .await
            .expect("Redis required — ensure Redis is running");

        let db = sqlx::PgPool::connect(&db_url)
            .await
            .expect("Postgres required — ensure DB is running with 007 migration applied");

        AppState {
            db,
            config: Arc::new(Config {
                database_url: db_url,
                redis_url,
                port: 3000,
                zap_webhook_secret: "test".into(),
                blockchain_service_url: None,
                lnd_rest_url: None,
                lnd_macaroon_hex: None,
                lnd_tls_skip_verify: false,
                lnd_tls_cert_pem: None,
                nostr_private_key: None,
                nostr_relays: vec![],
                zap_rate_limit_per_minute: 10,
                internal_service_secret: "test".into(),
                trust_proxy: false,
                max_db_connections: 5,
                mapbox_token: None,
                vapid_private_key: None,
                vapid_public_key: None,
                vapid_subject: None,
                ws_events_rate_cap: 30,
                // Must match the u tag URL used in tests
                public_base_url: Some("http://localhost".into()),
            }),
            http_client,
            hub: Arc::new(WsHub::new()),
            circle_hub: Arc::new(CircleHub::new()),
            redis_healthy: Arc::new(AtomicBool::new(false)),
            map_provider,
            zap_limiter,
            acoustic_limiter,
            event_tx: Arc::new(event_tx_inner),
            redis,
        }
    }

    fn make_test_app(state: AppState) -> axum::Router {
        axum::Router::new()
            .route("/api/acoustic/signals", post(submit_signal))
            .with_state(state)
    }

    fn signed_nip98_event(keys: &nostr_sdk::Keys, url: &str, method: &str) -> String {
        let event = nostr_sdk::EventBuilder::new(nostr_sdk::Kind::from(27235), "")
            .tags([
                nostr_sdk::Tag::parse(["u", url]).unwrap(),
                nostr_sdk::Tag::parse(["method", method]).unwrap(),
            ])
            .sign_with_keys(keys)
            .unwrap();
        serde_json::to_string(&event).unwrap()
    }

    fn valid_body(client_id: uuid::Uuid) -> serde_json::Value {
        serde_json::json!({
            "client_id": client_id,
            "threat_class": "Gunshot",
            "confidence": 0.87,
            "lat": 1.3521,
            "lng": 103.8198,
            "model_version": "yamnet-tfjs-1",
            "threshold_profile": "default-v1",
            "inference_backend": "webgl",
            "dropped_frames": 0
        })
    }

    #[tokio::test]
    #[ignore = "requires Postgres + Redis"]
    async fn valid_signal_returns_201_with_trust_state_pending() {
        use axum::body::Body;
        use axum::http::Request;
        use tower::ServiceExt;

        let state = make_test_state().await;
        let app = make_test_app(state);
        let keys = nostr_sdk::Keys::generate();
        let url = "http://localhost/api/acoustic/signals";
        let client_id = Uuid::new_v4();

        let resp = app
            .oneshot(
                Request::post("/api/acoustic/signals")
                    .header("content-type", "application/json")
                    .header("x-nostr-auth", signed_nip98_event(&keys, url, "POST"))
                    .body(Body::from(serde_json::to_vec(&valid_body(client_id)).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::CREATED);
        let body: serde_json::Value =
            serde_json::from_slice(&axum::body::to_bytes(resp.into_body(), 1024).await.unwrap())
                .unwrap();
        assert_eq!(body["trust_state"], "pending");
        assert!(body["id"].is_string());
    }

    #[tokio::test]
    #[ignore = "requires Postgres + Redis"]
    async fn duplicate_client_id_returns_200_deduplicated() {
        use axum::body::Body;
        use axum::http::Request;
        use tower::ServiceExt;

        let state = make_test_state().await;
        let keys = nostr_sdk::Keys::generate();
        let url = "http://localhost/api/acoustic/signals";
        let client_id = Uuid::new_v4();

        let app1 = make_test_app(state.clone());
        let resp1 = app1
            .oneshot(
                Request::post("/api/acoustic/signals")
                    .header("content-type", "application/json")
                    .header("x-nostr-auth", signed_nip98_event(&keys, url, "POST"))
                    .body(Body::from(serde_json::to_vec(&valid_body(client_id)).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp1.status(), StatusCode::CREATED);

        // Second submission with the same client_id — new NIP-98 event (different event ID)
        let app2 = make_test_app(state);
        let resp2 = app2
            .oneshot(
                Request::post("/api/acoustic/signals")
                    .header("content-type", "application/json")
                    .header("x-nostr-auth", signed_nip98_event(&keys, url, "POST"))
                    .body(Body::from(serde_json::to_vec(&valid_body(client_id)).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp2.status(), StatusCode::OK);
        let body: serde_json::Value =
            serde_json::from_slice(&axum::body::to_bytes(resp2.into_body(), 256).await.unwrap())
                .unwrap();
        assert_eq!(body["deduplicated"], true);
    }
}
```

- [ ] **Step 2: Run the unit tests — verify they pass**

```bash
cd services/gateway
cargo test acoustic -- --nocapture 2>&1 | grep -E "test .* (ok|FAILED|ignored)"
```

Expected: 6 unit tests pass (`h3_cells_singapore`, `h3_cells_new_york`, `invalid_lat_rejected`, `invalid_lng_rejected`, `body_*`). 2 integration tests listed as `ignored`.

- [ ] **Step 3: Register the route in `mod.rs`**

In `services/gateway/src/routes/mod.rs`:

```rust
pub mod acoustic;
pub mod circles;
pub mod events;
pub mod location_blobs;
pub mod maps;
pub mod push;
pub mod reports;
pub mod tiles;
pub mod zap;

use axum::Router;
use crate::AppState;

pub fn build_router() -> Router<AppState> {
    Router::new()
        .nest("/api/acoustic", acoustic::router())
        .nest("/api/events",   events::router())
        .nest("/api/reports",  reports::router())
        .nest("/api/circles",  circles::router().merge(location_blobs::router()))
        .nest("/api/zaps",     zap::router())
        .nest("/api/tiles",    tiles::router())
        .nest("/api/push",     push::router())
        .nest("/api/maps",     maps::router())
}
```

- [ ] **Step 4: Verify full compilation**

```bash
cd services/gateway
cargo build 2>&1 | tail -5
```

Expected: `Compiling gateway` then `Finished`.

- [ ] **Step 5: Run all gateway tests**

```bash
cd services/gateway
cargo test 2>&1 | tail -15
```

Expected: all non-ignored tests pass.

- [ ] **Step 6: Commit**

```bash
git add services/gateway/src/routes/acoustic.rs services/gateway/src/routes/mod.rs
git commit -m "feat: POST /api/acoustic/signals route — NIP-98 auth, rate limit, H3 derivation, client_id dedup"
```

---

### Task 4: PWA — `signNip98AuthEvent` + tests

**Files:**
- Modify: `apps/pwa/src/services/nostrService.ts`

The existing `signAuthEvent()` produces a kind-27235 event with empty tags — it is missing the `u` and `method` tags required by NIP-98. The new `signNip98AuthEvent(url, method)` function is correct.

The old `signAuthEvent()` should be kept unchanged (it may be used elsewhere for other purposes) and this new function added alongside it.

- [ ] **Step 1: Write the failing test**

Create `apps/pwa/src/services/__tests__/nostrService.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { signNip98AuthEvent } from '../nostrService'

describe('signNip98AuthEvent', () => {
  it('produces a kind-27235 event', async () => {
    const event = await signNip98AuthEvent(
      'https://api.sentinelmesh.io/api/acoustic/signals',
      'POST',
    )
    expect(event.kind).toBe(27235)
  })

  it('includes u tag with the exact URL', async () => {
    const url = 'https://api.sentinelmesh.io/api/acoustic/signals'
    const event = await signNip98AuthEvent(url, 'POST')
    const uTag = event.tags.find(t => t[0] === 'u')
    expect(uTag).toBeDefined()
    expect(uTag![1]).toBe(url)
  })

  it('includes method tag uppercased', async () => {
    const event = await signNip98AuthEvent(
      'https://api.sentinelmesh.io/api/acoustic/signals',
      'post', // lowercase input
    )
    const methodTag = event.tags.find(t => t[0] === 'method')
    expect(methodTag).toBeDefined()
    expect(methodTag![1]).toBe('POST')
  })

  it('has a recent created_at timestamp', async () => {
    const before = Math.floor(Date.now() / 1000)
    const event = await signNip98AuthEvent(
      'https://api.sentinelmesh.io/api/acoustic/signals',
      'POST',
    )
    const after = Math.floor(Date.now() / 1000)
    expect(event.created_at).toBeGreaterThanOrEqual(before)
    expect(event.created_at).toBeLessThanOrEqual(after)
  })

  it('has a non-empty sig and id', async () => {
    const event = await signNip98AuthEvent(
      'https://api.sentinelmesh.io/api/acoustic/signals',
      'POST',
    )
    expect(event.sig).toBeTruthy()
    expect(event.id).toBeTruthy()
    expect(event.pubkey).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
cd apps/pwa
npm test -- --reporter=verbose 2>&1 | grep -E "PASS|FAIL|✓|✗|nostrService"
```

Expected: FAIL — `signNip98AuthEvent is not a function`.

- [ ] **Step 3: Implement `signNip98AuthEvent` in `nostrService.ts`**

Add after the existing `signAuthEvent` function (do not modify `signAuthEvent`):

```typescript
/**
 * Sign a NIP-98 Kind 27235 HTTP auth event with correct u and method tags.
 * Used for X-Nostr-Auth headers on authenticated API endpoints.
 */
export async function signNip98AuthEvent(
  url: string,
  method: string,
): Promise<SignedReportEvent> {
  return signEventAsync({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['u', url],
      ['method', method.toUpperCase()],
    ],
    content: '',
  })
}
```

- [ ] **Step 4: Run the tests — verify they pass**

```bash
cd apps/pwa
npm test -- --reporter=verbose 2>&1 | grep -E "PASS|FAIL|✓|✗|nostrService"
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/services/nostrService.ts \
        apps/pwa/src/services/__tests__/nostrService.test.ts
git commit -m "feat: signNip98AuthEvent — proper u/method tags for NIP-98 HTTP auth"
```

---

### Task 5: PWA — `acousticSignalSubmit.ts` service

**Files:**
- Create: `apps/pwa/src/services/acousticSignalSubmit.ts`

This service replaces `autoSubmitAcousticReport` for acoustic detection submissions. It signs a NIP-98 event with the correct URL and method, then POSTs to `/api/acoustic/signals`. The absolute URL is constructed from `window.location.origin` to handle both dev (relative base) and prod (absolute base) correctly.

- [ ] **Step 1: Write the failing test**

Create `apps/pwa/src/services/__tests__/acousticSignalSubmit.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock nostrService before importing the module under test
vi.mock('../nostrService', () => ({
  signNip98AuthEvent: vi.fn().mockResolvedValue({
    kind: 27235,
    id: 'mock-event-id',
    pubkey: 'mock-pubkey',
    created_at: 1700000000,
    tags: [['u', 'http://localhost/api/acoustic/signals'], ['method', 'POST']],
    content: '',
    sig: 'mock-sig',
  }),
}))

import { submitAcousticSignal } from '../acousticSignalSubmit'
import { signNip98AuthEvent } from '../nostrService'

describe('submitAcousticSignal', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('crypto', {
      randomUUID: () => '00000000-0000-0000-0000-000000000001',
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('calls fetch with POST method', async () => {
    await submitAcousticSignal(
      { classIndex: 427, label: 'Gunshot', category: 'SECURITY_INCIDENT', confidence: 0.87 },
      { lat: 1.3521, lng: 103.8198 },
    )
    expect(fetchMock).toHaveBeenCalledOnce()
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(options.method).toBe('POST')
  })

  it('includes X-Nostr-Auth header', async () => {
    await submitAcousticSignal(
      { classIndex: 427, label: 'Gunshot', category: 'SECURITY_INCIDENT', confidence: 0.87 },
      { lat: 1.3521, lng: 103.8198 },
    )
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = options.headers as Record<string, string>
    expect(headers['X-Nostr-Auth']).toContain('mock-event-id')
  })

  it('sends threat_class from detection label', async () => {
    await submitAcousticSignal(
      { classIndex: 427, label: 'Gunshot', category: 'SECURITY_INCIDENT', confidence: 0.87 },
      { lat: 1.3521, lng: 103.8198 },
    )
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(options.body as string)
    expect(body.threat_class).toBe('Gunshot')
    expect(body.confidence).toBeCloseTo(0.87)
    expect(body.lat).toBe(1.3521)
    expect(body.lng).toBe(103.8198)
  })

  it('includes client_id in body', async () => {
    await submitAcousticSignal(
      { classIndex: 427, label: 'Gunshot', category: 'SECURITY_INCIDENT', confidence: 0.87 },
      { lat: 1.3521, lng: 103.8198 },
    )
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(options.body as string)
    expect(body.client_id).toBe('00000000-0000-0000-0000-000000000001')
  })

  it('does not throw on fetch error (offline resilience)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network error'))
    await expect(
      submitAcousticSignal(
        { classIndex: 427, label: 'Gunshot', category: 'SECURITY_INCIDENT', confidence: 0.87 },
        { lat: 1.3521, lng: 103.8198 },
      ),
    ).resolves.toBeUndefined()
  })

  it('signs NIP-98 event for the acoustic signals URL', async () => {
    await submitAcousticSignal(
      { classIndex: 427, label: 'Gunshot', category: 'SECURITY_INCIDENT', confidence: 0.87 },
      { lat: 1.3521, lng: 103.8198 },
    )
    expect(signNip98AuthEvent).toHaveBeenCalledWith(
      expect.stringContaining('/api/acoustic/signals'),
      'POST',
    )
  })
})
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
cd apps/pwa
npm test -- --reporter=verbose 2>&1 | grep -E "acousticSignalSubmit|FAIL|Cannot find"
```

Expected: FAIL — `acousticSignalSubmit` module not found.

- [ ] **Step 3: Implement `acousticSignalSubmit.ts`**

```typescript
// apps/pwa/src/services/acousticSignalSubmit.ts
import { signNip98AuthEvent } from './nostrService'
import type { ThreatDetection } from '../constants/acousticThreats'

const API_PATH = '/api/acoustic/signals'

interface Location {
  lat: number
  lng: number
}

export async function submitAcousticSignal(
  detection: ThreatDetection,
  location: Location,
): Promise<void> {
  const signalsUrl = new URL(API_PATH, window.location.origin).toString()

  let authEvent: string
  try {
    const event = await signNip98AuthEvent(signalsUrl, 'POST')
    authEvent = JSON.stringify(event)
  } catch (err) {
    console.warn('[acousticSignal] NIP-98 signing failed:', err)
    return
  }

  // crypto.randomUUID() generates UUID v4. The spec calls for UUIDv7 (time-ordered)
  // for better B-tree clustering. This satisfies the functional deduplication requirement.
  // Upgrade to v7 when the uuid@9 package is added or when a UUIDv7 polyfill is introduced.
  const payload = {
    client_id: crypto.randomUUID(),
    threat_class: detection.label,
    confidence: detection.confidence,
    lat: location.lat,
    lng: location.lng,
    model_version: 'yamnet-tfjs-1',
    threshold_profile: 'default-v1',
    inference_backend: 'webgl',
    dropped_frames: 0,
  }

  try {
    const response = await fetch(signalsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Nostr-Auth': authEvent,
      },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify(payload),
    })
    if (!response.ok && response.status !== 200) {
      console.warn('[acousticSignal] server rejected:', response.status)
    }
  } catch (err) {
    console.warn('[acousticSignal] submission failed (offline?):', err)
  }
}
```

- [ ] **Step 4: Run the tests — verify they pass**

```bash
cd apps/pwa
npm test -- --reporter=verbose 2>&1 | grep -E "acousticSignalSubmit|PASS|FAIL|✓|✗"
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/services/acousticSignalSubmit.ts \
        apps/pwa/src/services/__tests__/acousticSignalSubmit.test.ts
git commit -m "feat: acousticSignalSubmit service — NIP-98 authenticated signal submission"
```

---

### Task 6: PWA — update acoustic hooks to use new service

**Files:**
- Modify: `apps/pwa/src/hooks/useAcousticEngine.ts`
- Modify: `apps/pwa/src/hooks/useAcousticDetection.ts`

Both hooks currently call `autoSubmitAcousticReport` from `reportAutoSubmit.ts`. Replace with `submitAcousticSignal` from `acousticSignalSubmit.ts`. The `reportAutoSubmit.ts` file itself is left untouched — it is used for manual community reports.

- [ ] **Step 1: Update `useAcousticEngine.ts`**

Replace the file content:

```typescript
import { useEffect } from 'react'
import { useAppDispatch } from '../store'
import { detectionReceived, detectionStarted, detectionStopped } from '../store/acousticSlice'
import { AudioCapture } from '../services/audioCapture'
import { AcousticDetectionService } from '../services/acousticDetectionService'
import { submitAcousticSignal } from '../services/acousticSignalSubmit'

export function useAcousticEngine() {
  const dispatch = useAppDispatch()

  useEffect(() => {
    let capture: AudioCapture | null = null
    let detector: AcousticDetectionService | null = null

    async function start() {
      detector = new AcousticDetectionService((detection) => {
        dispatch(detectionReceived(detection))
        navigator.geolocation?.getCurrentPosition(
          pos => {
            submitAcousticSignal(detection, {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
            })
          },
          undefined,
          { maximumAge: 30_000 },
        )
      })
      try {
        await detector.init()
        capture = new AudioCapture(samples => detector?.processWindow(samples))
        await capture.start()
        dispatch(detectionStarted())
      } catch (err) {
        console.warn('[acoustic] detection unavailable:', err)
      }
    }

    const handleVisibilityChange = () => {
      if (document.hidden) capture?.stop()
    }
    const handleUnload = () => capture?.stop()

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('beforeunload', handleUnload)

    start()

    return () => {
      capture?.stop()
      dispatch(detectionStopped())
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('beforeunload', handleUnload)
    }
  }, [dispatch])
}
```

Note: this also adds `maximumAge: 30_000` to the geolocation call and the `visibilitychange`/`beforeunload` lifecycle handlers from the spec, since they touch the same code path.

- [ ] **Step 2: Update `useAcousticDetection.ts`**

Replace the file content:

```typescript
import { useEffect } from 'react'
import { useAppDispatch } from '../store'
import { AudioCapture } from '../services/audioCapture'
import { AcousticDetectionService } from '../services/acousticDetectionService'
import { submitAcousticSignal } from '../services/acousticSignalSubmit'
import { detectionReceived, detectionStarted, detectionStopped } from '../store/acousticSlice'

export function useAcousticDetection(): void {
  const dispatch = useAppDispatch()

  useEffect(() => {
    let capture: AudioCapture | null = null
    let detector: AcousticDetectionService | null = null

    async function start() {
      detector = new AcousticDetectionService((detection) => {
        dispatch(detectionReceived(detection))
        navigator.geolocation?.getCurrentPosition(
          pos => {
            submitAcousticSignal(detection, {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
            })
          },
          undefined,
          { maximumAge: 30_000 },
        )
      })
      try {
        await detector.init()
        capture = new AudioCapture(samples => detector?.processWindow(samples))
        await capture.start()
        dispatch(detectionStarted())
      } catch (err) {
        console.warn('[acoustic] detection unavailable:', err)
      }
    }

    const handleVisibilityChange = () => {
      if (document.hidden) capture?.stop()
    }
    const handleUnload = () => capture?.stop()

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('beforeunload', handleUnload)

    start()

    return () => {
      capture?.stop()
      detector = null
      dispatch(detectionStopped())
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('beforeunload', handleUnload)
    }
  }, [dispatch])
}
```

- [ ] **Step 3: Run the full PWA test suite**

```bash
cd apps/pwa
npm test 2>&1 | tail -15
```

Expected: all tests pass. No references to `autoSubmitAcousticReport` in the hooks.

- [ ] **Step 4: Verify `autoSubmitAcousticReport` is no longer imported by either hook**

```bash
grep -r "autoSubmitAcousticReport" apps/pwa/src/hooks/
```

Expected: no output.

- [ ] **Step 5: Verify TypeScript compilation**

```bash
cd apps/pwa
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/pwa/src/hooks/useAcousticEngine.ts \
        apps/pwa/src/hooks/useAcousticDetection.ts
git commit -m "feat: route acoustic detections to /api/acoustic/signals with NIP-98 auth — retire /api/reports path"
```

---

### Task 7: Full verification

- [ ] **Step 1: Run all gateway tests**

```bash
cd services/gateway
cargo test 2>&1 | tail -20
```

Expected: all non-ignored tests pass. No compilation warnings about unused code.

- [ ] **Step 2: Run all PWA tests**

```bash
cd apps/pwa
npm test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 3: Verify Phase 1 exit criterion**

```bash
# Confirm the old /api/reports path is not called from acoustic hooks
grep -r "api/reports\|autoSubmitAcousticReport" \
  apps/pwa/src/hooks/useAcousticEngine.ts \
  apps/pwa/src/hooks/useAcousticDetection.ts
```

Expected: no output.

```bash
# Confirm acoustic_signals table exists in DB
psql "$DATABASE_URL" -c "SELECT count(*) FROM acoustic_signals;"
```

Expected: `0` rows (empty table, migration applied).

```bash
# Confirm the route is registered
grep -r "acoustic" services/gateway/src/routes/mod.rs
```

Expected: `acoustic::router()` present.

- [ ] **Step 4: ADR-001 review gate**

Before merging, confirm each ADR-001 invariant is satisfied by the new code:

1. Raw PCM never leaves the device — `acousticSignalSubmit.ts` sends only `threat_class`, `confidence`, `lat`, `lng`, and metadata. No audio buffer is transmitted. ✓
2. No server-side audio storage — `acoustic_signals` table has no audio column. The gateway has no endpoint accepting audio data. ✓
3. No background recording without UI — `useAcousticEngine` and `useAcousticDetection` both now stop the capture on `visibilitychange` (document hidden) and `beforeunload`. ✓
4. No hidden microphone activation — unchanged; mic is requested on explicit user action only. ✓
5. No biometric voice analysis — unchanged; YAMNet model classifies environmental sound only. ✓
6. Geolocation only on detection — `getCurrentPosition` called only in the detection callback, with `maximumAge: 30_000`. ✓

If any invariant is violated, stop and fix before merging.

- [ ] **Step 5: Commit any cleanup**

If there are any lingering lint warnings or unused import warnings, fix them now. Otherwise:

```bash
git log --oneline -7
```

Expected: 7 commits for this phase — migration, AppState, route, signNip98AuthEvent, acousticSignalSubmit, hooks update, (any cleanup).
