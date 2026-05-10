# Rust Gateway Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Node.js/Express gateway with a Rust/axum binary that is a drop-in replacement — same routes, same DB schema, same Redis channels, same WebSocket protocol.

**Architecture:** Axum handles HTTP + WebSocket on the same listener; a supervised tokio task subscribes to Redis `sentinel:events:new` and fans out to an in-process broadcast channel that WebSocket connections read from. Per-circle location streams use a `DashMap<Uuid, broadcast::Sender>`. All DB queries use `sqlx::query_as` with named structs.

**Tech Stack:** `axum 0.7`, `tokio 1`, `sqlx 0.8` (postgres), `nostr-sdk 0.37`, `reqwest 0.12`, `redis 0.27`, `dashmap 6`, `tower-http 0.5`, `hmac 0.12`, `bytes 1`

---

## File Structure

```
services/
├── Cargo.toml                          # add "gateway" to members
└── gateway/
    ├── Cargo.toml
    └── src/
        ├── main.rs                     # AppState, router assembly, server startup
        ├── config.rs                   # Config struct, env loading
        ├── error.rs                    # AppError enum + IntoResponse
        ├── nudge.rs                    # fire-and-forget POST to blockchain
        ├── db/
        │   └── mod.rs                  # create_pool()
        ├── middleware/
        │   └── nostr_auth.rs           # NostrAuth axum extractor (kind 27235)
        ├── routes/
        │   ├── mod.rs                  # build_router()
        │   ├── events.rs               # POST/GET /api/events, GET /api/events/:id
        │   ├── reports.rs              # POST/GET /api/reports, POST vote, GET by-event
        │   ├── circles.rs              # CRUD /api/circles + member management
        │   ├── location_blobs.rs       # POST/GET /api/circles/:id/location
        │   └── zap.rs                  # POST /api/zaps/request, POST /api/zaps/webhook
        ├── reports/
        │   ├── consensus.rs            # compute_new_status (pure fn)
        │   └── service.rs              # create_report, cast_vote, list_reports
        ├── ws/
        │   ├── hub.rs                  # WsHub — county-keyed broadcast
        │   └── circle_hub.rs           # CircleHub — per-circle broadcast
        ├── lightning/
        │   ├── lnd_client.rs           # LND REST client
        │   └── zap_service.rs          # create_zap_request, handle_payment_webhook
        └── subscribers/
            └── event_subscriber.rs     # Redis → safety_events upsert → WsHub
```

---

### Task 1: Cargo workspace + gateway crate skeleton

**Files:**
- Modify: `services/Cargo.toml`
- Create: `services/gateway/Cargo.toml`
- Create: `services/gateway/src/main.rs`

- [ ] **Step 1: Add gateway to workspace**

Edit `services/Cargo.toml`, change the members line:

```toml
[workspace]
members = ["blockchain", "sentinel-core", "gateway"]
resolver = "2"
```

- [ ] **Step 2: Create `services/gateway/Cargo.toml`**

```toml
[package]
name = "gateway"
version.workspace = true
edition.workspace = true

[dependencies]
sentinel-core = { path = "../sentinel-core" }
tokio        = { workspace = true }
axum         = { workspace = true }
sqlx         = { workspace = true }
serde        = { workspace = true }
serde_json   = { workspace = true }
uuid         = { workspace = true }
chrono       = { workspace = true }
anyhow       = { workspace = true }
thiserror    = { workspace = true }
tracing      = { workspace = true }
tracing-subscriber = { workspace = true }
reqwest      = { workspace = true }
nostr-sdk    = { workspace = true }
sha2         = { workspace = true }
hex          = { workspace = true }

redis        = { version = "0.27", features = ["tokio-comp", "connection-manager"] }
dashmap      = "6"
bytes        = "1"
tower-http   = { version = "0.5", features = ["cors", "trace"] }
hmac         = "0.12"
subtle       = "2"

[dev-dependencies]
tower        = { version = "0.4", features = ["util"] }
```

- [ ] **Step 3: Create minimal `services/gateway/src/main.rs`**

```rust
fn main() {
    println!("gateway placeholder");
}
```

- [ ] **Step 4: Verify workspace compiles**

```
cd services && cargo build -p gateway
```

Expected: compiles with no errors.

- [ ] **Step 5: Commit**

```
git add services/Cargo.toml services/gateway/
git commit -m "chore(gateway): add gateway crate to workspace"
```

---

### Task 2: config.rs + error.rs + db/mod.rs + health endpoint

**Files:**
- Create: `services/gateway/src/config.rs`
- Create: `services/gateway/src/error.rs`
- Create: `services/gateway/src/db/mod.rs`
- Rewrite: `services/gateway/src/main.rs`

- [ ] **Step 1: Write config test**

Create `services/gateway/src/config.rs` with this test at the bottom:

```rust
use anyhow::{bail, Result};

pub struct Config {
    pub database_url: String,
    pub redis_url: String,
    pub port: u16,
    pub zap_webhook_secret: String,
    pub blockchain_service_url: Option<String>,
    pub lnd_rest_url: Option<String>,
    pub lnd_macaroon_hex: Option<String>,
    pub lnd_tls_skip_verify: bool,
    pub nostr_private_key: Option<String>,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        Ok(Config {
            database_url: require("DATABASE_URL")?,
            redis_url: require("REDIS_URL")?,
            port: std::env::var("PORT")
                .unwrap_or_else(|_| "3000".into())
                .parse()?,
            zap_webhook_secret: require("ZAP_WEBHOOK_SECRET")?,
            blockchain_service_url: std::env::var("BLOCKCHAIN_SERVICE_URL").ok(),
            lnd_rest_url: std::env::var("LND_REST_URL").ok(),
            lnd_macaroon_hex: std::env::var("LND_MACAROON_HEX").ok(),
            lnd_tls_skip_verify: std::env::var("LND_TLS_SKIP_VERIFY")
                .map(|v| v == "true" || v == "1")
                .unwrap_or(false),
            nostr_private_key: std::env::var("NOSTR_PRIVATE_KEY").ok(),
        })
    }
}

fn require(key: &str) -> Result<String> {
    std::env::var(key).map_err(|_| anyhow::anyhow!("missing required env var: {key}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_required_var_returns_error() {
        // Unset DATABASE_URL in an isolated way — use a subenv trick
        // We can't set env vars in parallel tests, so just verify the error message
        let result = require("GATEWAY_TEST_MISSING_VAR_XYZ");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("GATEWAY_TEST_MISSING_VAR_XYZ"));
    }
}
```

- [ ] **Step 2: Run config test**

```
cargo test -p gateway config -- --nocapture
```

Expected: PASS (1 test).

- [ ] **Step 3: Create `services/gateway/src/error.rs`**

```rust
use axum::{http::StatusCode, response::{IntoResponse, Response}, Json};

#[derive(thiserror::Error, Debug)]
pub enum AppError {
    #[error("not found")]
    NotFound,
    #[error("{0}")]
    BadRequest(String),
    #[error("unauthorized")]
    Unauthorized,
    #[error("forbidden")]
    Forbidden,
    #[error("rate limited")]
    RateLimited,
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, retryable) = match &self {
            AppError::NotFound      => (StatusCode::NOT_FOUND, "NOT_FOUND", false),
            AppError::BadRequest(_) => (StatusCode::BAD_REQUEST, "BAD_REQUEST", false),
            AppError::Unauthorized  => (StatusCode::UNAUTHORIZED, "UNAUTHORIZED", false),
            AppError::Forbidden     => (StatusCode::FORBIDDEN, "FORBIDDEN", false),
            AppError::RateLimited   => (StatusCode::TOO_MANY_REQUESTS, "RATE_LIMITED", true),
            AppError::Internal(e)   => {
                tracing::error!("internal error: {e:#}");
                (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true)
            }
        };
        let body = serde_json::json!({ "code": code, "message": self.to_string(), "retryable": retryable });
        (status, Json(body)).into_response()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        AppError::Internal(e.into())
    }
}
```

- [ ] **Step 4: Create `services/gateway/src/db/mod.rs`**

```rust
use anyhow::Result;
use sqlx::PgPool;

pub async fn create_pool(database_url: &str) -> Result<PgPool> {
    let pool = PgPool::connect(database_url).await?;
    Ok(pool)
}
```

- [ ] **Step 5: Rewrite `services/gateway/src/main.rs`** with health endpoint

```rust
mod config;
mod db;
mod error;

use std::sync::Arc;
use axum::{extract::State, http::StatusCode, response::Json, routing::get, Router};
use tokio::net::TcpListener;

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::PgPool,
    pub config: Arc<config::Config>,
    pub http_client: reqwest::Client,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let config = Arc::new(config::Config::from_env()?);
    let db = db::create_pool(&config.database_url).await?;
    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;

    let state = AppState { db, config, http_client };

    let app = Router::new()
        .route("/health", get(health))
        .with_state(state);

    let addr = format!("0.0.0.0:{}", 3000);
    let listener = TcpListener::bind(&addr).await?;
    tracing::info!("gateway listening on {addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health(State(state): State<AppState>) -> (StatusCode, Json<serde_json::Value>) {
    let ts = chrono::Utc::now().to_rfc3339();
    (StatusCode::OK, Json(serde_json::json!({ "ok": true, "service": "gateway", "ts": ts })))
}
```

- [ ] **Step 6: Compile check**

```
cargo build -p gateway
```

Expected: compiles cleanly.

- [ ] **Step 7: Commit**

```
git add services/gateway/src/
git commit -m "feat(gateway): config, error types, db pool, health endpoint"
```

---

### Task 3: NostrAuth extractor

**Files:**
- Create: `services/gateway/src/middleware/nostr_auth.rs`
- Modify: `services/gateway/src/main.rs` (add `mod middleware;`)

- [ ] **Step 1: Create the extractor with tests**

Create `services/gateway/src/middleware/nostr_auth.rs`:

