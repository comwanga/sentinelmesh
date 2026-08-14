# ADR-002: Use Stadia Maps as the Managed OSM Provider

**Status:** Accepted with production gate  
**Date:** 2026-08-14

## Context

SentinelMesh currently combines OpenFreeMap vector tiles with optional Mapbox
geocoding and routing. This creates inconsistent coverage, two operational
dependencies, and a slow fallback path when Mapbox is not configured. The map
plan requires one managed, global, OpenStreetMap-oriented provider for vector
tiles, search, reverse geocoding, and walking, cycling, and driving routes.

The browser may request public vector map assets directly because a tile host
necessarily observes viewport tile requests. Search and routing remain behind
the SentinelMesh gateway so provider credentials are not public and user
identity is never forwarded. Precise route requests must not be written to
logs, databases, or persistent caches.

## Decision

Use Stadia Maps as the managed map provider, subject to the production gate
below.

The selected provider capabilities are:

| Capability | Stadia Maps interface | SentinelMesh use |
|---|---|---|
| Vector tiles | OpenMapTiles-compatible MVT TileJSON | MapLibre rendering with a SentinelMesh-owned style |
| Autocomplete | `GET /geocoding/v2/autocomplete` | Debounced map search |
| Forward search | `GET /geocoding/v2/search` | Submitted address, road, place, and POI search |
| Reverse search | `GET /geocoding/v2/reverse` | Optional coordinate labeling |
| Routing | `POST /route/v1` | Valhalla `pedestrian`, `bicycle`, and `auto` costing |

Browser tile requests use registered-domain authentication. No tile API key is
embedded in the PWA. Search and routing use `STADIA_API_KEY` only in the
gateway through an `Authorization: Stadia-Auth ...` header. Production may use
the provider's EU endpoints when the account and coverage review confirms that
choice.

The gateway exposes only provider-independent `/api/maps/*` contracts. No
Stadia response shape, GID, costing name, error body, or credential is part of
the public PWA contract.

## Production Gate

Stadia Maps documentation states that proxying and bulk downloading or caching
are prohibited except in approved cases. Before sending production search or
routing traffic through the gateway, SentinelMesh operations must obtain
written confirmation or an enterprise agreement covering:

1. Gateway proxying of geocoding and routing requests.
2. Temporary hashed caching of geocoding results, if enabled.
3. Expected request volume, rate limits, and hard-limit behavior.
4. Commercial use and required attribution.
5. Data processing region, retention, subprocessors, and incident terms.
6. Availability target and support escalation path.

Until this gate is recorded as complete in the map provider runbook, production
configuration must leave the managed map APIs disabled. The existing map
remains available, and the gateway returns a structured provider-unavailable
response rather than silently sending traffic to Mapbox or a public OSRM or
Nominatim endpoint.

## Invariants

1. Search and routing provider credentials never enter a PWA build.
2. The gateway never forwards SentinelMesh identity or authentication headers.
3. The PWA has no direct geocoding or routing provider fallback.
4. Query text, labels, and coordinates are excluded from application logs and
   analytics.
5. Exact route endpoints are not persisted in Redis, Postgres, service-worker
   caches, or browser history.
6. Search proximity uses a coarsened map center, never an implicit GPS fix.
7. Stadia and OpenStreetMap/OpenMapTiles attribution remains visible on every
   map.
8. Provider failure produces a bounded timeout and structured error; it never
   silently changes travel mode or vendor.

## Consequences

- A single vendor supplies consistent global tile, search, and route data.
- MapLibre and the SentinelMesh-owned style preserve renderer and visual-design
  independence.
- The provider sees browser tile requests and gateway-originated map API
  traffic. It does not receive SentinelMesh identity, but timing and location
  inference remain residual risks.
- Domain-authenticated tiles simplify browser credential handling, but every
  production hostname must be registered before deployment.
- Production activation now depends on a commercial and privacy review. If the
  gate fails, the normalized gateway contract allows another managed provider
  to replace Stadia without changing the PWA.

## Alternatives Considered

### OpenFreeMap plus separate API vendors

This minimizes tile migration but retains multiple vendors, inconsistent
coverage, separate quotas, and more failure modes.

### Mapbox search and routing

This preserves existing code but does not meet the selected single OSM-provider
direction and leaves a separate dependency behind the OSM-derived base map.

### Global self-hosting

Planet-scale tiles, Photon, and Valhalla or OSRM provide the strongest control
but exceed the current operations capacity and delay the user-facing map work.

## References

- Vector tiles: https://docs.stadiamaps.com/vector/
- Geocoding overview: https://docs.stadiamaps.com/geocoding-search-autocomplete/overview/
- Autocomplete: https://docs.stadiamaps.com/geocoding-search-autocomplete/autocomplete/
- Routing: https://docs.stadiamaps.com/routing/standard-routing/
- Attribution: https://docs.stadiamaps.com/attribution/
- Limits and proxying notice: https://docs.stadiamaps.com/limits/
- Conformance runbook: `docs/operations/map-provider-conformance.md`
