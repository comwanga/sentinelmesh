# A1 — Repo Inventory Map (Ground Truth)

Audit unit A1. Built by direct inspection of the working tree on branch `feat/zap-hardening`, 2026-06-03.
Goal: establish what actually exists, in what language, where it runs, and how big it is — before any claim is trusted.

## Deployable components

| # | Path | Type | Language | Entrypoint | Purpose | LOC |
|---|------|------|----------|-----------|---------|-----|
| 1 | `services/gateway` | Service (HTTP+WS API) | Rust (axum/tokio/sqlx) | `src/main.rs` | Core public API. Events, community reports + consensus, family circles, encrypted location blobs, push subscriptions, Lightning zaps, acoustic signal ingest, map/tile proxy, WebSocket fanout (events + circles), Nostr auth middleware. **This is the heart of the system.** | 6,472 |
| 2 | `services/sentinel-core` | Library (shared crate) | Rust | `src/lib.rs` | Shared domain types (event, circle, location), crypto helpers, canonical schema, retry/job helpers. Linked by gateway + blockchain. | 617 |
| 3 | `services/blockchain` (Rust) | Service (worker) | Rust | `src/main.rs` | **DEPLOYED** Bitcoin anchoring worker: publish queue, OP_RETURN anchor, confirmation poller, Nostr publisher, UTXO/fee management. | 1,234 |
| 4 | `services/blockchain` (TS) | Service (worker) | TypeScript (express) | `src/index.ts` | **NOT DEPLOYED — parallel/legacy impl.** Mirrors the Rust worker set (bitcoinAnchor, confirmationPoller, nostrPublisher, publishWorker). Docker builds the Rust binary; this TS tree is dead weight. **FLAG.** | 1,514 |
| 5 | `services/signal` (API) | Service (HTTP API) | Python (FastAPI) | `main.py` | Signal ingest + NLP API. RSS/Twitter/radio ingestion, dedup, classifier, location extractor, severity scorer, event fuser, Kenya gazetteer, Redis queue publisher. Sentry-instrumented. | ~1,150 (of 2,087) |
| 6 | `services/signal` (ML worker) | Service (worker) | Python | `Dockerfile.ml` → worker/ | On-device-style audio capture + transcriber for acoustic pipeline. Separate container from the API. | ~235 |
| 7 | `apps/pwa` | Frontend (PWA) | TypeScript / React 18 | `src/main.tsx` | The entire user-facing product. 7 feature pages, 15 service modules, 12 redux slices, 14 hooks. Maps via MapLibre/react-map-gl, on-device ML via TensorFlow.js (blazeface), Nostr via nostr-tools. | 10,800 |

## Supporting / shared

| Path | Type | Notes |
|------|------|-------|
| `shared/contracts/events.schema.json` | Contract | Canonical event JSON schema (cross-language source of truth) |
| `shared/types/index.d.ts` | Contract | Shared TS type declarations |
| `services/event_schema.json`, `services/signal/event_schema.json` | Contract (copies) | Schema duplicated into services — **drift risk, FLAG** |
| `infra/postgres/init.sql` (+ migrations 004–008) | Schema | 13 tables (see below) |
| `infra/nginx`, `infra/map-style` | Infra | Reverse proxy + map style |
| `docker-compose.yml` / `.dev.yml` | Orchestration | Services: redis, gateway-rs, signal, signal-ml, blockchain |

## PWA internal map

- **Pages (7):** LiveMap, Reports, Circles, Alerts, Insights, Zaps, Settings
- **Services (15):** e2eeService, nostrService, locationPublisher, circleWebSocket, websocket, acousticDetectionService, acousticSignalSubmit, audioCapture, photoService, geocodingService, mapApiService, routingService, reportAutoSubmit
- **Store (12 slices):** events, viewportEvents, insightsEvents, circles, reports, zaps, acoustic, safetyLog, communityStats, ui
- **Hooks (14):** push subscription, acoustic engine/detection, circles, current location, proximity alerts, viewport WS, nearest threat, breakpoint/media-query

## Database tables (Postgres)

`safety_events`, `community_reports`, `report_votes`, `users`, `circles`, `circle_members`, `location_blobs`, `blockchain_anchors`, `lightning_zaps`, `push_subscriptions`, `publish_jobs`, `publish_failures`, `utxos`, `acoustic_signals`, `public_events` (15 total across init + migrations).

## LOC totals by language

| Language | LOC | Share |
|----------|-----|-------|
| TypeScript/React (PWA) | 10,800 | ~48% |
| Rust (gateway + core + blockchain) | 8,323 | ~37% |
| Python (signal API + ML) | 2,087 | ~9% |
| TypeScript (blockchain, dead) | 1,514 | ~7% |
| **Total (app source, excl. tests/gen)** | **~22,700** | |

## A1 findings worth carrying forward

1. **Duplicate blockchain implementations.** Rust (deployed) + TypeScript (~1,514 LOC, not built by Docker) implement the same anchoring workers. Confirm the TS tree is dead and remove it, or document why both exist. Two code paths for Bitcoin anchoring = two attack surfaces and a correctness-drift hazard. → feeds **C5**, **D2/D5**.
2. **Schema duplicated 3×.** `shared/contracts/events.schema.json` plus copies in `services/` and `services/signal/`. Canonical-source drift risk. → feeds **A2/A4**.
3. **NLP surface is small (~212 LOC).** The "NLP misinformation / classifier / severity" claims rest on a very thin codebase. Validate it does what's claimed vs. heuristic stubs. → feeds **F2**, **D6**.
4. **PWA is ~half the codebase and holds the privacy-critical logic** (e2ee, location publishing, on-device ML). The strongest privacy claims live in client code that the server cannot enforce. → feeds **B1–B5**, **C1–C2**.
5. **Lots of worktrees** (`.worktrees/`, `.claude/worktrees/`) carrying older copies of `init.sql`/migrations. Make sure audit targets the canonical `infra/postgres` tree only.

## Status
**A1 COMPLETE.** Ground-truth map established. Next per execution order: A2 (data-flow trace), A3 (trust boundaries), A4 (claims extraction).
