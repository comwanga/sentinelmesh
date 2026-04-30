# Safe Route Recommendations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a proximity alert fires, immediately show the user 2–3 routes that exit the threat zone, displayed as overlaid polylines on the existing Mapbox map.

**Architecture:** When `ProximityAlert` receives a proximity alert from the WebSocket, it calls a new `routingService` that computes escape waypoints (points 2km from the user in directions away from the threat), requests routes from the Mapbox Directions API, filters out any route whose geometry passes within the event's radius, and returns up to 3 safe route objects. A new `SafeRouteOverlay` Mapbox layer renders these routes as colour-coded polylines. All computation is client-side; no new backend endpoints are needed.

**Tech Stack:** Mapbox Directions REST API (`@mapbox/mapbox-sdk`), `@rnmapbox/maps` (existing), Redux Toolkit (existing), existing `ProximityAlert` component

---

## Prerequisites

```bash
cd sentinel-mobile
npm install @mapbox/mapbox-sdk
```

Add to `.env`:
```
MAPBOX_ACCESS_TOKEN=pk.your_token_here
```

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `sentinel-mobile/src/utils/geo.ts` | Create | Bearing calculation, destination point offset, point-to-segment distance |
| `sentinel-mobile/src/services/routingService.ts` | Create | Escape waypoint generation, Mapbox Directions calls, route safety filter |
| `sentinel-mobile/src/components/SafeRouteOverlay.tsx` | Create | Mapbox `ShapeSource` + `LineLayer` for route polylines |
| `sentinel-mobile/src/components/ProximityAlert.tsx` | Modify | Trigger route fetch on mount, pass routes to overlay |
| `sentinel-mobile/src/screens/MapScreen.tsx` | Modify | Mount `SafeRouteOverlay` |
| `sentinel-mobile/__tests__/geo.test.ts` | Create | Unit tests for geo math |
| `sentinel-mobile/__tests__/routingService.test.ts` | Create | Unit tests for waypoint generation and route filtering |
| `sentinel-mobile/__tests__/SafeRouteOverlay.test.tsx` | Create | Render tests for the overlay component |

---

## Task 1: Geo utility functions

**Files:**
- Create: `sentinel-mobile/src/utils/geo.ts`
- Test: `sentinel-mobile/__tests__/geo.test.ts`

Three functions needed:
1. `bearingBetween(from, to)` — compass bearing from one coordinate to another
2. `destinationPoint(origin, distanceKm, bearingDeg)` — point that is N km away in a given direction
3. `pointToLineDistance(point, lineCoords)` — minimum distance from a point to a GeoJSON LineString

- [ ] **Step 1: Write the failing test**

