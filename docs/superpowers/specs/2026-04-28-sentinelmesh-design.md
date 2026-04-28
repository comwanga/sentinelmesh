# SentinelMesh — Build Design Specification
**Date:** 2026-04-28  
**Status:** Approved  
**Scope:** Full system — all 4 modules, 10-week phased build  
**Author:** SentinelMesh engineering session

---

## 1. Decisions Made

| Decision | Choice | Rationale |
|---|---|---|
| Repository layout | Single monorepo | Fastest path to working software; can split later |
| JS runtime | TypeScript for all JS services | Type safety, IntelliSense, contract alignment |
| Python scope | Signal service only | NLP inference is the only justified Python use case |
| Dev environment | Docker-first | `docker-compose up` is the only setup step |
| Testing strategy | Test-alongside default; strict TDD for core logic; strong integration coverage | Speed + safety + realism |
| Shared packages | Built TypeScript packages with explicit compile step | Prevents drift; packages are versioned and importable |
| Schema source of truth | `shared/contracts/` JSON Schema + OpenAPI YAML | Single definition consumed by TS (generated types) and Python (Pydantic models) |
| Service boundaries | No cross-service imports; Redis pub/sub or HTTP only | Enforced by ESLint `no-restricted-imports` |

---

## 2. Repository Structure

```
sentinelmesh/
├── services/
│   ├── gateway/              # TypeScript + Express — auth, routing, WebSockets, rate limiting
│   ├── signal/               # Python + FastAPI — ingest, NLP, gazetteer (Python only)
│   ├── reports/              # TypeScript + Express — community reports, consensus, Nostr relay
│   ├── circles/              # TypeScript + Express — E2E encrypted location, proximity alerts
│   └── blockchain/           # TypeScript — Nostr publish, Bitcoin OP_RETURN anchor
├── apps/
│   ├── mobile/               # React Native (Android)
│   └── pwa/                  # React + Vite (PWA)
├── shared/
│   ├── contracts/            # JSON Schema + OpenAPI YAML — language-neutral source of truth
│   │   ├── events.schema.json
│   │   ├── reports.schema.json
│   │   ├── circles.schema.json
│   │   └── openapi.yaml
│   ├── types/                # Auto-generated TS types — never hand-edited
│   │   └── index.d.ts
│   ├── crypto/               # Built TS package "@sentinel/crypto" — X25519 + AES-256-GCM
│   │   ├── src/
│   │   ├── tests/
│   │   └── package.json
│   └── nostr/                # Built TS package "@sentinel/nostr" — event builder + sig verifier
│       ├── src/
│       ├── tests/
│       └── package.json
├── infra/
│   ├── docker-compose.yml        # production-equivalent stack
│   ├── docker-compose.dev.yml    # dev overrides: hot reload, exposed ports
│   ├── postgres/
│   │   └── init.sql              # full schema (safety_events, community_reports, circles, etc.)
│   └── nginx/
│       └── nginx.conf            # reverse proxy: all external traffic enters here
├── docs/
│   └── superpowers/specs/
├── Makefile                       # dev shortcuts: make up, make test, make seed, make smoke
├── tsconfig.base.json             # root TS config extended by all services
└── .env.example                   # all required env vars documented, no defaults for secrets
```

---

## 3. TypeScript Configuration

All Node.js services extend a single root config to stay consistent:

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

Each service's `tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "tests"] }
```

Shared packages (`crypto`, `nostr`) compile to `dist/` with type declarations. Services reference them via workspace-style local paths in `package.json`.

---

## 4. Service Communication

### Topology

```
Clients (WebSocket / REST)
        │
        ▼
  ┌──────────────┐
  │   gateway    │ ← only service reachable from outside Docker network
  │  (TS :3000)  │
  └──────┬───────┘
         │ internal HTTP (INTERNAL_SERVICE_SECRET header)
   ┌─────┼─────────────┐
   ▼     ▼             ▼
reports  circles   blockchain
(:3001)  (:3002)   (:3003)

         │ Redis pub/sub ("sentinel:events:new")
         ▼
      signal/
   (Python :8000)
         │
         ▼
      gateway  ← subscribes, persists to PG, fans out to WS clients
