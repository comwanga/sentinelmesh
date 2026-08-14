# Managed Map Provider Conformance

This runbook is the release gate for the managed OpenStreetMap provider chosen
in `docs/adr/002-managed-osm-provider.md`. Record evidence in the deployment
change request; do not add API keys, account identifiers, or commercial terms
to this repository.

## Required Account Checks

- [ ] Commercial use is approved for SentinelMesh.
- [ ] Gateway proxying for geocoding and routing is approved in writing.
- [ ] Temporary geocoding cache behavior and TTL are approved in writing.
- [ ] Production domains are registered for tile domain authentication.
- [ ] Monthly credits and hard-limit behavior are acceptable at projected load.
- [ ] Data-processing region, retention, subprocessors, and support path are
      documented internally.
- [ ] Required Stadia Maps, OpenMapTiles, and OpenStreetMap attribution is
      approved by product design and remains visible at mobile widths.

## Credential Boundary

| Credential | Location | Rule |
|---|---|---|
| Tile domain registration | Provider account | No browser API key |
| `STADIA_API_KEY` | Gateway secret store | Never use a `VITE_` prefix or query parameter |
| Provider account access | Password manager | Operations access only |

The gateway must send the API key with `Authorization: Stadia-Auth <key>`. It
must not forward cookies, NIP-98 events, public keys, request IDs containing
identity, or client authorization headers.

## Pre-Production Conformance

Run these checks against a non-production account through the gateway, not from
the PWA directly.

### Tiles and Style

- [ ] TileJSON and vector PBF requests succeed from every production hostname.
- [ ] The style uses the OpenMapTiles schema without missing-source errors.
- [ ] Roads, buildings, addresses, and selected POIs render in at least one
      dense and one rural location on each inhabited continent.
- [ ] Glyphs and sprites load without browser credentials or mixed content.
- [ ] Attribution is visible and keyboard accessible.
- [ ] Provider responses allow the bounded service-worker caching configured by
      SentinelMesh and that caching complies with the account agreement.

### Search

- [ ] Two-character autocomplete is rejected or throttled by SentinelMesh as
      configured; ordinary requests begin after the product debounce threshold.
- [ ] Addresses, named roads, buildings, settlements, and POIs normalize to the
      provider-independent result contract.
- [ ] Search works with and without a coarsened focus point.
- [ ] An incomplete focus pair is rejected before the provider call.
- [ ] Diacritics and non-Latin queries survive round trips unchanged.
- [ ] Empty, oversized, and malformed queries return structured client errors.
- [ ] Provider 401, 403, 429, 5xx, malformed JSON, and timeout responses map to
      stable SentinelMesh error codes without leaking provider bodies.

### Reverse Search

- [ ] Valid global coordinates return a normalized label or an empty result.
- [ ] Non-finite and out-of-range coordinates are rejected locally.
- [ ] A no-result response is distinct from provider unavailability.

### Routing

- [ ] Walking maps to Valhalla `pedestrian` costing.
- [ ] Cycling maps to Valhalla `bicycle` costing.
- [ ] Driving maps to Valhalla `auto` costing.
- [ ] Geometry is normalized to `[longitude, latitude]` pairs.
- [ ] Distance is normalized to meters and duration to seconds.
- [ ] No-route, distance-limit, invalid-point, 429, 5xx, malformed JSON, and
      timeout responses produce stable SentinelMesh results.
- [ ] Exact endpoints are absent from URLs, logs, metrics, Redis, Postgres, and
      service-worker caches.
- [ ] Unsupported modes are rejected; they are never silently substituted.

## Privacy Inspection

With temporary debug logging enabled only in a controlled environment, verify
the outbound request boundary and then disable it:

- [ ] No SentinelMesh authorization header reaches the provider.
- [ ] No Nostr pubkey, event, cookie, device identifier, or user agent copied
      from the browser reaches the provider.
- [ ] Operational logs contain only endpoint class, provider, status, latency,
      response size, and cache outcome.
- [ ] Metrics labels cannot contain query text, place names, coordinates, or
      route geometry.
- [ ] Search cache keys are one-way hashes over normalized inputs and have the
      approved TTL.

## Performance Gate

Measure from the production region with representative global requests:

| Operation | Target |
|---|---|
| Search cache hit | p95 <= 150 ms |
| Provider autocomplete/search | p95 <= 800 ms |
| Route preview | p95 <= 1.5 s |
| Provider timeout | <= 3 s total gateway budget |

The gateway must enforce lower per-client request rates than the provider quota
and expose quota warnings before the account hard limit is reached.

## Rollback

If conformance or the production gate fails:

1. Disable managed search and routing through configuration.
2. Keep the base incident map available.
3. Return `PROVIDER_UNAVAILABLE` from `/api/maps/*`; do not enable direct browser
   fallbacks.
4. Preserve the normalized contracts and replace only the gateway adapter and
   tile source after a new ADR.