```typescript
// sentinel-mobile/__tests__/geo.test.ts
import { bearingBetween, destinationPoint, pointToLineDistance } from '../src/utils/geo';

type Coord = { lat: number; lng: number };

describe('bearingBetween', () => {
  test('north: bearing is 0', () => {
    // Moving north from Nairobi CBD
    const bearing = bearingBetween({ lat: -1.2921, lng: 36.8219 }, { lat: -1.2000, lng: 36.8219 });
    expect(bearing).toBeCloseTo(0, 0);
  });

  test('east: bearing is approximately 90', () => {
    const bearing = bearingBetween({ lat: -1.2921, lng: 36.8219 }, { lat: -1.2921, lng: 37.0000 });
    expect(bearing).toBeCloseTo(90, 0);
  });

  test('south: bearing is approximately 180', () => {
    const bearing = bearingBetween({ lat: -1.2921, lng: 36.8219 }, { lat: -1.4000, lng: 36.8219 });
    expect(bearing).toBeCloseTo(180, 0);
  });
});

describe('destinationPoint', () => {
  test('moving 1km north returns point approximately 0.009 degrees latitude north', () => {
    const origin: Coord = { lat: -1.2921, lng: 36.8219 };
    const dest = destinationPoint(origin, 1, 0);
    expect(dest.lat).toBeGreaterThan(origin.lat);
    expect(dest.lat - origin.lat).toBeCloseTo(0.009, 2);
    expect(dest.lng).toBeCloseTo(origin.lng, 3);
  });

  test('moving 2km east returns point with same latitude and greater longitude', () => {
    const origin: Coord = { lat: -1.2921, lng: 36.8219 };
    const dest = destinationPoint(origin, 2, 90);
    expect(dest.lat).toBeCloseTo(origin.lat, 2);
    expect(dest.lng).toBeGreaterThan(origin.lng);
  });
});

describe('pointToLineDistance', () => {
  test('returns 0 when point is on the line', () => {
    const line: [number, number][] = [[36.82, -1.29], [36.84, -1.29]];
    const dist = pointToLineDistance({ lat: -1.29, lng: 36.83 }, line);
    expect(dist).toBeCloseTo(0, 1);
  });

  test('returns positive distance when point is off the line', () => {
    const line: [number, number][] = [[36.82, -1.29], [36.84, -1.29]];
    const dist = pointToLineDistance({ lat: -1.30, lng: 36.83 }, line);
    expect(dist).toBeGreaterThan(0);
  });

  test('distance is in km', () => {
    // Point 1km north of a horizontal line
    const line: [number, number][] = [[36.82, -1.30], [36.84, -1.30]];
    const dist = pointToLineDistance({ lat: -1.291, lng: 36.83 }, line);
    expect(dist).toBeCloseTo(1.0, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd sentinel-mobile && npx jest __tests__/geo.test.ts --no-coverage
```
Expected: FAIL — `Cannot find module '../src/utils/geo'`

- [ ] **Step 3: Implement geo utilities**

```typescript
// sentinel-mobile/src/utils/geo.ts

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const EARTH_RADIUS_KM = 6371;

interface LatLng { lat: number; lng: number; }

/** Compass bearing in degrees (0 = north, 90 = east) from `from` to `to`. */
export function bearingBetween(from: LatLng, to: LatLng): number {
  const lat1 = from.lat * DEG_TO_RAD;
  const lat2 = to.lat * DEG_TO_RAD;
  const dLng = (to.lng - from.lng) * DEG_TO_RAD;

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * RAD_TO_DEG) + 360) % 360;
}

/** Returns the coordinate that is `distanceKm` away from `origin` in direction `bearingDeg`. */
export function destinationPoint(origin: LatLng, distanceKm: number, bearingDeg: number): LatLng {
  const d = distanceKm / EARTH_RADIUS_KM;
  const bearing = bearingDeg * DEG_TO_RAD;
  const lat1 = origin.lat * DEG_TO_RAD;
  const lng1 = origin.lng * DEG_TO_RAD;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) +
    Math.cos(lat1) * Math.sin(d) * Math.cos(bearing),
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
  );

  return { lat: lat2 * RAD_TO_DEG, lng: lng2 * RAD_TO_DEG };
}

/** Minimum distance in km from `point` to any segment of `lineCoords` (GeoJSON [lng, lat] pairs). */
export function pointToLineDistance(point: LatLng, lineCoords: [number, number][]): number {
  let minDist = Infinity;

  for (let i = 0; i < lineCoords.length - 1; i++) {
    const a: LatLng = { lat: lineCoords[i][1],   lng: lineCoords[i][0] };
    const b: LatLng = { lat: lineCoords[i+1][1], lng: lineCoords[i+1][0] };
    minDist = Math.min(minDist, pointToSegmentDistance(point, a, b));
  }

  return minDist;
}

function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat +
    Math.cos(a.lat * DEG_TO_RAD) * Math.cos(b.lat * DEG_TO_RAD) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

function pointToSegmentDistance(p: LatLng, a: LatLng, b: LatLng): number {
  const ab = haversineKm(a, b);
  if (ab === 0) return haversineKm(p, a);

  // Project p onto segment ab, clamped to [0, 1]
  const t = Math.max(0, Math.min(1,
    ((p.lat - a.lat) * (b.lat - a.lat) + (p.lng - a.lng) * (b.lng - a.lng)) /
    ((b.lat - a.lat) ** 2 + (b.lng - a.lng) ** 2),
  ));

  const closest: LatLng = { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) };
  return haversineKm(p, closest);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd sentinel-mobile && npx jest __tests__/geo.test.ts --no-coverage
```
Expected: PASS — 8 tests passing

