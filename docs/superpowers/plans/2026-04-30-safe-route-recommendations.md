# Safe Route Recommendations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a proximity alert fires, immediately show the user 2–3 routes that exit the threat zone, displayed as colour-coded polylines on the existing react-map-gl map.

**Architecture:** A new `routingService` computes escape waypoints (points 2 km from the user in directions away from the threat), fetches routes from the Mapbox Directions REST API via `fetch`, filters out any route whose geometry passes within the event's radius, and returns up to 3 `SafeRoute` objects. A new `SafeRouteOverlay` component renders these as `react-map-gl` `Source`+`Layer` polylines inside the existing `SafetyMap`. All computation is client-side; no new backend endpoints are needed.

**Tech Stack:** Mapbox Directions REST API (direct `fetch`), `react-map-gl` `Source`+`Layer` (existing dependency), Vitest + `@testing-library/react` (existing), TypeScript

---

## Prerequisites

```bash
cd apps/pwa
npm install
```

No new packages needed — react-map-gl is already installed, and we call the Mapbox Directions API via native `fetch`.

Add to `apps/pwa/.env.local` (if not already present):
```
VITE_MAPBOX_TOKEN=pk.your_token_here
```

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/pwa/src/utils/geo.ts` | Create | Bearing calculation, destination point offset, point-to-segment distance |
| `apps/pwa/src/utils/geo.test.ts` | Create | Unit tests for geo math |
| `apps/pwa/src/services/routingService.ts` | Create | Escape waypoint generation, Mapbox Directions fetch, route safety filter |
| `apps/pwa/src/services/routingService.test.ts` | Create | Unit tests for waypoint generation and route filtering |
| `apps/pwa/src/components/SafeRouteOverlay.tsx` | Create | `react-map-gl` `Source`+`Layer` for route polylines |
| `apps/pwa/src/components/SafeRouteOverlay.test.tsx` | Create | Render tests for the overlay component |
| `apps/pwa/src/components/SafetyMap.tsx` | Modify | Add `proximityAlert` prop, trigger route fetch, mount `SafeRouteOverlay` |

---

## Task 1: Geo utility functions

**Files:**
- Create: `apps/pwa/src/utils/geo.ts`
- Create: `apps/pwa/src/utils/geo.test.ts`

Three functions needed:
1. `bearingBetween(from, to)` — compass bearing from one coordinate to another
2. `destinationPoint(origin, distanceKm, bearingDeg)` — point that is N km away in a given direction
3. `pointToLineDistance(point, lineCoords)` — minimum distance from a point to a GeoJSON LineString

- [ ] **Step 1: Write the failing test**

```typescript
// apps/pwa/src/utils/geo.test.ts
import { describe, test, expect } from 'vitest'
import { bearingBetween, destinationPoint, pointToLineDistance } from './geo'

type Coord = { lat: number; lng: number }

describe('bearingBetween', () => {
  test('north: bearing is 0', () => {
    const bearing = bearingBetween({ lat: -1.2921, lng: 36.8219 }, { lat: -1.2000, lng: 36.8219 })
    expect(bearing).toBeCloseTo(0, 0)
  })

  test('east: bearing is approximately 90', () => {
    const bearing = bearingBetween({ lat: -1.2921, lng: 36.8219 }, { lat: -1.2921, lng: 37.0000 })
    expect(bearing).toBeCloseTo(90, 0)
  })

  test('south: bearing is approximately 180', () => {
    const bearing = bearingBetween({ lat: -1.2921, lng: 36.8219 }, { lat: -1.4000, lng: 36.8219 })
    expect(bearing).toBeCloseTo(180, 0)
  })
})

describe('destinationPoint', () => {
  test('moving 1km north returns point approximately 0.009 degrees latitude north', () => {
    const origin: Coord = { lat: -1.2921, lng: 36.8219 }
    const dest = destinationPoint(origin, 1, 0)
    expect(dest.lat).toBeGreaterThan(origin.lat)
    expect(dest.lat - origin.lat).toBeCloseTo(0.009, 2)
    expect(dest.lng).toBeCloseTo(origin.lng, 3)
  })

  test('moving 2km east returns point with same latitude and greater longitude', () => {
    const origin: Coord = { lat: -1.2921, lng: 36.8219 }
    const dest = destinationPoint(origin, 2, 90)
    expect(dest.lat).toBeCloseTo(origin.lat, 2)
    expect(dest.lng).toBeGreaterThan(origin.lng)
  })
})

