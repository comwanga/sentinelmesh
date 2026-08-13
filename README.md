# SentinelMesh

A community incident-awareness prototype. It shows incidents on a map and lets people submit signed reports without creating a conventional account. Identity is a cryptographic [Nostr](https://nostr.com) keypair created on the device; location and pseudonymous identity data are still processed as described below.

The hard part of an app like this isn't drawing dots on a map — it's deciding **which dots to trust**. SentinelMesh's design is built around that question: automated signals start out untrusted and earn trust only through independent corroboration, and the server is built to hold as little readable personal data as possible.

> **V2 scope freeze:** SentinelMesh supports the incident map, alert list, signed community reports, and local identity. Family Circles, acoustic detection, routing, photos, and Insights are experimental and hidden by default. See [`docs/V2_SCOPE.md`](docs/V2_SCOPE.md) for the supported boundary and trust terminology.

---

## What it does

| Capability | V2 status | Description |
|---|---|---|
| **Incident map and alerts** | Core | Displays loaded incidents and their explicit stored trust state. Missing trust data is treated as unverified. |
| **Community reports** | Core | Submits location-based reports signed by the user's local Nostr key and supports community confirmation or denial. |
| **Local identity** | Core | Generates and stores a cryptographic identity in the browser with backup, restore, and optional NIP-05 verification controls. |
| **Push notifications** | Reworking | Not a release promise until permission UX and durable, targeted delivery are complete. |
| **Family Circles** | Experimental | Retained behind `VITE_ENABLE_EXPERIMENTAL_CIRCLES`; the current client/server journey is not release-ready. |
| **Acoustic detection** | Experimental | Retained behind `VITE_ENABLE_EXPERIMENTAL_ACOUSTIC`; detections are client assertions and cannot independently confirm an event. |
| **Routing** | Experimental | Retained behind `VITE_ENABLE_EXPERIMENTAL_ROUTING`; routes are not described as safe or authoritative. |
| **Photos** | Experimental | Retained behind `VITE_ENABLE_EXPERIMENTAL_PHOTOS`; privacy processing is best effort. |

---

## How events become trusted

Nothing on the map is assumed trustworthy just because it appeared. Each kind of signal has an explicit path from "raw input" to "confirmed", and machine-generated signals can never silently masquerade as confirmed human reports.

**Automated detections (NLP and acoustic) climb a trust ladder:**

| Tier | Meaning | What it can do |
|---|---|---|
| **Heuristic** | A single automated detection. Shown on the map but clearly labeled *"Automated Detection"*. | Visible only. **No** push and **no** influence on escape routes. |
| **Corroborating** | At least **2 independent sources** agree (e.g. two different news domains). | Still labeled automated; gaining support. |
| **Confirmed** | At least **3 independent sources across ≥2 channels** (e.g. news *and* radio). | Accepted by SentinelMesh's trust policy; eligible for configured notification behavior. |

A background worker recomputes this every few seconds and only ever *raises* a tier. "Independence" is counted as distinct sources and channels, never as raw row counts, so duplicate ingestion can't fake corroboration. Uncorroborated detections **expire** off the map after a TTL instead of lingering forever.

**Community reports use reputation-weighted consensus**, not a flat vote count: an established reporter's vote carries more weight than a brand-new key's, promotion to *verified* requires several **distinct** confirmers, and an optional gate can require some of those confirmers to be established accounts. This makes it expensive to manufacture or suppress consensus with throwaway identities (a "Sybil" attack).

**The NLP classifier is honest about being a heuristic.** It is negation-aware ("no fire, all clear" is *not* a fire) and its confidence is capped — it is keyword matching with guardrails, never presented as a calibrated AI detector.

The throughline: **trust is earned through independent corroboration**, and the system fails toward "show it but don't act on it" rather than "broadcast an unverified alarm".

---

## Privacy model (what is and isn't protected)

Be precise about this — overclaiming privacy is a safety risk for the people who rely on it.

**Protected:**
- **Family-circle keys** are delivered pairwise through signed NIP-44 v2 envelopes. Circle names, labels, and coordinates remain encrypted on-device with the shared AES-256-GCM circle key; the server stores ciphertext it cannot read.
- **Legacy circle keys** that were previously migrated into non-extractable storage without a vault copy remain usable for decryption but cannot be distributed. Restore a backup containing the key or create a new circle; the client will not rotate them destructively.
- **Family-circle social graph** is tokenized at rest: membership/owner/recipient identifiers are stored as per-circle keyed tokens (no plaintext pubkeys), and circle names and member labels are encrypted under the circle key. A database leak cannot reconstruct who belongs to which circle, or read circle/member names.
- **Community-report locations** are coarsened to a ~100 m cell, and the reporter's identity (pubkey/signature) is stored in a separate access-controlled table behind a restricted database role. A database leak cannot link a precise location trail to a person.
- **Audio** never leaves the device. Acoustic detection sends only a label, confidence, and location.
- **No name/email/phone is required.** If a user opts into NIP-05 verification, the canonical `name@domain` label and its 24-hour verification window are stored with the public key. The user can remove it explicitly; otherwise it remains as expired history until that public key verifies again or another key reclaims the label.
- **Mapbox tiles** are proxied through the gateway (`/api/tiles`); the Mapbox token is not exposed to the browser.
- **Photos** are EXIF-stripped and face-blurred on-device before upload (face blur is best-effort, frontal faces only).

**Threat model.** The community-report and family-circle protections above defend against a **stolen database or leaked read access without the application's secrets**. They do **not** hide data from the running server operator (who holds the keying secrets) — that is a deliberate, documented scope boundary, to be narrowed by later work.

**NOT protected (known limitations — do not assume otherwise):**
- **Acoustic-detection locations are stored in plaintext** and linked to a persistent pubkey, with no retention limit yet. Treat acoustic-detection history as an identity-linked location trail.
- **Family-circle timing metadata is visible to the server**: it can see *when* a member shares location (the coordinates, membership, and names are protected — the timing is not).
- **A Nostr pubkey is a stable pseudonymous identifier.** User-signed events and anything independently published to external relays or storage may be retained by third parties.
- **An optional NIP-05 label is linkable to the public key.** The server operator, or anyone with access to both profile and restricted report-author records, can correlate that human-readable label with pubkey-linked activity.

Remaining gaps are tracked in `docs/audit/` with a remediation plan.

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
└──────────────┬──────────────┘
               │
        ┌──────┴──────┐
        ▼             ▼
    Postgres      Redis Streams
```

Two things flow through the gateway continuously and are worth calling out, because they implement the trust model above:

- **Signal ingest → Redis Streams → gateway.** The Python signal service classifies news/social/radio and publishes events to a Redis Stream; the gateway consumes them, stages each as a *heuristic* detection, and broadcasts it to the map.
- **Trust synthesis workers (in the gateway).** Background tickers recompute corroboration for NLP and acoustic detections and promote them up the trust ladder, fire push on confirmation, and expire stale detections.

### Services

| Service | Language | Path | What it does |
|---|---|---|---|
| API Gateway | Rust + axum | `services/gateway/` | Auth (Nostr NIP-98, kind 27235), REST routes, WebSocket hub, trust-synthesis workers, tile proxy, push, IPFS photo proxy |
| Signal Ingest | Python + FastAPI | `services/signal/` | RSS / Twitter / radio → async NLP (negation-aware classifier) → events via Redis Streams |
| Shared types | Rust | `services/sentinel-core/` | Domain types shared across Rust services |
| PWA | React + Vite | `apps/pwa/` | Map, acoustic detection, reports, family circles, push notifications |
| Database | PostgreSQL 16 | `infra/postgres/` | All persistent data (active V2 migrations under `infra/postgres/migrations-v2/`) |
| Cache / Streams | Redis 7 | Docker service | Real-time event delivery via Redis Streams (XADD/XREADGROUP) |

---

## Getting started

### What you need

- Docker 24+ and Docker Compose v2
- Rust toolchain (stable) — [install via rustup](https://rustup.rs)
- A Mapbox secret token only if Mapbox-backed routes or tiles are enabled
- Node.js 20+ for local PWA development

### Step 1 — Clone and configure

```bash
git clone https://github.com/comwanga/sentinelmesh.git
cd sentinelmesh

cp .env.example .env
# Open .env and fill in the required variables (see below)
```

### Step 2 — Start the core stack

```bash
docker compose up -d --build --wait
```

Check it's running:
```bash
curl http://localhost/live
curl http://localhost/ready
# Both return HTTP 200 when the process and required dependencies are healthy.
```

Open **http://localhost**. The unprivileged Nginx container serves the built PWA and proxies `/api`, `/ws`, `/live`, and `/ready` to the Rust gateway.

The first V2 bootstrap requires a fresh database volume. During pre-production development, reset an old prototype volume with:

```bash
docker compose down -v --remove-orphans
```

Populated V2 databases are upgraded by the one-shot migrator; do not replay files under the historical `infra/postgres/migrations/` directory:

```bash
make migrate
```

### Optional profiles

```bash
docker compose --profile signal up -d --build
docker compose --profile ml up -d --build
```

Signal ingestion and ML transcription are not part of the default core stack.

### All service URLs (dev)

| Service | URL |
|---|---|
| Core PWA and proxy | http://localhost |
| API Gateway | http://localhost:3000 |
| Signal Service | http://localhost:8000 (optional `signal` profile) |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

---

## Running tests

```bash
make lint
make test-rust
make test-pwa
make build-pwa
make test-signal
make config
```

CI also enforces `cargo fmt --check`, `cargo clippy -D warnings`, `tsc --noEmit`, the clean V2 schema, and the restricted runtime database role boundary.

---

## Environment variables

All variables go in the root `.env` file. Copy `.env.example` to get started.

### Required for the backend to start

| Variable | Description |
|---|---|
| `POSTGRES_ADMIN_PASSWORD` | Bootstrap-only PostgreSQL administrator password; never used by the app |
| `APP_DATABASE_PASSWORD` | Password for the non-superuser `sentinel_app` runtime role |
| `DATABASE_URL` | Runtime connection string using `sentinel_app` |
| `REDIS_PASSWORD` | Password for Redis |
| `REDIS_URL` | Full Redis connection string — must match `REDIS_PASSWORD` |
| `INTERNAL_SERVICE_SECRET` | Random string for service-to-service auth (required in production; fails closed if unset) |
| `CIRCLE_TOKEN_SECRET` | Random string used to derive the per-circle membership tokens (required in production; **stable** — rotating it invalidates existing circle tokens) |
| `PUBLIC_BASE_URL` | Canonical external origin used by NIP-98 validation |
| `MAPBOX_TOKEN` | Optional Mapbox secret token used only by the server-side proxy |

### Optional

| Variable | Description |
|---|---|
| `PINATA_JWT` | Server-side Pinata JWT for the IPFS photo proxy (`/api/photos/pin`). |
| `TWITTER_BEARER_TOKEN` | For pulling Twitter/X signals. Skipped if empty. |
| `SENTRY_DSN` | Sentry error tracking URL. Optional in dev, recommended in production. |
| `MAX_DB_CONNECTIONS` | Gateway Postgres pool size. Defaults to 50. |
| `NLP_SYNTHESIS_ENABLED` | Trust-ladder worker for NLP detections. Default on; set `false` to dark-launch. |
| `ACOUSTIC_CONFIRM_ENABLED` | Allow acoustic clusters to reach *confirmed* and publish. Default off. |
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
│       │   ├── push-sw.js      # Push handlers imported by generated Workbox worker
│       │   └── icon.svg        # Install and notification icon
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
│   ├── sentinel-core/          # Shared Rust domain types
│   └── signal/                 # Python signal ingest + NLP
│       ├── ingest/             # RSS, Twitter, radio transcription
│       ├── nlp/                # Negation-aware classifier, severity scorer, location extractor
│       └── worker/             # Whisper ML worker
├── infra/
│   └── postgres/
│       ├── schema-v2.sql       # Authoritative clean V2 baseline
│       ├── bootstrap-roles.sh  # Runtime/reputation role creation
│       └── migrations/         # Historical pre-V2 migrations; not executable for V2
├── shared/
│   └── types/                  # Shared TypeScript types
├── docs/
│   ├── audit/                  # Security/privacy audit + remediation plan
│   └── superpowers/            # Design specs and implementation plans
├── docker-compose.yml          # Core single-host stack plus optional profiles
└── docker-compose.dev.yml      # Local development overrides
```

---

## Current implementation status

- [x] Local Nostr identity, signing, backup, and restore primitives
- [x] Community report submission and voting paths
- [x] Viewport-scoped map event transport
- [x] Report coordinate coarsening and separated author storage
- [x] Initial event and report synchronization
- [x] One canonical event contract and frontend store
- [x] Transactionally atomic report transitions and side effects
- [x] Single-host core production deployment, migrations, readiness, backup drills, and monitoring
- [ ] Durable and targeted push delivery

Signal ingestion, Family Circles, acoustic detection, routing, photos, and Insights are retained as experimental work. Presence in the repository is not an end-to-end completion claim.

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

Built for Global communities.