- [ ] **Step 5: Commit**

```bash
git add sentinel-mobile/src/utils/geo.ts sentinel-mobile/__tests__/geo.test.ts
git commit -m "feat: add geo utility functions for bearing, destination point, and line distance"
```

---

## Task 2: Routing service

**Files:**
- Create: `sentinel-mobile/src/services/routingService.ts`
- Test: `sentinel-mobile/__tests__/routingService.test.ts`

Generates 3 escape waypoints (in directions away from the event), fetches routes from Mapbox Directions, and filters out routes that pass through the event zone.

- [ ] **Step 1: Write the failing test**

```typescript
// sentinel-mobile/__tests__/routingService.test.ts
jest.mock('@mapbox/mapbox-sdk/services/directions', () => {
  return jest.fn(() => ({
    getDirections: jest.fn(() => ({
      send: jest.fn().mockResolvedValue({
        body: {
          routes: [{
            geometry: {
              type: 'LineString',
              // Route going north — safely away from event placed to the south
              coordinates: [[36.8219, -1.2921], [36.8219, -1.2800], [36.8219, -1.2600]],
            },
            distance: 3200,
            duration: 800,
          }],
        },
      }),
    })),
  }));
});

import { fetchSafeRoutes, SafeRoute } from '../src/services/routingService';

const userLocation  = { lat: -1.2921, lng: 36.8219 };
const eventLocation = { lat: -1.3200, lng: 36.8219 }; // 3km south of user
const eventRadiusKm = 0.5;

describe('fetchSafeRoutes', () => {
  test('returns an array of SafeRoute objects', async () => {
    const routes = await fetchSafeRoutes(userLocation, eventLocation, eventRadiusKm);
    expect(Array.isArray(routes)).toBe(true);
    routes.forEach((r: SafeRoute) => {
      expect(r).toHaveProperty('coordinates');
      expect(r).toHaveProperty('distanceKm');
      expect(r).toHaveProperty('durationMin');
      expect(r).toHaveProperty('label');
    });
  });

  test('returns at most 3 routes', async () => {
    const routes = await fetchSafeRoutes(userLocation, eventLocation, eventRadiusKm);
    expect(routes.length).toBeLessThanOrEqual(3);
  });

  test('filters routes that pass through event zone', async () => {
    const Directions = require('@mapbox/mapbox-sdk/services/directions');
    Directions.mockImplementationOnce(() => ({
      getDirections: jest.fn(() => ({
        send: jest.fn().mockResolvedValue({
          body: {
            routes: [{
              geometry: {
                type: 'LineString',
                // Route passes directly through the event location
                coordinates: [[36.8219, -1.2921], [36.8219, -1.3200], [36.8219, -1.3500]],
              },
              distance: 3000,
              duration: 750,
            }],
          },
        }),
      })),
    }));

    const routes = await fetchSafeRoutes(userLocation, eventLocation, eventRadiusKm);
    // The route through the event zone should be filtered out
    expect(routes.length).toBe(0);
  });

  test('does not throw when Mapbox API call fails', async () => {
    const Directions = require('@mapbox/mapbox-sdk/services/directions');
    Directions.mockImplementationOnce(() => ({
      getDirections: jest.fn(() => ({
        send: jest.fn().mockRejectedValue(new Error('API error')),
      })),
    }));

    await expect(fetchSafeRoutes(userLocation, eventLocation, eventRadiusKm)).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd sentinel-mobile && npx jest __tests__/routingService.test.ts --no-coverage
```
Expected: FAIL — `Cannot find module '../src/services/routingService'`

