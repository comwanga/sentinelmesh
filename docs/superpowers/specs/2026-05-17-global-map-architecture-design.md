# SentinelMesh — Global Map Architecture Design

**Date:** 2026-05-17
**Status:** Approved for implementation planning
**Scope:** Rendering layer, tile pipeline, provider abstraction, realtime overlays, privacy architecture, migration phasing

---

## Product Principle

SentinelMesh is "privacy by architecture, not by promise." The infrastructure itself minimises what can be known about users. This is a structural guarantee — not a policy statement — and it is the primary differentiator against ad-driven safety and mapping platforms globally.

---

## Approach Selected

**Incremental migration (Approach A):** Phases ship independently; production is functional at every stage. Tile migration delivers the largest privacy win and ships first. Provider abstraction is built immediately but Mapbox routing/geocoding APIs remain behind the gateway until self-hosted services are operational.

---

## Section 1: Rendering Layer + Tile Pipeline + Service Worker

### Rendering Layer

**MapLibre GL JS** replaces Mapbox GL JS as the rendering engine, via the react-map-gl v8 MapLibre adapter or a direct MapLibre wrapper abstraction (implementation detail deferred to avoid locking an import path). MapLibre is an open-source fork of Mapbox GL JS with an identical style spec and component API.

The `mapboxAccessToken` prop is removed from the frontend entirely. No Mapbox token is distributed to browser clients. All existing `<Marker>`, `<Source>`, `<Layer>` components in `LocationMarker`, `HomeRouteLayer`, `SafeRouteOverlay`, `CircleMapLayer`, and `EventMarker` work without API changes.

**Primary change surface:** `MapCanvas.tsx` and supporting config modules (style loading, provider initialisation, token handling). Other components do not require rendering-layer changes.

### Vector Tile Pipeline

Tiles move from `mapbox://styles/mapbox/dark-v11` (Mapbox proprietary, `api.mapbox.com`) to self-hosted PMTiles served from Cloudflare R2. PMTiles is a single-file archive; the browser fetches only viewport-relevant tiles via HTTP byte-range requests. No tile server process is required. No per-tile request is logged by any third party.

```
OpenStreetMap planet data (weekly update)
        ↓
  Planetiler (batch generation)
        ↓
  planet.pmtiles (tens to ~100 GB depending on schema and compression)
        ↓
  Cloudflare R2 (global CDN, byte-range capable)
        ↓
  MapLibre GL JS (viewport-bounded byte-range fetch)
```

In practice, initial deployment may use a regional extract (Africa, or named countries) to reduce generation time and storage cost, with a full planet extract added when operational capacity allows.

The SentinelMesh map style (road colours, label hierarchy, layer ordering, dark safety-oriented theme) is defined as a static JSON file versioned in `infra/map-style/` and hosted on the same R2/CDN. No Mapbox Style dependency remains.

### Removing Kenya Hardcoding

Three locations in the current codebase hardcode Kenya/Nairobi assumptions. All are removed in Phase 1:

| File | Hardcoding | Fix |
|---|---|---|
| `MapCanvas.tsx` | Default centre `(-1.2921, 36.8219)`, zoom 11 | Restore last known viewport from `localStorage`; fallback to GPS (with consent); final fallback to world centre `(0, 20)`, zoom 2 |
| `geocodingService.ts` | `country=KE` filter, Nairobi proximity bias | Remove `country` param; pass map centre (not GPS) as proximity hint |
| `MapOverlayHost.tsx` | Implicit Nairobi event radius assumptions | Use actual event coordinates only |

**First-visit location priority:**
1. Stored last viewport (`sentinel_last_viewport` in `localStorage`)
2. Device GPS — requires user consent, not requested automatically
3. IP geolocation — coarse only (city-level), not persisted, optional fallback
4. World centre `(0, 20)` zoom 2

IP-based fallback is coarse-grained and not stored. It is used only for initial viewport centring.

### Service Worker Caching Strategy

Three distinct cache strategies keyed by content type:

**Tile cache (Cache-First, 7-day TTL)**
PMTiles byte-range responses cached by URL + byte-range header. Tiles viewed previously survive network loss. LRU eviction when storage exceeds 150 MB.

