# SentinelMesh

> A privacy-first, blockchain-verified public safety intelligence layer for Kenya.

SentinelMesh aggregates open signals and opt-in community data to give ordinary Kenyans the situational awareness that only governments and corporations currently have — without trading away their privacy to get it.

---

## The Problem

During the Westgate attack (2013), Mathare floods (recurring), and every election cycle since 2007, ordinary Kenyans faced the same three failures:

- **Information fog** — WhatsApp rumours, no verified source of truth
- **Location anxiety** — no way to confirm a family member's safety in real time
- **Decision paralysis** — no alternative routes, no safe zones, no ground truth

Existing tools are either siloed, exploitative, state-controlled, or unverifiable. None of them are owned by communities. None of them are cryptographically trustworthy.

## What SentinelMesh Does

| Feature | How |
|---|---|
| **Live threat map** | Aggregates public signals (news RSS, Twitter/X, radio) → NLP classification → verified safety events on a real-time map |
| **Community reports** | Nostr-signed reports from the ground, consensus-scored, IPFS photo storage with on-device EXIF strip + face blur |
| **Family circles** | X25519 + AES-256-GCM end-to-end encrypted location sharing — server never stores decryptable coordinates |
| **Blockchain anchoring** | Every verified event published to Nostr; weekly digest anchored to Bitcoin via OP_RETURN — immutable, censor-proof record |
| **Acoustic detection** | On-device YAMNet via TensorFlow.js detects gunshots, explosions, and screaming — no audio ever leaves the browser |
| **Escape routes** | When a threat fires, Mapbox Directions calculates 2–3 walking routes that avoid the event radius |
| **Lightning tips** | Community reporters receive Bitcoin Lightning zaps (Nostr Kind 9735) for verified, high-quality reports |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                             │
│              React + Vite PWA  ·  Android (React Native)        │
└──────────────────────┬──────────────────────┬───────────────────┘
                       │                      │
                       ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                       API GATEWAY                               │
│              Node.js + Express · WebSockets · Redis             │
└──────┬──────────────┬──────────────┬──────────────┬────────────┘
       │              │              │              │
       ▼              ▼              ▼              ▼
┌──────────┐  ┌──────────────┐ ┌─────────┐  ┌────────────────┐
│  Signal  │  │  Community   │ │ Family  │  │  Blockchain    │
│  Ingest  │  │  Reports     │ │ Circles │  │  Anchor        │
│  Python  │  │  Node.js     │ │ Node.js │  │  Nostr+Bitcoin │
│  FastAPI │  │              │ │  E2EE   │  │  OP_RETURN     │
└──────┬───┘  └──────┬───────┘ └────┬────┘  └───────┬────────┘
       │              │              │               │
       └──────────────┴──────────────┴───────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                       DATA LAYER                                │
│         PostgreSQL · Redis · IPFS (report media)                │
└─────────────────────────────────────────────────────────────────┘
       │                                            │
       ▼                                            ▼
┌──────────────────┐                    ┌───────────────────────┐
│   Nostr Relays   │                    │  Bitcoin Testnet/     │
│  (event record)  │                    │  Mainnet (OP_RETURN)  │
└──────────────────┘                    └───────────────────────┘
```

### Service Map

| Service | Language | Path | Role |
|---|---|---|---|
| API Gateway | Node.js + Express + TypeScript | `services/gateway/` | Auth, routing, WebSocket hub, Lightning zaps |
| Signal Ingest | Python + FastAPI | `services/signal/` | RSS/Twitter/radio → NLP → safety events |
| PWA | React + Vite + TypeScript | `apps/pwa/` | Browser client — map, acoustic detection, reports |
| Database | PostgreSQL | `infra/postgres/` | Persistent structured storage |
| Cache / Pub-Sub | Redis | (compose service) | Real-time event delivery, session state |

---

## Tech Stack

- **Backend:** Node.js 20 · Express · TypeScript · Python 3.11 · FastAPI
- **Frontend:** React 18 · Vite · Redux Toolkit · react-map-gl · TensorFlow.js
- **Data:** PostgreSQL 16 · Redis 7
- **Protocols:** Nostr (nostr-tools v2) · Bitcoin OP_RETURN · Lightning Network (LND REST)
- **AI / NLP:** Whisper (faster-whisper) · spaCy · YAMNet (TF.js browser inference)
- **Mapping:** Mapbox GL JS · Mapbox Directions API
- **Infrastructure:** Docker · Docker Compose · nginx

---

## Non-Negotiable Privacy Principles

1. **Server never stores decryptable user locations.** Family circle coordinates are encrypted on-device with AES-256-GCM before transmission. The server receives and stores opaque blobs.
2. **No personal data at registration.** Identity is a Nostr keypair generated on-device. No email, no phone number, no name required.
3. **All media processing happens on-device.** EXIF stripping and face blurring occur in the browser/app before any upload.
4. **Every community report carries a verifiable cryptographic signature.** Reports are signed with the reporter's Nostr private key. Signatures are verified server-side and stored.
5. **Acoustic detection never sends audio off-device.** YAMNet inference runs entirely in the browser via TensorFlow.js. Only the detection label and confidence score are transmitted.
6. **Bitcoin network is testnet** until an explicit mainnet switch is made by the project maintainers.

---

## Getting Started

### Prerequisites

- Docker 24+ and Docker Compose v2
- Node.js 20+ (for local gateway development)
- Python 3.11+ (for local signal service development)
- A Mapbox public token (`VITE_MAPBOX_TOKEN`)
- A Nostr private key hex (`NOSTR_PRIVATE_KEY`) for event signing

### Quick Start (Docker Compose)

```bash
# 1. Clone the repository
git clone https://github.com/comwanga/sentinelmesh.git
cd sentinelmesh

