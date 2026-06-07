# SentinelMesh

A global public safety app. It shows live threats on a map, lets communities report incidents, and helps families stay safe — without collecting personal data.

---

## What it does

| Feature | Description |
|---|---|
| **Live threat map** | Pulls public signals from news, Twitter/X, and radio. Classifies them with NLP. Shows verified safety events on a real-time map. |
| **Community reports** | Anyone can submit a ground report. Reports are signed with a Nostr key and scored by community votes. The report's location is **coarsened to a ~100 m cell** and stored **separately from the reporter's identity** (which lives in an access-controlled table), so a database leak cannot reconstruct a precise, identity-linked location trail. Photos are processed on-device — EXIF stripped, faces blurred (best-effort, frontal faces) — before upload. |
| **Family circles** | Share your location with trusted people. Coordinates are encrypted on your device with AES-256-GCM; the server stores a blob whose **contents** it cannot read. Circle **membership, names, and member labels are tokenized/encrypted** — a database leak cannot reconstruct who is in which circle or read circle/member names. The **timing** of location shares remains visible to the server (see Privacy below). |
| **Push notifications** | Browser push (Web Push/VAPID) for HIGH/CRITICAL events. Payloads carry only a place name, never precise coordinates. Note: alerts are currently broadcast to all subscribers — per-location targeting is planned. |
| **Blockchain anchoring** | Verified events can be published to Nostr relays and a digest written to Bitcoin (OP_RETURN). The anchor commits an identifier digest (event id + nostr id + severity), **not** the report's location or text — it proves an event record existed, not that its content is unaltered. Off by default (`ANCHORING_ENABLED`); testnet until maintainers switch to mainnet. |
| **Acoustic detection** | The browser can classify sounds (gunshots, explosions, screaming) with a YAMNet model. Inference is on-device — no audio leaves your device; only a label, confidence, and location are sent. Detections are **client-asserted and not yet independently verified**; auto-publishing to the map is off by default (`ACOUSTIC_CONFIRM_ENABLED`). |
| **Escape routes** | When a threat is near, the app calculates 2–3 walking routes that avoid the danger zone using Mapbox Directions. |

---

## Privacy model (what is and isn't protected)

Be precise about this — overclaiming privacy is a safety risk for the people who rely on it.

**Protected:**
- **Family-circle coordinates** are encrypted on-device with AES-256-GCM. The server stores a blob whose contents it cannot read.
- **Family-circle social graph** is tokenized at rest: membership/owner/recipient identifiers are stored as per-circle keyed tokens (no plaintext pubkeys), and circle names and member labels are encrypted under the circle key. A database leak cannot reconstruct who belongs to which circle, or read circle/member names.
- **Community-report locations** are coarsened to a ~100 m cell, and the reporter's identity (pubkey/signature) is stored in a separate access-controlled table behind a restricted database role. A database leak cannot link a precise location trail to a person.
- **Audio** never leaves the device. Acoustic detection sends only a label, confidence, and location.
- **No name/email/phone** is collected. Identity is a Nostr keypair generated on the device.
- **Mapbox tiles** are proxied through the gateway (`/api/tiles`); the Mapbox token is not exposed to the browser.
- **Photos** are EXIF-stripped and face-blurred on-device before upload (face blur is best-effort, frontal faces only).

**Threat model.** The community-report and family-circle protections above defend against a **stolen database or leaked read access without the application's secrets**. They do **not** hide data from the running server operator (who holds the keying secrets) — that is a deliberate, documented scope boundary, to be narrowed by later work.

**NOT protected (known limitations — do not assume otherwise):**
- **Acoustic-detection locations are stored in plaintext** and linked to a persistent pubkey, with no retention limit yet. Treat acoustic-detection history as an identity-linked location trail.
- **Family-circle timing metadata is visible to the server**: it can see *when* a member shares location (the coordinates, membership, and names are protected — the timing is not).
- **A Nostr pubkey is a stable pseudonymous identifier.** Anything published to Nostr relays, IPFS, or Bitcoin is effectively permanent and cannot be erased.
- **Bitcoin anchoring** commits an identifier digest, not report content — it is not a tamper-proof record of where/what.