- [ ] **Step 3: Implement routingService**

```typescript
// sentinel-mobile/src/services/routingService.ts
import MapboxDirections from '@mapbox/mapbox-sdk/services/directions';
import { bearingBetween, destinationPoint, pointToLineDistance } from '../utils/geo';

const MAPBOX_TOKEN = process.env.MAPBOX_ACCESS_TOKEN ?? '';
const directionsClient = MapboxDirections({ accessToken: MAPBOX_TOKEN });

const ESCAPE_DISTANCE_KM = 2.0;
const SAFETY_BUFFER_KM   = 0.2; // extra clearance beyond event radius

export interface SafeRoute {
  coordinates: [number, number][];  // GeoJSON [lng, lat] pairs
  distanceKm: number;
  durationMin: number;
  label: string;                    // e.g. "Route 1 — 2.1 km"
}

interface LatLng { lat: number; lng: number; }

/**
 * Returns up to 3 routes from `userLocation` that avoid `eventLocation` ± `eventRadiusKm`.
 * Falls back to an empty array on API failure.
 */
export async function fetchSafeRoutes(
  userLocation: LatLng,
  eventLocation: LatLng,
  eventRadiusKm: number,
): Promise<SafeRoute[]> {
  // Compute the bearing FROM event TO user — this is the "safe" direction
  const safeBearing = bearingBetween(eventLocation, userLocation);

  // Three waypoints: safe direction ± 45° to give the user route choices
  const bearings = [safeBearing, (safeBearing + 45) % 360, (safeBearing - 45 + 360) % 360];
  const waypoints = bearings.map((b) => destinationPoint(userLocation, ESCAPE_DISTANCE_KM, b));

  const exclusionRadiusKm = eventRadiusKm + SAFETY_BUFFER_KM;
  const safeRoutes: SafeRoute[] = [];

  for (let i = 0; i < waypoints.length; i++) {
    const waypoint = waypoints[i];
    try {
      const response = await directionsClient.getDirections({
        profile: 'walking',
        geometries: 'geojson',
        overview: 'full',
        waypoints: [
          { coordinates: [userLocation.lng, userLocation.lat] },
          { coordinates: [waypoint.lng, waypoint.lat] },
        ],
      }).send();

      const route = response.body.routes?.[0];
      if (!route) continue;

      const coords: [number, number][] = route.geometry.coordinates;

      // Reject route if any coordinate is within the exclusion zone
      const passesThrough = coords.some(
        ([lng, lat]) =>
          pointToLineDistance({ lat, lng }, [[eventLocation.lng, eventLocation.lat], [eventLocation.lng, eventLocation.lat]]) < exclusionRadiusKm
      );
      if (passesThrough) continue;

      safeRoutes.push({
        coordinates: coords,
        distanceKm: Math.round(route.distance / 100) / 10,
        durationMin: Math.round(route.duration / 60),
        label: `Route ${safeRoutes.length + 1} — ${Math.round(route.distance / 100) / 10} km`,
      });
    } catch {
      // Partial failure is acceptable — continue to next waypoint
    }
  }

  return safeRoutes.slice(0, 3);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd sentinel-mobile && npx jest __tests__/routingService.test.ts --no-coverage
```
Expected: PASS — 4 tests passing

- [ ] **Step 5: Commit**

```bash
git add sentinel-mobile/src/services/routingService.ts \
        sentinel-mobile/__tests__/routingService.test.ts
git commit -m "feat: add routing service that fetches Mapbox escape routes avoiding event zones"
```

---

## Task 3: SafeRouteOverlay Mapbox component

**Files:**
- Create: `sentinel-mobile/src/components/SafeRouteOverlay.tsx`
- Test: `sentinel-mobile/__tests__/SafeRouteOverlay.test.tsx`