# 2. Copy environment template and fill in your values
cp .env.example .env
# Edit .env with your Mapbox token, Nostr key, and database credentials

# 3. Start all services
docker compose -f docker-compose.dev.yml up --build

# 4. Open the PWA
open http://localhost:5173
```

Services start on:
| Service | URL |
|---|---|
| PWA | http://localhost:5173 |
| API Gateway | http://localhost:3000 |
| Signal Service | http://localhost:8000 |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

### Local Development (without Docker)

**Gateway (Node.js):**
```bash
cd services/gateway
npm install
cp .env.example .env
npm run dev
```

**Signal Service (Python):**
```bash
cd services/signal
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload
```

**PWA:**
```bash
cd apps/pwa
npm install
cp .env.example .env.local
npm run dev
```

### Running Tests

```bash
# Gateway (Vitest)
cd services/gateway && npm test

# Signal service (pytest)
cd services/signal && pytest

# PWA (Vitest)
cd apps/pwa && npm test
```

---

## Environment Variables

### Gateway (`services/gateway/.env`)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `NOSTR_PRIVATE_KEY` | Yes | Hex private key for event signing |
| `NOSTR_RELAY_URL` | Yes | Nostr relay WebSocket URL |
| `LND_REST_URL` | Optional | LND node REST endpoint (for Lightning zaps) |
| `LND_MACAROON_HEX` | Optional | LND invoice macaroon (hex) |
| `ZAP_WEBHOOK_SECRET` | Optional | HMAC secret for LND payment webhook |
| `LND_TLS_SKIP_VERIFY` | Optional | `true` for self-signed certs in dev |

### Signal Service (`services/signal/.env`)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes (API) | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `LOG_LEVEL` | No | Logging level (default: `INFO`) |

### PWA (`apps/pwa/.env.local`)

| Variable | Required | Description |
|---|---|---|
| `VITE_MAPBOX_TOKEN` | Yes | Mapbox public access token |
| `VITE_API_BASE_URL` | No | Gateway URL (default: proxied via Vite) |

---

## Repository Structure

```
sentinelmesh/
├── apps/
│   └── pwa/                    # React + Vite PWA
│       ├── public/
│       │   └── audio-processor.js  # AudioWorklet (runs in audio thread)
│       └── src/
│           ├── components/     # Map, alerts, overlays, ZapButton
│           ├── constants/      # YAMNet threat class map
│           ├── services/       # Audio capture, routing, report submit
│           └── store/          # Redux slices (events, acoustic)
├── services/
│   ├── gateway/                # Node.js API + WebSocket hub
│   │   └── src/
│   │       ├── lightning/      # LND client + zap service
│   │       └── routes/         # REST endpoints
│   └── signal/                 # Python signal ingest + NLP
│       └── worker/             # Radio transcription + audio capture
├── infra/
│   └── postgres/
│       └── init.sql            # Single-source schema
├── shared/
│   ├── contracts/              # JSON Schema for events
│   └── types/                  # Generated TypeScript types
├── docs/
│   └── superpowers/plans/      # Implementation plans
├── docker-compose.yml          # Production compose
└── docker-compose.dev.yml      # Development compose
```

---

## Contributing

1. Fork the repository and create a feature branch off `main`
2. Follow the existing code style — TypeScript strict mode, Python type hints
3. Write tests first (TDD): Vitest for TypeScript, pytest for Python
4. Keep commits atomic and descriptive
5. Open a pull request with a clear description of what changed and why

All contributions must respect the privacy principles listed above. PRs that compromise user privacy (storing unencrypted locations, adding tracking, removing signature verification) will not be merged.

---

## Roadmap

- [x] Phase 1 — Core signal layer (RSS ingest, NLP classification, WebSocket events)
- [x] Phase 5 — Acoustic detection, escape routes, Lightning zaps (PWA)
- [ ] Phase 2 — Community reports (Nostr signing, consensus scoring, IPFS)
- [ ] Phase 3 — Family circles (E2EE location sharing, proximity alerts)
- [ ] Phase 4 — Blockchain anchoring (Nostr publish, Bitcoin OP_RETURN)
- [ ] Production hardening (Docker optimisation, faster-whisper, queue retry)
- [ ] Android APK (React Native, offline tile packs, Android Keystore)
- [ ] Testnet → Mainnet Bitcoin switch

---

## License

MIT — see [LICENSE](LICENSE).

Built with ❤️ for Kenyan communities.