describe('pointToLineDistance', () => {
  test('returns 0 when point is on the line', () => {
    const line: [number, number][] = [[36.82, -1.29], [36.84, -1.29]]
    const dist = pointToLineDistance({ lat: -1.29, lng: 36.83 }, line)
    expect(dist).toBeCloseTo(0, 1)
  })

  test('returns positive distance when point is off the line', () => {
    const line: [number, number][] = [[36.82, -1.29], [36.84, -1.29]]
    const dist = pointToLineDistance({ lat: -1.30, lng: 36.83 }, line)
    expect(dist).toBeGreaterThan(0)
  })

  test('distance is in km', () => {
    const line: [number, number][] = [[36.82, -1.30], [36.84, -1.30]]
    const dist = pointToLineDistance({ lat: -1.291, lng: 36.83 }, line)
    expect(dist).toBeCloseTo(1.0, 0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/pwa && npx vitest run src/utils/geo.test.ts
```
Expected: FAIL — `Cannot find module './geo'`

- [ ] **Step 3: Implement geo utilities**

```typescript
// apps/pwa/src/utils/geo.ts

const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI
const EARTH_RADIUS_KM = 6371

export interface LatLng { lat: number; lng: number }

/** Compass bearing in degrees (0 = north, 90 = east) from `from` to `to`. */
export function bearingBetween(from: LatLng, to: LatLng): number {
  const lat1 = from.lat * DEG_TO_RAD
  const lat2 = to.lat * DEG_TO_RAD
  const dLng = (to.lng - from.lng) * DEG_TO_RAD

  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return ((Math.atan2(y, x) * RAD_TO_DEG) + 360) % 360
}

/** Returns the coordinate that is `distanceKm` away from `origin` in direction `bearingDeg`. */
export function destinationPoint(origin: LatLng, distanceKm: number, bearingDeg: number): LatLng {
  const d = distanceKm / EARTH_RADIUS_KM
  const bearing = bearingDeg * DEG_TO_RAD
  const lat1 = origin.lat * DEG_TO_RAD
  const lng1 = origin.lng * DEG_TO_RAD

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) +
    Math.cos(lat1) * Math.sin(d) * Math.cos(bearing),
  )
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
  )

  return { lat: lat2 * RAD_TO_DEG, lng: lng2 * RAD_TO_DEG }
}

/** Minimum distance in km from `point` to any segment of `lineCoords` (GeoJSON [lng, lat] pairs). */
export function pointToLineDistance(point: LatLng, lineCoords: [number, number][]): number {
  let minDist = Infinity

  for (let i = 0; i < lineCoords.length - 1; i++) {
    const a: LatLng = { lat: lineCoords[i][1],     lng: lineCoords[i][0] }
    const b: LatLng = { lat: lineCoords[i + 1][1], lng: lineCoords[i + 1][0] }
    minDist = Math.min(minDist, pointToSegmentDistance(point, a, b))
  }

  return minDist
}

function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * DEG_TO_RAD
  const dLng = (b.lng - a.lng) * DEG_TO_RAD
  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)
  const h = sinDLat * sinDLat +
    Math.cos(a.lat * DEG_TO_RAD) * Math.cos(b.lat * DEG_TO_RAD) * sinDLng * sinDLng
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

function pointToSegmentDistance(p: LatLng, a: LatLng, b: LatLng): number {
  const ab = haversineKm(a, b)
  if (ab === 0) return haversineKm(p, a)

  const t = Math.max(0, Math.min(1,
    ((p.lat - a.lat) * (b.lat - a.lat) + (p.lng - a.lng) * (b.lng - a.lng)) /
    ((b.lat - a.lat) ** 2 + (b.lng - a.lng) ** 2),
  ))

  const closest: LatLng = { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) }
  return haversineKm(p, closest)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/pwa && npx vitest run src/utils/geo.test.ts
```
Expected: PASS — 8 tests passing

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/utils/geo.ts apps/pwa/src/utils/geo.test.ts
git commit -m "feat: add geo utility functions for bearing, destination point, and line distance"
```

---

## Task 2: Routing service

**Files:**
- Create: `apps/pwa/src/services/routingService.ts`
- Create: `apps/pwa/src/services/routingService.test.ts`

Generates 3 escape waypoints (in directions away from the event), fetches routes from the Mapbox Directions REST API, and filters out routes that pass through the event zone. The Mapbox token is accepted as a parameter so the function is testable without `import.meta.env`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/pwa/src/services/routingService.test.ts
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { fetchSafeRoutes } from './routingService'

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

beforeEach(() => {
  mockFetch.mockReset()
})

function mockDirectionsResponse(coordinates: [number, number][], distance = 3200, duration = 800) {
  return {
    ok: true,
    json: async () => ({
      routes: [{ geometry: { type: 'LineString', coordinates }, distance, duration }],
    }),
  }
}

const userLocation  = { lat: -1.2921, lng: 36.8219 }
const eventLocation = { lat: -1.3200, lng: 36.8219 } // 3km south of user
const eventRadiusKm = 0.5
const token = 'pk.test'

// Route going north — safely away from event placed to the south
const safeCoords: [number, number][] = [[36.8219, -1.2921], [36.8219, -1.2800], [36.8219, -1.2600]]
// Route passing directly through the event location
const unsafeCoords: [number, number][] = [[36.8219, -1.2921], [36.8219, -1.3200], [36.8219, -1.3500]]

describe('fetchSafeRoutes', () => {
  test('returns an array of SafeRoute objects', async () => {
    mockFetch.mockResolvedValue(mockDirectionsResponse(safeCoords))
    const routes = await fetchSafeRoutes(userLocation, eventLocation, eventRadiusKm, token)
    expect(Array.isArray(routes)).toBe(true)
    routes.forEach((r) => {
      expect(r).toHaveProperty('coordinates')
      expect(r).toHaveProperty('distanceKm')
      expect(r).toHaveProperty('durationMin')
      expect(r).toHaveProperty('label')
    })
  })

  test('returns at most 3 routes', async () => {
    mockFetch.mockResolvedValue(mockDirectionsResponse(safeCoords))
    const routes = await fetchSafeRoutes(userLocation, eventLocation, eventRadiusKm, token)
    expect(routes.length).toBeLessThanOrEqual(3)
  })

  test('filters routes that pass through event zone', async () => {
    mockFetch.mockResolvedValue(mockDirectionsResponse(unsafeCoords))
    const routes = await fetchSafeRoutes(userLocation, eventLocation, eventRadiusKm, token)
    expect(routes.length).toBe(0)
  })

  test('resolves to empty array when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('network error'))
    const routes = await fetchSafeRoutes(userLocation, eventLocation, eventRadiusKm, token)
    expect(routes).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/pwa && npx vitest run src/services/routingService.test.ts
```
Expected: FAIL — `Cannot find module './routingService'`

- [ ] **Step 3: Implement routingService**

```typescript
// apps/pwa/src/services/routingService.ts
import { bearingBetween, destinationPoint, pointToLineDistance, LatLng } from '../utils/geo'

const DIRECTIONS_BASE = 'https://api.mapbox.com/directions/v5/mapbox/walking'
const ESCAPE_DISTANCE_KM = 2.0
const SAFETY_BUFFER_KM = 0.2

export interface SafeRoute {
  coordinates: [number, number][]  // GeoJSON [lng, lat] pairs
  distanceKm: number
  durationMin: number
  label: string
}

/**
 * Returns up to 3 walking routes from `userLocation` that avoid `eventLocation` ± `eventRadiusKm`.
 * Falls back to an empty array on any API failure.
 * `mapboxToken` must be the caller's Mapbox public access token.
 */
export async function fetchSafeRoutes(
  userLocation: LatLng,
  eventLocation: LatLng,
  eventRadiusKm: number,
  mapboxToken: string,
): Promise<SafeRoute[]> {
  const safeBearing = bearingBetween(eventLocation, userLocation)
  const bearings = [safeBearing, (safeBearing + 45) % 360, (safeBearing - 45 + 360) % 360]
  const waypoints = bearings.map((b) => destinationPoint(userLocation, ESCAPE_DISTANCE_KM, b))

  const exclusionRadiusKm = eventRadiusKm + SAFETY_BUFFER_KM
  const safeRoutes: SafeRoute[] = []

  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i]
    try {
      const url =
        `${DIRECTIONS_BASE}/${userLocation.lng},${userLocation.lat};${wp.lng},${wp.lat}` +
        `?access_token=${mapboxToken}&geometries=geojson&overview=full`
      const res = await fetch(url)
      if (!res.ok) continue

      const data = await res.json() as { routes?: { geometry: { coordinates: [number, number][] }; distance: number; duration: number }[] }
      const route = data.routes?.[0]
      if (!route) continue

      const coords = route.geometry.coordinates
      const passesThrough = coords.some(
        ([lng, lat]) => pointToLineDistance(
          { lat, lng },
          [[eventLocation.lng, eventLocation.lat], [eventLocation.lng, eventLocation.lat]],
        ) < exclusionRadiusKm,
      )
      if (passesThrough) continue

      safeRoutes.push({
        coordinates: coords,
        distanceKm: Math.round(route.distance / 100) / 10,
        durationMin: Math.round(route.duration / 60),
        label: `Route ${safeRoutes.length + 1} — ${Math.round(route.distance / 100) / 10} km`,
      })
    } catch {
      // Partial failure is acceptable — continue to next waypoint
    }
  }

  return safeRoutes.slice(0, 3)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/pwa && npx vitest run src/services/routingService.test.ts
```
Expected: PASS — 4 tests passing

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/services/routingService.ts \
        apps/pwa/src/services/routingService.test.ts
git commit -m "feat: add routing service that fetches Mapbox escape routes avoiding event zones"
```

---

## Task 3: SafeRouteOverlay react-map-gl component

**Files:**
- Create: `apps/pwa/src/components/SafeRouteOverlay.tsx`
- Create: `apps/pwa/src/components/SafeRouteOverlay.test.tsx`

Renders route polylines using react-map-gl `Source` and `Layer`. Each route gets a distinct colour (green for preferred, yellow for alternatives). Must be rendered as a child of the react-map-gl `Map` component.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/pwa/src/components/SafeRouteOverlay.test.tsx
import { vi, describe, test, expect } from 'vitest'
import React from 'react'
import { render } from '@testing-library/react'
import { SafeRouteOverlay } from './SafeRouteOverlay'
import type { SafeRoute } from '../services/routingService'

vi.mock('react-map-gl', () => ({
  Source: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Layer: () => null,
}))

const mockRoutes: SafeRoute[] = [
  { coordinates: [[36.82, -1.29], [36.83, -1.28]], distanceKm: 1.4, durationMin: 18, label: 'Route 1 — 1.4 km' },
  { coordinates: [[36.82, -1.29], [36.84, -1.30]], distanceKm: 1.9, durationMin: 24, label: 'Route 2 — 1.9 km' },
]

describe('SafeRouteOverlay', () => {
  test('renders without throwing when given routes', () => {
    expect(() => render(<SafeRouteOverlay routes={mockRoutes} />)).not.toThrow()
  })

  test('renders nothing when routes array is empty', () => {
    const { container } = render(<SafeRouteOverlay routes={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/pwa && npx vitest run src/components/SafeRouteOverlay.test.tsx
```
Expected: FAIL — `Cannot find module './SafeRouteOverlay'`

- [ ] **Step 3: Implement SafeRouteOverlay**

```tsx
// apps/pwa/src/components/SafeRouteOverlay.tsx
import React from 'react'
import { Source, Layer } from 'react-map-gl'
import type { SafeRoute } from '../services/routingService'

// First route is green (safest direction), alternatives are yellow then orange
const ROUTE_COLOURS = ['#00C853', '#FFD600', '#FF6D00']

interface Props {
  routes: SafeRoute[]
}

export function SafeRouteOverlay({ routes }: Props) {
  if (routes.length === 0) return null

  return (
    <>
      {routes.map((route, index) => (
        <Source
          key={`safe-route-${index}`}
          id={`safe-route-${index}`}
          type="geojson"
          data={{
            type: 'Feature' as const,
            geometry: { type: 'LineString' as const, coordinates: route.coordinates },
            properties: { label: route.label },
          }}
        >
          <Layer
            id={`safe-route-line-${index}`}
            type="line"
            paint={{
              'line-color': ROUTE_COLOURS[index] ?? '#00C853',
              'line-width': 4,
              'line-opacity': 0.85,
            }}
            layout={{
              'line-cap': 'round',
              'line-join': 'round',
            }}
          />
        </Source>
      ))}
    </>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/pwa && npx vitest run src/components/SafeRouteOverlay.test.tsx
```
Expected: PASS — 2 tests passing

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/components/SafeRouteOverlay.tsx \
        apps/pwa/src/components/SafeRouteOverlay.test.tsx
git commit -m "feat: add SafeRouteOverlay react-map-gl component for escape route polylines"
```

---

## Task 4: Wire routes into SafetyMap

**Files:**
- Modify: `apps/pwa/src/components/SafetyMap.tsx`

Add a `proximityAlert` prop to `SafetyMap`. When the prop changes to a non-null alert, fetch escape routes and store them in local state. Render `SafeRouteOverlay` inside the existing `Map`. Clear routes when the alert is dismissed (prop becomes null).

- [ ] **Step 1: Read the current SafetyMap.tsx**

Read `apps/pwa/src/components/SafetyMap.tsx` in full to understand the existing imports, props interface, and JSX structure before making changes.

- [ ] **Step 2: Add imports**

At the top of `SafetyMap.tsx`, add after the existing react-map-gl import:
```typescript
import { useState, useEffect } from 'react'
import { fetchSafeRoutes, SafeRoute } from '../services/routingService'
import { SafeRouteOverlay } from './SafeRouteOverlay'
```

- [ ] **Step 3: Add ProximityAlert type and update the Props interface**

Add this type near the top of the file (before the Props interface):
```typescript
interface ProximityAlert {
  event_id: string
  event_lat: number
  event_lng: number
  event_radius_meters: number
}
```

Add `proximityAlert` to the existing Props interface:
```typescript
proximityAlert?: ProximityAlert | null
```

- [ ] **Step 4: Add escape route state and fetch effect**

Inside the `SafetyMap` component body, add after the existing hooks:
```typescript
const [escapeRoutes, setEscapeRoutes] = useState<SafeRoute[]>([])
const mapboxToken = import.meta.env['VITE_MAPBOX_TOKEN'] as string ?? ''

useEffect(() => {
  if (!proximityAlert || !userLocation) {
    setEscapeRoutes([])
    return
  }

  setEscapeRoutes([])

  fetchSafeRoutes(
    userLocation,
    { lat: proximityAlert.event_lat, lng: proximityAlert.event_lng },
    (proximityAlert.event_radius_meters ?? 500) / 1000,
    mapboxToken,
  ).then(setEscapeRoutes)
}, [proximityAlert?.event_id])
```

Note: `userLocation` should already exist in SafetyMap as state (the user's current location). If the component uses a different variable name, use that name instead.

- [ ] **Step 5: Mount SafeRouteOverlay inside the Map JSX**

Inside the `<Map>` component's children, add `SafeRouteOverlay` after the existing layers/markers:
```tsx
<SafeRouteOverlay routes={escapeRoutes} />
```

- [ ] **Step 6: Run the full PWA test suite**

```bash
cd apps/pwa && npx vitest run
```
Expected: All tests PASS (geo + routingService + SafeRouteOverlay + existing tests)

- [ ] **Step 7: Commit**

```bash
git add apps/pwa/src/components/SafetyMap.tsx
git commit -m "feat: fetch and display escape routes in SafetyMap when proximity alert fires"
```

---

## Self-Review

**Spec coverage:**
- [x] Routes generated when proximity alert fires — Task 4 `useEffect`
- [x] Routes avoid event radius — `fetchSafeRoutes` filter in Task 2
- [x] 2–3 routes displayed — `slice(0, 3)` in routingService
- [x] Distinct colours per route — `ROUTE_COLOURS` array in SafeRouteOverlay
- [x] Routes cleared when alert dismissed — `proximityAlert` null check in useEffect
- [x] No new backend endpoints — all computation is client-side
- [x] Graceful fallback when Mapbox API fails — returns empty array, no crash

**Placeholder scan:** None found.

**Type consistency:** `SafeRoute` defined in `routingService.ts`, imported by `SafeRouteOverlay` and `SafetyMap`. `LatLng` exported from `geo.ts` and re-used in `routingService.ts`. `ProximityAlert` interface defined inline in `SafetyMap.tsx` — only used there.
