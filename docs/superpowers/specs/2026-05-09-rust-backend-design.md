# SentinelMesh Rust Backend — Design Spec

**Date:** 2026-05-09
**Status:** Approved

---

## 1. Decision

Rewrite the Node.js gateway and blockchain services in Rust. Keep the Python signal service unchanged. This is a hybrid architecture that follows the natural systems boundary already in the codebase: Rust for networking/crypto/concurrency-heavy services; Python for ML inference.

**What changes:**
- `services/gateway` — replaces Node.js/Express with Rust/axum
- `services/blockchain` — replaces Node.js workers with Rust workers

**What does not change:**
- `services/signal` — Python/FastAPI, untouched
- PostgreSQL schema and migrations
- Redis channel names and payload format
- Docker Compose service names and ports
- PWA API contracts

---

## 2. Workspace Layout

`services/` becomes the Cargo workspace root. Rust crates live alongside the existing Python service directory.

```
services/
├── Cargo.toml              # workspace root, members: [gateway, blockchain, sentinel-core]
├── Cargo.lock
│
├── sentinel-core/          # shared contract library (no binary, no async)
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs
│       ├── event.rs        # Event, ThreatLevel, EventSource
│       ├── nostr.rs        # NostrEvent, verify_event_signature, build_signed_event
│       ├── crypto.rs       # canonical_hash, build_op_return_payload
│       └── circle.rs       # Circle, LocationBlob
│
├── gateway/                # axum HTTP + WebSocket server
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs
│       ├── config.rs
│       ├── db/
│       ├── routes/         # events, reports, circles, zap, health
│       ├── ws/             # hub, circle_hub
│       ├── middleware/     # rate limiting, nostr auth extractor
│       ├── lightning/      # lnbits client, zap verifier
│       └── subscribers/    # Redis → WebSocket fanout
│
├── blockchain/             # Bitcoin + Nostr workers
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs
│       ├── config.rs
│       ├── db/
│       ├── workers/        # bitcoin_anchor, nostr_publish, canonical, publish_loop
│       └── utils/          # fee_estimator
│
└── signal/                 # Python/FastAPI — unchanged
```

**Crate dependency graph:**
```
gateway    → sentinel-core
blockchain → sentinel-core
signal     → (no Rust dependency — communicates over HTTP/Redis)
```

---

## 3. sentinel-core

A boring, stable contract library. Its job is to define shared types and pure functions so that gateway and blockchain cannot drift apart. It is not a platform foundation and must not grow into one.

**Rules:**
- No `tokio`, no `sqlx`, no `axum`, no network or DB access of any kind
- No runtime dependencies beyond `serde`, `uuid`, `chrono`, `secp256k1`
- If a proposed addition touches the network, file system, or DB — it does not belong here

**Modules:**

`event.rs`
```rust
pub struct Event {
    pub id: Uuid,
    pub source: EventSource,
    pub threat_level: ThreatLevel,
    pub lat: f64,
    pub lng: f64,
    pub title: String,
    pub description: String,
    pub verified: bool,
    pub created_at: DateTime<Utc>,
}
pub enum EventSource { Rss, Twitter, Radio, CommunityReport }
pub enum ThreatLevel { Low, Medium, High, Critical }
```

`nostr.rs` — Nostr event type and pure signature verification/building. Extracted from the current `gateway/src/nostr/verifier.ts`. Both services use the same implementation.

`crypto.rs` — Canonical event hashing and OP_RETURN payload construction. Same function used by the blockchain worker (builds) and gateway (can verify). `build_op_return_payload` enforces the 80-byte Bitcoin OP_RETURN limit at compile time via a fixed-size return type.

`circle.rs` — Encrypted location blob types. The gateway stores and streams these; sentinel-core defines their shape. The server never inspects ciphertext content.

`retry.rs` — `RetryPolicy { max_attempts, base_delay, max_delay, jitter }`. Shared by both worker crates. Backoff is computed from an attempt count stored in the DB row, not in-process timer state.

---

## 4. Gateway Service

**Stack:** `axum` + `tokio` + `sqlx` + `tower_governor`

**Routes (1:1 with current Node.js gateway):**

| Route | Handler |
|---|---|
| `GET /health` | inline |
| `GET /health/detailed` | inline, exposes Redis health flag |
| `GET /api/events` | `routes::events::list` |
| `POST /api/reports` | `routes::reports::submit` |
| `GET /api/circles/:id` | `routes::circles::get` |
| `POST /api/circles/:id/location` | `routes::circles::push_blob` |
| `POST /api/zaps/webhook` | `routes::zap::webhook` (raw body, before JSON parsing) |
| `GET /ws` | `ws::hub::handler` |
| `GET /ws/circles` | `ws::circle_hub::handler` |

**Shared state:**
```rust
struct AppState {
    db: PgPool,
    redis_cmd: ConnectionManager,
    redis_sub: Arc<Mutex<PubSubHandle>>,
    event_tx: broadcast::Sender<Arc<Bytes>>,
    circle_txs: Arc<DashMap<CircleId, broadcast::Sender<Arc<Bytes>>>>,
    redis_healthy: Arc<AtomicBool>,
}
```