**API responses (Network-First, stale fallback)**
`/api/maps/route`, `/api/maps/search`, `/api/maps/reverse` — stale cached response served immediately when network is unavailable; refreshed in background when connectivity resumes. Safety events (`/api/events`) — stale-while-revalidate, 60-second freshness window.

**Map style + fonts (Cache-First, 30-day TTL)**
MapLibre style JSON and font glyphs are small, rarely updated, cached on first load.

**Sensitive data constraint:** Event cache entries and family overlay state are never cached in the service worker or localStorage. Only operational/UI data (viewport, filter preferences, style assets) is persistently cached.

**IndexedDB** stores the last 10 viewed viewport bounding boxes and associated non-sensitive event metadata for graceful reconnect rendering.

**Architectural preparation for Phase 4:** The caching layer is structured so regional PMTiles extracts can be added as an offline bundle without rewriting the service worker or cache strategy logic.

### Map State Ownership

Map viewport, active filters, overlay visibility, and route state are owned entirely by the client-side Redux store. Non-sensitive UI state (viewport, filter selections, style preferences) is persisted in `localStorage`. Sensitive overlay state (active family member positions, event viewing history) is stored in memory only and not persisted. This state is never derived from backend identity state and never transmitted to the server as authentication context.

---

## Section 2: Provider Abstraction Layer

### Core Principle

The frontend never communicates with any map provider directly. All map queries go through SentinelMesh's own gateway. Swapping a provider is an operational change (environment variable + adapter), not a frontend code change.

```
PWA                      Gateway (Rust/Axum)           Provider
───                      ──────────────────            ────────
POST /api/maps/route ──► RouteAdapter (trait) ────────► Mapbox Directions
GET  /api/maps/search ──► GeocodingAdapter    ────────► Mapbox Geocoding
GET  /api/maps/reverse ──► ReverseAdapter      ────────► Mapbox Geocoding

                         (Phase 3 — swap via env var)
                         └──► OSRM / Valhalla
                         └──► Photon / Nominatim
```

### Internal API Contract

These routes are the complete, stable, provider-independent map surface of the SentinelMesh API.

**`POST /api/maps/route`**
```json
Request:
{
  "from": { "lat": number, "lng": number },
  "to":   { "lat": number, "lng": number },
  "mode": "walking" | "driving" | "cycling"
}

Response:
{
  "coordinates": [[lng, lat], ...],
  "distance_m": number,
  "duration_s": number,
  "warnings": string[]
}
```

**`GET /api/maps/search?q={query}&lat={lat}&lng={lng}`**
```json
Response:
[{ "label": string, "lat": number, "lng": number }]
```
`lat`/`lng` are the map centre as a coarse proximity hint — not the user's GPS position.

**`GET /api/maps/reverse?lat={lat}&lng={lng}`**
```json
Response:
{ "label": string }
```

### Adapter Interface (Rust)

```rust
#[async_trait]
pub trait MapProvider: Send + Sync {
    async fn route(&self, req: RouteRequest) -> Result<RouteResponse, MapError>;
    async fn search(&self, query: &str, proximity: Option<LatLng>) -> Result<Vec<SearchResult>, MapError>;
    async fn reverse(&self, point: LatLng) -> Result<String, MapError>;
}
```

Provider selection via environment:
```
MAP_ROUTING_PROVIDER=mapbox     # Phase 1; later: osrm | valhalla
MAP_GEOCODING_PROVIDER=mapbox   # Phase 1; later: photon | nominatim
```

**Phase 1 adapters:**

| Impl | Routing | Geocoding |
|---|---|---|
| `MapboxAdapter` | Mapbox Directions v5 | Mapbox Geocoding v5 |

**Phase 3 adapters:**

| Impl | Routing | Geocoding |
|---|---|---|
| `OsrmPhotonAdapter` | OSRM HTTP API | Photon API |

### Response Normalisation

The internal `RouteResponse`, `SearchResult`, and `ReverseResult` structs are the single source of truth. Adapters are responsible for translating provider-specific field names, units, and coordinate ordering into the normalised struct. The frontend never sees provider response shapes. Provider migration is operational, not architectural.

The gateway validates all adapter output against the internal schema before returning to the frontend, preventing provider drift bugs from reaching clients silently.

