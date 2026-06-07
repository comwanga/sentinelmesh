# SentinelMesh

A public-safety app for communities. It shows live threats on a map, lets people report incidents, and helps families keep track of each other — with **no accounts and no personal details**. Your identity is just a cryptographic key (a [Nostr](https://nostr.com) keypair) created on your device.

The hard part of an app like this isn't drawing dots on a map — it's deciding **which dots to trust**. SentinelMesh's design is built around that question: automated signals start out untrusted and earn trust only through independent corroboration, and the server is built to hold as little readable personal data as possible.

---

## What it does

| Feature | Description |
|---|---|
| **Live threat map** | Pulls public signals from news feeds, Twitter/X, and radio, and classifies them with rule-based NLP. New automated detections appear on the map **labeled and unverified**, and are promoted to confirmed events only through independent corroboration (see [How events become trusted](#how-events-become-trusted)). |
| **Community reports** | Anyone can submit a ground report, signed with their Nostr key. Reports are scored by **reputation-weighted** community voting (not raw vote counts), which blunts sock-puppet manipulation. Locations are **coarsened to a ~100 m grid cell** and stored **separately from the reporter's identity**, so a database leak can't reconstruct a precise, person-linked location trail. Photos are EXIF-stripped and face-blurred on-device (best-effort, frontal faces) before upload. |
| **Family circles** | Share your live location with trusted people. Coordinates are **encrypted on your device** (AES-256-GCM) — the server stores a blob it can't read. Circle **membership, names, and member labels are tokenized/encrypted** too, so a database leak can't reveal who is in which circle. Only the *timing* of shares stays visible to the server. |
| **Acoustic detection** | The browser can classify sounds (gunshots, explosions, screaming) on-device with a YAMNet model — **no audio ever leaves your device**, only a label, confidence, and location. These detections are **client-asserted and treated as untrusted**: they follow the same corroboration ladder, and auto-publishing is off by default (`ACOUSTIC_CONFIRM_ENABLED`). |
| **Push notifications** | Browser push (Web Push / VAPID) for HIGH/CRITICAL events. Only fires for **confirmed** events; payloads carry a place name, never precise coordinates. *(Today these are broadcast to all subscribers — proximity/circle targeting is planned.)* |
| **Escape routes** | When a confirmed threat is near, the app computes 2–3 walking routes that avoid the danger zone (Mapbox Directions). |
| **Blockchain anchoring** | Confirmed events can be published to Nostr relays and a digest written to Bitcoin (OP_RETURN). The anchor commits an **identifier digest** (event id + nostr id + severity), **not** the location or text — it proves a record existed, not that its content is unaltered. Off by default (`ANCHORING_ENABLED`), testnet until maintainers switch to mainnet. |

---

## How events become trusted

Nothing on the map is assumed trustworthy just because it appeared. Each kind of signal has an explicit path from "raw input" to "confirmed", and machine-generated signals can never silently masquerade as confirmed human reports.

**Automated detections (NLP and acoustic) climb a trust ladder:**

| Tier | Meaning | What it can do |
|---|---|---|
| **Heuristic** | A single automated detection. Shown on the map but clearly labeled *"Automated Detection"*. | Visible only. **No** push, **no** Bitcoin anchor, **no** influence on escape routes. |
| **Corroborating** | At least **2 independent sources** agree (e.g. two different news domains). | Still labeled automated; gaining support. |
| **Confirmed** | At least **3 independent sources across ≥2 channels** (e.g. news *and* radio). | Treated as a real event — push + anchoring may fire. |

A background worker recomputes this every few seconds and only ever *raises* a tier. "Independence" is counted as distinct sources and channels, never as raw row counts, so duplicate ingestion can't fake corroboration. Uncorroborated detections **expire** off the map after a TTL instead of lingering forever.

**Community reports use reputation-weighted consensus**, not a flat vote count: an established reporter's vote carries more weight than a brand-new key's, promotion to *verified* requires several **distinct** confirmers, and an optional gate can require some of those confirmers to be established accounts. This makes it expensive to manufacture or suppress consensus with throwaway identities (a "Sybil" attack).

**The NLP classifier is honest about being a heuristic.** It is negation-aware ("no fire, all clear" is *not* a fire) and its confidence is capped — it is keyword matching with guardrails, never presented as a calibrated AI detector.

The throughline: **trust is earned through independent corroboration**, and the system fails toward "show it but don't act on it" rather than "broadcast an unverified alarm".

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
│   React 18 + Vite · TF.js (lazy)  │
└────────────────┬──────────────────┘
                 │ HTTP + WebSocket
                 ▼
┌───────────────────────────────────┐
│          API Gateway              │
│   Rust + axum 0.7 · sqlx 0.8      │
│   WebSocket hub · trust workers   │
│   tile proxy · push               │
└──┬──────────┬──────────┬──────────┘
   │          │          │
   ▼          ▼          ▼
Postgres   Redis       Blockchain
           Streams     service (Rust)
                       └→ Nostr relays
                       └→ Bitcoin
```

Two things flow through the gateway continuously and are worth calling out, because they implement the trust model above:

- **Signal ingest → Redis Streams → gateway.** The Python signal service classifies news/social/radio and publishes events to a Redis Stream; the gateway consumes them, stages each as a *heuristic* detection, and broadcasts it to the map.
- **Trust synthesis workers (in the gateway).** Background tickers recompute corroboration for NLP and acoustic detections and promote them up the trust ladder, fire push on confirmation, and expire stale detections.

### Services

| Service | Language | Path | What it does |
|---|---|---|---|
| API Gateway | Rust + axum | `services/gateway/` | Auth (Nostr NIP-98, kind 27235), REST routes, WebSocket hub, trust-synthesis workers, tile proxy, push, IPFS photo proxy |
| Signal Ingest | Python + FastAPI | `services/signal/` | RSS / Twitter / radio → async NLP (negation-aware classifier) → events via Redis Streams |
| Blockchain Worker | Rust | `services/blockchain/` | Nostr publish (parallel, 4 relays), Bitcoin OP_RETURN anchoring, UTXO management |
| Shared types | Rust | `services/sentinel-core/` | Domain types and crypto shared across Rust services |
| PWA | React + Vite | `apps/pwa/` | Map, acoustic detection, reports, family circles, push notifications |
| Database | PostgreSQL 16 | `infra/postgres/` | All persistent data (numbered migrations under `infra/postgres/migrations/`) |
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

CI also enforces `cargo fmt --check`, `cargo clippy -D warnings`, `tsc --noEmit`, and that every database migration applies cleanly to a fresh database.

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
| `INTERNAL_SERVICE_SECRET` | Random string for service-to-service auth (required in production; fails closed if unset) |
| `CIRCLE_TOKEN_SECRET` | Random string used to derive the per-circle membership tokens (required in production; **stable** — rotating it invalidates existing circle tokens) |
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
| `NLP_SYNTHESIS_ENABLED` | Trust-ladder worker for NLP detections. Default on; set `false` to dark-launch. |
| `ACOUSTIC_CONFIRM_ENABLED` | Allow acoustic clusters to reach *confirmed* and publish. Default off. |
| `ANCHORING_ENABLED` | Allow confirmed events to queue Bitcoin anchors. Default off. |
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
│           ├── services/       # Audio capture, routing, WebSocket, nostr, e2ee
│           └── store/          # Redux slices
├── services/
│   ├── gateway/                # Rust + axum API gateway
│   │   └── src/
│   │       ├── routes/         # REST endpoints (events, reports, circles, push, tiles, photos)
│   │       ├── subscribers/    # Redis Streams consumer + trust-synthesis workers
│   │       ├── circles/        # Per-circle token derivation (C-3)
│   │       ├── trust/          # Shared trust-tier contract (heuristic→corroborating→confirmed)
│   │       └── ws/             # WebSocket hub
│   ├── blockchain/             # Rust blockchain anchoring worker
│   │   └── src/
│   │       ├── workers/        # Nostr publisher, Bitcoin anchor, confirmation poller
│   │       └── utils/          # Fee estimator
│   ├── sentinel-core/          # Shared Rust domain types and crypto
│   └── signal/                 # Python signal ingest + NLP
│       ├── ingest/             # RSS, Twitter, radio transcription
│       ├── nlp/                # Negation-aware classifier, severity scorer, location extractor
│       └── worker/             # Whisper ML worker
├── infra/
│   └── postgres/
│       ├── init.sql            # Base database schema
│       └── migrations/         # Numbered, idempotent migrations
├── shared/
│   └── types/                  # Shared TypeScript types
├── docs/
│   ├── audit/                  # Security/privacy audit + remediation plan
│   └── superpowers/            # Design specs and implementation plans
├── docker-compose.yml          # Production
└── docker-compose.dev.yml      # Local development overrides
```

---

## What's been built

- [x] Signal ingestion — RSS, Twitter/X, radio transcription → async NLP → events via Redis Streams
- [x] **Trust ladder for automated detections** — heuristic → corroborating → confirmed by independent-source corroboration; push/anchor gated to confirmed; stale detections expire
- [x] **Negation-aware NLP classifier** with capped, honest confidence
- [x] Community reports — Nostr signing, server verification, **reputation-weighted (Sybil-resistant) consensus**, IPFS photos
- [x] **Report location privacy** — ~100 m coordinate coarsening + reporter identity separated behind a restricted DB role
- [x] Family circles — E2EE location sharing, proximity alerts, WebSocket presence
- [x] **Family-circle social-graph privacy** — per-circle tokenized membership, encrypted circle names + member labels
- [x] Acoustic detection — YAMNet browser inference feeding the same trust ladder
- [x] Escape routes — Mapbox Directions avoiding threat zones
- [x] Push notifications — Web Push (VAPID), service worker, gateway subscription store
- [x] Reliability hardening — Redis Streams (no message loss on disconnect), Mapbox tile proxy, fetch timeouts, WebSocket exponential backoff, Postgres connection pooling

## What's coming next

- [ ] Recoverable, multi-device identity (so a lost key doesn't lose your circles)
- [ ] Targeted push (by proximity/circle) instead of broadcast-to-all
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