```

### Communication Patterns

| Pattern | Used for | Rule |
|---|---|---|
| Redis pub/sub | signal → gateway event broadcast | signal emits only; never calls services over HTTP |
| Internal HTTP | gateway → reports / circles / blockchain | gateway is sole external entry point |
| PostgreSQL | all services | each service owns its domain tables; no cross-table queries |

### Security Rules
- `signal/` communicates **only** via Redis — zero HTTP calls to other services
- All internal HTTP requests carry `X-Internal-Secret: $INTERNAL_SERVICE_SECRET` header
- Each Node.js service maintains its own `pg-pool` — no shared DB client
- All external traffic enters through nginx → gateway only

---

## 5. Core Data Contract

Defined in `shared/contracts/events.schema.json`. TypeScript types auto-generated; Python Pydantic models aligned to the same schema.

```typescript
// shared/types/index.d.ts (generated — do not edit)

type EventType =
  | 'TRAFFIC_INCIDENT' | 'FLOOD' | 'CIVIL_UNREST'
  | 'SECURITY_INCIDENT' | 'FIRE' | 'MEDICAL_EMERGENCY'
  | 'INFRASTRUCTURE_FAILURE' | 'FALSE_ALARM'

type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

type EventStatus = 'PENDING' | 'UNVERIFIED' | 'VERIFIED' | 'AUTHORITATIVE' | 'DISPUTED' | 'REJECTED'

type SafetyEvent = {
  event_id: string
  event_type: EventType
  severity: Severity
  title: string
  summary: string
  location: {
    place_name: string
    lat: number
    lng: number
    county: string
    radius_meters: number
  } | null                  // null when gazetteer match fails — never fabricated
  confidence: number        // 0.0 – 1.0
  source_count: number
  source_breakdown: Record<string, number>
  is_active: boolean
  started_at: string
  last_updated: string
  nostr_event_id: string | null
  bitcoin_txid: string | null
}

type CommunityReport = {
  id: string
  report_type: string
  description: string
  lat: number
  lng: number
  place_name: string | null
  nostr_pubkey: string      // 64-char hex
  nostr_signature: string   // 128-char hex
  nostr_event_id: string | null
  reporter_tier: 'NEWCOMER' | 'TRUSTED' | 'VETERAN' | 'SENTINEL'
  consensus_score: number
  status: EventStatus
  photo_ipfs_cid: string | null
  linked_event_id: string | null
  created_at: string
}

type SentinelError = {
  code: string
  message: string
  retryable: boolean
  context?: Record<string, unknown>
}
```

---

## 6. Phase 1 Data Flow — Signal Ingest to Live Map

```
signal/ ingest tasks (APScheduler)
  rss_parser        → every 60s
  twitter_stream    → continuous
  radio_transcriber → 30s Whisper windows
  official_feeds    → every 5min
        │
        ▼
  Pipeline (sequential per item):
  1. dedup          SHA256(content) → Redis check (24h TTL)
  2. lang_detect    discard if not sw/en
  3. classify       Gemma 2 GGUF → event_type + confidence
  4. extract_loc    spaCy NER → Kenya gazetteer → (lat, lng) or null
  5. score_severity keyword density + source trust → CRITICAL|HIGH|MEDIUM|LOW
  6. fuse_events    cluster signals within 2km / 30min → single SafetyEvent
        │
        ▼ Redis publish "sentinel:events:new"
        │
gateway/ subscriber
  1. Validate shape against events.schema.json (Ajv)
  2. Persist to PostgreSQL safety_events
  3. Cache: sentinel:event:{id} (TTL 30min)
  4. Update sorted set: sentinel:events:active
  5. WebSocket fan-out to subscribed clients (county match or radius)
        │
        ▼ { type: "NEW_EVENT", payload: SafetyEvent }
        │
apps/pwa/
  Redux eventsSlice → Mapbox GL marker → severity colour + icon