### Privacy Constraints Inside the Gateway

**Identity stripped from map requests:** The `/api/maps/*` handlers authenticate the request for rate limiting and access control, then discard identity before the provider call. Authentication is not forwarded downstream.

**No sensitive payload logging:** Query content, coordinates, place names, and user identity are never written to logs. Allowed operational metrics: provider name, response latency, HTTP status, cache hit/miss, request byte size.

**Server-side query cache:** Frequent queries cached in Redis with a 5-minute TTL. Cache key: `sha256(provider + normalised_query + coarse_context)` where `coarse_context` includes rounded proximity (2–5 km grid) and transport mode for routing. No user identifier in the cache key.

**Proximity hint is map centre, rounded:** The frontend sends the visible map centre as proximity bias, not GPS coordinates. The gateway rounds this to a 2–5 km grid before forwarding, preventing precision leakage.

**Mapbox token never leaves the gateway:** `MAPBOX_TOKEN` is read only by the adapter. The PWA holds no token.

### Transport Modes

Phase 1 exposes `walking`, `driving`, `cycling`. The `MapboxAdapter` maps these to Mapbox profile strings. The `OsrmPhotonAdapter` maps them to OSRM profiles. Adapters must gracefully degrade unsupported modes (e.g., cycling availability varies by region) to a closest equivalent or return a structured error — never a silent failure.

### Provider Failure Strategy

For a safety application, routing failure has real consequences. Each route/geocode request follows a fallback chain:

1. **Primary provider** — normal path
2. **Cached response** — serve stale result if available and within acceptable TTL
3. **Degraded mode** — return partial result (e.g., straight-line distance estimate) with `degraded: true` flag
4. **Structured error** — return error with actionable message for UX fallback display

### Per-Provider Rate Limiting

The gateway tracks per-provider quota consumption. Configurable thresholds trigger alerts before hard limits are reached. Per-region throttling is a Phase 3 addition when traffic patterns are understood.

### Rollback Safety

Each phase must be independently reversible without breaking API contracts. Provider adapters can be switched back via environment variable. Frontend changes in each phase are isolated to defined modules.

---

## Section 3: Realtime Overlay Architecture

### Subscription Model

One WebSocket connection per client per gateway shard. Gateways are stateless — subscription state lives in the WS handler's memory for the connection lifetime only. Horizontal scaling uses load-balanced shards; sticky sessions only where the underlying transport requires it.

```
Client                          Gateway WS Handler
──────                          ──────────────────
connect  ─────────────────────► authenticate (Nostr token)
                                use for rate limit + access control only
                                do not propagate identity downstream

subscribe({
  bounds: {n, s, e, w},        ► PostGIS bounding box query
  zoom: number,                ► determines cluster resolution
  filters: string[]            ► event type filter
}) ──────────────────────────►

                               ◄─ initial_batch([events | clusters])
                               ◄─ event_state_change({id, state, ...})
                               ◄─ cluster_update({cell, count, dominant_severity})

viewport_changed({bounds,...}) ► debounced re-query (300 ms)
                               ◄─ diff_patch({added, removed, updated})
                               (snapshot_request → full batch on demand)

disconnect ────────────────────► subscription state discarded immediately
```

**Anti-abuse persistence:** No subscription history is stored. Ephemeral rate-limit counters and abuse-prevention metrics are the only server-side state that outlives the connection.

### Spatial Indexing

Events stored in Postgres with a `geography(Point)` column. `GIST` index on geography enables fast bounding box intersection globally. Viewport query:

```sql
SELECT id, event_type, severity, lat, lng, title, started_at
FROM safety_events
WHERE is_active = true
  AND event_type = ANY($filters)
  AND geog && ST_MakeEnvelope($west, $south, $east, $north, 4326)::geography
ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END ASC
LIMIT $dynamic_limit;
```

`LIMIT` is dynamic based on viewport area and zoom level, not a hardcoded 500. Dense low-zoom viewports receive cluster summaries only; fine high-zoom viewports receive paginated individual events.

For high-density regions at low zoom, a **materialised H3 aggregation view** (resolution 5, refreshed every 30 seconds) serves cluster queries instead of running `ST_Within` on raw events. This prevents full-table spatial scans in disaster scenarios.

