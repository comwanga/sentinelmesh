# SentinelMesh

A public safety app for Kenya. It shows live threats on a map, lets communities report incidents, and helps families stay safe — without collecting personal data.

---

## What it does

| Feature | Description |
|---|---|
| **Live threat map** | Pulls public signals from news, Twitter/X, and radio. Classifies them with NLP. Shows verified safety events on a real-time map. |
| **Community reports** | Anyone can submit a ground report. Reports are signed with a Nostr key, verified by the server, and scored by community votes. Photos are processed on-device — EXIF stripped, faces blurred — before upload. |
| **Family circles** | Share your location with trusted people. Location data is encrypted on your device before it's sent. The server only stores an encrypted blob it can never read. |
| **Blockchain anchoring** | Every verified event is published to Nostr relays. A weekly digest is written to Bitcoin (OP_RETURN) as a permanent, tamper-proof record. |
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
- Bitcoin is on testnet until the project maintainers explicitly switch to mainnet.

---

## Architecture

```
┌───────────────────────────────────┐
│           Browser (PWA)           │
│   React + Vite · TensorFlow.js    │
└────────────────┬──────────────────┘
                 │ HTTP + WebSocket
                 ▼
┌───────────────────────────────────┐
│          API Gateway              │
│   Node.js + Express + TypeScript  │
│   WebSocket hub · Lightning zaps  │
└──┬──────────┬──────────┬──────────┘
   │          │          │
   ▼          ▼          ▼
Postgres   Redis     Nostr/Bitcoin
```

### Services

| Service | Language | Path | What it does |
|---|---|---|---|
| API Gateway | Node.js + TypeScript | `services/gateway/` | Auth, REST routes, WebSocket hub, Lightning zaps |
| Signal Ingest | Python + FastAPI | `services/signal/` | RSS / Twitter / radio → NLP → safety events |
| PWA | React + Vite | `apps/pwa/` | Map, acoustic detection, reports, family circles |
| Database | PostgreSQL 16 | `infra/postgres/` | All persistent data |
| Cache / Pub-Sub | Redis 7 | Docker service | Real-time event delivery |

---

## Getting started

### What you need

- Docker 24+ and Docker Compose v2
- A Mapbox public token — [get one free at mapbox.com](https://mapbox.com)
- Node.js 20+ (for running the PWA locally)

### Step 1 — Clone and configure

```bash
git clone https://github.com/comwanga/sentinelmesh.git
cd sentinelmesh

cp .env.example .env
# Open .env and fill in: POSTGRES_PASSWORD, REDIS_PASSWORD,
# JWT_SECRET, INTERNAL_SERVICE_SECRET, ZAP_WEBHOOK_SECRET,
# and VITE_MAPBOX_TOKEN
```

### Step 2 — Start the backend (Docker)

```bash
# Start Postgres, Redis, and the API Gateway
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis gateway
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

The PWA automatically proxies `/api` requests to the gateway on port 3000.

### All service URLs

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
# Gateway (54 tests)
cd services/gateway && npm test

# PWA (99 tests)
cd apps/pwa && npm test

# Signal service
cd services/signal && pytest
```

---

## Environment variables

All variables go in the root `.env` file. Copy `.env.example` to get started.

### Required for everything to start

| Variable | Description |
|---|---|
| `POSTGRES_PASSWORD` | Password for the PostgreSQL `sentinel` user |
| `DATABASE_URL` | Full Postgres connection string — must match `POSTGRES_PASSWORD` |
| `REDIS_PASSWORD` | Password for Redis |
| `REDIS_URL` | Full Redis connection string — must match `REDIS_PASSWORD` |
| `JWT_SECRET` | At least 64 random characters |
| `INTERNAL_SERVICE_SECRET` | Random string for service-to-service calls |
| `ZAP_WEBHOOK_SECRET` | Random string for verifying LND payment webhooks |
| `VITE_MAPBOX_TOKEN` | Your Mapbox public access token |

### Optional

| Variable | Description |
|---|---|
| `NOSTR_PRIVATE_KEY` | Hex private key for signing Nostr events and zap receipts. Without this, zap receipts are skipped. |
| `LND_REST_URL` | LND node REST URL (e.g. `https://localhost:8080`). Needed for Lightning zaps. |
| `LND_MACAROON_HEX` | LND admin macaroon in hex |
| `TWITTER_BEARER_TOKEN` | For pulling Twitter/X signals. Skipped if empty. |
| `SENTRY_DSN` | Sentry error tracking URL. Optional in dev, recommended in production. |

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
│       └── src/
│           ├── components/     # Map, alerts, ZapButton, circles
│           ├── services/       # Audio capture, routing, report submit
│           └── store/          # Redux slices
├── services/
│   ├── gateway/                # Node.js API + WebSocket
│   │   └── src/
│   │       ├── lightning/      # LND client and zap service
│   │       ├── routes/         # REST endpoints
│   │       └── subscribers/    # Redis event subscriber
│   └── signal/                 # Python signal ingest + NLP
├── infra/
│   └── postgres/
│       └── init.sql            # Database schema
├── shared/
│   ├── contracts/              # JSON Schema for events
│   └── types/                  # Shared TypeScript types
├── docker-compose.yml          # Production
└── docker-compose.dev.yml      # Local development
```

---

## What's been built

- [x] Signal ingestion — RSS, Twitter/X, radio transcription → NLP → safety events
- [x] Community reports — Nostr signing, server verification, consensus voting, IPFS photos
- [x] Family circles — E2EE location sharing, proximity alerts, WebSocket presence
- [x] Blockchain anchoring — Nostr relay publishing, Bitcoin OP_RETURN weekly digest
- [x] Acoustic detection — YAMNet browser inference, auto-submit on detection
- [x] Escape routes — Mapbox Directions avoiding threat zones
- [x] Lightning zaps — LND invoice generation, HMAC webhook, Kind 9735 receipt

## What's coming next

- [ ] Production hardening — circuit breakers, structured logging, metrics
- [ ] Android app — React Native, offline maps, Android Keystore
- [ ] Testnet → Mainnet switch

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