```

---

## 7. Error Handling

Every external call has a documented failure mode. No silent error swallowing.

| Failure | Response |
|---|---|
| RSS / Twitter fetch timeout | Exponential backoff (1s→2s→4s, max 32s). Log WARN. Skip item. |
| Whisper stream unavailable | Mark station DEGRADED in Redis. Retry after 5min. Alert Sentry. |
| Gemma 2 timeout (>10s) | Emit event with `confidence: 0`, skip NLP fields. Log ERROR. |
| Gazetteer miss | Store event with `location: null`. Reduce confidence by 0.3. Never guess. |
| Redis connection lost | gateway reconnects with jitter backoff. Buffer up to 100 events in-memory. |
| PostgreSQL transient error | 3 retries with backoff. Dead-letter file: `/var/log/sentinel/dlq.jsonl`. |
| WebSocket client drop | Remove from subscription set. Expected — not an error. |
| Bitcoin RPC unreachable | Queue anchor in DB with `status: pending`. Retry every 10min. |
| Nostr relay rejection | `Promise.allSettled` — partial success acceptable. Log failures. Retry after 30min. |

All services return a consistent error envelope:
```typescript
{ code: string, message: string, retryable: boolean, context?: Record<string, unknown> }
```

---

## 8. Testing Strategy

**Default:** test-alongside (implementation + tests written in same sitting)  
**Core logic:** strict TDD (failing test first) — consensus engine, crypto, location extractor, Nostr sig verifier  
**Real-world flows:** strong integration coverage — full ingest pipeline, E2E location round-trip, API auth flows

| Layer | Tool | What's tested |
|---|---|---|
| `shared/crypto` | Vitest (TDD) | X25519 keygen, ECDH, AES-256-GCM, edge cases |
| `shared/nostr` | Vitest (TDD) | Event signing, sig verification, malformed events |
| `signal/` NLP | pytest (TDD for classifier + extractor) | Labels, gazetteer lookups, confidence scoring |
| `reports/` consensus | Vitest (TDD) | All 5 status states, every score transition, concurrent votes |
| `gateway/` API | Supertest (integration) | Happy path + auth failures + rate limits |
| `circles/` E2E location | Vitest (integration) | Encrypt → upload → download → decrypt round-trip |
| Full signal flow | pytest + Redis mock | Ingest → classify → emit → validate SafetyEvent shape |
| Docker stack smoke | curl via `make smoke` | Every endpoint hit once after `docker-compose up` |

**CI order:** `shared/crypto` → `shared/nostr` → `signal/` → `reports/` → `circles/` → `gateway/` → smoke  
Fast packages first — failures surface before slow integration tests run.

---

## 9. Build Phases (aligned to spec)

| Phase | Weeks | Deliverable |
|---|---|---|
| 1 — Core Signal Layer | 1–3 | RSS + Twitter + radio → NLP → PostgreSQL → WebSocket → PWA map |
| 2 — Community Reports | 4–5 | Nostr-signed reports, consensus scoring, IPFS photos, reputation |
| 3 — Family Circles | 6–7 | X25519 + AES-256-GCM location, ghost mode, proximity alerts |
| 4 — Blockchain + Polish | 8–10 | Nostr publish, Bitcoin OP_RETURN anchor, offline APK, security audit |

Each phase produces running, tested software — not scaffolding.

---

## 10. Non-Negotiable Invariants

These must never be violated regardless of feature pressure or deadline:

1. Server never stores decryptable user locations — E2E enforced in code, not policy
2. No personal data at registration — Nostr pubkey only
3. All photo processing (EXIF strip, face blur) happens on-device before upload
4. Every community report carries a verifiable Nostr signature
5. Bitcoin network is testnet until `BITCOIN_NETWORK=mainnet` is explicitly set
6. Kenya gazetteer is the only coordinate source — `location: null` is the correct response to a gazetteer miss, never a guessed coordinate
7. `signal/` is Python only — no TypeScript bleeds into NLP service
8. `shared/types/` is generated — never hand-edited
9. No secrets hardcoded — all credentials via environment variables
10. Swahili + English in all user-facing strings