Renders route polylines on the Mapbox map. Each route gets a distinct colour (green for preferred, yellow for alternatives). Uses `@rnmapbox/maps` `ShapeSource` and `LineLayer`.

- [ ] **Step 1: Write the failing test**

```typescript
// sentinel-mobile/__tests__/SafeRouteOverlay.test.tsx
import React from 'react';
import { render } from '@testing-library/react-native';
import { SafeRouteOverlay } from '../src/components/SafeRouteOverlay';
import { SafeRoute } from '../src/services/routingService';

jest.mock('@rnmapbox/maps', () => ({
  ShapeSource: ({ children }: any) => children,
  LineLayer:   () => null,
}));

const mockRoutes: SafeRoute[] = [
  { coordinates: [[36.82, -1.29], [36.83, -1.28]], distanceKm: 1.4, durationMin: 18, label: 'Route 1 — 1.4 km' },
  { coordinates: [[36.82, -1.29], [36.84, -1.30]], distanceKm: 1.9, durationMin: 24, label: 'Route 2 — 1.9 km' },
];

describe('SafeRouteOverlay', () => {
  test('renders without throwing when given routes', () => {
    expect(() => render(<SafeRouteOverlay routes={mockRoutes} />)).not.toThrow();
  });

  test('renders nothing when routes array is empty', () => {
    const { toJSON } = render(<SafeRouteOverlay routes={[]} />);
    expect(toJSON()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd sentinel-mobile && npx jest __tests__/SafeRouteOverlay.test.tsx --no-coverage
```
Expected: FAIL — `Cannot find module '../src/components/SafeRouteOverlay'`

- [ ] **Step 3: Implement SafeRouteOverlay**

```tsx
// sentinel-mobile/src/components/SafeRouteOverlay.tsx
import React from 'react';
import MapboxGL from '@rnmapbox/maps';
import { SafeRoute } from '../services/routingService';

// First route is green (safest direction), alternatives are yellow
const ROUTE_COLOURS = ['#00C853', '#FFD600', '#FF6D00'];

interface Props {
  routes: SafeRoute[];
}

export function SafeRouteOverlay({ routes }: Props) {
  if (routes.length === 0) return null;

  return (
    <>
      {routes.map((route, index) => {
        const geojson: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: route.coordinates },
            properties: { label: route.label },
          }],
        };

        return (
          <MapboxGL.ShapeSource key={`safe-route-${index}`} id={`safe-route-${index}`} shape={geojson}>
            <MapboxGL.LineLayer
              id={`safe-route-line-${index}`}
              style={{
                lineColor:  ROUTE_COLOURS[index] ?? '#00C853',
                lineWidth:  4,
                lineOpacity: 0.85,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </MapboxGL.ShapeSource>
        );
      })}
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd sentinel-mobile && npx jest __tests__/SafeRouteOverlay.test.tsx --no-coverage
```
Expected: PASS — 2 tests passing

- [ ] **Step 5: Commit**

```bash
git add sentinel-mobile/src/components/SafeRouteOverlay.tsx \
        sentinel-mobile/__tests__/SafeRouteOverlay.test.tsx
git commit -m "feat: add SafeRouteOverlay Mapbox component for escape route polylines"
```

---

## Task 4: Wire routes into ProximityAlert and MapScreen

**Files:**
- Modify: `sentinel-mobile/src/components/ProximityAlert.tsx`
- Modify: `sentinel-mobile/src/screens/MapScreen.tsx`

When a `PROXIMITY_ALERT` WebSocket event arrives, fetch escape routes and store them in local component state. Pass them to `SafeRouteOverlay` via Redux or lifted state in `MapScreen`.

- [ ] **Step 1: Add route state to ProximityAlert.tsx**

Find `sentinel-mobile/src/components/ProximityAlert.tsx`. Add these imports at the top:
```typescript
import { useState, useEffect } from 'react';
import { fetchSafeRoutes, SafeRoute } from '../services/routingService';
```