```rust
use axum::{
    async_trait,
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
    response::{IntoResponse, Response},
    Json,
};

pub struct NostrAuth {
    pub pubkey: String,
}

#[derive(Debug)]
pub enum NostrAuthRejection {
    MissingHeader,
    InvalidJson,
    WrongKind,
    Expired,
    InvalidSignature,
}

impl IntoResponse for NostrAuthRejection {
    fn into_response(self) -> Response {
        let msg = match &self {
            Self::MissingHeader      => "missing X-Nostr-Auth header",
            Self::InvalidJson        => "X-Nostr-Auth is not valid JSON",
            Self::WrongKind          => "event kind must be 27235",
            Self::Expired            => "event created_at is outside ±60s window",
            Self::InvalidSignature   => "invalid Nostr signature",
        };
        (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "code": "UNAUTHORIZED", "message": msg, "retryable": false })),
        )
            .into_response()
    }
}

#[async_trait]
impl<S: Send + Sync> FromRequestParts<S> for NostrAuth {
    type Rejection = NostrAuthRejection;

    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        let header = parts
            .headers
            .get("x-nostr-auth")
            .ok_or(NostrAuthRejection::MissingHeader)?;

        let raw = header.to_str().map_err(|_| NostrAuthRejection::InvalidJson)?;
        let event: nostr_sdk::Event =
            serde_json::from_str(raw).map_err(|_| NostrAuthRejection::InvalidJson)?;

        if event.kind != nostr_sdk::Kind::from(27235u16) {
            return Err(NostrAuthRejection::WrongKind);
        }

        let now = chrono::Utc::now().timestamp();
        let event_ts = event.created_at.as_u64() as i64;
        if (now - event_ts).abs() > 60 {
            return Err(NostrAuthRejection::Expired);
        }

        event.verify().map_err(|_| NostrAuthRejection::InvalidSignature)?;

        Ok(NostrAuth { pubkey: event.pubkey.to_hex() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request, routing::get, Router};
    use nostr_sdk::{EventBuilder, Keys, Kind};
    use tower::ServiceExt;

    fn make_auth_event(keys: &Keys, kind: u16, offset_secs: i64) -> String {
        let ts = nostr_sdk::Timestamp::from(
            (chrono::Utc::now().timestamp() + offset_secs) as u64
        );
        let event = EventBuilder::new(Kind::from(kind), "")
            .custom_created_at(ts)
            .sign_with_keys(keys)
            .unwrap();
        serde_json::to_string(&event).unwrap()
    }

    async fn test_app() -> Router {
        Router::new().route("/protected", get(|_auth: NostrAuth| async { "ok" }))
    }

    #[tokio::test]
    async fn missing_header_returns_401() {
        let app = test_app().await;
        let resp = app
            .oneshot(Request::get("/protected").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn wrong_kind_returns_401() {
        let keys = Keys::generate();
        let header = make_auth_event(&keys, 1, 0);
        let app = test_app().await;
        let resp = app
            .oneshot(
                Request::get("/protected")
                    .header("x-nostr-auth", header)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn expired_event_returns_401() {
        let keys = Keys::generate();
        let header = make_auth_event(&keys, 27235, -120);
        let app = test_app().await;
        let resp = app
            .oneshot(
                Request::get("/protected")
                    .header("x-nostr-auth", header)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn valid_event_passes() {
        let keys = Keys::generate();
        let header = make_auth_event(&keys, 27235, 0);
        let app = test_app().await;
        let resp = app
            .oneshot(
                Request::get("/protected")
                    .header("x-nostr-auth", header)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }
}
```

- [ ] **Step 2: Add `mod middleware;` to `main.rs`**

Add near the top of `services/gateway/src/main.rs` with the other `mod` declarations:

```rust
mod middleware;
```

Create `services/gateway/src/middleware/mod.rs`:

```rust
pub mod nostr_auth;
```

- [ ] **Step 3: Run tests**

```
cargo test -p gateway nostr_auth -- --nocapture
```

Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```
git add services/gateway/src/middleware/
git commit -m "feat(gateway): NostrAuth axum extractor with freshness + sig verification"
```

---

### Task 4: WsHub + /ws endpoint

**Files:**
- Create: `services/gateway/src/ws/hub.rs`
- Create: `services/gateway/src/ws/mod.rs`

- [ ] **Step 1: Write WsHub tests**

Create `services/gateway/src/ws/hub.rs`:

```rust
use bytes::Bytes;
use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::broadcast;

const CHANNEL_CAPACITY: usize = 256;

#[derive(Clone)]
pub struct WsHub {
    senders: Arc<DashMap<String, broadcast::Sender<Arc<Bytes>>>>,
}

impl WsHub {
    pub fn new() -> Self {
        Self { senders: Arc::new(DashMap::new()) }
    }

    /// Broadcast bytes to a specific county channel AND the "global" channel.
    /// If county is None, broadcasts to global only.
    pub fn broadcast(&self, county: Option<&str>, msg: Bytes) {
        let arc = Arc::new(msg);
        if let Some(c) = county {
            if let Some(tx) = self.senders.get(c) {
                let _ = tx.send(arc.clone());
            }
        }
        if let Some(tx) = self.senders.get("global") {
            let _ = tx.send(arc);
        }
    }

    /// Returns a receiver for the given county key (creates the channel if absent).
    /// Use "global" for clients that want all events regardless of county.
    pub fn subscribe(&self, county: &str) -> broadcast::Receiver<Arc<Bytes>> {
        self.senders
            .entry(county.to_string())
            .or_insert_with(|| broadcast::channel(CHANNEL_CAPACITY).0)
            .subscribe()
    }
}

impl Default for WsHub {
    fn default() -> Self { Self::new() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn county_subscriber_receives_broadcast() {
        let hub = WsHub::new();
        let mut rx = hub.subscribe("nairobi");
        hub.broadcast(Some("nairobi"), Bytes::from_static(b"hello"));
        let msg = rx.recv().await.unwrap();
        assert_eq!(msg.as_ref(), b"hello");
    }

    #[tokio::test]
    async fn global_subscriber_receives_all_broadcasts() {
        let hub = WsHub::new();
        let mut global = hub.subscribe("global");
        hub.broadcast(Some("mombasa"), Bytes::from_static(b"event1"));
        let msg = global.recv().await.unwrap();
        assert_eq!(msg.as_ref(), b"event1");
    }

    #[tokio::test]
    async fn county_subscriber_does_not_receive_other_county() {
        let hub = WsHub::new();
        let mut nairobi = hub.subscribe("nairobi");
        hub.broadcast(Some("mombasa"), Bytes::from_static(b"other"));
        // nairobi should not receive this
        assert!(nairobi.try_recv().is_err());
    }
}
```

- [ ] **Step 2: Create `services/gateway/src/ws/mod.rs`**

```rust
pub mod hub;
pub mod circle_hub;

use std::sync::Arc;
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::IntoResponse,
};
use bytes::Bytes;
use serde::Deserialize;
use crate::AppState;

#[derive(Deserialize)]
pub struct WsParams {
    pub county: Option<String>,
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<WsParams>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let county = params.county.unwrap_or_else(|| "global".to_string());
    ws.on_upgrade(move |socket| handle_public_ws(socket, county, state))
}

async fn handle_public_ws(mut socket: WebSocket, county: String, state: AppState) {
    let mut rx = state.hub.subscribe(&county);
    loop {
        tokio::select! {
            result = rx.recv() => {
                match result {
                    Ok(msg) => {
                        if socket.send(Message::Text(
                            std::str::from_utf8(&msg).unwrap_or("").to_string()
                        )).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("ws client lagged by {n} messages, county={county}");
                        // lossy: just continue
                    }
                    Err(_) => break,
                }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(_)) => {} // ignore client messages on the public feed
                    _ => break,
                }
            }
        }
    }
}
```

- [ ] **Step 3: Add `mod ws;` and `hub` to `AppState` in `main.rs`**

Replace `main.rs` AppState with:

```rust
mod config;
mod db;
mod error;
mod middleware;
mod ws;

use std::sync::Arc;
use axum::{extract::State, http::StatusCode, response::Json, routing::get, Router};
use tokio::net::TcpListener;
use ws::hub::WsHub;
use ws::circle_hub::CircleHub;

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::PgPool,
    pub config: Arc<config::Config>,
    pub http_client: reqwest::Client,
    pub hub: Arc<WsHub>,
    pub circle_hub: Arc<CircleHub>,
    pub redis_healthy: Arc<std::sync::atomic::AtomicBool>,
}
```

Update `main()` to build the new fields:

```rust
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let config = Arc::new(config::Config::from_env()?);
    let db = db::create_pool(&config.database_url).await?;
    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;
    let hub = Arc::new(WsHub::new());
    let circle_hub = Arc::new(CircleHub::new());
    let redis_healthy = Arc::new(std::sync::atomic::AtomicBool::new(false));

    let state = AppState { db, config, http_client, hub, circle_hub, redis_healthy };

    let app = Router::new()
        .route("/health", get(health))
        .route("/ws", get(ws::ws_handler))
        .with_state(state);

    let addr = format!("0.0.0.0:3000");
    let listener = TcpListener::bind(&addr).await?;
    tracing::info!("gateway listening on {addr}");
    axum::serve(listener, app).await?;
    Ok(())
}
```

- [ ] **Step 4: Run hub tests**

```
cargo test -p gateway ws::hub -- --nocapture
```

Expected: 3 tests pass.

- [ ] **Step 5: Compile check**

```
cargo build -p gateway
```

Expected: compiles.

- [ ] **Step 6: Commit**

```
git add services/gateway/src/ws/
git commit -m "feat(gateway): WsHub broadcast + /ws county-filtered endpoint"
```

---

### Task 5: CircleHub + /ws/circles endpoint

**Files:**
- Create: `services/gateway/src/ws/circle_hub.rs`
- Modify: `services/gateway/src/ws/mod.rs`

- [ ] **Step 1: Write CircleHub with tests**

Create `services/gateway/src/ws/circle_hub.rs`:

```rust
use bytes::Bytes;
use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::broadcast;
use uuid::Uuid;

const CHANNEL_CAPACITY: usize = 64;

#[derive(Clone)]
pub struct CircleHub {
    senders: Arc<DashMap<Uuid, broadcast::Sender<Arc<Bytes>>>>,
}

impl CircleHub {
    pub fn new() -> Self {
        Self { senders: Arc::new(DashMap::new()) }
    }

    pub fn broadcast(&self, circle_id: Uuid, msg: Bytes) {
        if let Some(tx) = self.senders.get(&circle_id) {
            let _ = tx.send(Arc::new(msg));
        }
    }

    pub fn subscribe(&self, circle_id: Uuid) -> broadcast::Receiver<Arc<Bytes>> {
        self.senders
            .entry(circle_id)
            .or_insert_with(|| broadcast::channel(CHANNEL_CAPACITY).0)
            .subscribe()
    }
}

impl Default for CircleHub { fn default() -> Self { Self::new() } }

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn circle_subscriber_receives_broadcast() {
        let hub = CircleHub::new();
        let id = Uuid::new_v4();
        let mut rx = hub.subscribe(id);
        hub.broadcast(id, Bytes::from_static(b"location"));
        let msg = rx.recv().await.unwrap();
        assert_eq!(msg.as_ref(), b"location");
    }

    #[tokio::test]
    async fn different_circles_are_isolated() {
        let hub = CircleHub::new();
        let id_a = Uuid::new_v4();
        let id_b = Uuid::new_v4();
        let mut rx_a = hub.subscribe(id_a);
        hub.broadcast(id_b, Bytes::from_static(b"other"));
        assert!(rx_a.try_recv().is_err());
    }
}
```

- [ ] **Step 2: Add circle WebSocket handler to `services/gateway/src/ws/mod.rs`**

Append to the existing `mod.rs`:

```rust
use uuid::Uuid;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum CircleClientMsg {
    JoinCircle { circle_id: Uuid, nostr_auth_event: Option<serde_json::Value> },
}

pub async fn ws_circles_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_circle_ws(socket, state))
}

async fn handle_circle_ws(mut socket: WebSocket, state: AppState) {
    // Wait for join_circle message
    let (circle_id, pubkey) = loop {
        match socket.recv().await {
            Some(Ok(Message::Text(text))) => {
                let Ok(msg) = serde_json::from_str::<CircleClientMsg>(&text) else {
                    let _ = socket.send(Message::Text(
                        r#"{"error":"expected join_circle message"}"#.into()
                    )).await;
                    continue;
                };
                let CircleClientMsg::JoinCircle { circle_id, nostr_auth_event } = msg;

                // Verify auth event if provided
                let resolved_pubkey = if let Some(raw) = nostr_auth_event {
                    match verify_ws_auth(&raw) {
                        Ok(pk) => pk,
                        Err(e) => {
                            let _ = socket.send(Message::Close(Some(axum::extract::ws::CloseFrame {
                                code: 4001,
                                reason: e.into(),
                            }))).await;
                            return;
                        }
                    }
                } else {
                    let _ = socket.send(Message::Close(Some(axum::extract::ws::CloseFrame {
                        code: 4001,
                        reason: "nostr_auth_event required".into(),
                    }))).await;
                    return;
                };

                // Check DB membership
                let is_member = sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM circle_members WHERE circle_id = $1 AND member_pubkey = $2
                     UNION ALL SELECT COUNT(*) FROM circles WHERE id = $1 AND owner_pubkey = $2"
                )
                .bind(circle_id)
                .bind(&resolved_pubkey)
                .fetch_all(&state.db)
                .await
                .map(|rows| rows.iter().any(|n| *n > 0))
                .unwrap_or(false);

                if !is_member {
                    let _ = socket.send(Message::Close(Some(axum::extract::ws::CloseFrame {
                        code: 4003,
                        reason: "not a circle member".into(),
                    }))).await;
                    return;
                }

                break (circle_id, resolved_pubkey);
            }
            _ => return,
        }
    };

    // Send snapshot of current blobs
    if let Ok(blobs) = fetch_blob_snapshot(&state.db, circle_id).await {
        let payload = serde_json::json!({ "type": "CIRCLE_SNAPSHOT", "payload": blobs });
        let _ = socket.send(Message::Text(payload.to_string())).await;
    }

    let mut rx = state.circle_hub.subscribe(circle_id);
    loop {
        tokio::select! {
            result = rx.recv() => {
                match result {
                    Ok(msg) => {
                        let text = std::str::from_utf8(&msg).unwrap_or("").to_string();
                        // Check for member removal
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                            if v["type"] == "MEMBER_REMOVED" && v["pubkey"] == pubkey {
                                let _ = socket.send(Message::Close(Some(axum::extract::ws::CloseFrame {
                                    code: 4003,
                                    reason: "removed from circle".into(),
                                }))).await;
                                return;
                            }
                        }
                        if socket.send(Message::Text(text)).await.is_err() { break; }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        // Re-send snapshot on lag
                        if let Ok(blobs) = fetch_blob_snapshot(&state.db, circle_id).await {
                            let payload = serde_json::json!({ "type": "CIRCLE_SNAPSHOT", "payload": blobs });
                            if socket.send(Message::Text(payload.to_string())).await.is_err() { break; }
                        }
                        rx = state.circle_hub.subscribe(circle_id);
                    }
                    Err(_) => break,
                }
            }
            msg = socket.recv() => {
                if !matches!(msg, Some(Ok(_))) { break; }
            }
        }
    }
}

fn verify_ws_auth(raw: &serde_json::Value) -> Result<String, std::borrow::Cow<'static, str>> {
    let event: nostr_sdk::Event = serde_json::from_value(raw.clone())
        .map_err(|_| std::borrow::Cow::Borrowed("invalid auth event JSON"))?;
    if event.kind != nostr_sdk::Kind::from(27235u16) {
        return Err("auth event must be kind 27235".into());
    }
    let now = chrono::Utc::now().timestamp();
    let ts = event.created_at.as_u64() as i64;
    if (now - ts).abs() > 60 {
        return Err("auth event expired".into());
    }
    event.verify().map_err(|_| std::borrow::Cow::Borrowed("invalid signature"))?;
    Ok(event.pubkey.to_hex())
}

async fn fetch_blob_snapshot(
    pool: &sqlx::PgPool,
    circle_id: Uuid,
) -> anyhow::Result<Vec<serde_json::Value>> {
    let rows = sqlx::query_as::<_, (Uuid, String, String, chrono::DateTime<chrono::Utc>)>(
        "SELECT id, sender_pubkey, encrypted_payload, expires_at
         FROM location_blobs WHERE circle_id = $1 AND expires_at > NOW()"
    )
    .bind(circle_id)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|(id, sender, payload, exp)| serde_json::json!({
        "id": id, "sender_pubkey": sender, "encrypted_payload": payload, "expires_at": exp
    })).collect())
}
```

- [ ] **Step 3: Register /ws/circles in `main.rs`**

In the router construction in `main()`, add:

```rust
.route("/ws/circles", get(ws::ws_circles_handler))
```

- [ ] **Step 4: Run CircleHub tests**

```
cargo test -p gateway ws::circle_hub -- --nocapture
```

Expected: 2 tests pass.

- [ ] **Step 5: Compile check**

```
cargo build -p gateway
```

- [ ] **Step 6: Commit**

```
git add services/gateway/src/ws/
git commit -m "feat(gateway): CircleHub + /ws/circles endpoint with auth + snapshot"
```

---

### Task 6: reports/consensus.rs

**Files:**
- Create: `services/gateway/src/reports/consensus.rs`
- Create: `services/gateway/src/reports/mod.rs`

- [ ] **Step 1: Write failing tests**

Create `services/gateway/src/reports/consensus.rs`:

```rust
/// Returns the new status if a transition applies, None if the report stays the same.
/// Priority: rejection > dispute > positive progression.
pub fn compute_new_status(
    status: &str,
    score: i32,
    confirmation_count: i32,
    denial_count: i32,
) -> Option<String> {
    // Rejection (highest priority)
    if matches!(status, "PENDING" | "DISPUTED") && score <= -5 {
        return Some("REJECTED".to_string());
    }
    // Dispute
    if matches!(status, "UNVERIFIED" | "VERIFIED" | "AUTHORITATIVE")
        && denial_count >= 3
        && denial_count > confirmation_count
    {
        return Some("DISPUTED".to_string());
    }
    // Positive progression
    match status {
        "PENDING"     if score >= 3  => Some("UNVERIFIED".to_string()),
        "UNVERIFIED"  if score >= 7  => Some("VERIFIED".to_string()),
        "VERIFIED"    if score >= 15 => Some("AUTHORITATIVE".to_string()),
        _                            => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_advances_to_unverified_at_score_3() {
        assert_eq!(compute_new_status("PENDING", 3, 2, 0), Some("UNVERIFIED".into()));
    }
    #[test]
    fn unverified_advances_to_verified_at_score_7() {
        assert_eq!(compute_new_status("UNVERIFIED", 7, 5, 0), Some("VERIFIED".into()));
    }
    #[test]
    fn verified_advances_to_authoritative_at_score_15() {
        assert_eq!(compute_new_status("VERIFIED", 15, 10, 0), Some("AUTHORITATIVE".into()));
    }
    #[test]
    fn rejected_when_score_minus_5_in_pending() {
        assert_eq!(compute_new_status("PENDING", -5, 0, 3), Some("REJECTED".into()));
    }
    #[test]
    fn rejected_when_score_minus_5_in_disputed() {
        assert_eq!(compute_new_status("DISPUTED", -5, 0, 4), Some("REJECTED".into()));
    }
    #[test]
    fn disputed_when_denial_count_dominates() {
        assert_eq!(compute_new_status("VERIFIED", 3, 1, 4), Some("DISPUTED".into()));
    }
    #[test]
    fn no_transition_below_threshold() {
        assert_eq!(compute_new_status("PENDING", 2, 1, 0), None);
    }
    #[test]
    fn rejection_takes_priority_over_positive() {
        // Score is -5 even though it would advance if positive
        assert_eq!(compute_new_status("PENDING", -5, 5, 0), Some("REJECTED".into()));
    }
}
```

Create `services/gateway/src/reports/mod.rs`:

```rust
pub mod consensus;
pub mod service;
```

Add `mod reports;` to `main.rs`.

- [ ] **Step 2: Run consensus tests**

```
cargo test -p gateway reports::consensus -- --nocapture
```

Expected: 8 tests pass.

- [ ] **Step 3: Commit**

```
git add services/gateway/src/reports/
git commit -m "feat(gateway): consensus state machine with 8 tests"
```

---

### Task 7: reports/service.rs

**Files:**
- Create: `services/gateway/src/reports/service.rs`

This file contains the DB-touching business logic for reports: create, vote, list, and status transition.

- [ ] **Step 1: Create `services/gateway/src/reports/service.rs`**

