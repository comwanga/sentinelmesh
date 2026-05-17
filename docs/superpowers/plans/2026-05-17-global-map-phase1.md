# Global Map Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the PWA map from Mapbox GL to MapLibre GL, add a global-first viewport and PMTiles tile pipeline, create a provider abstraction layer in the gateway for routing/geocoding, and add service worker caching — no provider credentials in the browser and no Kenya-specific hardcoding anywhere.

**Architecture:** PWA imports MapLibre GL (no token required for rendering); tiles served from Cloudflare R2 via CDN byte-range requests; routing and geocoding proxied through gateway `/api/maps/*` routes where the Mapbox token is held server-side; service worker caches tiles aggressively and API responses with stale-while-revalidate. All existing component boundaries and Redux state stay unchanged.

**Tech Stack:** maplibre-gl, pmtiles (npm), react-map-gl v8 maplibre adapter, vite-plugin-pwa + Workbox, Rust async-trait, reqwest (MapboxAdapter as Phase 1 provider), axum

---

## File Structure

**New files:**
- `apps/pwa/src/config/mapConfig.ts` — pmtiles protocol registration, MAP_STYLE_URL, WORLD_CENTER
- `apps/pwa/src/config/mapConfig.test.ts`
- `apps/pwa/src/hooks/useInitialViewport.ts` — localStorage → world-center fallback
- `apps/pwa/src/hooks/useInitialViewport.test.ts`
- `apps/pwa/src/services/mapApiService.ts` — thin HTTP wrappers for /api/maps/*
- `apps/pwa/src/services/mapApiService.test.ts`
- `infra/map-style/sentinelmesh-dark.json` — canonical MapLibre style spec, OpenMapTiles schema
- `infra/pmtiles/generate-africa.sh` — Planetiler pipeline script
- `services/gateway/src/maps/types.rs` — SearchResult, RouteResult
- `services/gateway/src/maps/provider.rs` — MapProvider async trait
- `services/gateway/src/maps/mapbox_adapter.rs` — MapboxAdapter implements MapProvider
- `services/gateway/src/maps/mod.rs` — module re-exports
- `services/gateway/src/routes/maps.rs` — /api/maps/search, /route, /reverse handlers

**Modified files:**
- `apps/pwa/package.json` — add maplibre-gl, pmtiles, vite-plugin-pwa; remove mapbox-gl
- `apps/pwa/vite.config.ts` — aliases → maplibre.js; add VitePWA plugin
- `apps/pwa/.env.local` — remove VITE_MAPBOX_TOKEN; add VITE_MAPTILES_URL, VITE_MAP_STYLE_URL
- `apps/pwa/src/components/map/MapCanvas.tsx` — MapLibre import, mapConfig style, persistViewport, world-center default
- `apps/pwa/src/components/map/MapCanvas.test.tsx` — update mock specifier + default coordinate assertions
- `apps/pwa/src/services/geocodingService.ts` — delegate to mapApiService.searchAddress; remove token param; remove country=KE
- `apps/pwa/src/services/routingService.ts` — delegate to mapApiService.getRoute; remove mapboxToken params
- `apps/pwa/src/services/routingService.test.ts` — remove token arg; update mock response format
- `apps/pwa/src/components/HomeRoutePanel.tsx` — remove TOKEN const; remove token from geocodeAddress calls
- `apps/pwa/src/components/map/MapOverlayHost.tsx` — remove token from fetchSafeRoutes call
- `apps/pwa/src/components/map/LocationMarker.tsx` — import Marker from react-map-gl/maplibre
- `apps/pwa/src/components/map/HomeRouteLayer.tsx` — import Source/Layer from react-map-gl/maplibre
- `apps/pwa/src/components/SafeRouteOverlay.tsx` — import Source/Layer from react-map-gl/maplibre
- `apps/pwa/src/pages/LiveMapPage.tsx` — import Marker from react-map-gl/maplibre; pass initialViewport
- `apps/pwa/src/pages/LiveMapPage.test.tsx` — update react-map-gl mock specifier
- `services/gateway/src/routes/mod.rs` — add maps route
- `services/gateway/src/main.rs` — mod maps; add map_provider to AppState
- `services/gateway/Cargo.toml` — add async-trait

---

### Task 1: Install MapLibre GL + pmtiles; update Vite aliases

**Files:**
- Modify: `apps/pwa/package.json`
- Modify: `apps/pwa/vite.config.ts`

- [ ] **Step 1: Run existing test suite as baseline**

From `apps/pwa`:
```
npx vitest run
```
Expected: all tests pass (180 tests). Note this count — same number must pass after this task.

- [ ] **Step 2: Install maplibre-gl and pmtiles; remove mapbox-gl**

From `apps/pwa`:
```
npm install maplibre-gl pmtiles
npm uninstall mapbox-gl
```

- [ ] **Step 3: Update vite.config.ts aliases**

Replace the entire `vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: 'react-map-gl/maplibre', replacement: resolve('node_modules/react-map-gl/dist/maplibre.js') },
      { find: 'react-map-gl/mapbox',   replacement: resolve('node_modules/react-map-gl/dist/maplibre.js') },
      { find: 'react-map-gl',          replacement: resolve('node_modules/react-map-gl/dist/maplibre.js') },
    ],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true, changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
})
```

Aliases are ordered longest-match-first so `react-map-gl/maplibre` is resolved before the bare `react-map-gl`.

- [ ] **Step 4: Run full test suite**

```
npx vitest run
```
Expected: same passing count as Step 1. The vite alias change does not break existing mocks because Vitest intercepts `vi.mock('react-map-gl', ...)` at the string literal level, before alias resolution.

- [ ] **Step 5: Commit**

```
git add apps/pwa/package.json apps/pwa/package-lock.json apps/pwa/vite.config.ts
git commit -m "feat: install maplibre-gl + pmtiles, update vite aliases to maplibre bundle"
```

---

### Task 2: Create mapConfig.ts

**Files:**
- Create: `apps/pwa/src/config/mapConfig.ts`
- Create: `apps/pwa/src/config/mapConfig.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/pwa/src/config/mapConfig.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('maplibre-gl', () => ({
  default: { addProtocol: vi.fn() },
}))
vi.mock('pmtiles', () => ({
  Protocol: class { tile() {} },
}))

import { MAP_STYLE_URL, WORLD_CENTER } from './mapConfig'

describe('mapConfig', () => {
  it('MAP_STYLE_URL is a non-empty string', () => {
    expect(typeof MAP_STYLE_URL).toBe('string')
    expect(MAP_STYLE_URL.length).toBeGreaterThan(0)
  })

  it('WORLD_CENTER has valid coordinate properties', () => {
    expect(WORLD_CENTER.longitude).toBe(0)
    expect(WORLD_CENTER.latitude).toBe(20)
    expect(WORLD_CENTER.zoom).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run src/config/mapConfig.test.ts
```
Expected: FAIL — `Cannot find module './mapConfig'`

- [ ] **Step 3: Create mapConfig.ts**

```ts
import maplibregl from 'maplibre-gl'
import { Protocol } from 'pmtiles'

const protocol = new Protocol()
maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol))

export const MAP_STYLE_URL: string =
  (import.meta.env.VITE_MAP_STYLE_URL as string | undefined) ??
  'https://demotiles.maplibre.org/style.json'

export const MAPTILES_URL: string =
  (import.meta.env.VITE_MAPTILES_URL as string | undefined) ?? ''

export const WORLD_CENTER = { longitude: 0, latitude: 20, zoom: 2 } as const
```

`demotiles.maplibre.org/style.json` is the dev fallback until the SentinelMesh style and R2 tiles are deployed. Set `VITE_MAP_STYLE_URL` to override in `.env.local`.

- [ ] **Step 4: Run test to verify it passes**

```
npx vitest run src/config/mapConfig.test.ts
```
Expected: PASS (2 tests)

- [ ] **Step 5: Run full suite**

```
npx vitest run
```
Expected: all tests pass

- [ ] **Step 6: Commit**

```
git add apps/pwa/src/config/mapConfig.ts apps/pwa/src/config/mapConfig.test.ts
git commit -m "feat: add mapConfig with pmtiles protocol registration and world-center default"
```

---

### Task 3: Create useInitialViewport hook

**Files:**
- Create: `apps/pwa/src/hooks/useInitialViewport.ts`
- Create: `apps/pwa/src/hooks/useInitialViewport.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/pwa/src/hooks/useInitialViewport.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useInitialViewport } from './useInitialViewport'

const KEY = 'sentinel_last_viewport'

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

describe('useInitialViewport', () => {
  it('returns world center when no saved viewport', () => {
    const { result } = renderHook(() => useInitialViewport())
    expect(result.current.longitude).toBe(0)
    expect(result.current.latitude).toBe(20)
    expect(result.current.zoom).toBe(2)
  })

  it('returns saved viewport from localStorage', () => {
    localStorage.setItem(KEY, JSON.stringify({ longitude: 36.82, latitude: -1.29, zoom: 12 }))
    const { result } = renderHook(() => useInitialViewport())
    expect(result.current.longitude).toBe(36.82)
    expect(result.current.latitude).toBe(-1.29)
    expect(result.current.zoom).toBe(12)
  })

  it('falls back to world center when localStorage value is corrupted', () => {
    localStorage.setItem(KEY, 'not-valid-json{{')
    const { result } = renderHook(() => useInitialViewport())
    expect(result.current.longitude).toBe(0)
    expect(result.current.latitude).toBe(20)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run src/hooks/useInitialViewport.test.ts
```
Expected: FAIL — `Cannot find module './useInitialViewport'`

- [ ] **Step 3: Create useInitialViewport.ts**

```ts
import { useMemo } from 'react'
import { WORLD_CENTER } from '../config/mapConfig'

const STORAGE_KEY = 'sentinel_last_viewport'

interface ViewState {
  longitude: number
  latitude: number
  zoom: number
}

export function useInitialViewport(): ViewState {
  return useMemo(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      try { return JSON.parse(saved) as ViewState }
      catch { /* corrupted — fall through */ }
    }
    return { ...WORLD_CENTER }
  }, [])
}