**Auth:** A `NostrAuth` axum extractor verifies the Nostr signature before the handler runs. Invalid signatures are rejected at the extractor boundary — no handler ever receives unverified identity.

**Rate limiting:** `tower_governor` wraps individual routers. The zap webhook and report submission endpoints get tighter limits than public event reads.

**WebSocket delivery guarantees:**

`/ws` — public threat feed
: At-most-once, lossy. `broadcast::channel<Arc<Bytes>>`. Each event is serialized to `Arc<Bytes>` once at the sender; all receivers share the same allocation. `Lagged` errors are logged and the receiver reconnects silently. Missing a public threat event is tolerable.

`/ws/circles` — encrypted location stream
: Snapshot-on-connect + best-effort live updates + resync-on-lag.

1. On connect: query DB for the latest blob per circle member, send a snapshot frame immediately. Client has consistent state before any live updates.
2. Live updates: per-circle `broadcast::Sender<Arc<Bytes>>` stored in `circle_txs` (DashMap). Senders are created lazily, dropped when the last receiver disconnects. No global noisy channel.
3. On `Lagged`: re-query the DB snapshot, send it, re-subscribe to the per-circle sender. Resync without closing the WebSocket connection.
4. Membership invalidation: a Redis pub/sub channel `circle:{id}:members` receives events on any membership change. The WebSocket handler listens to this channel. If the connected user is removed from the circle, the socket is closed immediately.

**Redis subscriber resilience:** The subscriber runs in a dedicated `tokio::task` with a supervised reconnect loop. Backoff from 100ms to 30s. `redis_healthy` flag is updated on each state change and exposed by `/health/detailed`.

**sqlx:** All DB queries use `sqlx::query!` macros — queries are verified against the live schema at compile time. A wrong column name or type mismatch is a build error.

---

## 5. Blockchain Service

**Stack:** `tokio` + `sqlx` + `bitcoin` + `nostr-sdk` + `reqwest`

**Process model:** One `tokio` runtime, four supervised worker tasks. A crash in one worker does not affect the others.

```
main
├── bitcoin_anchor_worker
├── nostr_publish_worker
├── canonical_worker
└── health_server           (axum, GET /health only)
```

**Anchor state machine:**
```rust
enum AnchorState {
    Pending,
    FeeEstimated { sats_per_vbyte: u64 },
    Built { txid: Txid, raw_tx: Vec<u8> },
    Broadcast { txid: Txid, broadcast_at: DateTime<Utc> },
    Confirmed { txid: Txid, block_height: u32 },
    Failed { reason: String, retries: u32 },
}
```

Each state transition is a DB write. Process restarts resume from the last committed state. No in-memory state is ever the source of truth.

**UTXO pool:** Managed in the DB. Workers claim UTXOs with `SELECT ... FOR UPDATE SKIP LOCKED` — same strategy as the TypeScript version, now with compile-time query verification.

**Nostr relay pool:** `nostr-sdk` manages connections. A relay that fails 5 consecutive times is marked degraded in the DB and skipped until the next health cycle.

**Retry backoff:** Uses `sentinel-core::RetryPolicy`. Attempt count is read from the DB row — backoff survives restarts.

**No user-facing HTTP** beyond `GET /health`. If the gateway needs to trigger an anchor, it writes a DB record; the worker picks it up on the next poll cycle. No direct RPC between services.

---

## 6. Migration Order

### Phase 1 — Blockchain → Rust
The TypeScript blockchain service is stopped. The Rust binary takes its existing environment variables unchanged. Docker Compose `blockchain` service points to the new binary. Gateway and signal are untouched. This phase validates the Rust toolchain, sqlx, and CI before touching user-facing code.

### Phase 2 — Gateway → Rust
The Rust gateway replaces the Node.js gateway on the same port. The TypeScript gateway runs in parallel on a different port during the switchover window — traffic can be shifted back instantly if a regression appears.

### Phase 3 — sentinel-core extraction
Stable types from Phase 1 and 2 are extracted into `sentinel-core`. Internal refactor only, no behavioral change.

### Phase 4 — Python boundary optimization
Do not rewrite signal. Define a JSON schema for the Redis event payload that both the Python publisher and Rust gateway subscriber validate at startup. Catches contract drift without touching the ML pipeline.

---

## 7. Key Rust Crates

| Purpose | Crate |
|---|---|
| HTTP + WebSocket | `axum` |
| Async runtime | `tokio` |
| Database | `sqlx` |
| Rate limiting | `tower_governor` |
| Concurrent map | `dashmap` |
| Bitcoin | `bitcoin` |
| Nostr | `nostr-sdk` |
| secp256k1 | `secp256k1` |
| HTTP client | `reqwest` |
| Serialization | `serde`, `serde_json` |
| UUIDs | `uuid` |
| Time | `chrono` |

---

## 8. What This Is Not

- Not a line-by-line TypeScript-to-Rust translation. External behavior is preserved; internal architecture is redesigned idiomatically.
- `sentinel-core` is not a platform foundation. It is a contract library: types and pure functions, nothing more. Any addition that requires a runtime dependency is rejected.