```rust
use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Report {
    pub id: Uuid,
    pub report_type: String,
    pub description: Option<String>,
    pub lat: f64,
    pub lng: f64,
    pub place_name: Option<String>,
    pub nostr_pubkey: String,
    pub nostr_signature: String,
    pub nostr_event_id: String,
    pub reporter_tier: String,
    pub consensus_score: i32,
    pub confirmation_count: i32,
    pub denial_count: i32,
    pub status: String,
    pub photo_ipfs_cid: Option<String>,
    pub linked_event_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub struct CreateReportInput {
    pub report_type: String,
    pub description: Option<String>,
    pub lat: f64,
    pub lng: f64,
    pub place_name: Option<String>,
    pub nostr_pubkey: String,
    pub nostr_signature: String,
    pub nostr_event_id: String,
    pub photo_ipfs_cid: Option<String>,
    pub linked_event_id: Option<Uuid>,
}

pub struct CastVoteInput {
    pub voter_pubkey: String,
    pub vote: String, // "CONFIRM" or "DENY"
    pub voter_lat: Option<f64>,
    pub voter_lng: Option<f64>,
}

#[derive(Deserialize)]
pub struct ListReportsParams {
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub radius_km: Option<f64>,
    pub status: Option<String>,
    pub reporter_tier: Option<String>,
    pub linked_event_id: Option<Uuid>,
    pub limit: Option<i64>,
}

fn tier_score(tier: &str) -> i32 {
    match tier {
        "TRUSTED"   => 2,
        "VETERAN"   => 3,
        "SENTINEL"  => 4,
        _           => 1, // NEWCOMER
    }
}

fn compute_tier(score: i64) -> &'static str {
    if score >= 50      { "SENTINEL" }
    else if score >= 20 { "VETERAN" }
    else if score >= 5  { "TRUSTED" }
    else                { "NEWCOMER" }
}

pub async fn create_report(pool: &PgPool, input: CreateReportInput) -> Result<Report> {
    let mut tx = pool.begin().await?;

    // Upsert user
    sqlx::query(
        "INSERT INTO users (nostr_pubkey, total_reports, last_active, reputation_score, reputation_tier, accurate_reports)
         VALUES ($1, 1, NOW(), 0, 'NEWCOMER', 0)
         ON CONFLICT (nostr_pubkey) DO UPDATE
           SET total_reports = users.total_reports + 1, last_active = NOW()"
    )
    .bind(&input.nostr_pubkey)
    .execute(&mut *tx)
    .await?;

    let tier: String = sqlx::query_scalar(
        "SELECT reputation_tier FROM users WHERE nostr_pubkey = $1"
    )
    .bind(&input.nostr_pubkey)
    .fetch_one(&mut *tx)
    .await?;

    let initial_score = tier_score(&tier);

    let report = sqlx::query_as::<_, Report>(
        "INSERT INTO community_reports
           (report_type, description, lat, lng, place_name, nostr_pubkey, nostr_signature,
            nostr_event_id, reporter_tier, consensus_score, confirmation_count, denial_count,
            status, photo_ipfs_cid, linked_event_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,0,'PENDING',$11,$12)
         RETURNING *"
    )
    .bind(&input.report_type)
    .bind(&input.description)
    .bind(input.lat)
    .bind(input.lng)
    .bind(&input.place_name)
    .bind(&input.nostr_pubkey)
    .bind(&input.nostr_signature)
    .bind(&input.nostr_event_id)
    .bind(&tier)
    .bind(initial_score)
    .bind(&input.photo_ipfs_cid)
    .bind(input.linked_event_id)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(report)
}

/// Returns (updated_report, old_score) so callers can detect threshold crossings.
pub async fn cast_vote(
    pool: &PgPool,
    report_id: Uuid,
    input: CastVoteInput,
) -> Result<(Report, i32)> {
    let mut tx = pool.begin().await?;

    let report = sqlx::query_as::<_, Report>(
        "SELECT * FROM community_reports WHERE id = $1 FOR UPDATE"
    )
    .bind(report_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| anyhow::anyhow!("report not found"))?;

    if report.nostr_pubkey == input.voter_pubkey {
        anyhow::bail!("cannot vote on your own report");
    }

    let old_score = report.consensus_score;

    // Check proximity (within 1000m)
    let nearby = match (input.voter_lat, input.voter_lng) {
        (Some(vlat), Some(vlng)) => {
            let dist: f64 = sqlx::query_scalar(
                "SELECT earth_distance(ll_to_earth($1,$2), ll_to_earth($3,$4))"
            )
            .bind(vlat).bind(vlng).bind(report.lat).bind(report.lng)
            .fetch_one(&mut *tx)
            .await?;
            dist <= 1000.0
        }
        _ => false,
    };

    let (score_delta, conf_delta, deny_delta) = match (input.vote.as_str(), nearby) {
        ("CONFIRM", true)  => (2i32,  1i32, 0i32),
        ("CONFIRM", false) => (1,      1,    0),
        ("DENY",    true)  => (-3,     0,    1),
        ("DENY",    false) => (-2,     0,    1),
        _ => anyhow::bail!("vote must be CONFIRM or DENY"),
    };

    sqlx::query(
        "INSERT INTO report_votes (report_id, voter_pubkey, vote, voter_lat, voter_lng)
         VALUES ($1, $2, $3, $4, $5)"
    )
    .bind(report_id).bind(&input.voter_pubkey).bind(&input.vote)
    .bind(input.voter_lat).bind(input.voter_lng)
    .execute(&mut *tx)
    .await?;

    let updated = sqlx::query_as::<_, Report>(
        "UPDATE community_reports
         SET consensus_score    = consensus_score + $2,
             confirmation_count = confirmation_count + $3,
             denial_count       = denial_count + $4,
             updated_at         = NOW()
         WHERE id = $1
         RETURNING *"
    )
    .bind(report_id).bind(score_delta).bind(conf_delta).bind(deny_delta)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok((updated, old_score))
}

pub async fn apply_status_transition(
    pool: &PgPool,
    report_id: Uuid,
    new_status: &str,
    reporter_pubkey: &str,
) -> Result<()> {
    let mut tx = pool.begin().await?;

    sqlx::query("UPDATE community_reports SET status = $2, updated_at = NOW() WHERE id = $1")
        .bind(report_id).bind(new_status)
        .execute(&mut *tx).await?;

    if new_status == "VERIFIED" {
        let new_score: i64 = sqlx::query_scalar(
            "UPDATE users SET accurate_reports = accurate_reports + 1,
                              reputation_score  = reputation_score  + 10
             WHERE nostr_pubkey = $1
             RETURNING reputation_score"
        )
        .bind(reporter_pubkey)
        .fetch_one(&mut *tx)
        .await?;

        let new_tier = compute_tier(new_score);
        sqlx::query("UPDATE users SET reputation_tier = $2 WHERE nostr_pubkey = $1")
            .bind(reporter_pubkey).bind(new_tier)
            .execute(&mut *tx).await?;
    }

    tx.commit().await?;
    Ok(())
}

pub async fn list_reports(pool: &PgPool, params: ListReportsParams) -> Result<Vec<Report>> {
    let limit = params.limit.unwrap_or(50).min(200);
    let radius_m = params.radius_km.unwrap_or(10.0) * 1000.0;

    // Build dynamic query. All filters are optional.
    let reports = sqlx::query_as::<_, Report>(
        "SELECT * FROM community_reports
         WHERE ($1::float8 IS NULL OR
                earth_distance(ll_to_earth($1,$2), ll_to_earth(lat,lng)) <= $3)
           AND ($4::text IS NULL OR status = $4)
           AND ($5::text IS NULL OR reporter_tier = $5)
           AND ($6::uuid IS NULL OR linked_event_id = $6)
         ORDER BY created_at DESC
         LIMIT $7"
    )
    .bind(params.lat)
    .bind(params.lng)
    .bind(radius_m)
    .bind(params.status)
    .bind(params.reporter_tier)
    .bind(params.linked_event_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    Ok(reports)
}
```

- [ ] **Step 2: Compile check**

```
cargo build -p gateway
```

Expected: compiles (no DB tests — logic tested via route integration tests).

- [ ] **Step 3: Commit**

```
git add services/gateway/src/reports/service.rs
git commit -m "feat(gateway): report service — create, vote, list, status transition"
```

---

### Task 8: routes/events.rs

**Files:**
- Create: `services/gateway/src/routes/events.rs`
- Create: `services/gateway/src/routes/mod.rs`

- [ ] **Step 1: Create `services/gateway/src/routes/events.rs`**

```rust
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::get,
    Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{error::AppError, AppState};

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
    pub nostr_event_id: Option<String>,
    pub bitcoin_txid: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Deserialize)]
pub struct CreateEventBody {
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
    pub is_active: Option<bool>,
}

#[derive(Deserialize)]
pub struct ListEventsQuery {
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub radius_km: Option<f64>,
    pub severity: Option<String>,   // comma-separated
    pub r#type: Option<String>,      // comma-separated
    pub active_only: Option<String>,
    pub limit: Option<i64>,
}

async fn create_event(
    State(state): State<AppState>,
    Json(body): Json<CreateEventBody>,
) -> Result<(StatusCode, Json<SafetyEvent>), AppError> {
    if body.event_type.is_empty() || body.title.is_empty() || body.severity.is_empty() {
        return Err(AppError::BadRequest("event_type, title, severity are required".into()));
    }

    let mut tx = state.db.begin().await?;

    let event = sqlx::query_as::<_, SafetyEvent>(
        "INSERT INTO safety_events
           (event_type, severity, title, lat, lng, started_at, summary, place_name, county,
            radius_meters, confidence, source_count, source_breakdown, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING *"
    )
    .bind(&body.event_type).bind(&body.severity).bind(&body.title)
    .bind(body.lat).bind(body.lng).bind(body.started_at)
    .bind(&body.summary).bind(&body.place_name).bind(&body.county)
    .bind(body.radius_meters).bind(body.confidence).bind(body.source_count)
    .bind(&body.source_breakdown).bind(body.is_active.unwrap_or(true))
    .fetch_one(&mut *tx)
    .await?;

    let should_publish = matches!(body.severity.as_str(), "AUTHORITATIVE" | "CRITICAL");
    if should_publish {
        sqlx::query(
            "INSERT INTO publish_jobs (source_type, source_id, status, next_retry_at)
             VALUES ('SAFETY_EVENT', $1, 'PENDING', NOW())"
        )
        .bind(event.id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    // Broadcast to WebSocket hub (fire-and-forget)
    {
        let msg = serde_json::json!({ "type": "NEW_EVENT", "payload": event });
        state.hub.broadcast(body.county.as_deref(), serde_json::to_string(&msg).unwrap().into());
    }

    // Nudge blockchain service if applicable
    if should_publish {
        if let Some(url) = state.config.blockchain_service_url.clone() {
            crate::nudge::nudge_blockchain(state.http_client.clone(), url);
        }
    }

    Ok((StatusCode::CREATED, Json(event)))
}

async fn list_events(
    State(state): State<AppState>,
    Query(q): Query<ListEventsQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let radius_m = q.radius_km.unwrap_or(10.0) * 1000.0;
    let limit = q.limit.unwrap_or(50).min(200);
    let active_only = q.active_only.as_deref() != Some("false");

    let severity_filter: Option<Vec<String>> = q.severity.as_deref()
        .map(|s| s.split(',').map(|x| x.trim().to_uppercase()).collect());
    let type_filter: Option<Vec<String>> = q.r#type.as_deref()
        .map(|s| s.split(',').map(|x| x.trim().to_uppercase()).collect());

    let events = sqlx::query_as::<_, SafetyEvent>(
        "SELECT * FROM safety_events
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

    let total = events.len() as i64;
    Ok(Json(serde_json::json!({ "events": events, "total": total })))
}

async fn get_event(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<SafetyEvent>, AppError> {
    let event = sqlx::query_as::<_, SafetyEvent>(
        "SELECT * FROM safety_events WHERE id = $1"
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;

    Ok(Json(event))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_events).post(create_event))
        .route("/:id", get(get_event))
}
```

- [ ] **Step 2: Create `services/gateway/src/routes/mod.rs`**

```rust
pub mod events;
pub mod reports;
pub mod circles;
pub mod location_blobs;
pub mod zap;

use axum::Router;
use crate::AppState;

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .nest("/api/events",  events::router())
        .nest("/api/reports", reports::router())
        .nest("/api/circles", circles::router())
        .nest("/api/zaps",    zap::router())
        .with_state(state)
}
```

- [ ] **Step 3: Add `mod routes;` to `main.rs` and wire router**

In `main.rs`, add near other mod declarations:

```rust
mod nudge;
mod routes;
```

Replace the app construction in `main()`:

```rust
let app = Router::new()
    .route("/health", get(health))
    .route("/health/detailed", get(health_detailed))
    .route("/ws", get(ws::ws_handler))
    .route("/ws/circles", get(ws::ws_circles_handler))
    .merge(routes::build_router(state.clone()))
    .with_state(state);
```

Add `health_detailed` handler after `health`:

```rust
async fn health_detailed(State(state): State<AppState>) -> Json<serde_json::Value> {
    let redis_ok = state.redis_healthy.load(std::sync::atomic::Ordering::Relaxed);
    let ts = chrono::Utc::now().to_rfc3339();
    Json(serde_json::json!({ "ok": true, "service": "gateway", "ts": ts, "redis": redis_ok }))
}
```

- [ ] **Step 4: Compile check**

```
cargo build -p gateway
```

Expected: compiles. (There will be stubs needed for `reports`, `circles`, `location_blobs`, `zap` — create them as empty router stubs now.)