- [ ] **Step 2: Add route-fetching effect inside ProximityAlert**

Inside the ProximityAlert component, add after the existing hooks:
```typescript
const [escapeRoutes, setEscapeRoutes] = useState<SafeRoute[]>([]);

useEffect(() => {
  if (!alert || !userLocation) return;

  setEscapeRoutes([]); // clear previous routes immediately

  fetchSafeRoutes(
    userLocation,
    { lat: alert.event_lat, lng: alert.event_lng },
    (alert.event_radius_meters ?? 500) / 1000,
  ).then(setEscapeRoutes);
}, [alert?.event_id]);
```

Note: `alert.event_lat`, `alert.event_lng`, and `alert.event_radius_meters` must be present in the `PROXIMITY_ALERT` WebSocket payload. Verify in `backend/src/proximity/proximityEngine.js` that the emitted payload includes these fields; if not, add them.

- [ ] **Step 3: Pass routes up to MapScreen via a callback prop**

Add an `onRoutesReady` prop to `ProximityAlert`:
```typescript
// In ProximityAlert's Props interface:
onRoutesReady?: (routes: SafeRoute[]) => void;

// In the useEffect above, after setEscapeRoutes(routes):
fetchSafeRoutes(...).then((routes) => {
  setEscapeRoutes(routes);
  onRoutesReady?.(routes);
});
```

- [ ] **Step 4: Add SafeRouteOverlay to MapScreen.tsx**

In `sentinel-mobile/src/screens/MapScreen.tsx`, add:
```typescript
import { useState } from 'react';
import { SafeRouteOverlay } from '../components/SafeRouteOverlay';
import { SafeRoute } from '../services/routingService';
```

Inside MapScreen component body:
```typescript
const [escapeRoutes, setEscapeRoutes] = useState<SafeRoute[]>([]);
```

In MapScreen's JSX, inside the MapView component, add:
```tsx
<SafeRouteOverlay routes={escapeRoutes} />
```

And pass `onRoutesReady` to ProximityAlert:
```tsx
<ProximityAlert
  alert={currentProximityAlert}
  onRoutesReady={setEscapeRoutes}
  // existing props unchanged
/>
```

When the alert is dismissed, clear routes:
```typescript
// In the alert dismiss handler:
setEscapeRoutes([]);
```

- [ ] **Step 5: Run all routing tests together**

```bash
cd sentinel-mobile && npx jest \
  __tests__/geo.test.ts \
  __tests__/routingService.test.ts \
  __tests__/SafeRouteOverlay.test.tsx \
  --no-coverage
```
Expected: All tests PASS (14+ assertions)

- [ ] **Step 6: Commit**

```bash
git add sentinel-mobile/src/components/ProximityAlert.tsx \
        sentinel-mobile/src/screens/MapScreen.tsx
git commit -m "feat: fetch and display escape routes when proximity alert fires"
```

---

## Self-Review

**Spec coverage:**
- [x] Routes generated when proximity alert fires — Task 4
- [x] Routes avoid event radius — `fetchSafeRoutes` filter in Task 2
- [x] 2–3 routes displayed — `slice(0, 3)` in routingService
- [x] Distinct colours per route — `ROUTE_COLOURS` array in SafeRouteOverlay
- [x] Routes cleared when alert dismissed — Task 4 dismiss handler
- [x] No new backend endpoints — all computation is client-side
- [x] Graceful fallback when Mapbox API fails — returns empty array, no crash

**Placeholder scan:** None found.

**Type consistency:** `SafeRoute` defined in `routingService.ts`, imported by `SafeRouteOverlay` and `ProximityAlert`. `LatLng` interface defined locally in `routingService.ts` (not exported — only used internally). Geo utility `LatLng` in `geo.ts` is identical; if refactoring later, extract to a shared types file.