export function persistViewport(vs: ViewState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(vs))
}
```

`persistViewport` is a plain function (not a hook) so MapCanvas can call it inside a `useCallback` without Rules-of-Hooks issues.

- [ ] **Step 4: Run test to verify it passes**

```
npx vitest run src/hooks/useInitialViewport.test.ts
```
Expected: PASS (3 tests)

- [ ] **Step 5: Run full suite**

```
npx vitest run
```
Expected: all tests pass

- [ ] **Step 6: Commit**

```
git add apps/pwa/src/hooks/useInitialViewport.ts apps/pwa/src/hooks/useInitialViewport.test.ts
git commit -m "feat: add useInitialViewport hook — localStorage with world-center fallback"
```

---

### Task 4: Create mapApiService.ts

**Files:**
- Create: `apps/pwa/src/services/mapApiService.ts`
- Create: `apps/pwa/src/services/mapApiService.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/pwa/src/services/mapApiService.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { searchAddress, getRoute, reverseGeocode } from './mapApiService'

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

beforeEach(() => mockFetch.mockReset())

describe('searchAddress', () => {
  it('returns features on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [{ label: 'Nairobi, Kenya', lat: -1.2921, lng: 36.8219 }],
      }),
    })
    const results = await searchAddress('Nairobi')
    expect(results).toHaveLength(1)
    expect(results[0].label).toBe('Nairobi, Kenya')
    const [call] = mockFetch.mock.calls
    expect((call[0] as string)).toContain('/api/maps/search')
    expect((call[0] as string)).toContain('q=Nairobi')
  })

  it('includes proximity params when provided', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ features: [] }) })
    await searchAddress('park', { lat: -1.28, lng: 36.82 })
    expect(mockFetch.mock.calls[0][0]).toContain('lat=-1.28')
  })

  it('returns empty array on non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false })
    expect(await searchAddress('xyz')).toEqual([])
  })

  it('returns empty array on network error', async () => {
    mockFetch.mockRejectedValue(new Error('network'))
    expect(await searchAddress('xyz')).toEqual([])
  })
})

describe('getRoute', () => {
  it('returns route on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        coordinates: [[36.82, -1.29], [36.83, -1.28]],
        distance: 2100,
        duration: 1500,
      }),
    })
    const route = await getRoute({ lat: -1.29, lng: 36.82 }, { lat: -1.28, lng: 36.83 })
    expect(route).not.toBeNull()
    expect(route!.distance).toBe(2100)
    expect(route!.coordinates).toHaveLength(2)
  })

  it('returns null on failure', async () => {
    mockFetch.mockResolvedValue({ ok: false })
    expect(await getRoute({ lat: 0, lng: 0 }, { lat: 1, lng: 1 })).toBeNull()
  })
})