Create stubs for each missing route file, e.g. `services/gateway/src/routes/reports.rs`:

```rust
use axum::Router;
use crate::AppState;
pub fn router() -> Router<AppState> { Router::new() }
```

Repeat for `circles.rs`, `location_blobs.rs`, `zap.rs`.

- [ ] **Step 5: Commit**

```
git add services/gateway/src/routes/
git commit -m "feat(gateway): events routes (POST/GET /api/events, GET by id)"
```

---

### Task 9: nudge.rs

**Files:**
- Create: `services/gateway/src/nudge.rs`

- [ ] **Step 1: Create `services/gateway/src/nudge.rs`**

```rust
use reqwest::Client;

pub fn nudge_blockchain(client: Client, base_url: String) {
    tokio::spawn(async move {
        let url = format!("{base_url}/internal/nudge");
        match client
            .post(&url)
            .timeout(std::time::Duration::from_millis(500))
            .send()
            .await
        {
            Ok(r) if r.status().is_success() => {}
            Ok(r)  => tracing::warn!("blockchain nudge returned {}", r.status()),
            Err(e) => tracing::warn!("blockchain nudge failed: {e}"),
        }
    });
}
```

- [ ] **Step 2: Compile check**

```
cargo build -p gateway
```

- [ ] **Step 3: Commit**

```
git add services/gateway/src/nudge.rs
git commit -m "feat(gateway): fire-and-forget blockchain nudge"
```

---

### Task 10: routes/reports.rs

**Files:**
- Replace stub: `services/gateway/src/routes/reports.rs`

- [ ] **Step 1: Implement `services/gateway/src/routes/reports.rs`**

```rust
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::Json,
    routing::{get, post},
    Router,
};
use chrono::Utc;
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::{net::IpAddr, sync::Arc, time::{Duration, Instant}};
use uuid::Uuid;

use crate::{
    error::AppError,
    reports::{
        consensus::compute_new_status,
        service::{
            apply_status_transition, cast_vote, create_report, list_reports,
            CastVoteInput, CreateReportInput, ListReportsParams,
        },
    },
    AppState,
};

// Simple token-bucket rate limiter keyed by string (IP or pubkey)
#[derive(Clone)]
struct RateLimiter(Arc<DashMap<String, (u32, Instant)>>, u32, Duration);

impl RateLimiter {
    fn new(max: u32, window: Duration) -> Self {
        Self(Arc::new(DashMap::new()), max, window)
    }
    fn check(&self, key: &str) -> bool {
        let now = Instant::now();
        let mut entry = self.0.entry(key.to_string()).or_insert((0, now));
        if now.duration_since(entry.1) >= self.2 {
            *entry = (1, now);
            return true;
        }
        if entry.0 < self.1 {
            entry.0 += 1;
            true
        } else {
            false
        }
    }
}

#[derive(Deserialize)]
struct CreateReportBody {
    report_type: String,
    description: Option<String>,
    lat: f64,
    lng: f64,
    place_name: Option<String>,
    nostr_pubkey: String,
    nostr_event: serde_json::Value,
    photo_ipfs_cid: Option<String>,
    linked_event_id: Option<Uuid>,
}

const VALID_REPORT_TYPES: &[&str] = &[
    "ROAD_BLOCKED", "FLOODING", "SECURITY_INCIDENT", "FIRE",
    "PROTEST_MARCH", "ACCIDENT", "INFRASTRUCTURE", "ALL_CLEAR", "OTHER",
];

#[derive(Deserialize)]
struct CastVoteBody {
    voter_pubkey: String,
    vote: String,
    voter_nostr_event: serde_json::Value,
    voter_lat: Option<f64>,
    voter_lng: Option<f64>,
}

fn extract_ip(headers: &HeaderMap) -> String {
    headers.get("x-real-ip")
        .or_else(|| headers.get("x-forwarded-for"))
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or("").trim().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

fn verify_nostr_event(raw: &serde_json::Value, expected_pubkey: &str, max_age_secs: i64) -> Result<(), AppError> {
    let event: nostr_sdk::Event = serde_json::from_value(raw.clone())
        .map_err(|_| AppError::BadRequest("invalid nostr_event".into()))?;
    if event.pubkey.to_hex() != expected_pubkey {
        return Err(AppError::BadRequest("nostr_event pubkey mismatch".into()));
    }
    let age = Utc::now().timestamp() - event.created_at.as_u64() as i64;
    if age > max_age_secs || age < -10 {
        return Err(AppError::BadRequest("nostr_event is expired".into()));
    }
    event.verify().map_err(|_| AppError::BadRequest("invalid nostr signature".into()))?;
    Ok(())
}

// Shared rate limiters live in AppState extension — we embed them in the closure via Arc
async fn post_report(
    State(state): State<AppState>,
    headers: HeaderMap,
    report_rl: axum::Extension<Arc<RateLimiter>>,
    Json(body): Json<CreateReportBody>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let ip = extract_ip(&headers);
    let key = format!("report:{}", body.nostr_pubkey.chars().take(16).collect::<String>());
    if !report_rl.check(&key) && !report_rl.check(&format!("ip:{ip}")) {
        return Err(AppError::RateLimited);
    }

    if !VALID_REPORT_TYPES.contains(&body.report_type.as_str()) {
        return Err(AppError::BadRequest(format!("invalid report_type: {}", body.report_type)));
    }

    verify_nostr_event(&body.nostr_event, &body.nostr_pubkey, 300)?;

    let sig = body.nostr_event["sig"].as_str().unwrap_or("").to_string();
    let event_id = body.nostr_event["id"].as_str().unwrap_or("").to_string();

    let report = create_report(&state.db, CreateReportInput {
        report_type: body.report_type,
        description: body.description,
        lat: body.lat,
        lng: body.lng,
        place_name: body.place_name,
        nostr_pubkey: body.nostr_pubkey.clone(),
        nostr_signature: sig,
        nostr_event_id: event_id,
        photo_ipfs_cid: body.photo_ipfs_cid,
        linked_event_id: body.linked_event_id,
    }).await?;

    let msg = serde_json::json!({ "type": "NEW_REPORT", "payload": report });
    state.hub.broadcast(None, serde_json::to_string(&msg).unwrap().into());

    Ok((StatusCode::CREATED, Json(serde_json::to_value(&report).unwrap())))
}

async fn vote(
    State(state): State<AppState>,
    headers: HeaderMap,
    vote_rl: axum::Extension<Arc<RateLimiter>>,
    Path(report_id): Path<Uuid>,
    Json(body): Json<CastVoteBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let ip = extract_ip(&headers);
    let key = format!("vote:{}", body.voter_pubkey.chars().take(16).collect::<String>());
    if !vote_rl.check(&key) && !vote_rl.check(&format!("ip:{ip}")) {
        return Err(AppError::RateLimited);
    }

    verify_nostr_event(&body.voter_nostr_event, &body.voter_pubkey, 300)?;

    let (updated, old_score) = cast_vote(&state.db, report_id, CastVoteInput {
        voter_pubkey: body.voter_pubkey,
        vote: body.vote,
        voter_lat: body.voter_lat,
        voter_lng: body.voter_lng,
    }).await.map_err(|e| {
        if e.to_string().contains("unique") || e.to_string().contains("duplicate") {
            AppError::BadRequest("already voted on this report".into())
        } else if e.to_string().contains("not found") {
            AppError::NotFound
        } else if e.to_string().contains("own report") {
            AppError::BadRequest("cannot vote on your own report".into())
        } else {
            AppError::Internal(e)
        }
    })?;

    // Compute and apply status transition
    if let Some(new_status) = compute_new_status(
        &updated.status,
        updated.consensus_score,
        updated.confirmation_count,
        updated.denial_count,
    ) {
        apply_status_transition(&state.db, report_id, &new_status, &updated.nostr_pubkey).await?;

        // Publish job if crossing score threshold
        if updated.consensus_score >= 3 && old_score < 3 {
            sqlx::query(
                "INSERT INTO publish_jobs (source_type, source_id, status, next_retry_at)
                 VALUES ('COMMUNITY_REPORT', $1, 'PENDING', NOW())
                 ON CONFLICT DO NOTHING"
            )
            .bind(report_id)
            .execute(&state.db)
            .await?;

            if let Some(url) = state.config.blockchain_service_url.clone() {
                crate::nudge::nudge_blockchain(state.http_client.clone(), url);
            }
        }
    }

    let msg = serde_json::json!({ "type": "REPORT_UPDATED", "payload": updated });
    state.hub.broadcast(None, serde_json::to_string(&msg).unwrap().into());

    Ok(Json(serde_json::to_value(&updated).unwrap()))
}

async fn list(
    State(state): State<AppState>,
    Query(params): Query<ListReportsParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    let reports = list_reports(&state.db, params).await?;
    let total = reports.len() as i64;
    Ok(Json(serde_json::json!({ "reports": reports, "total": total })))
}

async fn by_event(
    State(state): State<AppState>,
    Path(event_id): Path<Uuid>,
    Query(q): Query<ListReportsParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    let params = ListReportsParams { linked_event_id: Some(event_id), ..q };
    let reports = list_reports(&state.db, params).await?;
    let total = reports.len() as i64;
    Ok(Json(serde_json::json!({ "reports": reports, "total": total })))
}

pub fn router() -> Router<AppState> {
    let report_rl = Arc::new(RateLimiter::new(10, Duration::from_secs(3600)));
    let vote_rl = Arc::new(RateLimiter::new(30, Duration::from_secs(60)));
    Router::new()
        .route("/", post(post_report).get(list))
        .route("/:id/vote", post(vote))
        .route("/by-event/:event_id", get(by_event))
        .layer(axum::Extension(report_rl))
        .layer(axum::Extension(vote_rl))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_limiter_allows_up_to_max() {
        let rl = RateLimiter::new(3, Duration::from_secs(60));
        assert!(rl.check("key1"));
        assert!(rl.check("key1"));
        assert!(rl.check("key1"));
        assert!(!rl.check("key1")); // 4th request denied
    }

    #[test]
    fn rate_limiter_resets_after_window() {
        let rl = RateLimiter::new(1, Duration::from_millis(1));
        assert!(rl.check("key2"));
        assert!(!rl.check("key2")); // denied within window
        std::thread::sleep(Duration::from_millis(5));
        assert!(rl.check("key2")); // allowed after window resets
    }
}
```

- [ ] **Step 2: Run rate limiter tests**

```
cargo test -p gateway routes::reports -- --nocapture
```

Expected: 2 tests pass.

- [ ] **Step 3: Compile check**

```
cargo build -p gateway
```

- [ ] **Step 4: Commit**

```
git add services/gateway/src/routes/reports.rs
git commit -m "feat(gateway): reports routes with consensus voting and IP rate limiting"
```

---

### Task 11: routes/circles.rs + routes/location_blobs.rs

**Files:**
- Replace stub: `services/gateway/src/routes/circles.rs`
- Replace stub: `services/gateway/src/routes/location_blobs.rs`

- [ ] **Step 1: Implement `services/gateway/src/routes/circles.rs`**

