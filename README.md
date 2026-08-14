# SentinelMesh

A privacy-aware community safety network. SentinelMesh combines a live OpenStreetMap-based incident map, signed community reports, durable nearby alerts, and portable [Nostr](https://nostr.com) identity without requiring a conventional account.

The hard part of an app like this isn't drawing dots on a map — it's deciding **which dots to trust**. SentinelMesh's design is built around that question: automated signals start out untrusted and earn trust only through independent corroboration, and the server is built to hold as little readable personal data as possible.

The default product supports the safety map, alert list, signed community reports, local or remote signing, optional NIP-05 identity, encrypted backup and restore, and opt-in push perimeters. Family Circles, acoustic detection, routing, photos, and Insights remain experimental and hidden by default. See [`docs/V2_SCOPE.md`](docs/V2_SCOPE.md) for the supported boundary and trust terminology.

---

## What it does

| Capability | Status | Description |
|---|---|---|
| **Safety map and alerts** | Core | Uses MapLibre with Stadia's OpenStreetMap-derived OpenMapTiles data. Displays each incident's stored trust state; missing trust data is unverified. |
| **Community reports** | Core | Submits location-based reports signed by the user's local Nostr key and supports community confirmation or denial. |
| **Nostr identity** | Core | Generates an encrypted local identity or connects a NIP-46 remote signer, with backup, restore, NIP-19 key handling, and optional NIP-05 verification. |
| **Push notifications** | Core | User-enabled alert perimeters deliver confirmed incidents through durable, geographically targeted queues. |
| **Family Circles** | Experimental | Circle management is behind `VITE_ENABLE_EXPERIMENTAL_CIRCLES`. Location sharing additionally requires both `SAFE_CIRCLE_LOCATION_ENABLED=true` and `VITE_ENABLE_SAFE_CIRCLE_LOCATION=true`; it is off by default. Membership uses epoch-bound keys and pending/accept, removal revokes a member and forces a rekey, the circle WebSocket requires a fresh bound kind-27235 auth event, and markers render only decrypted, roster-verified locations with explicit user controls. |
| **Acoustic detection** | Experimental | Retained behind `VITE_ENABLE_EXPERIMENTAL_ACOUSTIC`; detections are client assertions and cannot independently confirm an event. |
| **Routing** | Experimental | Retained behind `VITE_ENABLE_EXPERIMENTAL_ROUTING`; routes are not described as safe or authoritative. |
| **Photos** | Experimental | Retained behind `VITE_ENABLE_EXPERIMENTAL_PHOTOS`; privacy processing is best effort. |

### Nostr protocol support

| NIP | Status | SentinelMesh use |
|---|---|---|
| **NIP-01** | Core primitives | Event IDs, secp256k1 signatures, and signature verification for reports, votes, vouches, and authenticated actions. Signed application events are submitted to the gateway; SentinelMesh is not a general relay client. |
| **NIP-05** | Core | Optional `name@domain` verification for the active public key, with server-side HTTPS resolution and an explicit validity window. |
| **NIP-19** | Core, scoped | Displays `npub`, imports/exports `nsec`, and accepts `npub` or hex public keys. Other NIP-19 entities are not claimed. |
| **NIP-44 v2** | Experimental | Pairwise encrypted delivery of Family Circle keys, upgraded to epoch-bound v2 key packages. The cryptographic envelope and persistence paths are implemented; live Circle location sharing remains experimental. |
| **NIP-46** | Core | Connects a `bunker://` remote signer, verifies returned events, persists encrypted connection state, and never silently falls back to the local key. |
| **NIP-98** | Core | Authenticates identity, push, and supported mutation requests with signed kind `27235` events, exact URL/method binding, optional payload hashes, and Redis replay protection. |

NIP-07 detection exists only as scaffolding and is not presented as an active signer mode. NIP-49 and NIP-57 are not implemented in the current product.

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
- **Family-circle keys** are delivered pairwise through signed NIP-44 v2 envelopes with epoch-bound v2 key packages. Keys are stored per (circle, epoch); a membership change bumps the epoch so a removed member's key no longer decrypts new envelopes (forward secrecy across membership changes). The safe-location foundation signs the complete location event before AES-256-GCM encryption; the server stores one short-lived opaque ciphertext envelope per sender and cannot read its coordinates.
- **Family-circle membership lifecycle** is explicit: the owner adds a member as PENDING, the recipient accepts, and location publication is blocked until the owner atomically commits an epoch with a wrap for every active member. Removing a member (or self-leave) deactivates them, deletes their envelope, and forces a rekey.
- **Legacy circle keys** that were previously migrated into non-extractable storage without a vault copy remain usable for decryption but cannot be distributed. Restore a backup containing the key or create a new circle; the client will not rotate them destructively.
- **Family-circle social graph** is tokenized at rest: membership, owner, and location-sender identifiers are stored as per-circle keyed tokens (no plaintext pubkeys), and circle names and member labels are encrypted under the circle key. Member tokens are never returned to non-owner members. A database leak without the token secret cannot map those tokens back to pubkeys or read circle/member names.
- **Community-report locations** are coarsened to a ~100 m cell, and the reporter's identity (pubkey/signature) is stored in a separate access-controlled table behind a restricted database role. A database leak cannot link a precise location trail to a person.
- **Audio** never leaves the device. Acoustic detection sends only a label, confidence, and location.
- **No name/email/phone is required.** If a user opts into NIP-05 verification, the canonical `name@domain` label and its 24-hour verification window are stored with the public key. The user can remove it explicitly; otherwise it remains as expired history until that public key verifies again or another key reclaims the label.
- **Map browsing uses open data.** The default PWA renders Stadia-hosted, OpenStreetMap-derived OpenMapTiles vector data with MapLibre. Localhost needs no credentials; production uses registered-domain authentication.
- **Photos** are EXIF-stripped and face-blurred on-device before upload (face blur is best-effort, frontal faces only).

**Threat model.** The community-report and family-circle protections above defend against a **stolen database or leaked read access without the application's secrets**. The server still observes circle identifiers, keyed sender tokens, ciphertext hashes, envelope sizes, and publish/expiry timing. A compromised running client, circle key, authenticated member, or gateway can attack availability or traffic analysis; E2EE protects coordinate contents, not those boundaries. Removed-member socket invalidation relies on a single gateway replica; `SAFE_CIRCLE_LOCATION_ENABLED` fails startup when more than one replica is configured.

**NOT protected (known limitations — do not assume otherwise):**
- **Acoustic-detection locations are stored in plaintext** and linked to a persistent pubkey, with no retention limit yet. Treat acoustic-detection history as an identity-linked location trail.
- **Family-circle envelope metadata is visible to the server**: it stores short-lived encrypted envelopes plus circle, epoch, keyed sender, replay hash, size, creation, and expiry metadata. Coordinates are not plaintext, but timing and traffic patterns are not hidden.
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
│   push delivery · API             │
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
| API Gateway | Rust + axum | `services/gateway/` | Nostr authentication, REST routes, WebSocket hubs, trust-synthesis workers, durable push, and optional media/map proxies |
| Signal Ingest | Python + FastAPI | `services/signal/` | RSS / Twitter / radio → async NLP (negation-aware classifier) → events via Redis Streams |
| Shared types | Rust | `services/sentinel-core/` | Domain types shared across Rust services |
| PWA | React + Vite | `apps/pwa/` | Responsive MapLibre safety map, alerts, reports, Nostr identity, and push preferences |
| Database | PostgreSQL 16 | `infra/postgres/` | All persistent data (active V2 migrations under `infra/postgres/migrations-v2/`) |
| Cache / Streams | Redis 7 | Docker service | Real-time event delivery via Redis Streams (XADD/XREADGROUP) |

---

## Getting started

### What you need

- Docker 24+ and Docker Compose v2
- Rust toolchain (stable) — [install via rustup](https://rustup.rs)
- Internet access to Stadia Maps for default vector map data, or a compatible OpenMapTiles TileJSON source
- A Mapbox secret token only if optional Mapbox-backed proxy routes are enabled
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

### Optional

| Variable | Description |
|---|---|
| `MAP_API_ENABLED` | Enables gateway map search, reverse geocoding, and routing. Defaults to `false`. |
| `STADIA_API_KEY` | Server-side Stadia Maps API key. Required when map APIs are enabled in production; never expose as a `VITE_*` value. |
| `MAPBOX_TOKEN` | Legacy server-side tile proxy token only; not used for map search or routing. |
| `PINATA_JWT` | Server-side Pinata JWT for the IPFS photo proxy (`/api/photos/pin`). |
| `TWITTER_BEARER_TOKEN` | For pulling Twitter/X signals. Skipped if empty. |
| `SENTRY_DSN` | Sentry error tracking URL. Optional in dev, recommended in production. |
| `MAX_DB_CONNECTIONS` | Gateway Postgres pool size. Defaults to 50. |
| `NLP_SYNTHESIS_ENABLED` | Trust-ladder worker for NLP detections. Default on; set `false` to dark-launch. |
| `ACOUSTIC_CONFIRM_ENABLED` | Allow acoustic clusters to reach *confirmed* and publish. Default off. |
| `VAPID_PRIVATE_KEY` | Base64url-encoded VAPID private key for Web Push. Push is disabled if unset. |
| `VAPID_PUBLIC_KEY` | Base64url-encoded VAPID public key (also set as `VITE_VAPID_PUBLIC_KEY` for the PWA) |
| `VAPID_SUBJECT` | `mailto:` or HTTPS URL identifying the push sender (e.g. `mailto:ops@example.com`) |

Map search uses Stadia's autocomplete endpoint for interactive suggestions. A separate submitted-query refinement through the full search endpoint can be added later without changing the public result contract.

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

## Implementation status

- [x] Local Nostr identity, signing, backup, and restore primitives
- [x] Community report submission and voting paths
- [x] Viewport-scoped map event transport
- [x] Report coordinate coarsening and separated author storage
- [x] Initial event and report synchronization
- [x] One canonical event contract and frontend store
- [x] Transactionally atomic report transitions and side effects
- [x] Single-host core production deployment, migrations, readiness, backup drills, and monitoring
- [x] Durable and targeted push delivery with explicit permission controls
- [x] NIP-05 identity verification and expiry controls
- [x] NIP-46 remote signer mode with strict no-fallback behavior
- [x] NIP-98 authenticated mutations and replay protection
- [x] Bright responsive interface and OpenStreetMap-based MapLibre cartography

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