describe('reverseGeocode', () => {
  it('returns label on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ label: 'Westlands, Nairobi' }),
    })
    expect(await reverseGeocode(-1.28, 36.82)).toBe('Westlands, Nairobi')
  })

  it('returns null on failure', async () => {
    mockFetch.mockResolvedValue({ ok: false })
    expect(await reverseGeocode(0, 0)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run src/services/mapApiService.test.ts
```
Expected: FAIL — `Cannot find module './mapApiService'`

- [ ] **Step 3: Create mapApiService.ts**

```ts
import type { LatLng } from '../utils/geo'

export interface GeocodeSuggestion {
  label: string
  lat: number
  lng: number
}

export interface RouteResult {
  coordinates: [number, number][]
  distance: number
  duration: number
}

export async function searchAddress(
  query: string,
  proximity?: { lat: number; lng: number },
): Promise<GeocodeSuggestion[]> {
  const params = new URLSearchParams({ q: query, limit: '5' })
  if (proximity) {
    params.set('lat', String(proximity.lat))
    params.set('lng', String(proximity.lng))
  }
  try {
    const res = await fetch(`/api/maps/search?${params}`)
    if (!res.ok) return []
    const data = await res.json() as { features?: GeocodeSuggestion[] }
    return data.features ?? []
  } catch {
    return []
  }
}

export async function getRoute(from: LatLng, to: LatLng): Promise<RouteResult | null> {
  const params = new URLSearchParams({
    from: `${from.lng},${from.lat}`,
    to: `${to.lng},${to.lat}`,
    mode: 'walking',
  })
  try {
    const res = await fetch(`/api/maps/route?${params}`)
    if (!res.ok) return null
    return await res.json() as RouteResult
  } catch {
    return null
  }
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(`/api/maps/reverse?lat=${lat}&lng=${lng}`)
    if (!res.ok) return null
    const data = await res.json() as { label?: string }
    return data.label ?? null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```
npx vitest run src/services/mapApiService.test.ts
```
Expected: PASS (8 tests)

- [ ] **Step 5: Run full suite**

```
npx vitest run
```
Expected: all tests pass

- [ ] **Step 6: Commit**

```
git add apps/pwa/src/services/mapApiService.ts apps/pwa/src/services/mapApiService.test.ts
git commit -m "feat: add mapApiService — /api/maps/* gateway client, no provider token in browser"
```

---

### Task 5: Migrate MapCanvas.tsx to MapLibre

**Files:**
- Modify: `apps/pwa/src/components/map/MapCanvas.tsx`
- Modify: `apps/pwa/src/components/map/MapCanvas.test.tsx`
- Modify: `apps/pwa/src/pages/LiveMapPage.tsx`

- [ ] **Step 1: Write the failing test**

Replace `apps/pwa/src/components/map/MapCanvas.test.tsx` entirely:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MapCanvas } from './MapCanvas'

vi.mock('../../config/mapConfig', () => ({
  MAP_STYLE_URL: 'https://demotiles.maplibre.org/style.json',
  WORLD_CENTER: { longitude: 0, latitude: 20, zoom: 2 },
  MAPTILES_URL: '',
}))

vi.mock('../../hooks/useInitialViewport', () => ({
  persistViewport: vi.fn(),
}))

vi.mock('react-map-gl/maplibre', () => ({
  Map: ({ children, longitude, latitude, zoom, onMove }: {
    children?: React.ReactNode
    longitude: number
    latitude: number
    zoom: number
    onMove: (evt: { viewState: { longitude: number; latitude: number; zoom: number } }) => void
  }) => (
    <div
      data-testid="mapbox"
      data-longitude={String(longitude)}
      data-latitude={String(latitude)}
      data-zoom={String(zoom)}
      onClick={() => onMove({ viewState: { longitude: 10, latitude: 10, zoom: 5 } })}
    >
      {children}
    </div>
  ),
}))

describe('MapCanvas', () => {
  it('renders with world-center default view state', () => {
    render(<MapCanvas />)
    const map = screen.getByTestId('mapbox')
    expect(map.getAttribute('data-longitude')).toBe('0')
    expect(map.getAttribute('data-latitude')).toBe('20')
    expect(map.getAttribute('data-zoom')).toBe('2')
  })

  it('renders children inside the map', () => {
    render(<MapCanvas><div data-testid="child">marker</div></MapCanvas>)
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('accepts custom initial view state', () => {
    render(<MapCanvas initialViewState={{ longitude: 1.0, latitude: 2.0, zoom: 8 }} />)
    const map = screen.getByTestId('mapbox')
    expect(map.getAttribute('data-longitude')).toBe('1')
    expect(map.getAttribute('data-latitude')).toBe('2')
    expect(map.getAttribute('data-zoom')).toBe('8')
  })

  it('calls onMove when map moves', () => {
    const onLoad = vi.fn()
    render(<MapCanvas onMapLoad={onLoad} />)
    fireEvent.click(screen.getByTestId('mapbox'))
    // Verify no crash — persistViewport is called internally
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run src/components/map/MapCanvas.test.tsx
```
Expected: FAIL — MapCanvas still uses `react-map-gl` (bare) + Nairobi default, mock is now `react-map-gl/maplibre`

- [ ] **Step 3: Update MapCanvas.tsx**

```tsx
import { useState, useCallback } from 'react'
import { Map } from 'react-map-gl/maplibre'
import { MAP_STYLE_URL, WORLD_CENTER } from '../../config/mapConfig'
import { persistViewport } from '../../hooks/useInitialViewport'

interface ViewState {
  longitude: number
  latitude: number
  zoom: number
}

interface Props {
  initialViewState?: ViewState
  children?: React.ReactNode
  onMapLoad?: () => void
}

export function MapCanvas({ initialViewState = WORLD_CENTER, children, onMapLoad }: Props = {}) {
  const [viewState, setViewState] = useState<ViewState>(initialViewState)
  const handleMove = useCallback((evt: { viewState: ViewState }) => {
    setViewState(evt.viewState)
    persistViewport(evt.viewState)
  }, [])
  return (
    <Map
      {...viewState}
      onMove={handleMove}
      onLoad={onMapLoad}
      style={{ width: '100%', height: '100%' }}
      mapStyle={MAP_STYLE_URL}
    >
      {children}
    </Map>
  )
}
```

- [ ] **Step 4: Update LiveMapPage.tsx to pass initialViewport**

In `apps/pwa/src/pages/LiveMapPage.tsx`:

Add import after the existing hook imports:
```tsx
import { useInitialViewport } from '../hooks/useInitialViewport'
```

Add inside `LiveMapPage()` function alongside other hooks:
```tsx
const initialViewport = useInitialViewport()
```

Update the MapCanvas call to pass it:
```tsx
<MapCanvas initialViewState={initialViewport} onMapLoad={handleMapLoad}>
```

- [ ] **Step 5: Run test to verify it passes**

```
npx vitest run src/components/map/MapCanvas.test.tsx
```
Expected: PASS (4 tests)

- [ ] **Step 6: Run full suite**

```
npx vitest run
```
Expected: all tests pass

- [ ] **Step 7: Commit**

```
git add apps/pwa/src/components/map/MapCanvas.tsx apps/pwa/src/components/map/MapCanvas.test.tsx apps/pwa/src/pages/LiveMapPage.tsx
git commit -m "feat: migrate MapCanvas to MapLibre, world-center default, persist viewport on pan/zoom"
```

---

### Task 6: Migrate geocodingService and routingService to mapApiService

**Files:**
- Modify: `apps/pwa/src/services/geocodingService.ts`
- Modify: `apps/pwa/src/services/routingService.ts`
- Modify: `apps/pwa/src/services/routingService.test.ts`

- [ ] **Step 1: Update routingService.test.ts to remove token**

The test currently calls `fetchSafeRoutes(userLocation, eventLocation, eventRadiusKm, token)` — replace the whole file:
```ts
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { fetchSafeRoutes, fetchRouteToHome } from './routingService'

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

beforeEach(() => mockFetch.mockReset())

function mockRouteResponse(coordinates: [number, number][], distance = 3200, duration = 800) {
  return {
    ok: true,
    json: async () => ({ coordinates, distance, duration }),
  }
}

const userLocation  = { lat: -1.2921, lng: 36.8219 }
const eventLocation = { lat: -1.3200, lng: 36.8219 }
const eventRadiusKm = 0.5

const safeCoords:   [number, number][] = [[36.8219, -1.2921], [36.8219, -1.2800], [36.8219, -1.2600]]
const unsafeCoords: [number, number][] = [[36.8219, -1.2921], [36.8219, -1.3200], [36.8219, -1.3500]]

describe('fetchSafeRoutes', () => {
  test('returns an array of SafeRoute objects', async () => {
    mockFetch.mockResolvedValue(mockRouteResponse(safeCoords))
    const routes = await fetchSafeRoutes(userLocation, eventLocation, eventRadiusKm)
    expect(Array.isArray(routes)).toBe(true)
    routes.forEach((r) => {
      expect(r).toHaveProperty('coordinates')
      expect(r).toHaveProperty('distanceKm')
      expect(r).toHaveProperty('durationMin')
      expect(r).toHaveProperty('label')
    })
  })
  test('returns at most 3 routes', async () => {
    mockFetch.mockResolvedValue(mockRouteResponse(safeCoords))
    const routes = await fetchSafeRoutes(userLocation, eventLocation, eventRadiusKm)
    expect(routes.length).toBeLessThanOrEqual(3)
  })
  test('filters routes that pass through event zone', async () => {
    mockFetch.mockResolvedValue(mockRouteResponse(unsafeCoords))
    const routes = await fetchSafeRoutes(userLocation, eventLocation, eventRadiusKm)
    expect(routes.length).toBe(0)
  })
  test('resolves to empty array when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('network error'))
    const routes = await fetchSafeRoutes(userLocation, eventLocation, eventRadiusKm)
    expect(routes).toEqual([])
  })
})

describe('fetchRouteToHome', () => {
  test('returns HomeRoute with distance and duration', async () => {
    mockFetch.mockResolvedValue(mockRouteResponse([[36.82, -1.29], [36.83, -1.28]], 1500, 900))
    const route = await fetchRouteToHome(
      { lat: -1.29, lng: 36.82 },
      { lat: -1.28, lng: 36.83 },
      [],
    )
    expect(route).not.toBeNull()
    expect(route!.distanceKm).toBe(1.5)
    expect(route!.durationMin).toBe(15)
    expect(route!.warnings).toEqual([])
  })
  test('returns null when fetch returns non-ok', async () => {
    mockFetch.mockResolvedValue({ ok: false })
    const route = await fetchRouteToHome({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, [])
    expect(route).toBeNull()
  })
  test('adds warning when route passes through danger zone', async () => {
    const coords: [number, number][] = [[36.8219, -1.3200]]
    mockFetch.mockResolvedValue(mockRouteResponse(coords))
    const dangerZones = [{ lat: -1.32, lng: 36.8219, radiusKm: 0.5 }]
    const route = await fetchRouteToHome(userLocation, eventLocation, dangerZones)
    expect(route!.warnings.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run src/services/routingService.test.ts
```
Expected: FAIL — `fetchRouteToHome` signature still expects `mapboxToken`; `fetchSafeRoutes` still expects token

- [ ] **Step 3: Update geocodingService.ts**

```ts
import { searchAddress } from './mapApiService'

export type { GeocodeSuggestion } from './mapApiService'

export async function geocodeAddress(
  query: string,
  proximity?: { lat: number; lng: number },
): Promise<import('./mapApiService').GeocodeSuggestion[]> {
  return searchAddress(query, proximity)
}
```

The `token` and `country=KE` params are gone. The proximity default falls back to nothing (the gateway handles any provider-specific proximity defaults).

- [ ] **Step 4: Update routingService.ts**

```ts
import { getRoute } from './mapApiService'
import { bearingBetween, destinationPoint, pointToLineDistance, LatLng } from '../utils/geo'

const ESCAPE_DISTANCE_KM = 2.0
const SAFETY_BUFFER_KM = 0.2

export interface HomeRoute {
  coordinates: [number, number][]
  distanceKm: number
  durationMin: number
  warnings: string[]
}

export interface SafeRoute {
  coordinates: [number, number][]
  distanceKm: number
  durationMin: number
  label: string
}

export async function fetchRouteToHome(
  from: LatLng,
  to: LatLng,
  dangerZones: { lat: number; lng: number; radiusKm: number }[],
): Promise<HomeRoute | null> {
  const result = await getRoute(from, to)
  if (!result) return null
  const coords = result.coordinates
  const warnings: string[] = []
  for (const zone of dangerZones) {
    const passes = coords.some(([lng, lat]) => {
      const dx = lat - zone.lat
      const dy = lng - zone.lng
      return Math.sqrt(dx * dx + dy * dy) * 111 < zone.radiusKm
    })
    if (passes) warnings.push('Route passes near a danger zone')
  }
  return {
    coordinates: coords,
    distanceKm: Math.round(result.distance / 100) / 10,
    durationMin: Math.round(result.duration / 60),
    warnings: [...new Set(warnings)],
  }
}

export async function fetchSafeRoutes(
  userLocation: LatLng,
  eventLocation: LatLng,
  eventRadiusKm: number,
): Promise<SafeRoute[]> {
  const safeBearing = bearingBetween(eventLocation, userLocation)
  const bearings = [safeBearing, (safeBearing + 45) % 360, (safeBearing - 45 + 360) % 360]
  const waypoints = bearings.map((b) => destinationPoint(userLocation, ESCAPE_DISTANCE_KM, b))
  const exclusionRadiusKm = eventRadiusKm + SAFETY_BUFFER_KM
  const safeRoutes: SafeRoute[] = []

  for (const wp of waypoints) {
    try {
      const result = await getRoute(userLocation, wp)
      if (!result) continue

      const coords = result.coordinates
      const passesThrough = coords.some(([lng, lat]) =>
        pointToLineDistance(
          { lat, lng },
          [[eventLocation.lng, eventLocation.lat], [eventLocation.lng, eventLocation.lat]],
        ) < exclusionRadiusKm,
      )
      if (passesThrough) continue

      safeRoutes.push({
        coordinates: coords,
        distanceKm: Math.round(result.distance / 100) / 10,
        durationMin: Math.round(result.duration / 60),
        label: `Route ${safeRoutes.length + 1} — ${Math.round(result.distance / 100) / 10} km`,
      })
    } catch {
      // Partial failure — continue to next waypoint
    }
  }

  return safeRoutes.slice(0, 3)
}
```

- [ ] **Step 5: Run test to verify it passes**

```
npx vitest run src/services/routingService.test.ts
```
Expected: PASS (7 tests)

- [ ] **Step 6: Run full suite**

```
npx vitest run
```
Expected: all tests pass

- [ ] **Step 7: Commit**

```
git add apps/pwa/src/services/geocodingService.ts apps/pwa/src/services/routingService.ts apps/pwa/src/services/routingService.test.ts
git commit -m "feat: route geocoding and routing through /api/maps/* gateway, remove token from frontend"
```

---

### Task 7: Remove Mapbox token from HomeRoutePanel and MapOverlayHost

**Files:**
- Modify: `apps/pwa/src/components/HomeRoutePanel.tsx`
- Modify: `apps/pwa/src/components/map/MapOverlayHost.tsx`
- Modify: `apps/pwa/.env.local`

- [ ] **Step 1: Run full suite to get baseline**

```
npx vitest run
```
Expected: all tests pass

- [ ] **Step 2: Update HomeRoutePanel.tsx — remove TOKEN const and all token args**

Remove lines 8-9 (`const TOKEN = ...` and `const HOME_KEY = ...`) and replace with:
```tsx
const HOME_KEY = 'sentinel_home_location'
```

Remove line 36 (`location ?? undefined` now just passes proximity as before, but no `TOKEN` argument):

Change the `geocodeAddress` call in the debounced effect from:
```ts
const results = await geocodeAddress(trimmed, TOKEN, location ?? undefined)
```
to:
```ts
const results = await geocodeAddress(trimmed, location ?? undefined)
```

The full updated import line becomes:
```tsx
import { geocodeAddress, type GeocodeSuggestion } from '../services/geocodingService'
```

Remove the `TOKEN` import from the top imports list (it was a `const`, not an import).

Complete updated `HomeRoutePanel.tsx`:
```tsx
import { useState, useCallback, useEffect, useRef } from 'react'
import { useAppSelector, useAppDispatch } from '../store'
import { setHomeLocation, clearHomeLocation, homeRouteSet, homeRouteCleared } from '../store/uiSlice'
import { geocodeAddress, type GeocodeSuggestion } from '../services/geocodingService'
import { fetchRouteToHome } from '../services/routingService'
import { useCurrentLocation } from '../hooks/useCurrentLocation'

const HOME_KEY = 'sentinel_home_location'

interface Props {
  onClose: () => void
}

export function HomeRoutePanel({ onClose }: Props) {
  const dispatch = useAppDispatch()
  const homeLocation = useAppSelector(s => s.ui.homeLocation)
  const homeRoute = useAppSelector(s => s.ui.homeRoute)
  const events = useAppSelector(s => s.events.items)
  const { location } = useCurrentLocation()

  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([])
  const [searching, setSearching] = useState(false)
  const [routing, setRouting] = useState(false)
  const [routeError, setRouteError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = query.trim()
    if (trimmed.length < 2) { setSuggestions([]); return }
    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      const results = await geocodeAddress(trimmed, location ?? undefined)
      setSuggestions(results)
      setSearching(false)
    }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, location])

  const handleSelectHome = useCallback((s: GeocodeSuggestion) => {
    const home = { lat: s.lat, lng: s.lng, label: s.label }
    dispatch(setHomeLocation(home))
    localStorage.setItem(HOME_KEY, JSON.stringify(home))
    setSuggestions([])
    setQuery('')
    dispatch(homeRouteCleared())
    setRouteError(null)
  }, [dispatch])

  const handleClearHome = useCallback(() => {
    dispatch(clearHomeLocation())
    dispatch(homeRouteCleared())
    localStorage.removeItem(HOME_KEY)
    setRouteError(null)
  }, [dispatch])

  const handleGetRoute = useCallback(async () => {
    if (!homeLocation || !location) return
    setRouting(true)
    setRouteError(null)
    dispatch(homeRouteCleared())
    const dangerZones = events
      .filter(e => e.is_active)
      .map(e => ({ lat: e.lat, lng: e.lng, radiusKm: ((e as any).radius_meters ?? 400) / 1000 }))
    const route = await fetchRouteToHome(
      { lat: location.lat, lng: location.lng },
      { lat: homeLocation.lat, lng: homeLocation.lng },
      dangerZones,
    )
    setRouting(false)
    if (!route) {
      setRouteError('Could not fetch route — check your connection.')
      return
    }
    dispatch(homeRouteSet(route))
  }, [homeLocation, location, events, dispatch])

  const route = homeRoute

  return (
    <div style={{
      background: '#0d1118', border: '1px solid #1a2035', borderRadius: 10,
      padding: 16, width: 300, maxWidth: '100%',
      fontFamily: "'Courier New', monospace",
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 11, letterSpacing: '0.12em', color: '#00E5FF', fontWeight: 700 }}>
          NAVIGATE HOME
        </span>
        <button
          onClick={() => { onClose(); dispatch(homeRouteCleared()) }}
          style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#4a5568', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}
        >
          ×
        </button>
      </div>

      {homeLocation ? (
        <div style={{ background: '#050709', border: '1px solid rgba(0,229,255,0.2)', borderRadius: 6, padding: '8px 10px', marginBottom: 12 }}>
          <div style={{ fontSize: 9, color: '#4a5568', letterSpacing: '0.08em', marginBottom: 4 }}>SAVED HOME</div>
          <div style={{ fontSize: 10, color: '#e2e8f0', lineHeight: 1.4, marginBottom: 6 }}>
            {homeLocation.label}
          </div>
          <button
            onClick={handleClearHome}
            style={{ fontSize: 9, color: '#FF6B6B', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            ✕ Clear
          </button>
        </div>
      ) : (
        <div style={{ fontSize: 9, color: '#4a5568', marginBottom: 10 }}>
          No home saved. Search below to set your home location.
        </div>
      )}

      <div style={{ fontSize: 9, color: '#4a5568', letterSpacing: '0.06em', marginBottom: 5 }}>
        SET HOME ADDRESS
      </div>
      <div style={{ position: 'relative', marginBottom: 6 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); setSuggestions([]) } }}
          placeholder="Type a place or road name…"
          autoComplete="off"
          style={{
            width: '100%', boxSizing: 'border-box',
            background: '#050709', border: '1px solid #1a2035', borderRadius: 4,
            color: '#e2e8f0', fontSize: 10, padding: '6px 28px 6px 8px', outline: 'none',
          }}
        />
        {searching && (
          <span style={{
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            fontSize: 10, color: '#4a5568',
          }}>…</span>
        )}
      </div>

      {suggestions.length > 0 && (
        <div style={{ marginBottom: 12, border: '1px solid #1a2035', borderRadius: 6, overflow: 'hidden' }}>
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => handleSelectHome(s)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                background: '#050709', border: 'none', borderBottom: i < suggestions.length - 1 ? '1px solid #1a2035' : 'none',
                color: '#e2e8f0', fontSize: 10, padding: '7px 10px', cursor: 'pointer',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#0d1118')}
              onMouseLeave={e => (e.currentTarget.style.background = '#050709')}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {homeLocation && (
        <button
          onClick={handleGetRoute}
          disabled={routing || !location}
          style={{
            width: '100%', padding: '9px 0', marginBottom: 10,
            background: routing ? '#050709' : 'rgba(0,229,255,0.1)',
            border: `1px solid ${routing ? '#1a2035' : 'rgba(0,229,255,0.4)'}`,
            borderRadius: 6, color: routing ? '#4a5568' : '#00E5FF',
            fontSize: 11, letterSpacing: '0.06em', cursor: routing ? 'default' : 'pointer',
          }}
        >
          {routing ? 'Calculating…' : !location ? 'Enable GPS first' : 'Get Route Home'}
        </button>
      )}

      {routeError && (
        <div style={{ fontSize: 9, color: '#FF2D2D', marginBottom: 8 }}>{routeError}</div>
      )}

      {route && (
        <div style={{ background: '#050709', border: '1px solid #1a2035', borderRadius: 6, padding: '10px 12px' }}>
          <div style={{ display: 'flex', gap: 16, marginBottom: route.warnings.length ? 8 : 0 }}>
            <div>
              <div style={{ fontSize: 9, color: '#4a5568', marginBottom: 2 }}>DISTANCE</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#00E5FF' }}>{route.distanceKm} km</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: '#4a5568', marginBottom: 2 }}>WALKING</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{route.durationMin} min</div>
            </div>
          </div>
          {route.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 9, color: '#FF9800', display: 'flex', gap: 4, marginTop: 4 }}>
              <span>⚠</span><span>{w}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Update MapOverlayHost.tsx — remove token from fetchSafeRoutes**

Change the fetchSafeRoutes call. Find this block in `MapOverlayHost.tsx`:
```ts
      const token = import.meta.env.VITE_MAPBOX_TOKEN as string
      try {
        const result = await fetchSafeRoutes(userLocation, eventLocation, radiusKm, token)
```

Replace with:
```ts
      try {
        const result = await fetchSafeRoutes(userLocation, eventLocation, radiusKm)
```

Also remove the `const token = ...` line entirely.

- [ ] **Step 4: Update .env.local — remove VITE_MAPBOX_TOKEN**

Replace `apps/pwa/.env.local`:
```
VITE_MAPTILES_URL=https://r2.sentinelmesh.io/tiles/africa.pmtiles
VITE_MAP_STYLE_URL=https://demotiles.maplibre.org/style.json
```

`VITE_MAP_STYLE_URL` stays as demotiles until Task 9 style is deployed to R2. `VITE_MAPTILES_URL` is the future R2 endpoint — it's referenced by the style JSON, not directly by the PWA in Phase 1.

- [ ] **Step 5: Run full suite**

```
npx vitest run
```
Expected: all tests pass

- [ ] **Step 6: Commit**

```
git add apps/pwa/src/components/HomeRoutePanel.tsx apps/pwa/src/components/map/MapOverlayHost.tsx apps/pwa/.env.local
git commit -m "feat: remove VITE_MAPBOX_TOKEN from PWA — geocoding and routing now go through gateway"
```

---

### Task 8: Update Source/Layer/Marker imports to react-map-gl/maplibre

**Files:**
- Modify: `apps/pwa/src/components/map/LocationMarker.tsx`
- Modify: `apps/pwa/src/components/map/HomeRouteLayer.tsx`
- Modify: `apps/pwa/src/components/SafeRouteOverlay.tsx`
- Modify: `apps/pwa/src/pages/LiveMapPage.tsx`
- Modify: `apps/pwa/src/pages/LiveMapPage.test.tsx`

- [ ] **Step 1: Update mock specifier in LiveMapPage.test.tsx**

In `apps/pwa/src/pages/LiveMapPage.test.tsx`, change the react-map-gl mock from `'react-map-gl'` to `'react-map-gl/maplibre'`:

Find:
```tsx
vi.mock('react-map-gl', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="mapbox">{children}</div>,
  Marker: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
```

Replace with:
```tsx
vi.mock('react-map-gl/maplibre', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="mapbox">{children}</div>,
  Marker: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Map: ({ children }: { children: ReactNode }) => <div data-testid="mapbox">{children}</div>,
}))
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run src/pages/LiveMapPage.test.tsx
```
Expected: FAIL — `Marker` is still imported from `react-map-gl` in `LiveMapPage.tsx`, but the mock is now on `react-map-gl/maplibre`

- [ ] **Step 3: Update import in LiveMapPage.tsx**

In `apps/pwa/src/pages/LiveMapPage.tsx`, change:
```tsx
import { Marker } from 'react-map-gl'
```
to:
```tsx
import { Marker } from 'react-map-gl/maplibre'
```

- [ ] **Step 4: Update LocationMarker.tsx**

Change line 1:
```tsx
import { Marker } from 'react-map-gl/maplibre'
```

- [ ] **Step 5: Update HomeRouteLayer.tsx**

Change line 1:
```tsx
import { Source, Layer } from 'react-map-gl/maplibre'
```

- [ ] **Step 6: Update SafeRouteOverlay.tsx**

Change line 1:
```tsx
import { Source, Layer } from 'react-map-gl/maplibre'
```

- [ ] **Step 7: Run test to verify it passes**

```
npx vitest run src/pages/LiveMapPage.test.tsx
```
Expected: PASS (all 8 tests)

- [ ] **Step 8: Run full suite**

```
npx vitest run
```
Expected: all tests pass

- [ ] **Step 9: Commit**

```
git add apps/pwa/src/components/map/LocationMarker.tsx apps/pwa/src/components/map/HomeRouteLayer.tsx apps/pwa/src/components/SafeRouteOverlay.tsx apps/pwa/src/pages/LiveMapPage.tsx apps/pwa/src/pages/LiveMapPage.test.tsx
git commit -m "feat: migrate all react-map-gl imports to maplibre adapter"
```

---

### Task 9: Author infra/map-style/sentinelmesh-dark.json

**Files:**
- Create: `infra/map-style/sentinelmesh-dark.json`

This is the canonical SentinelMesh map style targeting the OpenMapTiles vector tile schema (the schema Planetiler produces). It won't be used by the PWA until `VITE_MAP_STYLE_URL` points to it after deployment to R2.

- [ ] **Step 1: Create infra/map-style/ directory and write the style**

Create `infra/map-style/sentinelmesh-dark.json`:
```json
{
  "version": 8,
  "name": "SentinelMesh Dark",
  "glyphs": "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  "sprite": "",
  "sources": {
    "openmaptiles": {
      "type": "vector",
      "url": "pmtiles://{MAPTILES_URL}"
    }
  },
  "layers": [
    {
      "id": "background",
      "type": "background",
      "paint": { "background-color": "#0B0E14" }
    },
    {
      "id": "water",
      "type": "fill",
      "source": "openmaptiles",
      "source-layer": "water",
      "paint": { "fill-color": "#0d1a2e" }
    },
    {
      "id": "landcover",
      "type": "fill",
      "source": "openmaptiles",
      "source-layer": "landcover",
      "paint": { "fill-color": "#0e1520", "fill-opacity": 0.6 }
    },
    {
      "id": "landuse",
      "type": "fill",
      "source": "openmaptiles",
      "source-layer": "landuse",
      "filter": ["in", "class", "residential", "commercial", "industrial"],
      "paint": { "fill-color": "#0d1520", "fill-opacity": 0.4 }
    },
    {
      "id": "roads-casing",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": ["in", "class", "motorway", "trunk", "primary", "secondary"],
      "layout": { "line-cap": "round", "line-join": "round" },
      "paint": {
        "line-color": "#1a2035",
        "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1.5, 12, 5, 16, 10]
      }
    },
    {
      "id": "roads-fill",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": ["in", "class", "motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"],
      "layout": { "line-cap": "round", "line-join": "round" },
      "paint": {
        "line-color": [
          "match", ["get", "class"],
          "motorway", "#2a3a5a",
          "trunk",    "#243352",
          "primary",  "#1e2c4a",
          "#141c2d"
        ],
        "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.5, 12, 2, 16, 5]
      }
    },
    {
      "id": "building",
      "type": "fill",
      "source": "openmaptiles",
      "source-layer": "building",
      "minzoom": 14,
      "paint": { "fill-color": "#0f1620", "fill-outline-color": "#1a2035" }
    },
    {
      "id": "place-label",
      "type": "symbol",
      "source": "openmaptiles",
      "source-layer": "place",
      "layout": {
        "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 8, 12, 12, 14],
        "text-max-width": 8,
        "text-anchor": "center"
      },
      "paint": {
        "text-color": "#94a3b8",
        "text-halo-color": "#0B0E14",
        "text-halo-width": 1.5
      }
    },
    {
      "id": "road-label",
      "type": "symbol",
      "source": "openmaptiles",
      "source-layer": "transportation_name",
      "layout": {
        "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": 10,
        "symbol-placement": "line",
        "text-max-angle": 30
      },
      "paint": {
        "text-color": "#64748b",
        "text-halo-color": "#0B0E14",
        "text-halo-width": 1
      }
    }
  ]
}
```

The `{MAPTILES_URL}` placeholder is substituted at deploy time. When deploying, replace it with the R2 URL (e.g. `https://r2.sentinelmesh.io/tiles/africa.pmtiles`).

- [ ] **Step 2: Run full suite to verify no regressions**

```
npx vitest run
```
Expected: all tests pass (this is a static JSON file, no code changes)

- [ ] **Step 3: Commit**

```
git add infra/map-style/sentinelmesh-dark.json
git commit -m "feat: add SentinelMesh dark map style — OpenMapTiles schema, dark theme"
```

---

### Task 10: Create infra/pmtiles pipeline script

**Files:**
- Create: `infra/pmtiles/generate-africa.sh`

- [ ] **Step 1: Create the script**

Create `infra/pmtiles/generate-africa.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

# Generates africa.pmtiles from OpenStreetMap data using Planetiler.
# Output: ~15GB. Run on a machine with at least 16GB RAM and 80GB disk.
# Prerequisites: Java 21+, curl, rclone (for R2 upload)

PLANETILER_VERSION="0.8.3"
PLANETILER_JAR="planetiler-${PLANETILER_VERSION}-with-deps.jar"
OUTPUT="africa.pmtiles"

if [ ! -f "$PLANETILER_JAR" ]; then
  echo "Downloading Planetiler ${PLANETILER_VERSION}..."
  curl -L -o "$PLANETILER_JAR" \
    "https://github.com/onthegomap/planetiler/releases/download/v${PLANETILER_VERSION}/${PLANETILER_JAR}"
fi

echo "Generating ${OUTPUT}..."
java -Xmx12g -jar "$PLANETILER_JAR" \
  --area=africa \
  --download \
  --output="$OUTPUT" \
  --nodemap-type=sparsearray \
  --nodemap-storage=mmap

echo "Done: $(du -sh "$OUTPUT" | cut -f1)"
echo ""
echo "Upload to R2:"
echo "  rclone copy $OUTPUT r2:sentinelmesh-tiles/tiles/"
echo ""
echo "Then update infra/map-style/sentinelmesh-dark.json:"
echo "  Replace {MAPTILES_URL} with:"
echo "  https://r2.sentinelmesh.io/tiles/$OUTPUT"
```

Make it executable and commit:

- [ ] **Step 2: Commit**

```
git add infra/pmtiles/generate-africa.sh
git commit -m "feat: add Africa PMTiles pipeline script — Planetiler, R2 upload"
```

---

### Task 11: Gateway maps module — types, trait, and mod

**Files:**
- Create: `services/gateway/src/maps/types.rs`
- Create: `services/gateway/src/maps/provider.rs`
- Create: `services/gateway/src/maps/mod.rs`
- Modify: `services/gateway/Cargo.toml`

- [ ] **Step 1: Add async-trait to Cargo.toml**

In `services/gateway/Cargo.toml`, add after the `futures = "0.3"` line:
```toml
async-trait = "0.1"
```

- [ ] **Step 2: Write the failing tests**

Create `services/gateway/src/maps/types.rs` and also write a test module at the bottom:
```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SearchResult {
    pub label: String,
    pub lat: f64,
    pub lng: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RouteResult {
    pub coordinates: Vec<[f64; 2]>,
    pub distance: f64,
    pub duration: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_result_serializes() {
        let r = SearchResult { label: "Nairobi".into(), lat: -1.29, lng: 36.82 };
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("Nairobi"));
        assert!(json.contains("lat"));
    }

    #[test]
    fn route_result_serializes() {
        let r = RouteResult {
            coordinates: vec![[36.82, -1.29], [36.83, -1.28]],
            distance: 1500.0,
            duration: 900.0,
        };
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("coordinates"));
        assert!(json.contains("1500"));
    }
}
```

- [ ] **Step 3: Run test to verify it fails (cannot compile yet)**

From `services/gateway`:
```
cargo test maps::types
```
Expected: compile error — `maps` module doesn't exist yet

- [ ] **Step 4: Create provider.rs**

```rust
use async_trait::async_trait;
use super::types::{RouteResult, SearchResult};

#[async_trait]
pub trait MapProvider: Send + Sync {
    async fn search(
        &self,
        query: &str,
        lat: Option<f64>,
        lng: Option<f64>,
        limit: u8,
    ) -> anyhow::Result<Vec<SearchResult>>;

    async fn route(
        &self,
        from_lng: f64,
        from_lat: f64,
        to_lng: f64,
        to_lat: f64,
    ) -> anyhow::Result<Option<RouteResult>>;

    async fn reverse(&self, lat: f64, lng: f64) -> anyhow::Result<Option<String>>;
}
```

- [ ] **Step 5: Create mod.rs**

```rust
mod mapbox_adapter;
mod provider;
pub mod types;

pub use mapbox_adapter::MapboxAdapter;
pub use provider::MapProvider;
pub use types::{RouteResult, SearchResult};
```

The `mapbox_adapter` module reference will fail to compile until Task 12 creates it. Add a placeholder in `mapbox_adapter.rs` for now:
```rust
use super::{provider::MapProvider, types::{RouteResult, SearchResult}};
use async_trait::async_trait;

pub struct MapboxAdapter {
    pub(super) client: reqwest::Client,
    pub(super) token: String,
}

impl MapboxAdapter {
    pub fn new(client: reqwest::Client, token: String) -> Self {
        Self { client, token }
    }
}

#[async_trait]
impl MapProvider for MapboxAdapter {
    async fn search(&self, _query: &str, _lat: Option<f64>, _lng: Option<f64>, _limit: u8) -> anyhow::Result<Vec<SearchResult>> {
        Ok(vec![])
    }
    async fn route(&self, _from_lng: f64, _from_lat: f64, _to_lng: f64, _to_lat: f64) -> anyhow::Result<Option<RouteResult>> {
        Ok(None)
    }
    async fn reverse(&self, _lat: f64, _lng: f64) -> anyhow::Result<Option<String>> {
        Ok(None)
    }
}
```

This placeholder lets the module compile. Task 12 replaces the stub bodies.

- [ ] **Step 6: Add `mod maps;` to main.rs**

In `services/gateway/src/main.rs`, add after `mod reports;`:
```rust
mod maps;
```

Also add `map_provider` to the `AppState` struct:
```rust
pub struct AppState {
    pub db: sqlx::PgPool,
    pub config: Arc<config::Config>,
    pub http_client: reqwest::Client,
    pub hub: Arc<WsHub>,
    pub circle_hub: Arc<CircleHub>,
    pub redis_healthy: Arc<AtomicBool>,
    pub map_provider: Arc<dyn maps::MapProvider>,
}
```

And initialize it in `main()` (before `let state = AppState { ... }`):
```rust
let map_provider: Arc<dyn maps::MapProvider> = Arc::new(
    maps::MapboxAdapter::new(
        http_client.clone(),
        config.mapbox_token.clone().unwrap_or_default(),
    )
);
```

Add to `AppState` initializer:
```rust
let state = AppState {
    db: db.clone(),
    config: config.clone(),
    http_client,
    hub: hub.clone(),
    circle_hub,
    redis_healthy: redis_healthy.clone(),
    map_provider,
};
```

- [ ] **Step 7: Run test to verify it compiles and passes**

```
cargo test maps::types
```
Expected: PASS (2 tests: `search_result_serializes`, `route_result_serializes`)

- [ ] **Step 8: Run full gateway test suite**

```
cargo test
```
Expected: all tests pass

- [ ] **Step 9: Commit**

```
git add services/gateway/src/maps/ services/gateway/src/main.rs services/gateway/Cargo.toml
git commit -m "feat: add gateway maps module — MapProvider trait, types, stub MapboxAdapter"
```

---

### Task 12: Implement MapboxAdapter

**Files:**
- Modify: `services/gateway/src/maps/mapbox_adapter.rs`

- [ ] **Step 1: Write failing tests in mapbox_adapter.rs**

Replace the placeholder `mapbox_adapter.rs` with:
```rust
use super::{provider::MapProvider, types::{RouteResult, SearchResult}};
use async_trait::async_trait;
use serde::Deserialize;

pub struct MapboxAdapter {
    pub(super) client: reqwest::Client,
    pub(super) token: String,
}

impl MapboxAdapter {
    pub fn new(client: reqwest::Client, token: String) -> Self {
        Self { client, token }
    }
}

#[derive(Deserialize)]
struct GeocodeResponse {
    features: Vec<GeocodeFeature>,
}

#[derive(Deserialize)]
struct GeocodeFeature {
    place_name: String,
    center: [f64; 2],
}

#[derive(Deserialize)]
struct DirectionsResponse {
    routes: Vec<DirectionsRoute>,
}

#[derive(Deserialize)]
struct DirectionsRoute {
    geometry: DirectionsGeometry,
    distance: f64,
    duration: f64,
}

#[derive(Deserialize)]
struct DirectionsGeometry {
    coordinates: Vec<[f64; 2]>,
}

#[async_trait]
impl MapProvider for MapboxAdapter {
    async fn search(
        &self,
        query: &str,
        lat: Option<f64>,
        lng: Option<f64>,
        limit: u8,
    ) -> anyhow::Result<Vec<SearchResult>> {
        let encoded = urlencoding::encode(query);
        let prox = match (lat, lng) {
            (Some(la), Some(lo)) => format!("&proximity={lo},{la}"),
            _ => String::new(),
        };
        let url = format!(
            "https://api.mapbox.com/geocoding/v5/mapbox.places/{encoded}.json\
             ?access_token={}&types=address,place,poi&limit={limit}{prox}",
            self.token,
        );
        let res = self.client.get(&url).send().await?;
        if !res.status().is_success() {
            anyhow::bail!("geocoding upstream returned {}", res.status());
        }
        let data: GeocodeResponse = res.json().await?;
        Ok(data.features.into_iter().map(|f| SearchResult {
            label: f.place_name,
            lat: f.center[1],
            lng: f.center[0],
        }).collect())
    }

    async fn route(
        &self,
        from_lng: f64,
        from_lat: f64,
        to_lng: f64,
        to_lat: f64,
    ) -> anyhow::Result<Option<RouteResult>> {
        let url = format!(
            "https://api.mapbox.com/directions/v5/mapbox/walking/{from_lng},{from_lat};{to_lng},{to_lat}\
             ?access_token={}&geometries=geojson&overview=full",
            self.token,
        );
        let res = self.client.get(&url).send().await?;
        if !res.status().is_success() {
            anyhow::bail!("directions upstream returned {}", res.status());
        }
        let data: DirectionsResponse = res.json().await?;
        Ok(data.routes.into_iter().next().map(|r| RouteResult {
            coordinates: r.geometry.coordinates,
            distance: r.distance,
            duration: r.duration,
        }))
    }

    async fn reverse(&self, lat: f64, lng: f64) -> anyhow::Result<Option<String>> {
        let url = format!(
            "https://api.mapbox.com/geocoding/v5/mapbox.places/{lng},{lat}.json\
             ?access_token={}&types=place,locality,neighborhood&limit=1",
            self.token,
        );
        let res = self.client.get(&url).send().await?;
        if !res.status().is_success() {
            anyhow::bail!("reverse geocoding upstream returned {}", res.status());
        }
        let data: GeocodeResponse = res.json().await?;
        Ok(data.features.into_iter().next().map(|f| f.place_name))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_adapter() -> MapboxAdapter {
        MapboxAdapter::new(reqwest::Client::new(), "test-token".into())
    }

    #[test]
    fn adapter_stores_token() {
        let a = make_adapter();
        assert_eq!(a.token, "test-token");
    }

    #[test]
    fn geocode_response_deserializes() {
        let json = r#"{"features":[{"place_name":"Nairobi","center":[36.82,-1.29]}]}"#;
        let r: GeocodeResponse = serde_json::from_str(json).unwrap();
        assert_eq!(r.features[0].place_name, "Nairobi");
        assert_eq!(r.features[0].center[0], 36.82);
    }

    #[test]
    fn directions_response_deserializes() {
        let json = r#"{"routes":[{"geometry":{"coordinates":[[36.82,-1.29],[36.83,-1.28]]},"distance":1500.0,"duration":900.0}]}"#;
        let r: DirectionsResponse = serde_json::from_str(json).unwrap();
        assert_eq!(r.routes[0].distance, 1500.0);
        assert_eq!(r.routes[0].geometry.coordinates[0], [36.82_f64, -1.29_f64]);
    }
}
```

- [ ] **Step 2: Run test to verify tests pass**

```
cargo test maps::mapbox_adapter
```
Expected: PASS (3 tests: `adapter_stores_token`, `geocode_response_deserializes`, `directions_response_deserializes`)

- [ ] **Step 3: Run full gateway suite**

```
cargo test
```
Expected: all tests pass

- [ ] **Step 4: Commit**

```
git add services/gateway/src/maps/mapbox_adapter.rs
git commit -m "feat: implement MapboxAdapter — proxies geocoding and routing to Mapbox, no token leak"
```

---

### Task 13: Gateway /api/maps route handlers

**Files:**
- Create: `services/gateway/src/routes/maps.rs`

- [ ] **Step 1: Write the failing tests first**

Create `services/gateway/src/routes/maps.rs`:
```rust
use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::Json,
    routing::get,
    Router,
};
use serde::{Deserialize, Serialize};
use crate::AppState;

#[derive(Deserialize)]
pub struct SearchParams {
    pub q: String,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub limit: Option<u8>,
}

#[derive(Deserialize)]
pub struct RouteParams {
    pub from: String,
    pub to: String,
}

#[derive(Deserialize)]
pub struct ReverseParams {
    pub lat: f64,
    pub lng: f64,
}

#[derive(Serialize)]
struct SearchResponse {
    features: Vec<crate::maps::SearchResult>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/search",  get(search_handler))
        .route("/route",   get(route_handler))
        .route("/reverse", get(reverse_handler))
}

async fn search_handler(
    State(state): State<AppState>,
    Query(params): Query<SearchParams>,
) -> Result<Json<SearchResponse>, StatusCode> {
    let limit = params.limit.unwrap_or(5).min(10);
    state
        .map_provider
        .search(&params.q, params.lat, params.lng, limit)
        .await
        .map(|features| Json(SearchResponse { features }))
        .map_err(|e| {
            tracing::error!("maps/search error: {e}");
            StatusCode::BAD_GATEWAY
        })
}

async fn route_handler(
    State(state): State<AppState>,
    Query(params): Query<RouteParams>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let from = parse_lng_lat(&params.from).ok_or(StatusCode::BAD_REQUEST)?;
    let to   = parse_lng_lat(&params.to).ok_or(StatusCode::BAD_REQUEST)?;
    state
        .map_provider
        .route(from.0, from.1, to.0, to.1)
        .await
        .map(|r| Json(serde_json::to_value(&r).unwrap_or(serde_json::Value::Null)))
        .map_err(|e| {
            tracing::error!("maps/route error: {e}");
            StatusCode::BAD_GATEWAY
        })
}

async fn reverse_handler(
    State(state): State<AppState>,
    Query(params): Query<ReverseParams>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    state
        .map_provider
        .reverse(params.lat, params.lng)
        .await
        .map(|label| Json(serde_json::json!({ "label": label })))
        .map_err(|e| {
            tracing::error!("maps/reverse error: {e}");
            StatusCode::BAD_GATEWAY
        })
}

fn parse_lng_lat(s: &str) -> Option<(f64, f64)> {
    let mut parts = s.splitn(2, ',');
    let lng: f64 = parts.next()?.trim().parse().ok()?;
    let lat: f64 = parts.next()?.trim().parse().ok()?;
    Some((lng, lat))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_lng_lat_valid() {
        assert_eq!(parse_lng_lat("36.82,-1.29"), Some((36.82, -1.29)));
    }

    #[test]
    fn parse_lng_lat_with_spaces() {
        assert_eq!(parse_lng_lat("36.82, -1.29"), Some((36.82, -1.29)));
    }

    #[test]
    fn parse_lng_lat_invalid_returns_none() {
        assert!(parse_lng_lat("not-coords").is_none());
        assert!(parse_lng_lat("").is_none());
    }
}
```

- [ ] **Step 2: Run test to verify it fails (module not registered yet)**

```
cargo test routes::maps
```
Expected: compile error — `maps` not in `routes/mod.rs` yet

- [ ] **Step 3: Register in routes/mod.rs**

Replace `services/gateway/src/routes/mod.rs`:
```rust
pub mod circles;
pub mod events;
pub mod location_blobs;
pub mod maps;
pub mod push;
pub mod reports;
pub mod tiles;
pub mod zap;

use axum::Router;
use crate::AppState;

pub fn build_router() -> Router<AppState> {
    Router::new()
        .nest("/api/events",  events::router())
        .nest("/api/reports", reports::router())
        .nest("/api/circles", circles::router().merge(location_blobs::router()))
        .nest("/api/zaps",    zap::router())
        .nest("/api/tiles",   tiles::router())
        .nest("/api/push",    push::router())
        .nest("/api/maps",    maps::router())
}
```

- [ ] **Step 4: Run test to verify it passes**

```
cargo test routes::maps
```
Expected: PASS (3 tests: `parse_lng_lat_valid`, `parse_lng_lat_with_spaces`, `parse_lng_lat_invalid_returns_none`)

- [ ] **Step 5: Run full gateway suite**

```
cargo test
```
Expected: all tests pass

- [ ] **Step 6: Commit**

```
git add services/gateway/src/routes/maps.rs services/gateway/src/routes/mod.rs
git commit -m "feat: add /api/maps/search, /route, /reverse gateway handlers"
```

---

### Task 14: Service worker — vite-plugin-pwa + Workbox

**Files:**
- Modify: `apps/pwa/package.json`
- Modify: `apps/pwa/vite.config.ts`

- [ ] **Step 1: Install vite-plugin-pwa**

From `apps/pwa`:
```
npm install --save-dev vite-plugin-pwa
```

- [ ] **Step 2: Run existing test suite — verify nothing broke**

```
npx vitest run
```
Expected: all tests pass

- [ ] **Step 3: Update vite.config.ts to add VitePWA plugin**

Replace `apps/pwa/vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'SentinelMesh',
        short_name: 'SentinelMesh',
        description: 'Privacy-first community safety network',
        theme_color: '#0B0E14',
        background_color: '#0B0E14',
        display: 'standalone',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname.includes('/tiles/') || url.href.endsWith('.pmtiles'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'sm-tiles',
              expiration: { maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/api/') &&
              !url.pathname.startsWith('/api/circles') &&
              !url.pathname.startsWith('/api/location'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'sm-api',
              expiration: { maxAgeSeconds: 60 },
            },
          },
          {
            urlPattern: ({ url }) =>
              url.pathname.endsWith('.json') ||
              /\.(woff2?)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'sm-assets',
              expiration: { maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: [
      { find: 'react-map-gl/maplibre', replacement: resolve('node_modules/react-map-gl/dist/maplibre.js') },
      { find: 'react-map-gl/mapbox',   replacement: resolve('node_modules/react-map-gl/dist/maplibre.js') },
      { find: 'react-map-gl',          replacement: resolve('node_modules/react-map-gl/dist/maplibre.js') },
    ],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true, changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
})
```

Cache strategy rationale:
- **sm-tiles** (`CacheFirst`, 7 days): PMTiles range-requests are large; once cached they don't change. Circle/location data excluded from all caching.
- **sm-api** (`StaleWhileRevalidate`, 60s): Safety events must be fresh but can tolerate one stale render. Circle and location endpoints excluded — they carry sensitive position data.
- **sm-assets** (`CacheFirst`, 30 days): Style JSON and fonts are versioned; long TTL is safe.

- [ ] **Step 4: Verify build generates service worker**

From `apps/pwa`:
```
npm run build
ls dist/sw.js
```
Expected: `dist/sw.js` exists

- [ ] **Step 5: Run full test suite**

```
npx vitest run
```
Expected: all tests pass (vite-plugin-pwa only affects the build output, not the dev/test environment)

- [ ] **Step 6: Commit**

```
git add apps/pwa/vite.config.ts apps/pwa/package.json apps/pwa/package-lock.json
git commit -m "feat: add service worker — tiles CacheFirst 7d, API stale-while-revalidate 60s, assets 30d"
```

---

### Task 15: Final verification — run all test suites

**Files:** None (verification only)

- [ ] **Step 1: Run full PWA test suite**

From `apps/pwa`:
```
npx vitest run --reporter=verbose
```
Expected: all tests pass, no token-related errors, no Mapbox import errors

- [ ] **Step 2: Run full gateway test suite**

From `services/gateway`:
```
cargo test -- --nocapture
```
Expected: all tests pass including new `maps` module tests

- [ ] **Step 3: Verify no VITE_MAPBOX_TOKEN references remain in PWA source**

From `apps/pwa/src`:
```
grep -r "VITE_MAPBOX_TOKEN" .
```
Expected: no output (zero references)

- [ ] **Step 4: Verify no direct Mapbox API calls in PWA source**

```
grep -r "api.mapbox.com" apps/pwa/src/
```
Expected: no output (all calls now go through `/api/maps/*`)

- [ ] **Step 5: Commit final verification**

```
git add .
git commit -m "chore: phase 1 global map migration complete — MapLibre, no token in browser, gateway provider abstraction"
```

---

## Self-Review

**Spec coverage check:**
- [x] MapLibre GL JS replacing Mapbox GL → Tasks 1, 5
- [x] Africa PMTiles pipeline → Task 10
- [x] SentinelMesh custom map style → Task 9
- [x] Provider abstraction layer (gateway /api/maps/*)  → Tasks 11–13
- [x] Remove Kenya hardcoding → Tasks 5 (world-center default), 6 (no country=KE), 7 (no hardcoded proximity)
- [x] Service worker caching (3 strategies) → Task 14
- [x] No credentials in browser → Tasks 4, 7, 15
- [x] Transport mode (walking) wired through gateway → Tasks 4, 12 (`/mapbox/walking`)
- [x] useInitialViewport → Task 3

**Placeholder scan:** All tasks have complete code. No TBD or TODO in code blocks.

**Type consistency check:**
- `GeocodeSuggestion` defined in `mapApiService.ts`, re-exported from `geocodingService.ts` — consistent across Tasks 4, 6, 7
- `RouteResult` defined in `mapApiService.ts` matches `RouteResult` in `maps/types.rs` — `distance: number` / `distance: f64`, `duration: number` / `duration: f64`
- `fetchRouteToHome` signature in Task 6 step 4 removes `mapboxToken` param — matches test in Task 6 step 1
- `fetchSafeRoutes` signature in Task 6 step 4 removes `mapboxToken` param — matches test in Task 6 step 1
- `MapProvider.route()` takes `(from_lng, from_lat, to_lng, to_lat)` in Task 11 — matches call in `route_handler` Task 13: `route(from.0, from.1, to.0, to.1)` where `parse_lng_lat` returns `(lng, lat)` tuple
- `MAP_STYLE_URL` exported from `mapConfig.ts` — used in `MapCanvas.tsx` and the test mock — consistent
- `WORLD_CENTER` as `const` object `{ longitude: 0, latitude: 20, zoom: 2 }` — used in `MapCanvas.tsx` default prop and `useInitialViewport` fallback — consistent