```rust
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{delete, get, post},
    Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{error::AppError, middleware::nostr_auth::NostrAuth, AppState};

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Circle {
    pub id: Uuid,
    pub owner_pubkey: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct CircleMember {
    pub circle_id: Uuid,
    pub member_pubkey: String,
    pub alert_radius_km: Option<f64>,
    pub alert_severity: Option<String>,
    pub joined_at: DateTime<Utc>,
}

#[derive(Deserialize)]
struct CreateCircleBody { name: String }

#[derive(Deserialize)]
struct AddMemberBody {
    member_pubkey: String,
    alert_radius_km: Option<f64>,
    alert_severity: Option<String>,
}

async fn create_circle(
    State(state): State<AppState>,
    auth: NostrAuth,
    Json(body): Json<CreateCircleBody>,
) -> Result<(StatusCode, Json<Circle>), AppError> {
    let circle = sqlx::query_as::<_, Circle>(
        "INSERT INTO circles (id, owner_pubkey, name) VALUES (gen_random_uuid(), $1, $2) RETURNING *"
    )
    .bind(&auth.pubkey).bind(&body.name)
    .fetch_one(&state.db).await?;
    Ok((StatusCode::CREATED, Json(circle)))
}

async fn get_circle(
    State(state): State<AppState>,
    _auth: NostrAuth,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let circle = sqlx::query_as::<_, Circle>("SELECT * FROM circles WHERE id = $1")
        .bind(id).fetch_optional(&state.db).await?.ok_or(AppError::NotFound)?;

    let members = sqlx::query_as::<_, CircleMember>(
        "SELECT * FROM circle_members WHERE circle_id = $1"
    )
    .bind(id).fetch_all(&state.db).await?;

    Ok(Json(serde_json::json!({ "id": circle.id, "owner_pubkey": circle.owner_pubkey,
        "name": circle.name, "created_at": circle.created_at, "members": members })))
}

async fn add_member(
    State(state): State<AppState>,
    auth: NostrAuth,
    Path(id): Path<Uuid>,
    Json(body): Json<AddMemberBody>,
) -> Result<(StatusCode, Json<CircleMember>), AppError> {
    // Only owner can add members
    let owner: Option<String> = sqlx::query_scalar("SELECT owner_pubkey FROM circles WHERE id = $1")
        .bind(id).fetch_optional(&state.db).await?;
    if owner.as_deref() != Some(&auth.pubkey) {
        return Err(AppError::Forbidden);
    }

    let member = sqlx::query_as::<_, CircleMember>(
        "INSERT INTO circle_members (circle_id, member_pubkey, alert_radius_km, alert_severity)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (circle_id, member_pubkey) DO UPDATE
           SET alert_radius_km = EXCLUDED.alert_radius_km,
               alert_severity  = EXCLUDED.alert_severity
         RETURNING *"
    )
    .bind(id).bind(&body.member_pubkey).bind(body.alert_radius_km).bind(&body.alert_severity)
    .fetch_one(&state.db).await?;

    Ok((StatusCode::CREATED, Json(member)))
}

async fn remove_member(
    State(state): State<AppState>,
    auth: NostrAuth,
    Path((circle_id, member_pubkey)): Path<(Uuid, String)>,
) -> Result<StatusCode, AppError> {
    // Owner OR self-removal allowed
    let owner: Option<String> = sqlx::query_scalar("SELECT owner_pubkey FROM circles WHERE id = $1")
        .bind(circle_id).fetch_optional(&state.db).await?;
    if owner.as_deref() != Some(&auth.pubkey) && auth.pubkey != member_pubkey {
        return Err(AppError::Forbidden);
    }

    sqlx::query("DELETE FROM circle_members WHERE circle_id = $1 AND member_pubkey = $2")
        .bind(circle_id).bind(&member_pubkey)
        .execute(&state.db).await?;

    // Notify the circle's WebSocket channel that this member was removed
    let msg = serde_json::json!({ "type": "MEMBER_REMOVED", "pubkey": member_pubkey });
    state.circle_hub.broadcast(circle_id, serde_json::to_string(&msg).unwrap().into());

    Ok(StatusCode::NO_CONTENT)
}

async fn delete_circle(
    State(state): State<AppState>,
    auth: NostrAuth,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let deleted = sqlx::query(
        "DELETE FROM circles WHERE id = $1 AND owner_pubkey = $2"
    )
    .bind(id).bind(&auth.pubkey)
    .execute(&state.db).await?;

    if deleted.rows_affected() == 0 { return Err(AppError::Forbidden); }
    Ok(StatusCode::NO_CONTENT)
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", post(create_circle))
        .route("/:id", get(get_circle).delete(delete_circle))
        .route("/:id/members", post(add_member))
        .route("/:id/members/:pubkey", delete(remove_member))
}
```

- [ ] **Step 2: Implement `services/gateway/src/routes/location_blobs.rs`**

```rust
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::get,
    Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{error::AppError, middleware::nostr_auth::NostrAuth, AppState};

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct LocationBlob {
    pub id: Uuid,
    pub circle_id: Uuid,
    pub sender_pubkey: String,
    pub encrypted_payload: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Deserialize)]
struct PushBlobBody { encrypted_payload: String }

async fn is_circle_member(db: &sqlx::PgPool, circle_id: Uuid, pubkey: &str) -> anyhow::Result<bool> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM (
           SELECT 1 FROM circle_members WHERE circle_id = $1 AND member_pubkey = $2
           UNION
           SELECT 1 FROM circles WHERE id = $1 AND owner_pubkey = $2
         ) sub"
    )
    .bind(circle_id).bind(pubkey)
    .fetch_one(db).await?;
    Ok(count > 0)
}

async fn push_blob(
    State(state): State<AppState>,
    auth: NostrAuth,
    Path(circle_id): Path<Uuid>,
    Json(body): Json<PushBlobBody>,
) -> Result<(StatusCode, Json<LocationBlob>), AppError> {
    if !is_circle_member(&state.db, circle_id, &auth.pubkey).await? {
        return Err(AppError::Forbidden);
    }

    let blob = sqlx::query_as::<_, LocationBlob>(
        "INSERT INTO location_blobs (id, circle_id, sender_pubkey, encrypted_payload, expires_at)
         VALUES (gen_random_uuid(), $1, $2, $3, NOW() + INTERVAL '10 minutes')
         RETURNING *"
    )
    .bind(circle_id).bind(&auth.pubkey).bind(&body.encrypted_payload)
    .fetch_one(&state.db).await?;

    let msg = serde_json::json!({ "type": "CIRCLE_LOCATION_BLOB", "payload": blob });
    state.circle_hub.broadcast(circle_id, serde_json::to_string(&msg).unwrap().into());

    Ok((StatusCode::CREATED, Json(blob)))
}

async fn list_blobs(
    State(state): State<AppState>,
    auth: NostrAuth,
    Path(circle_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !is_circle_member(&state.db, circle_id, &auth.pubkey).await? {
        return Err(AppError::Forbidden);
    }

    let blobs = sqlx::query_as::<_, LocationBlob>(
        "SELECT * FROM location_blobs WHERE circle_id = $1 AND expires_at > NOW()"
    )
    .bind(circle_id)
    .fetch_all(&state.db).await?;

    Ok(Json(serde_json::json!({ "blobs": blobs })))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/:id/location", get(list_blobs).post(push_blob))
}
```

- [ ] **Step 3: Wire location_blobs into `routes/mod.rs`**

In `services/gateway/src/routes/mod.rs`, update `build_router`:

```rust
pub fn build_router(state: AppState) -> Router {
    Router::new()
        .nest("/api/events",  events::router())
        .nest("/api/reports", reports::router())
        .nest("/api/circles", circles::router().merge(location_blobs::router()))
        .nest("/api/zaps",    zap::router())
        .with_state(state)
}
```

- [ ] **Step 4: Compile check**

```
cargo build -p gateway
```

- [ ] **Step 5: Commit**

```
git add services/gateway/src/routes/circles.rs services/gateway/src/routes/location_blobs.rs
git commit -m "feat(gateway): circles CRUD + encrypted location blobs routes"
```

---

### Task 12: lightning/lnd_client.rs + lightning/zap_service.rs + routes/zap.rs

**Files:**
- Create: `services/gateway/src/lightning/mod.rs`
- Create: `services/gateway/src/lightning/lnd_client.rs`
- Create: `services/gateway/src/lightning/zap_service.rs`
- Replace stub: `services/gateway/src/routes/zap.rs`

- [ ] **Step 1: Create `services/gateway/src/lightning/lnd_client.rs`**

```rust
use anyhow::Result;
use reqwest::Client;
use serde::Deserialize;

#[derive(Clone)]
pub struct LndClient {
    client: Client,
    base_url: String,
    macaroon_hex: String,
}

#[derive(Deserialize)]
struct LndInvoiceResponse {
    payment_request: String,
    r_hash: String, // base64 encoded
}

pub struct InvoiceResult {
    pub payment_request: String,
    pub payment_hash_hex: String,
}

impl LndClient {
    pub fn new(base_url: &str, macaroon_hex: &str, tls_skip_verify: bool) -> Result<Self> {
        let client = Client::builder()
            .danger_accept_invalid_certs(tls_skip_verify)
            .build()?;
        Ok(Self {
            client,
            base_url: base_url.trim_end_matches('/').to_string(),
            macaroon_hex: macaroon_hex.to_string(),
        })
    }

    pub async fn create_invoice(&self, amount_sats: i64, memo: &str) -> Result<InvoiceResult> {
        let resp: LndInvoiceResponse = self.client
            .post(format!("{}/v1/invoices", self.base_url))
            .header("Grpc-Metadata-macaroon", &self.macaroon_hex)
            .json(&serde_json::json!({ "value": amount_sats, "memo": memo, "expiry": 3600 }))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        // LND returns r_hash as base64 standard
        let hash_bytes = base64_decode_standard(&resp.r_hash)?;
        let payment_hash_hex = hex::encode(hash_bytes);

        Ok(InvoiceResult {
            payment_request: resp.payment_request,
            payment_hash_hex,
        })
    }

    pub async fn get_invoice(&self, payment_hash_hex: &str) -> Result<serde_json::Value> {
        // LND wants base64url for the URL path
        let hash_bytes = hex::decode(payment_hash_hex)?;
        let b64url = base64_url_encode(&hash_bytes);

        let val = self.client
            .get(format!("{}/v1/invoice/{}", self.base_url, b64url))
            .header("Grpc-Metadata-macaroon", &self.macaroon_hex)
            .send()
            .await?
            .error_for_status()?
            .json::<serde_json::Value>()
            .await?;

        Ok(val)
    }
}

fn base64_decode_standard(s: &str) -> Result<Vec<u8>> {
    use std::io::Read;
    let mut decoder = base64::read::DecoderReader::new(s.as_bytes(), &base64::engine::general_purpose::STANDARD);
    let mut out = Vec::new();
    decoder.read_to_end(&mut out)?;
    Ok(out)
}

fn base64_url_encode(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}
```

**Note:** Add `base64 = "0.22"` to `services/gateway/Cargo.toml` dependencies.

- [ ] **Step 2: Create `services/gateway/src/lightning/zap_service.rs`**