Remaining gaps are tracked in `docs/audit/` with a remediation plan. Bitcoin stays on testnet until maintainers explicitly switch to mainnet.

---

## Architecture

```
┌───────────────────────────────────┐
│           Browser (PWA)           │
│   React 18 + Vite · TF.js (lazy) │
└────────────────┬──────────────────┘
                 │ HTTP + WebSocket
                 ▼
┌───────────────────────────────────┐
│          API Gateway              │
│   Rust + axum 0.7 · sqlx 0.8     │
│   WebSocket hub · tile proxy      │
└──┬──────────┬──────────┬──────────┘
   │          │          │
   ▼          ▼          ▼
Postgres   Redis       Blockchain
           Streams     service (Rust)
                       └→ Nostr relays
                       └→ Bitcoin
```

### Services

| Service | Language | Path | What it does |
|---|---|---|---|
| API Gateway | Rust + axum | `services/gateway/` | Auth (Nostr kind 27235), REST routes, WebSocket hub, tile proxy, push subscriptions, IPFS photo proxy |
| Signal Ingest | Python + FastAPI | `services/signal/` | RSS / Twitter / radio → async NLP → safety events via Redis Streams |
| Blockchain Worker | Rust | `services/blockchain/` | Nostr publish (parallel, 4 relays), Bitcoin OP_RETURN anchoring, UTXO management |
| Shared types | Rust | `services/sentinel-core/` | Domain types and crypto shared across Rust services |
| PWA | React + Vite | `apps/pwa/` | Map, acoustic detection, reports, family circles, push notifications |
| Database | PostgreSQL 16 | `infra/postgres/` | All persistent data |
| Cache / Streams | Redis 7 | Docker service | Real-time event delivery via Redis Streams (XADD/XREADGROUP) |

---

## Getting started

### What you need

