# SentinelMesh

A public safety app for Kenya. It shows live threats on a map, lets communities report incidents, and helps families stay safe — without collecting personal data.

---

## What it does

| Feature | Description |
|---|---|
| **Live threat map** | Pulls public signals from news, Twitter/X, and radio. Classifies them with NLP. Shows verified safety events on a real-time map. |
| **Community reports** | Anyone can submit a ground report. Reports are signed with a Nostr key, verified by the server, and scored by community votes. Photos are processed on-device — EXIF stripped, faces blurred — before upload. |
| **Family circles** | Share your location with trusted people. Location data is encrypted on your device before it's sent. The server only stores an encrypted blob it can never read. |
| **Push notifications** | Subscribe to browser push notifications for high-severity events near you. Powered by Web Push (VAPID) — no account or email required. |
| **Blockchain anchoring** | Every verified event is published to Nostr relays (4 geographically distributed, parallel publish). A digest is written to Bitcoin (OP_RETURN) as a permanent, tamper-proof record. Fee is capped at 50 sat/vB and transactions opt into RBF. |
| **Acoustic detection** | The browser listens for gunshots, explosions, and screaming using a YAMNet model. All inference runs locally — no audio ever leaves your device. |
| **Escape routes** | When a threat is near, the app calculates 2–3 walking routes that avoid the danger zone using Mapbox Directions. |
| **Lightning tips** | Users can tip reporters with Bitcoin Lightning (sats). Payment receipts are published as Nostr Kind 9735 zap events. |

---

## Privacy rules (never broken)

- The server never stores readable location data. All family circle coordinates are encrypted on-device with AES-256-GCM.
- No personal data is collected at sign-up. Your identity is a Nostr keypair generated on your device. No email, no phone number, no name.
- All photo processing (EXIF strip, face blur) happens on-device before upload.
- Every community report has a cryptographic signature. The server verifies it.
- Acoustic detection never sends audio off-device. Only the detection label and confidence score are transmitted.
- Mapbox map tiles are proxied through the gateway (`/api/tiles`). The Mapbox token is never exposed in browser network traffic.
- Bitcoin is on testnet until the project maintainers explicitly switch to mainnet.

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
| API Gateway | Rust + axum | `services/gateway/` | Auth (Nostr kind 27235), REST routes, WebSocket hub, tile proxy, push subscriptions, Lightning zaps |
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
| `INTERNAL_SERVICE_SECRET` | Random string for service-to-service auth |
| `ZAP_WEBHOOK_SECRET` | Random string for verifying LND payment webhooks |
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
| `NOSTR_PRIVATE_KEY` | Hex private key for gateway to sign zap receipts |
| `LND_REST_URL` | LND node REST URL. Needed for Lightning zaps. |
| `LND_MACAROON_HEX` | LND admin macaroon in hex |
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

## Testing Lightning zaps locally

Zap payments need a running LND node. For local development, use [Polar](https://lightningpolar.com/) — it spins up a local Lightning network in a few clicks.

1. Install Polar and create a network with two LND nodes
2. Copy the admin macaroon hex and REST URL from one node into `.env`
3. Restart the gateway: `docker compose ... restart gateway`
4. The ⚡ button on event popups will now generate real invoices

---

## Repository layout

```
sentinelmesh/
├── apps/
│   └── pwa/                    # React + Vite browser app
│       ├── public/
│       │   └── sw.js           # Service worker (push notifications)
│       └── src/
│           ├── components/     # Map, reports, circles, ZapButton
│           ├── hooks/          # useCircles, usePushSubscription, etc.
│           ├── services/       # Audio capture, routing, WebSocket, nostr
│           └── store/          # Redux slices
├── services/
│   ├── gateway/                # Rust + axum API gateway
│   │   └── src/
│   │       ├── routes/         # REST endpoints (events, reports, circles, push, tiles, zaps)
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
- [x] Lightning zaps — LND invoice generation, HMAC webhook, Kind 9735 receipt
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