```rust
use anyhow::Result;
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;
use serde::Serialize;

use super::lnd_client::LndClient;

const MAX_ZAP_SATS: i64 = 100_000;

#[derive(Debug, Serialize)]
pub struct ZapCreated {
    pub zap_id: Uuid,
    pub payment_request: String,
    pub amount_sats: i64,
}

#[derive(Debug, sqlx::FromRow)]
struct ZapRow {
    pub id: Uuid,
    pub status: String,
    pub bolt11_invoice: String,
    pub recipient_pubkey: String,
    pub amount_sats: i64,
}

pub async fn create_zap_request(
    pool: &PgPool,
    lnd: &LndClient,
    report_id: Uuid,
    amount_sats: i64,
) -> Result<ZapCreated> {
    if amount_sats > MAX_ZAP_SATS {
        anyhow::bail!("amount_sats exceeds maximum of {MAX_ZAP_SATS}");
    }

    let recipient: Option<String> = sqlx::query_scalar(
        "SELECT nostr_pubkey FROM community_reports WHERE id = $1"
    )
    .bind(report_id)
    .fetch_optional(pool)
    .await?;

    let recipient_pubkey = recipient.ok_or_else(|| anyhow::anyhow!("report not found"))?;

    let memo = format!("Zap for report {report_id}");
    let invoice = lnd.create_invoice(amount_sats, &memo).await?;

    let zap_id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO lightning_zaps
           (id, report_id, recipient_pubkey, amount_sats, bolt11_invoice, payment_hash, status)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'pending')
         RETURNING id"
    )
    .bind(report_id).bind(&recipient_pubkey).bind(amount_sats)
    .bind(&invoice.payment_request).bind(&invoice.payment_hash_hex)
    .fetch_one(pool)
    .await?;

    Ok(ZapCreated { zap_id, payment_request: invoice.payment_request, amount_sats })
}

pub async fn handle_payment_webhook(
    pool: &PgPool,
    payment_hash: &str,
    nostr_private_key_hex: Option<&str>,
) -> Result<()> {
    let zap = sqlx::query_as::<_, ZapRow>(
        "SELECT id, status, bolt11_invoice, recipient_pubkey, amount_sats
         FROM lightning_zaps WHERE payment_hash = $1"
    )
    .bind(payment_hash)
    .fetch_optional(pool)
    .await?;

    let zap = match zap {
        None => return Ok(()), // unknown payment hash — ignore
        Some(z) if z.status != "pending" => return Ok(()), // already processed
        Some(z) => z,
    };

    let mut receipt_id: Option<String> = None;
    let mut receipt_json: Option<String> = None;

    // Publish kind 9735 zap receipt to Nostr if key is configured
    if let Some(key_hex) = nostr_private_key_hex {
        match publish_zap_receipt(key_hex, &zap.recipient_pubkey, &zap.bolt11_invoice, payment_hash).await {
            Ok((id, json)) => { receipt_id = Some(id); receipt_json = Some(json); }
            Err(e) => tracing::warn!("failed to publish zap receipt: {e}"),
        }
    } else {
        tracing::warn!("NOSTR_PRIVATE_KEY not set — skipping kind 9735 receipt");
    }

    sqlx::query(
        "UPDATE lightning_zaps SET status='paid', paid_at=NOW(), zap_receipt_id=$2, zap_receipt_json=$3
         WHERE id = $1"
    )
    .bind(zap.id).bind(receipt_id).bind(receipt_json)
    .execute(pool).await?;

    Ok(())
}

async fn publish_zap_receipt(
    private_key_hex: &str,
    recipient_pubkey: &str,
    bolt11: &str,
    preimage_hex: &str,
) -> Result<(String, String)> {
    use nostr_sdk::prelude::*;

    let secret_key = SecretKey::from_hex(private_key_hex)?;
    let keys = Keys::new(secret_key);

    let tags = vec![
        Tag::public_key(PublicKey::from_hex(recipient_pubkey)?),
        Tag::parse(&["bolt11", bolt11])?,
        Tag::parse(&["preimage", preimage_hex])?,
    ];

    let event = EventBuilder::new(Kind::ZapReceipt, "")
        .tags(tags)
        .sign_with_keys(&keys)?;

    let id = event.id.to_hex();
    let json = serde_json::to_string(&event)?;

    let client = Client::new(keys);
    client.add_relay("wss://nos.lol").await?;
    client.connect().await;
    client.send_event(&event).await?;
    client.disconnect().await.ok();

    Ok((id, json))
}
```

- [ ] **Step 3: Create `services/gateway/src/lightning/mod.rs`**

```rust
pub mod lnd_client;
pub mod zap_service;
```

Add `mod lightning;` to `main.rs`.

- [ ] **Step 4: Implement `services/gateway/src/routes/zap.rs`**

```rust
use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::Json,
    routing::post,
    Router,
};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use subtle::ConstantTimeEq;
use serde::Deserialize;
use uuid::Uuid;

use crate::{error::AppError, AppState};

type HmacSha256 = Hmac<Sha256>;

#[derive(Deserialize)]
struct ZapRequestBody {
    report_id: Uuid,
    amount_sats: i64,
}

#[derive(Deserialize)]
struct WebhookBody {
    payment_hash: String,
}

fn verify_hmac(secret: &str, body: &[u8], provided_sig: &str) -> bool {
    let Ok(provided_bytes) = hex::decode(provided_sig) else { return false; };
    let Ok(mut mac) = HmacSha256::new_from_slice(secret.as_bytes()) else { return false; };
    mac.update(body);
    let computed = mac.finalize().into_bytes();
    computed.as_slice().ct_eq(&provided_bytes).into()
}

async fn zap_request(
    State(state): State<AppState>,
    Json(body): Json<ZapRequestBody>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let (lnd_url, lnd_mac) = match (&state.config.lnd_rest_url, &state.config.lnd_macaroon_hex) {
        (Some(u), Some(m)) => (u.clone(), m.clone()),
        _ => return Err(AppError::BadRequest("LND not configured".into())),
    };

    let lnd = crate::lightning::lnd_client::LndClient::new(
        &lnd_url, &lnd_mac, state.config.lnd_tls_skip_verify
    ).map_err(|e| AppError::Internal(e))?;

    if body.amount_sats <= 0 {
        return Err(AppError::BadRequest("amount_sats must be positive".into()));
    }

    let result = crate::lightning::zap_service::create_zap_request(
        &state.db, &lnd, body.report_id, body.amount_sats
    ).await.map_err(|e| {
        if e.to_string().contains("not found") { AppError::NotFound }
        else if e.to_string().contains("maximum") { AppError::BadRequest(e.to_string()) }
        else { AppError::Internal(e) }
    })?;

    Ok((StatusCode::CREATED, Json(serde_json::json!({
        "zap_id": result.zap_id,
        "payment_request": result.payment_request,
        "amount_sats": result.amount_sats,
    }))))
}

async fn webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<serde_json::Value>, AppError> {
    let sig = headers
        .get("x-lnd-signature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if !verify_hmac(&state.config.zap_webhook_secret, &body, sig) {
        return Err(AppError::Unauthorized);
    }

    let parsed: WebhookBody = serde_json::from_slice(&body)
        .map_err(|_| AppError::BadRequest("invalid JSON body".into()))?;

    crate::lightning::zap_service::handle_payment_webhook(
        &state.db,
        &parsed.payment_hash,
        state.config.nostr_private_key.as_deref(),
    )
    .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/request", post(zap_request))
        .route("/webhook", post(webhook))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_hmac_passes() {
        let secret = "test-secret";
        let body = b"hello world";
        let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(body);
        let sig = hex::encode(mac.finalize().into_bytes());
        assert!(verify_hmac(secret, body, &sig));
    }

    #[test]
    fn wrong_sig_fails() {
        assert!(!verify_hmac("secret", b"body", "deadbeef"));
    }

    #[test]
    fn tampered_body_fails() {
        let secret = "test-secret";
        let body = b"original";
        let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(body);
        let sig = hex::encode(mac.finalize().into_bytes());
        assert!(!verify_hmac(secret, b"tampered", &sig));
    }
}
```

- [ ] **Step 5: Run HMAC tests**

```
cargo test -p gateway routes::zap -- --nocapture
```

Expected: 3 tests pass.

- [ ] **Step 6: Add `base64 = "0.22"` to gateway Cargo.toml, then compile**

```
cargo build -p gateway
```

- [ ] **Step 7: Commit**

```
git add services/gateway/src/lightning/ services/gateway/src/routes/zap.rs services/gateway/Cargo.toml
git commit -m "feat(gateway): LND client, zap service, and zap routes with HMAC verification"
```

---

### Task 13: subscribers/event_subscriber.rs

**Files:**
- Create: `services/gateway/src/subscribers/mod.rs`
- Create: `services/gateway/src/subscribers/event_subscriber.rs`

- [ ] **Step 1: Create `services/gateway/src/subscribers/event_subscriber.rs`**

```rust
use std::sync::{atomic::{AtomicBool, Ordering}, Arc};
use anyhow::Result;
use redis::AsyncCommands;
use sqlx::PgPool;
use tokio::time::{sleep, Duration};

use crate::ws::hub::WsHub;

const CHANNEL: &str = "sentinel:events:new";
const BASE_BACKOFF_MS: u64 = 100;
const MAX_BACKOFF_MS: u64 = 30_000;

pub async fn run(
    redis_url: String,
    pool: PgPool,
    hub: Arc<WsHub>,
    redis_healthy: Arc<AtomicBool>,
) {
    let mut backoff_ms = BASE_BACKOFF_MS;
    loop {
        match subscribe_loop(&redis_url, &pool, &hub, &redis_healthy).await {
            Ok(()) => break, // clean exit (shouldn't happen)
            Err(e) => {
                redis_healthy.store(false, Ordering::Relaxed);
                tracing::warn!("redis subscriber error: {e:#}, retrying in {backoff_ms}ms");
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
    let client = redis::Client::open(redis_url)?;
    let mut pubsub = client.get_async_pubsub().await?;
    pubsub.subscribe(CHANNEL).await?;

    redis_healthy.store(true, Ordering::Relaxed);
    tracing::info!("redis subscriber connected, listening on {CHANNEL}");

    let mut stream = pubsub.on_message();
    loop {
        let msg: redis::Msg = match stream.next().await {
            Some(m) => m,
            None => anyhow::bail!("redis pub/sub stream ended"),
        };

        let payload: String = msg.get_payload()?;
        if let Err(e) = handle_message(pool, hub, &payload).await {
            tracing::warn!("failed to handle redis message: {e:#}");
        }
    }
}

async fn handle_message(pool: &PgPool, hub: &Arc<WsHub>, payload: &str) -> Result<()> {
    let event: serde_json::Value = serde_json::from_str(payload)?;

    let county = event["location"]["county"].as_str().map(str::to_string);

    // Upsert into safety_events
    sqlx::query(
        "INSERT INTO safety_events
           (id, event_type, severity, title, lat, lng, started_at,
            summary, place_name, county, is_active, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,NOW(),NOW())
         ON CONFLICT (id) DO UPDATE SET
           severity   = EXCLUDED.severity,
           title      = EXCLUDED.title,
           summary    = EXCLUDED.summary,
           updated_at = NOW()"
    )
    .bind(event["id"].as_str().and_then(|s| s.parse::<uuid::Uuid>().ok()))
    .bind(event["type"].as_str())
    .bind(event["severity"].as_str())
    .bind(event["title"].as_str())
    .bind(event["location"]["lat"].as_f64())
    .bind(event["location"]["lng"].as_f64())
    .bind(event["startedAt"].as_str().and_then(|s| s.parse::<chrono::DateTime<chrono::Utc>>().ok()))
    .bind(event["summary"].as_str())
    .bind(event["location"]["placeName"].as_str())
    .bind(county.as_deref())
    .execute(pool)
    .await?;

    // Broadcast to WebSocket hub
    let ws_msg = serde_json::json!({ "type": "NEW_EVENT", "payload": event });
    hub.broadcast(county.as_deref(), serde_json::to_string(&ws_msg).unwrap().into());

    Ok(())
}
```