- Docker 24+ and Docker Compose v2
- Rust toolchain (stable) — [install via rustup](https://rustup.rs)
- A Mapbox **secret** token — [mapbox.com](https://mapbox.com) (used server-side for the tile proxy)
- Node.js 20+ (for the PWA only)

### Step 1 — Clone and configure

```bash
git clone https://github.com/comwanga/sentinelmesh.git
cd sentinelmesh

cp .env.example .env
# Open .env and fill in the required variables (see below)
```

### Step 2 — Start the backend (Docker)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis gateway-rs
```

Check it's running:
```bash
curl http://localhost:3000/health
# → {"ok":true,"service":"gateway"}
```

### Step 3 — Start the PWA

```bash
cd apps/pwa
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

The PWA automatically proxies `/api` and `/ws` requests to the gateway on port 3000.

### All service URLs (dev)

| Service | URL |
|---|---|
| PWA | http://localhost:5173 |
| API Gateway | http://localhost:3000 |
| Signal Service | http://localhost:8000 (optional, needs Docker build) |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

---

## Running tests

```bash
# Gateway (Rust)
cd services/gateway && cargo test

# Blockchain service (Rust)
cd services/blockchain && cargo test

# PWA
cd apps/pwa && npm test

# Signal service (Python)
cd services/signal && pytest
```

---

## Environment variables

All variables go in the root `.env` file. Copy `.env.example` to get started.

### Required for the backend to start

| Variable | Description |
|---|---|
| `POSTGRES_PASSWORD` | Password for the PostgreSQL `sentinel` user |
| `DATABASE_URL` | Full Postgres connection string — must match `POSTGRES_PASSWORD` |
| `REDIS_PASSWORD` | Password for Redis |
| `REDIS_URL` | Full Redis connection string — must match `REDIS_PASSWORD` |
| `INTERNAL_SERVICE_SECRET` | Random string for service-to-service auth (required in production) |
| `MAPBOX_TOKEN` | Your Mapbox **secret** access token (server-side tile proxy) |
| `VITE_MAPBOX_TOKEN` | Your Mapbox **public** access token (PWA, used only for style URLs) |

### Blockchain service

| Variable | Description |
|---|---|
| `NOSTR_PRIVKEY` | 64-char hex private key for signing Nostr events |
| `BITCOIN_WIF` | Bitcoin private key in WIF format for OP_RETURN anchoring |
| `BITCOIN_NETWORK` | `testnet` (default) or `mainnet` |
| `RELAY_URLS` | Comma-separated Nostr relay list. Defaults to 4 diverse relays if unset. |

### Optional

| Variable | Description |
|---|---|
| `PINATA_JWT` | Server-side Pinata JWT for the IPFS photo proxy (`/api/photos/pin`). |
| `TWITTER_BEARER_TOKEN` | For pulling Twitter/X signals. Skipped if empty. |
| `SENTRY_DSN` | Sentry error tracking URL. Optional in dev, recommended in production. |
| `MAX_DB_CONNECTIONS` | Gateway Postgres pool size. Defaults to 50. |
| `VAPID_PRIVATE_KEY` | Base64url-encoded VAPID private key for Web Push. Push is disabled if unset. |
| `VAPID_PUBLIC_KEY` | Base64url-encoded VAPID public key (also set as `VITE_VAPID_PUBLIC_KEY` for the PWA) |
| `VAPID_SUBJECT` | `mailto:` or HTTPS URL identifying the push sender (e.g. `mailto:ops@example.com`) |

To generate VAPID keys:
```bash
npx web-push generate-vapid-keys
```

---

## Repository layout

```
sentinelmesh/
├── apps/
│   └── pwa/                    # React + Vite browser app
│       ├── public/
│       │   └── sw.js           # Service worker (push notifications)
│       └── src/
│           ├── components/     # Map, reports, circles
│           ├── hooks/          # useCircles, usePushSubscription, etc.
│           ├── services/       # Audio capture, routing, WebSocket, nostr
│           └── store/          # Redux slices
├── services/
│   ├── gateway/                # Rust + axum API gateway
│   │   └── src/
│   │       ├── routes/         # REST endpoints (events, reports, circles, push, tiles, photos)
│   │       ├── subscribers/    # Redis Streams event consumer
│   │       └── ws/             # WebSocket hub
│   ├── blockchain/             # Rust blockchain anchoring worker
│   │   └── src/
│   │       ├── workers/        # Nostr publisher, Bitcoin anchor, confirmation poller
│   │       └── utils/          # Fee estimator
│   ├── sentinel-core/          # Shared Rust domain types and crypto
│   └── signal/                 # Python signal ingest + NLP
│       ├── ingest/             # RSS, Twitter, radio transcription
│       ├── nlp/                # Classifier, severity scorer, location extractor
│       └── worker/             # Whisper ML worker
├── infra/
│   └── postgres/
│       └── init.sql            # Database schema
├── shared/
│   └── types/                  # Shared TypeScript types
├── docker-compose.yml          # Production
└── docker-compose.dev.yml      # Local development overrides
```

---

## What's been built

- [x] Signal ingestion — RSS, Twitter/X, radio transcription → async NLP → safety events via Redis Streams
- [x] Community reports — Nostr signing, server verification, consensus voting, IPFS photos
- [x] Family circles — E2EE location sharing, proximity alerts, WebSocket presence
- [x] Blockchain anchoring — parallel Nostr relay publish (4 relays), Bitcoin OP_RETURN, 50 sat/vB fee cap, RBF
- [x] Acoustic detection — YAMNet browser inference, auto-submit on detection
- [x] Escape routes — Mapbox Directions avoiding threat zones
- [x] Push notifications — Web Push (VAPID), service worker, gateway subscription store
- [x] Reliability hardening — Redis Streams (no message loss on disconnect), Mapbox tile proxy, Chrome 66+ fetch timeouts, WebSocket exponential backoff, Postgres connection pooling

## What's coming next

- [ ] Android app — React Native, offline maps, Android Keystore
- [ ] Testnet → Mainnet switch
- [ ] Structured logging and metrics (Prometheus / Grafana)

---

## Contributing

1. Fork the repo and create a branch from `main`
2. Write tests before writing code
3. Keep commits small and descriptive
4. Open a pull request — describe what changed and why

PRs that break any of the privacy rules listed above will not be merged.

---

## License

MIT — see [LICENSE](LICENSE).

Built for Kenyan communities.