### Clustering Strategy

**Server-side (zoom ≤ 10):** Gateway queries the H3 materialised view, returns `{ cell_id, count, dominant_severity, centroid_lat, centroid_lng }` cluster objects. Client receives cluster summaries only.

**Client-side (zoom > 10):** Individual events sent; MapLibre GeoJSON source `cluster: true` handles visual grouping.

**Rule:** Server clustering is authoritative for low zoom. Client clustering is visual refinement only and must never be used to reconstruct raw event data or infer counts beyond what the server sent.

### Overlay Types and Realtime Behaviour

| Overlay | Channel | Privacy model | Retention |
|---|---|---|---|
| Safety events | Viewport WS subscription | No identity attached | Memory-only; discarded on disconnect |
| Family member locations | Encrypted permissioned channel | E2EE X25519; gateway sees ciphertext only | Ephemeral; last position only |
| Escape routes | On-demand request/response | Route not logged | Not stored |
| Acoustic detections | Short-lived broadcast (30s TTL) | Anonymous source | EXPIRED after TTL |
| Proximity alerts | Client-side computation only | Never sent to server | Local memory only |

**Family location key handling:** Encryption keys are never stored in persistent backend logs or caches. Key exchange is identity-bound but never location-bound.

### Event Lifecycle Model

```
REPORTED → (validation) → ACTIVE → UPDATED → RESOLVED → EXPIRED
```

| State | Meaning | Client behaviour |
|---|---|---|
| `REPORTED` | Submitted, pending validation | Not shown |
| `ACTIVE` | Validated, ongoing | Rendered with severity colour |
| `UPDATED` | Content mutated, still active | In-place update, no flicker |
| `RESOLVED` | Explicitly marked safe/over | Fade out, remove |
| `EXPIRED` | TTL elapsed without confirmation | Auto-remove, no server query |

Acoustic detections have a 30-second hard TTL: `ACTIVE → EXPIRED`. Standard safety events require explicit `RESOLVED` action. The `diff_patch` message carries `[{id, state, ...}]`; clients that miss patches request a full snapshot.

### Debounce and Backpressure

- Viewport move events debounced at 300 ms per connection
- Per-client event rate cap: configurable max events/patches per second
- `low_bandwidth: true` subscribe flag: server returns cluster summaries only regardless of zoom, reducing payload ~80% in dense regions
- In extreme-density scenarios (mass casualty events), server switches affected viewports to snapshot-only mode and disables incremental diffs

### Privacy Note on Viewport Inference

The server receives viewport bounding boxes, not GPS coordinates. However, coarse location inference from viewport bounds remains possible. Mitigations in place: debouncing reduces movement resolution; spatial aggregation prevents individual-event correlation; no viewport history is persisted server-side. The system reduces but does not eliminate inference-based privacy risks from timing, density, and viewport pattern analysis.

---

## Section 4: Privacy Architecture Summary + Migration Phasing

### What the Architecture Structurally Prevents

| Capability | Status | Mechanism |
|---|---|---|
| Tile provider sees user viewport | Structurally prevented | PMTiles/R2 CDN; no auth token; no user context in requests |
| Routing provider sees user identity | Structurally prevented | Gateway strips identity before provider call |
| Geocoding provider logs search history | Structurally prevented | No persistent query logging; cache keyed by content hash |
| Server sees plaintext family locations | Structurally prevented | E2EE X25519; gateway receives ciphertext only |
| Proximity alerts reveal GPS to server | Structurally prevented | Computed client-side only; never transmitted |
| Viewport history builds user profile | Structurally prevented | Subscription state discarded on disconnect; no persistence |
| Sensitive overlay state persists | Structurally prevented | Memory-only; not in localStorage or service worker cache |
| Provider swap requires frontend changes | Structurally prevented | Normalised internal API contract; adapters swap via env var |

**Residual risks:** Systems evolve, bugs occur, misconfigurations happen. "Structurally prevented" describes the current architecture — not an absolute guarantee. Inference-based risks (timing, density, viewport patterns) are reduced by debouncing, batching, and aggregation but are not fully eliminated.

### System Invariants (Non-Negotiables)

These invariants define SentinelMesh's architectural constitution. Any design that violates one is a regression requiring explicit approval:

1. **Frontend never communicates directly with external map providers.** All map queries go through the SentinelMesh gateway.
2. **No persistent storage of sensitive location data server-side.** Route queries, geocoding queries, viewport subscriptions, and precise coordinates are not written to the database.
3. **All map APIs normalised through the gateway abstraction.** Provider-specific response shapes never reach the frontend.
4. **All realtime event overlays are viewport-bounded.** The server never receives continuous precise GPS as a subscription primitive.
5. **All E2EE data (family locations) is never decrypted server-side.** The gateway is a ciphertext relay for circle location sharing.
6. **Encryption keys for E2EE are never stored in server-side caches or logs.**
7. **Each migration phase is independently reversible without breaking API contracts.**

### Migration Phases

**Phase 1 — Rendering + Tiles + Global Coverage + Provider Abstraction** *(ships first)*

Deliverables:
- MapLibre GL JS replaces Mapbox GL (rendering layer and supporting config modules)
- Self-hosted map style in `infra/map-style/`; hosted on Cloudflare R2
- PMTiles planet (or regional extract) generated via Planetiler, uploaded to R2
- `VITE_MAPBOX_TOKEN` removed from PWA entirely
- `country=KE`, Nairobi default centre, and all Kenya-specific assumptions removed
- First-visit viewport logic: last stored → GPS consent → coarse IP → world centre
- `/api/maps/route`, `/api/maps/search`, `/api/maps/reverse` added to gateway
- `MapProvider` trait + `MapboxAdapter` (routing: Mapbox Directions; geocoding: Mapbox Geocoding)
- Response normalisation contract enforced at gateway boundary
- Transport modes: `walking`, `driving`, `cycling`
- Provider failure chain: primary → cache → degraded → error
- Service worker: tile cache (7d), API stale-while-revalidate (60s), style/font cache (30d)
- Sensitive overlay state moved to memory-only

Privacy wins: tiles never touch Mapbox; Mapbox token never in browser; no geographic lock-in.

---

**Phase 2 — Realtime Overlay Optimisation** *(after Phase 1 stable)*

Deliverables:
- Viewport-bounded WebSocket subscriptions
- PostGIS GIST index on `safety_events.geog`
- H3 materialised aggregation view (res 5, 30s refresh) for zoom ≤ 10
- Event lifecycle model (`REPORTED/ACTIVE/UPDATED/RESOLVED/EXPIRED`) in DB and WS protocol
- `diff_patch` incremental updates; snapshot-on-demand for missed patches
- Backpressure: per-client rate limits, `low_bandwidth` mode, dynamic payload caps
- Per-provider quota tracking and alerting

Privacy wins: server receives only viewport bounds, not GPS; no viewport history persisted.

---

**Phase 3 — Full Provider Independence** *(after Phase 2 stable)*

Deliverables:
- OSRM deployed (Docker service, OSM planet data)
- Photon deployed (geocoding)
- `OsrmPhotonAdapter` implemented and tested
- `MAP_ROUTING_PROVIDER=osrm`, `MAP_GEOCODING_PROVIDER=photon`
- Mapbox Directions and Geocoding APIs fully removed from request path

Privacy wins: no routing or geocoding queries leave SentinelMesh infrastructure. (Tile CDN and OSM data downloads remain as expected external dependencies.)

---

**Phase 4 — Offline Resilience + Advanced Privacy** *(demand-driven)*

Deliverables:
- Regional PMTiles extract bundling for high-risk areas
- Offline route previews for cached regions
- Encrypted IndexedDB for sensitive state requiring persistence
- Optional peer-to-peer emergency mesh (zero-connectivity scenarios)

---

## Open Questions for Implementation Planning

1. **PMTiles scope for Phase 1:** Full planet extract or named regional extract first? (Affects Planetiler run time and R2 storage cost.)
2. **MapLibre style source:** Adapt an existing open-source dark style (e.g., OSM Liberty, Protomaps Dark) or author SentinelMesh's own from scratch?
3. **OSRM data coverage in Phase 3:** Full planet routing graph or regional first?
4. **H3 resolution tuning:** Resolution 5 assumed for Phase 2 clustering; validate against actual event density in target regions before schema migration.