**Note:** The `stream.next()` call on pubsub requires `use futures::StreamExt;`. Add `futures = "0.3"` to `services/gateway/Cargo.toml`.

Create `services/gateway/src/subscribers/mod.rs`:

```rust
pub mod event_subscriber;
```

Add `mod subscribers;` to `main.rs`.

- [ ] **Step 2: Compile check**

```
cargo build -p gateway
```

- [ ] **Step 3: Commit**

```
git add services/gateway/src/subscribers/ services/gateway/Cargo.toml
git commit -m "feat(gateway): Redis event subscriber with reconnect loop"
```

---

### Task 14: Complete main.rs — wire subscriber + graceful shutdown

**Files:**
- Rewrite: `services/gateway/src/main.rs`

- [ ] **Step 1: Replace `main.rs` with the complete version**

```rust
mod config;
mod db;
mod error;
mod lightning;
mod middleware;
mod nudge;
mod reports;
mod routes;
mod subscribers;
mod ws;

use std::sync::{atomic::AtomicBool, Arc};
use axum::{extract::State, http::StatusCode, response::Json, routing::get, Router};
use tokio::net::TcpListener;
use ws::{circle_hub::CircleHub, hub::WsHub};

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::PgPool,
    pub config: Arc<config::Config>,
    pub http_client: reqwest::Client,
    pub hub: Arc<WsHub>,
    pub circle_hub: Arc<CircleHub>,
    pub redis_healthy: Arc<AtomicBool>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let config = Arc::new(config::Config::from_env()?);
    let db = db::create_pool(&config.database_url).await?;
    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;
    let hub = Arc::new(WsHub::new());
    let circle_hub = Arc::new(CircleHub::new());
    let redis_healthy = Arc::new(AtomicBool::new(false));

    let state = AppState {
        db: db.clone(),
        config: config.clone(),
        http_client,
        hub: hub.clone(),
        circle_hub,
        redis_healthy: redis_healthy.clone(),
    };

    // Spawn Redis subscriber
    let sub_hub = hub.clone();
    let sub_pool = db.clone();
    let sub_redis_url = config.redis_url.clone();
    let sub_healthy = redis_healthy.clone();
    tokio::spawn(async move {
        subscribers::event_subscriber::run(sub_redis_url, sub_pool, sub_hub, sub_healthy).await;
    });

    let app = Router::new()
        .route("/health", get(health))
        .route("/health/detailed", get(health_detailed))
        .route("/ws", get(ws::ws_handler))
        .route("/ws/circles", get(ws::ws_circles_handler))
        .merge(routes::build_router(state.clone()))
        .with_state(state);

    let addr = format!("0.0.0.0:{}", config.port);
    let listener = TcpListener::bind(&addr).await?;
    tracing::info!("gateway listening on {addr}");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn health() -> (StatusCode, Json<serde_json::Value>) {
    let ts = chrono::Utc::now().to_rfc3339();
    (StatusCode::OK, Json(serde_json::json!({ "ok": true, "service": "gateway", "ts": ts })))
}

async fn health_detailed(State(state): State<AppState>) -> Json<serde_json::Value> {
    let redis_ok = state.redis_healthy.load(std::sync::atomic::Ordering::Relaxed);
    let ts = chrono::Utc::now().to_rfc3339();
    Json(serde_json::json!({ "ok": true, "service": "gateway", "ts": ts, "redis": redis_ok }))
}

async fn shutdown_signal() {
    use tokio::signal;
    let ctrl_c = async { signal::ctrl_c().await.expect("failed to install Ctrl+C handler") };
    #[cfg(unix)]
    {
        let terminate = async {
            signal::unix::signal(signal::unix::SignalKind::terminate())
                .expect("failed to install SIGTERM handler")
                .recv()
                .await;
        };
        tokio::select! {
            _ = ctrl_c => {}
            _ = terminate => {}
        }
    }
    #[cfg(not(unix))]
    ctrl_c.await;
    tracing::info!("shutdown signal received");
}
```

- [ ] **Step 2: Full compile check**

```
cargo build -p gateway
```

Expected: compiles with no errors.

- [ ] **Step 3: Run all tests**

```
cargo test -p gateway -- --nocapture
```

Expected: all unit tests pass (NostrAuth × 4, WsHub × 3, CircleHub × 2, consensus × 8, rate limiter × 2, HMAC × 3 = 22 tests).

- [ ] **Step 4: Commit**

```
git add services/gateway/src/main.rs
git commit -m "feat(gateway): complete main.rs with Redis subscriber and graceful shutdown"
```

---

### Task 15: Dockerfile + .dockerignore

**Files:**
- Create: `services/gateway/Dockerfile`
- Create: `services/gateway/.dockerignore`

- [ ] **Step 1: Create `services/gateway/.dockerignore`**

```
node_modules
dist
*.ts
*.js
package.json
package-lock.json
tsconfig.json
target
```

- [ ] **Step 2: Create `services/gateway/Dockerfile`**

```dockerfile
# ── Build stage ──────────────────────────────────────────────────────────────
FROM rust:1.82-slim AS builder

WORKDIR /build

# Install system deps
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

# Copy workspace manifests
COPY Cargo.toml Cargo.lock ./
COPY sentinel-core/Cargo.toml sentinel-core/Cargo.toml
COPY blockchain/Cargo.toml blockchain/Cargo.toml
COPY gateway/Cargo.toml gateway/Cargo.toml

# Stub all crates to cache dependency compilation
RUN mkdir -p sentinel-core/src blockchain/src gateway/src && \
    echo "pub mod jobs; pub mod crypto; pub mod retry;" > sentinel-core/src/lib.rs && \
    for m in jobs crypto retry; do echo "" > sentinel-core/src/${m}.rs; done && \
    echo "fn main() {}" > blockchain/src/main.rs && \
    echo "fn main() {}" > gateway/src/main.rs

RUN cargo build --release -p gateway 2>/dev/null; true

# Now copy real sources and force recompile
COPY sentinel-core/src sentinel-core/src
COPY blockchain/src blockchain/src
COPY gateway/src gateway/src
RUN touch sentinel-core/src/lib.rs blockchain/src/main.rs gateway/src/main.rs && \
    cargo build --release -p gateway

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/target/release/gateway /usr/local/bin/gateway

EXPOSE 3000
CMD ["gateway"]
```

- [ ] **Step 3: Verify the build context path in docker-compose (next task)**

No test for Dockerfile — verified in Task 16.

- [ ] **Step 4: Commit**

```
git add services/gateway/Dockerfile services/gateway/.dockerignore
git commit -m "chore(gateway): multi-stage Dockerfile with dep-caching stub trick"
```

---

### Task 16: docker-compose.yml + nginx.conf — switch traffic to Rust gateway

**Files:**
- Modify: `docker-compose.yml`
- Modify: `infra/nginx/nginx.conf`

- [ ] **Step 1: Update `docker-compose.yml`**

Add `gateway-rs` service and rename the existing Node.js service to `gateway-legacy`:

```yaml
  # Node.js gateway kept on stand-by during switchover window
  gateway-legacy:
    build:
      context: ./services/gateway
    restart: unless-stopped
    env_file: .env
    environment:
      NODE_ENV: production
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  # Rust gateway — receives all nginx traffic
  gateway-rs:
    build:
      context: ./services
      dockerfile: gateway/Dockerfile
    restart: unless-stopped
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
```

Remove the old `gateway:` service block entirely (it is replaced by `gateway-legacy` + `gateway-rs`).

- [ ] **Step 2: Update `infra/nginx/nginx.conf`**

Change the upstream to point to `gateway-rs`:

```nginx
  upstream gateway {
    server gateway-rs:3000;
  }
```

(All other nginx config stays the same — the upstream name `gateway` is unchanged so the rest of the file needs no edits.)

- [ ] **Step 3: Docker build smoke test**

```
docker compose build gateway-rs
```

Expected: builds successfully. (Requires Docker to be running.)

- [ ] **Step 4: Commit**

```
git add docker-compose.yml infra/nginx/nginx.conf
git commit -m "chore(infra): switch nginx upstream to gateway-rs, keep gateway-legacy on standby"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| GET/POST /api/events, GET /api/events/:id | Task 8 |
| POST /api/reports, POST vote, GET reports, GET by-event | Task 10 |
| POST/GET/DELETE /api/circles, member CRUD | Task 11 |
| POST/GET /api/circles/:id/location | Task 11 |
| POST /api/zaps/request, POST /api/zaps/webhook (HMAC) | Task 12 |
| GET /health, GET /health/detailed | Task 2 + Task 14 |
| GET /ws (county-filtered broadcast) | Task 4 |
| GET /ws/circles (auth + snapshot + lag-resync) | Task 5 |
| NostrAuth extractor (kind 27235, ±60s, sig) | Task 3 |
| Redis subscriber with reconnect loop | Task 13 |
| Rate limiting (reports: 10/hr, votes: 30/min) | Task 10 |
| LND invoice creation + webhook HMAC | Task 12 |
| Kind 9735 zap receipt publishing | Task 12 |
| Consensus state machine | Task 6 |
| Report reputation tier progression | Task 7 |
| MEMBER_REMOVED circle WebSocket invalidation | Task 11 |
| Multi-stage Dockerfile | Task 15 |
| docker-compose + nginx switchover | Task 16 |

**Placeholder scan:** None found.

**Type consistency check:**
- `SafetyEvent` defined in `routes/events.rs` — used only there. ✓
- `Report` defined in `reports/service.rs` — imported in `routes/reports.rs`. ✓
- `Circle`, `CircleMember`, `LocationBlob` defined in their route files. ✓
- `NostrAuth` from `middleware/nostr_auth.rs` used in `routes/circles.rs` and `routes/location_blobs.rs`. ✓
- `WsHub::broadcast` signature `(Option<&str>, Bytes)` consistent across `routes/events.rs`, `routes/reports.rs`, `subscribers/event_subscriber.rs`. ✓
- `CircleHub::broadcast` signature `(Uuid, Bytes)` consistent across `routes/circles.rs`, `routes/location_blobs.rs`, `ws/mod.rs`. ✓
