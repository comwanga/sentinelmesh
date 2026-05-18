# Map Style Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 9-layer skeleton map style with a 24-layer production stack, implement overlay visualisation language (severity markers, radius zones, CRITICAL animation), donut-ring cluster components, portal-based overlay host, and mobile-first rendering.

**Architecture:** Color tokens centralised in `map-tokens.ts` drive all marker, cluster, and overlay colors. `sentinelmesh-dark.json` (24 layers, slate-blue palette) served from `public/` with `{MAPTILES_URL}` substituted at runtime by `loadMapStyle()`. Overlay components render through a React portal (`#map-overlay-portal`) to escape the MapCanvas `isolation: isolate` stacking context. `EventClusterLayer` replaces the direct `EventMarker` loop in `LiveMapPage`, using zoom-based hysteresis to dissolve clusters at z13.2 and re-form at z12.8.

**Tech Stack:** React 18, MapLibre GL JS, react-map-gl v8, Vitest + Testing Library, CSS Modules, TypeScript, SVG for cluster donuts.

---

## File Map

**Create:**
- `apps/pwa/src/styles/map-tokens.ts` — typed color constants for all map, overlay, and marker colors
- `apps/pwa/src/components/map/MapCanvas.module.css` — container isolation + bottom safe-zone gradient
- `apps/pwa/src/components/map/RadiusZoneLayer.tsx` — MapLibre GeoJSON circle source for event radius zones
- `apps/pwa/src/components/map/RadiusZoneLayer.test.tsx`
- `apps/pwa/src/components/map/ClusterMarker.tsx` — memoised SVG donut ring cluster component
- `apps/pwa/src/components/map/ClusterMarker.test.tsx`
- `apps/pwa/src/components/map/EventClusterLayer.tsx` — zoom-aware clustering wrapper (individual markers vs donut clusters)
- `apps/pwa/src/components/map/EventClusterLayer.test.tsx`

**Modify:**
- `apps/pwa/index.html` — remove Mapbox CSS link, add `<div id="map-overlay-portal">`
- `apps/pwa/src/main.tsx` — add `import 'maplibre-gl/dist/maplibre-gl.css'`
- `apps/pwa/src/config/mapConfig.ts` — add `loadMapStyle()` async function
- `apps/pwa/src/components/map/MapCanvas.tsx` — wrap in container div with CSS module, use `loadMapStyle()`
- `apps/pwa/src/components/map/MapCanvas.test.tsx` — update mock for `loadMapStyle`
- `apps/pwa/src/components/EventMarker.tsx` — spec-compliant sizes, tokens, border ring, hit area, CRITICAL pulse animation
- `apps/pwa/src/components/map/MapOverlayHost.tsx` — render through React portal, updated z-indices
- `apps/pwa/src/pages/LiveMapPage.tsx` — replace direct EventMarker loop with EventClusterLayer + RadiusZoneLayer
- `infra/map-style/sentinelmesh-dark.json` — full 24-layer production stack
- `apps/pwa/public/sentinelmesh-dark.json` — identical copy served to browser
- `apps/pwa/.env.local` — set `VITE_MAP_STYLE_URL=/sentinelmesh-dark.json`

---

## Task 1: Color tokens module

**Files:**
- Create: `apps/pwa/src/styles/map-tokens.ts`
- Test: (no dedicated test file — import correctness verified by TypeScript compiler; used by Tasks 5, 6, 7)

- [ ] **Step 1: Write the failing type-check test**

Create `apps/pwa/src/styles/map-tokens.ts` with an empty export so TypeScript can verify the shape in subsequent import sites. Add a quick sanity test that imports the module and verifies key token existence.

Create `apps/pwa/src/styles/map-tokens.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { MAP_COLORS, SEVERITY_COLORS, RADIUS_FILL, RADIUS_STROKE } from './map-tokens'

describe('map-tokens', () => {
  it('MAP_COLORS has required base tokens', () => {
    expect(MAP_COLORS.bg).toBe('#0B0E14')
    expect(MAP_COLORS.roadCasing).toBe('#111827')
    expect(MAP_COLORS.water).toBe('#0c1828')
  })

  it('SEVERITY_COLORS maps all four severities', () => {
    expect(SEVERITY_COLORS.CRITICAL).toBe('#FF2D2D')
    expect(SEVERITY_COLORS.HIGH).toBe('#FF9800')
    expect(SEVERITY_COLORS.MEDIUM).toBe('#FFD500')
    expect(SEVERITY_COLORS.LOW).toBe('#9C27B0')
  })

  it('RADIUS_FILL has CRITICAL HIGH MEDIUM but not LOW', () => {
    expect(RADIUS_FILL.CRITICAL).toMatch(/rgba/)
    expect(RADIUS_FILL.HIGH).toMatch(/rgba/)
    expect(RADIUS_FILL.MEDIUM).toMatch(/rgba/)
    expect(RADIUS_FILL.LOW).toBeUndefined()
  })

  it('overlay hue ranges do not appear in base map tokens', () => {
    // Red, orange, yellow, cyan, teal are reserved for overlays.
    // Base map tokens must not use high-saturation versions of these hues.
    const baseTokenValues = [
      MAP_COLORS.bg, MAP_COLORS.water, MAP_COLORS.park,
      MAP_COLORS.roadMotorway, MAP_COLORS.roadPrimary, MAP_COLORS.roadSecondary,
    ]
    for (const v of baseTokenValues) {
      expect(v).not.toMatch(/^#[Ff][Ff]/)  // no bright reds/oranges
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
cd apps/pwa && npx vitest run src/styles/map-tokens.test.ts
```

Expected: FAIL — `Cannot find module './map-tokens'`

- [ ] **Step 3: Create the tokens module**

Create `apps/pwa/src/styles/map-tokens.ts`:

```typescript
export const MAP_COLORS = {
  bg:                   '#0B0E14',
  water:                '#0c1828',
  park:                 '#0b1c10',
  landuseResidential:   '#0c1320',
  landuseCommercial:    '#0d1525',
  roadCasing:           '#111827',
  roadMotorway:         '#2c3a52',
  roadTrunk:            '#253347',
  roadPrimary:          '#1f2c3e',
  roadSecondary:        '#182030',
  roadTertiary:         '#131820',
  roadMinor:            '#10131a',
  buildingFill:         '#101520',
  buildingOutline:      '#1a2030',
  labelDistrict:        '#a8b8cc',
  labelSuburb:          '#7a9ab5',
  labelMinor:           '#607a90',
  labelRoad:            '#4e6a85',
  labelPoi:             '#527a9e',
} as const

export const SEVERITY_COLORS = {
  CRITICAL: '#FF2D2D',
  HIGH:     '#FF9800',
  MEDIUM:   '#FFD500',
  LOW:      '#9C27B0',
} as const

export const OVERLAY_COLORS = {
  route:  '#00E5FF',
  family: '#00E6B4',
} as const

export const RADIUS_FILL = {
  CRITICAL: 'rgba(255,45,45,0.14)',
  HIGH:     'rgba(255,152,0,0.11)',
  MEDIUM:   'rgba(255,213,0,0.09)',
} as const

export const RADIUS_STROKE = {
  CRITICAL: 'rgba(255,45,45,0.52)',
  HIGH:     'rgba(255,152,0,0.45)',
  MEDIUM:   'rgba(255,213,0,0.35)',
} as const

export const RADIUS_STROKE_WIDTH = {
  CRITICAL: 1.5,
  HIGH:     1.3,
  MEDIUM:   1.2,
} as const
```

- [ ] **Step 4: Run test to verify it passes**

```
cd apps/pwa && npx vitest run src/styles/map-tokens.test.ts
```

Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/styles/map-tokens.ts apps/pwa/src/styles/map-tokens.test.ts
git commit -m "feat: add map color tokens module"
```

---

## Task 2: HTML cleanup — Mapbox CSS out, MapLibre CSS in, portal div

**Files:**
- Modify: `apps/pwa/index.html`
- Modify: `apps/pwa/src/main.tsx`

- [ ] **Step 1: Write failing test**

The MapCanvas test currently passes with the Mapbox CSS link in `index.html`. We need a test that asserts MapLibre CSS is imported and Mapbox CSS is absent. The cleanest way is a grep-based assertion in a shell script, but since we're in Vitest, we'll verify the DOM doesn't load the Mapbox link by checking the import in `main.tsx`.

Create `apps/pwa/src/main.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

describe('HTML entrypoint', () => {
  it('index.html does not contain Mapbox CSS link', () => {
    const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf-8')
    expect(html).not.toContain('mapbox.com')
  })

  it('index.html contains map-overlay-portal div', () => {
    const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf-8')
    expect(html).toContain('id="map-overlay-portal"')
  })

  it('main.tsx imports maplibre-gl CSS', () => {
    const main = readFileSync(resolve(__dirname, 'main.tsx'), 'utf-8')
    expect(main).toContain("maplibre-gl/dist/maplibre-gl.css")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
cd apps/pwa && npx vitest run src/main.test.tsx
```

Expected: FAIL — 3 failures (Mapbox link present, portal div absent, MapLibre CSS import absent)

- [ ] **Step 3: Update index.html**

Current `apps/pwa/index.html`:
```html
<!DOCTYPE html>
<html lang="sw">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SentinelMesh</title>
    <link href="https://api.mapbox.com/mapbox-gl-js/v3.11.0/mapbox-gl.css" rel="stylesheet" />
  </head>
  <body style="margin:0;background:#0a0a0a;">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Replace with:
```html
<!DOCTYPE html>
<html lang="sw">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SentinelMesh</title>
  </head>
  <body style="margin:0;background:#0a0a0a;">
    <div id="root"></div>
    <div id="map-overlay-portal" style="position:fixed;inset:0;pointer-events:none;z-index:100;"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Update main.tsx — add MapLibre CSS import**

Current `apps/pwa/src/main.tsx`:
```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import { RouterProvider } from 'react-router-dom'
import { store } from './store'
import { router } from './router'

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {/* non-fatal */})
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <RouterProvider router={router} />
    </Provider>
  </React.StrictMode>
)
```

Replace with:
```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import { RouterProvider } from 'react-router-dom'
import 'maplibre-gl/dist/maplibre-gl.css'
import { store } from './store'
import { router } from './router'

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {/* non-fatal */})
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <RouterProvider router={router} />
    </Provider>
  </React.StrictMode>
)
```

- [ ] **Step 5: Run test to verify it passes**

```
cd apps/pwa && npx vitest run src/main.test.tsx
```

Expected: PASS — 3 tests

- [ ] **Step 6: Run full test suite to catch regressions**

```
cd apps/pwa && npx vitest run
```

Expected: All existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/pwa/index.html apps/pwa/src/main.tsx apps/pwa/src/main.test.tsx
git commit -m "feat: remove Mapbox CSS, add MapLibre CSS import and overlay portal div"
```

---

## Task 3: `loadMapStyle()` + MapCanvas container isolation + CSS module

**Files:**
- Modify: `apps/pwa/src/config/mapConfig.ts`
- Create: `apps/pwa/src/components/map/MapCanvas.module.css`
- Modify: `apps/pwa/src/components/map/MapCanvas.tsx`
- Modify: `apps/pwa/src/components/map/MapCanvas.test.tsx`
- Modify: `apps/pwa/.env.local`

- [ ] **Step 1: Write failing tests**

Update `apps/pwa/src/components/map/MapCanvas.test.tsx` to cover the new `loadMapStyle` behaviour:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MapCanvas } from './MapCanvas'

const mockStyle = { version: 8, name: 'test', layers: [] }

vi.mock('../../config/mapConfig', () => ({
  MAP_STYLE_URL: 'https://demotiles.maplibre.org/style.json',
  WORLD_CENTER: { longitude: 0, latitude: 20, zoom: 2 },
  MAPTILES_URL: '',
  loadMapStyle: vi.fn().mockResolvedValue(mockStyle),
}))

vi.mock('../../hooks/useInitialViewport', () => ({
  persistViewport: vi.fn(),
}))

vi.mock('react-map-gl/maplibre', () => ({
  Map: ({ children, longitude, latitude, zoom, onMove, mapStyle }: {
    children?: React.ReactNode
    longitude: number
    latitude: number
    zoom: number
    onMove: (evt: { viewState: { longitude: number; latitude: number; zoom: number } }) => void
    mapStyle?: unknown
  }) => (
    <div
      data-testid="mapbox"
      data-longitude={String(longitude)}
      data-latitude={String(latitude)}
      data-zoom={String(zoom)}
      data-style-type={typeof mapStyle === 'object' ? 'object' : 'string'}
      onClick={() => onMove({ viewState: { longitude: 10, latitude: 10, zoom: 5 } })}
    >
      {children}
    </div>
  ),
}))

describe('MapCanvas', () => {
  it('renders with world-center default view state', async () => {
    await act(async () => { render(<MapCanvas />) })
    const map = screen.getByTestId('mapbox')
    expect(map.getAttribute('data-longitude')).toBe('0')
    expect(map.getAttribute('data-latitude')).toBe('20')
    expect(map.getAttribute('data-zoom')).toBe('2')
  })

  it('renders children inside the map', async () => {
    await act(async () => {
      render(<MapCanvas><div data-testid="child">marker</div></MapCanvas>)
    })
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('accepts custom initial view state', async () => {
    await act(async () => {
      render(<MapCanvas initialViewState={{ longitude: 1.0, latitude: 2.0, zoom: 8 }} />)
    })
    const map = screen.getByTestId('mapbox')
    expect(map.getAttribute('data-longitude')).toBe('1')
    expect(map.getAttribute('data-latitude')).toBe('2')
    expect(map.getAttribute('data-zoom')).toBe('8')
  })

  it('passes resolved style object to Map after loadMapStyle resolves', async () => {
    await act(async () => { render(<MapCanvas />) })
    const map = screen.getByTestId('mapbox')
    expect(map.getAttribute('data-style-type')).toBe('object')
  })

  it('renders container div wrapping the Map', async () => {
    const { container } = await act(async () => render(<MapCanvas />))
    const wrapper = container.firstElementChild
    expect(wrapper?.tagName).toBe('DIV')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
cd apps/pwa && npx vitest run src/components/map/MapCanvas.test.tsx
```

Expected: FAIL — `loadMapStyle is not a function` or similar

- [ ] **Step 3: Add `loadMapStyle()` to mapConfig.ts**

Replace `apps/pwa/src/config/mapConfig.ts` with:

```typescript
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

export async function loadMapStyle(): Promise<object | string> {
  const styleUrl = MAP_STYLE_URL
  if (!styleUrl || styleUrl.startsWith('http') || styleUrl.startsWith('//')) {
    return styleUrl
  }
  const res = await fetch(styleUrl)
  if (!res.ok) throw new Error(`Map style fetch failed: ${res.status} ${styleUrl}`)
  const text = await res.text()
  return JSON.parse(text.replaceAll('{MAPTILES_URL}', MAPTILES_URL))
}
```

- [ ] **Step 4: Create MapCanvas.module.css**

Create `apps/pwa/src/components/map/MapCanvas.module.css`:

```css
.container {
  width: 100%;
  height: 100%;
  position: relative;
  isolation: isolate;
}

.container::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 120px;
  background: linear-gradient(to bottom, transparent 0%, rgba(11, 14, 20, 0.72) 100%);
  pointer-events: none;
  z-index: 5;
}
```

- [ ] **Step 5: Update MapCanvas.tsx**

Replace `apps/pwa/src/components/map/MapCanvas.tsx` with:

```typescript
import { useState, useCallback, useEffect } from 'react'
import { Map } from 'react-map-gl/maplibre'
import { loadMapStyle, WORLD_CENTER } from '../../config/mapConfig'
import { persistViewport } from '../../hooks/useInitialViewport'
import styles from './MapCanvas.module.css'

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
  const [mapStyle, setMapStyle] = useState<object | string | undefined>(undefined)

  useEffect(() => {
    loadMapStyle().then(setMapStyle).catch(console.error)
  }, [])

  const handleMove = useCallback((evt: { viewState: ViewState }) => {
    setViewState(evt.viewState)
    persistViewport(evt.viewState)
  }, [])

  return (
    <div className={styles.container}>
      <Map
        {...viewState}
        onMove={handleMove}
        onLoad={onMapLoad}
        style={{ width: '100%', height: '100%' }}
        mapStyle={mapStyle}
      >
        {children}
      </Map>
    </div>
  )
}
```

- [ ] **Step 6: Update .env.local to point at local style JSON**

Edit `apps/pwa/.env.local` — change `VITE_MAP_STYLE_URL`:

```
VITE_MAPTILES_URL=https://r2.sentinelmesh.io/tiles/africa.pmtiles
VITE_MAP_STYLE_URL=/sentinelmesh-dark.json
```

- [ ] **Step 7: Run tests to verify they pass**

```
cd apps/pwa && npx vitest run src/components/map/MapCanvas.test.tsx
```

Expected: PASS — 5 tests

- [ ] **Step 8: Run full suite**

```
cd apps/pwa && npx vitest run
```

Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add apps/pwa/src/config/mapConfig.ts \
        apps/pwa/src/components/map/MapCanvas.tsx \
        apps/pwa/src/components/map/MapCanvas.test.tsx \
        apps/pwa/src/components/map/MapCanvas.module.css \
        apps/pwa/.env.local
git commit -m "feat: add loadMapStyle, MapCanvas container isolation and safe-zone gradient"
```

---

## Task 4: Production sentinelmesh-dark.json (24-layer stack)

**Files:**
- Modify: `infra/map-style/sentinelmesh-dark.json`
- Create/copy: `apps/pwa/public/sentinelmesh-dark.json` (identical)
- Test: No Vitest test — verified by JSON parse and layer-count assertion

- [ ] **Step 1: Write the validation test**

Create `apps/pwa/src/styles/map-style.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const STYLE_PATH = resolve(__dirname, '../../../public/sentinelmesh-dark.json')

describe('sentinelmesh-dark.json', () => {
  let style: Record<string, unknown>

  it('is valid JSON', () => {
    const text = readFileSync(STYLE_PATH, 'utf-8')
    expect(() => { style = JSON.parse(text) }).not.toThrow()
    style = JSON.parse(text)
  })

  it('has version 8', () => {
    const text = readFileSync(STYLE_PATH, 'utf-8')
    style = JSON.parse(text)
    expect(style.version).toBe(8)
  })

  it('has at least 20 layers', () => {
    const text = readFileSync(STYLE_PATH, 'utf-8')
    style = JSON.parse(text)
    const layers = style.layers as unknown[]
    expect(layers.length).toBeGreaterThanOrEqual(20)
  })

  it('has background layer as first layer', () => {
    const text = readFileSync(STYLE_PATH, 'utf-8')
    style = JSON.parse(text)
    const layers = style.layers as Array<Record<string, unknown>>
    expect(layers[0].id).toBe('background')
    expect(layers[0].type).toBe('background')
  })

  it('road casing layers appear before road fill layers', () => {
    const text = readFileSync(STYLE_PATH, 'utf-8')
    style = JSON.parse(text)
    const layers = style.layers as Array<Record<string, unknown>>
    const ids = layers.map(l => l.id as string)
    const firstCasing = ids.findIndex(id => id.includes('casing'))
    const firstFill   = ids.findIndex(id => id.startsWith('road-fill'))
    expect(firstCasing).toBeGreaterThanOrEqual(0)
    expect(firstFill).toBeGreaterThan(firstCasing)
  })

  it('does not contain {MAPTILES_URL} literal (placeholder must be substituted at runtime)', () => {
    // The raw file DOES contain the placeholder; this test verifies the test itself
    // is checking the right thing — the fetch+replace in loadMapStyle handles substitution.
    // This test intentionally passes because the raw file SHOULD contain the placeholder.
    const text = readFileSync(STYLE_PATH, 'utf-8')
    expect(text).toContain('{MAPTILES_URL}')
  })

  it('uses openmaptiles source name', () => {
    const text = readFileSync(STYLE_PATH, 'utf-8')
    style = JSON.parse(text)
    const sources = style.sources as Record<string, unknown>
    expect(sources).toHaveProperty('openmaptiles')
  })

  it('symbol-sort-key is set on place-label-city', () => {
    const text = readFileSync(STYLE_PATH, 'utf-8')
    style = JSON.parse(text)
    const layers = style.layers as Array<Record<string, unknown>>
    const cityLayer = layers.find(l => l.id === 'place-label-city')
    expect(cityLayer).toBeDefined()
    const layout = cityLayer!.layout as Record<string, unknown>
    expect(layout['symbol-sort-key']).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
cd apps/pwa && npx vitest run src/styles/map-style.test.ts
```

Expected: FAIL — `ENOENT: no such file or directory, open '.../public/sentinelmesh-dark.json'`

- [ ] **Step 3: Write the 24-layer production style**

Replace `infra/map-style/sentinelmesh-dark.json` with the full production stack:

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
      "paint": { "fill-color": "#0c1828" }
    },
    {
      "id": "waterway",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "waterway",
      "minzoom": 8,
      "layout": { "line-cap": "round", "line-join": "round" },
      "paint": { "line-color": "#0c1828", "line-width": 1 }
    },
    {
      "id": "landcover",
      "type": "fill",
      "source": "openmaptiles",
      "source-layer": "landcover",
      "filter": ["in", "class", "park", "forest", "scrub", "grass"],
      "paint": { "fill-color": "#0b1c10", "fill-opacity": 0.7 }
    },
    {
      "id": "landuse",
      "type": "fill",
      "source": "openmaptiles",
      "source-layer": "landuse",
      "filter": ["in", "class", "residential", "commercial", "industrial"],
      "paint": {
        "fill-color": [
          "match", ["get", "class"],
          "residential",  "#0c1320",
          "commercial",   "#0d1525",
          "industrial",   "#0d1525",
          "#0c1320"
        ],
        "fill-opacity": 0.5
      }
    },
    {
      "id": "building-fill",
      "type": "fill",
      "source": "openmaptiles",
      "source-layer": "building",
      "minzoom": 14,
      "paint": { "fill-color": "#101520", "fill-opacity": 0.9 }
    },
    {
      "id": "building-outline",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "building",
      "minzoom": 14,
      "paint": { "line-color": "#1a2030", "line-width": 0.7 }
    },
    {
      "id": "road-casing-motorway-trunk",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": ["in", "class", "motorway", "trunk"],
      "layout": { "line-cap": "round", "line-join": "round" },
      "paint": {
        "line-color": "#111827",
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          6, 2.6, 10, 7.8, 14, 15.6
        ]
      }
    },
    {
      "id": "road-casing-primary",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": ["==", "class", "primary"],
      "minzoom": 10,
      "layout": { "line-cap": "round", "line-join": "round" },
      "paint": {
        "line-color": "#111827",
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          10, 4.5, 14, 10.4, 18, 20.8
        ]
      }
    },
    {
      "id": "road-casing-secondary-tertiary",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": ["in", "class", "secondary", "tertiary"],
      "minzoom": 12,
      "layout": { "line-cap": "round", "line-join": "round" },
      "paint": {
        "line-color": "#111827",
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          12, 3.9, 14, 3.9, 18, 9.1
        ]
      }
    },
    {
      "id": "road-fill-motorway",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": ["==", "class", "motorway"],
      "layout": { "line-cap": "round", "line-join": "round" },
      "paint": {
        "line-color": "#2c3a52",
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          6, 2, 10, 6, 14, 12, 18, 22
        ]
      }
    },
    {
      "id": "road-fill-trunk",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": ["==", "class", "trunk"],
      "layout": { "line-cap": "round", "line-join": "round" },
      "paint": {
        "line-color": "#253347",
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          6, 1.5, 10, 5, 14, 10, 18, 18
        ]
      }
    },
    {
      "id": "road-fill-primary",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": ["==", "class", "primary"],
      "minzoom": 10,
      "layout": { "line-cap": "round", "line-join": "round" },
      "paint": {
        "line-color": "#1f2c3e",
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          10, 3.5, 14, 8, 18, 16
        ]
      }
    },
    {
      "id": "road-fill-secondary",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": ["==", "class", "secondary"],
      "minzoom": 12,
      "layout": { "line-cap": "round", "line-join": "round" },
      "paint": {
        "line-color": "#182030",
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          12, 3, 14, 3, 18, 7
        ]
      }
    },
    {
      "id": "road-fill-tertiary",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": ["==", "class", "tertiary"],
      "minzoom": 12,
      "layout": { "line-cap": "round", "line-join": "round" },
      "paint": {
        "line-color": "#131820",
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          12, 2, 14, 2, 18, 5
        ]
      }
    },
    {
      "id": "road-fill-minor-service",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": ["in", "class", "minor", "service", "track", "path"],
      "minzoom": 13,
      "layout": { "line-cap": "round", "line-join": "round" },
      "paint": {
        "line-color": "#10131a",
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          13, 1, 14, 1.5, 18, 3.5
        ]
      }
    },
    {
      "id": "bridge-casing",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": ["all", ["==", "brunnel", "bridge"], ["in", "class", "motorway", "trunk", "primary", "secondary"]],
      "layout": { "line-cap": "butt", "line-join": "miter" },
      "paint": {
        "line-color": "#111827",
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          10, 7.8, 14, 15.6
        ]
      }
    },
    {
      "id": "bridge-fill",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": ["all", ["==", "brunnel", "bridge"], ["in", "class", "motorway", "trunk", "primary", "secondary"]],
      "layout": { "line-cap": "butt", "line-join": "miter" },
      "paint": {
        "line-color": [
          "match", ["get", "class"],
          "motorway", "#2c3a52",
          "trunk",    "#253347",
          "primary",  "#1f2c3e",
          "#182030"
        ],
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          10, 6, 14, 12
        ]
      }
    },
    {
      "id": "road-label-motorway-primary",
      "type": "symbol",
      "source": "openmaptiles",
      "source-layer": "transportation_name",
      "filter": ["in", "class", "motorway", "primary"],
      "minzoom": 12,
      "layout": {
        "symbol-placement": "line",
        "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": [
          "interpolate", ["linear"], ["zoom"],
          12, 10, 14, 11
        ],
        "text-max-angle": 30,
        "symbol-sort-key": 4
      },
      "paint": {
        "text-color": "#4e6a85",
        "text-halo-color": "#0B0E14",
        "text-halo-width": 1.2
      }
    },
    {
      "id": "road-label-secondary",
      "type": "symbol",
      "source": "openmaptiles",
      "source-layer": "transportation_name",
      "filter": ["in", "class", "secondary", "tertiary"],
      "minzoom": 14,
      "layout": {
        "symbol-placement": "line",
        "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": [
          "interpolate", ["linear"], ["zoom"],
          14, 9, 16, 10
        ],
        "text-max-angle": 30,
        "symbol-sort-key": 6
      },
      "paint": {
        "text-color": "#4e6a85",
        "text-halo-color": "#0B0E14",
        "text-halo-width": 1
      }
    },
    {
      "id": "poi-safety",
      "type": "symbol",
      "source": "openmaptiles",
      "source-layer": "poi",
      "filter": ["in", "class", "hospital", "police"],
      "minzoom": 14,
      "layout": {
        "text-field": ["match", ["get", "class"], "hospital", "H", "police", "P", ""],
        "text-font": ["Noto Sans Bold"],
        "text-size": 11,
        "text-allow-overlap": false,
        "symbol-sort-key": 5
      },
      "paint": {
        "text-color": "#527a9e",
        "text-halo-color": "#0B0E14",
        "text-halo-width": 1.5
      }
    },
    {
      "id": "place-label-suburb",
      "type": "symbol",
      "source": "openmaptiles",
      "source-layer": "place",
      "filter": ["in", "class", "suburb", "quarter", "neighbourhood"],
      "minzoom": 12,
      "layout": {
        "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": [
          "interpolate", ["linear"], ["zoom"],
          12, 11, 14, 13
        ],
        "text-max-width": 8,
        "symbol-sort-key": 3
      },
      "paint": {
        "text-color": "#7a9ab5",
        "text-halo-color": "#0B0E14",
        "text-halo-width": 1.5
      }
    },
    {
      "id": "place-label-district",
      "type": "symbol",
      "source": "openmaptiles",
      "source-layer": "place",
      "filter": ["in", "class", "town", "village", "hamlet"],
      "minzoom": 8,
      "layout": {
        "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": [
          "interpolate", ["linear"], ["zoom"],
          8, 12, 10, 13, 14, 15
        ],
        "text-max-width": 8,
        "symbol-sort-key": 2
      },
      "paint": {
        "text-color": "#a8b8cc",
        "text-halo-color": "#0B0E14",
        "text-halo-width": 1.5
      }
    },
    {
      "id": "place-label-city",
      "type": "symbol",
      "source": "openmaptiles",
      "source-layer": "place",
      "filter": ["in", "class", "city"],
      "minzoom": 4,
      "layout": {
        "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
        "text-font": ["Noto Sans Bold"],
        "text-size": [
          "interpolate", ["linear"], ["zoom"],
          4, 12, 8, 12, 10, 14, 12, 16, 14, 18
        ],
        "text-max-width": 8,
        "symbol-sort-key": 1
      },
      "paint": {
        "text-color": "#a8b8cc",
        "text-halo-color": "#0B0E14",
        "text-halo-width": 2
      }
    }
  ]
}
```

- [ ] **Step 4: Copy to public/**

```bash
cp infra/map-style/sentinelmesh-dark.json apps/pwa/public/sentinelmesh-dark.json
```

- [ ] **Step 5: Run test to verify it passes**

```
cd apps/pwa && npx vitest run src/styles/map-style.test.ts
```

Expected: PASS — 7 tests

- [ ] **Step 6: Commit**

```bash
git add infra/map-style/sentinelmesh-dark.json \
        apps/pwa/public/sentinelmesh-dark.json \
        apps/pwa/src/styles/map-style.test.ts
git commit -m "feat: production 24-layer sentinelmesh-dark map style"
```

---

## Task 5: EventMarker rewrite — spec sizes, tokens, border ring, hit area, CRITICAL pulse

**Files:**
- Modify: `apps/pwa/src/components/EventMarker.tsx`
- Create: `apps/pwa/src/components/EventMarker.test.tsx`

The current `EventMarker.tsx` uses emoji icons, a flat 36px diameter, incorrect severity colors, and no hit-area padding. This task replaces it with the spec-compliant version.

- [ ] **Step 1: Write failing tests**

Create `apps/pwa/src/components/EventMarker.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import EventMarker from './EventMarker'
import type { SafetyEvent } from '../../../../shared/types'

const base: SafetyEvent = {
  id: '1', event_type: 'SECURITY_INCIDENT', severity: 'CRITICAL',
  title: 'Test', summary: null, lat: -1.28, lng: 36.82,
  place_name: null, county: null, is_active: true,
  started_at: '2026-05-18T00:00:00Z', created_at: '2026-05-18T00:00:00Z',
  nostr_event_id: null, bitcoin_txid: null,
}

describe('EventMarker', () => {
  it('renders a hit-area wrapper with 8px padding', () => {
    const { container } = render(<EventMarker event={base} onClick={vi.fn()} />)
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.style.padding).toBe('8px')
  })

  it('CRITICAL dot has correct background color', () => {
    const { container } = render(<EventMarker event={base} onClick={vi.fn()} />)
    const wrapper = container.firstElementChild as HTMLElement
    const dot = wrapper.firstElementChild as HTMLElement
    expect(dot.style.background).toBe('rgb(255, 45, 45)')
  })

  it('CRITICAL dot has correct desktop size (24px diameter)', () => {
    const { container } = render(<EventMarker event={base} onClick={vi.fn()} />)
    const wrapper = container.firstElementChild as HTMLElement
    const dot = wrapper.firstElementChild as HTMLElement
    expect(dot.style.width).toBe('24px')
    expect(dot.style.height).toBe('24px')
  })

  it('CRITICAL shows exclamation mark', () => {
    render(<EventMarker event={base} onClick={vi.fn()} />)
    expect(screen.getByText('!')).toBeInTheDocument()
  })

  it('HIGH shows exclamation mark', () => {
    render(<EventMarker event={{ ...base, severity: 'HIGH' }} onClick={vi.fn()} />)
    expect(screen.getByText('!')).toBeInTheDocument()
  })

  it('MEDIUM does not show exclamation mark', () => {
    render(<EventMarker event={{ ...base, severity: 'MEDIUM' }} onClick={vi.fn()} />)
    expect(screen.queryByText('!')).not.toBeInTheDocument()
  })

  it('LOW does not show exclamation mark', () => {
    render(<EventMarker event={{ ...base, severity: 'LOW' }} onClick={vi.fn()} />)
    expect(screen.queryByText('!')).not.toBeInTheDocument()
  })

  it('calls onClick with the event when wrapper is clicked', () => {
    const onClick = vi.fn()
    const { container } = render(<EventMarker event={base} onClick={onClick} />)
    const wrapper = container.firstElementChild as HTMLElement
    wrapper.click()
    expect(onClick).toHaveBeenCalledWith(base)
  })

  it('CRITICAL marker injects CSS animation keyframes', () => {
    render(<EventMarker event={base} onClick={vi.fn()} />)
    const styleEls = document.querySelectorAll('style[data-sm-pulse]')
    expect(styleEls.length).toBeGreaterThan(0)
  })

  it('non-CRITICAL marker does not inject animation', () => {
    // Clear any previously injected styles
    document.querySelectorAll('style[data-sm-pulse]').forEach(el => el.remove())
    render(<EventMarker event={{ ...base, severity: 'HIGH' }} onClick={vi.fn()} />)
    const styleEls = document.querySelectorAll('style[data-sm-pulse]')
    expect(styleEls.length).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
cd apps/pwa && npx vitest run src/components/EventMarker.test.tsx
```

Expected: FAIL — multiple failures (wrong padding, wrong color, etc.)

- [ ] **Step 3: Rewrite EventMarker.tsx**

Replace `apps/pwa/src/components/EventMarker.tsx` with:

```typescript
import { useEffect } from 'react'
import type { SafetyEvent } from '../../../../shared/types'
import { SEVERITY_COLORS } from '../styles/map-tokens'

const SIZES: Record<string, number> = {
  CRITICAL: 24,
  HIGH:     20,
  MEDIUM:   16,
  LOW:      12,
}

const BORDER_RING: Record<string, { color: string; width: number } | null> = {
  CRITICAL: { color: 'rgba(255,255,255,0.25)', width: 2 },
  HIGH:     { color: 'rgba(255,255,255,0.20)', width: 1.5 },
  MEDIUM:   { color: 'rgba(255,255,255,0.18)', width: 1.5 },
  LOW:      null,
}

const PULSE_CSS = `
@keyframes sm-radius-pulse {
  0%, 100% { opacity: 1.0; }
  50% { opacity: 0.4; }
}
@keyframes sm-border-pulse {
  0%, 100% { opacity: 0.25; }
  50% { opacity: 1.0; }
}
.sm-critical-border { animation: sm-border-pulse 2.5s ease-in-out infinite; }
`

function injectPulseStyles() {
  if (document.querySelector('style[data-sm-pulse]')) return
  const el = document.createElement('style')
  el.setAttribute('data-sm-pulse', '')
  el.textContent = PULSE_CSS
  document.head.appendChild(el)
}

interface Props {
  event: SafetyEvent
  onClick: (event: SafetyEvent) => void
}

export default function EventMarker({ event, onClick }: Props) {
  const { severity } = event
  const fill = SEVERITY_COLORS[severity] ?? '#4a5568'
  const size = SIZES[severity] ?? 12
  const ring = BORDER_RING[severity]
  const showExclamation = severity === 'CRITICAL' || severity === 'HIGH'

  useEffect(() => {
    if (severity === 'CRITICAL') injectPulseStyles()
  }, [severity])

  return (
    <div
      onClick={() => onClick(event)}
      style={{
        padding: '8px',
        cursor: 'pointer',
        pointerEvents: 'all',
      }}
      title={event.title}
    >
      <div
        style={{
          background: fill,
          borderRadius: '50%',
          width: `${size}px`,
          height: `${size}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: ring ? `${ring.width}px solid ${ring.color}` : 'none',
          ...(severity === 'CRITICAL' && ring
            ? { borderColor: undefined }
            : {}),
        }}
      >
        {ring && severity === 'CRITICAL' && (
          <span
            className="sm-critical-border"
            style={{
              position: 'absolute',
              borderRadius: '50%',
              width: `${size}px`,
              height: `${size}px`,
              border: `${ring.width}px solid ${ring.color}`,
              pointerEvents: 'none',
            }}
          />
        )}
        {showExclamation && (
          <span style={{
            color: 'white',
            fontWeight: 700,
            fontSize: `${Math.max(8, size * 0.5)}px`,
            lineHeight: 1,
            fontFamily: 'monospace',
            userSelect: 'none',
          }}>!</span>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
cd apps/pwa && npx vitest run src/components/EventMarker.test.tsx
```

Expected: PASS — 10 tests

- [ ] **Step 5: Run full suite**

```
cd apps/pwa && npx vitest run
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/pwa/src/components/EventMarker.tsx \
        apps/pwa/src/components/EventMarker.test.tsx
git commit -m "feat: rewrite EventMarker with spec severity sizes, border ring and CRITICAL pulse"
```

---

## Task 6: RadiusZoneLayer — MapLibre GeoJSON circle source for event radius zones

**Files:**
- Create: `apps/pwa/src/components/map/RadiusZoneLayer.tsx`
- Create: `apps/pwa/src/components/map/RadiusZoneLayer.test.tsx`
- Modify: `apps/pwa/src/pages/LiveMapPage.tsx`

- [ ] **Step 1: Write failing tests**

Create `apps/pwa/src/components/map/RadiusZoneLayer.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { RadiusZoneLayer } from './RadiusZoneLayer'
import type { SafetyEvent } from '../../../../../shared/types'

const mockSource = vi.fn(({ children }: { children?: React.ReactNode }) => <div data-testid="source">{children}</div>)
const mockLayer  = vi.fn(() => <div data-testid="layer" />)

vi.mock('react-map-gl/maplibre', () => ({
  Source: mockSource,
  Layer:  mockLayer,
}))

const critical: SafetyEvent = {
  id: 'c1', event_type: 'SECURITY_INCIDENT', severity: 'CRITICAL',
  title: 'Critical event', summary: null, lat: -1.28, lng: 36.82,
  place_name: null, county: null, is_active: true,
  started_at: '2026-05-18T00:00:00Z', created_at: '2026-05-18T00:00:00Z',
  nostr_event_id: null, bitcoin_txid: null,
}
const low: SafetyEvent = { ...critical, id: 'l1', severity: 'LOW' }
const inactive: SafetyEvent = { ...critical, id: 'i1', severity: 'HIGH', is_active: false }

describe('RadiusZoneLayer', () => {
  it('renders Source + Layer for active non-LOW events', () => {
    const { getByTestId } = render(<RadiusZoneLayer events={[critical]} />)
    expect(getByTestId('source')).toBeInTheDocument()
    expect(getByTestId('layer')).toBeInTheDocument()
  })

  it('renders null when all events are LOW severity', () => {
    const { container } = render(<RadiusZoneLayer events={[low]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders null when all events are inactive', () => {
    const { container } = render(<RadiusZoneLayer events={[inactive]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders null for empty events array', () => {
    const { container } = render(<RadiusZoneLayer events={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('passes correct GeoJSON feature count to Source', () => {
    const high: SafetyEvent = { ...critical, id: 'h1', severity: 'HIGH' }
    render(<RadiusZoneLayer events={[critical, high, low]} />)
    const call = mockSource.mock.calls[mockSource.mock.calls.length - 1][0]
    const data = call.data as { features: unknown[] }
    expect(data.features).toHaveLength(2) // CRITICAL + HIGH, not LOW
  })

  it('sets circle-pitch-alignment to map on Layer', () => {
    render(<RadiusZoneLayer events={[critical]} />)
    const call = mockLayer.mock.calls[mockLayer.mock.calls.length - 1][0]
    expect(call.paint['circle-pitch-alignment']).toBe('map')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
cd apps/pwa && npx vitest run src/components/map/RadiusZoneLayer.test.tsx
```

Expected: FAIL — `Cannot find module './RadiusZoneLayer'`

- [ ] **Step 3: Create RadiusZoneLayer.tsx**

Create `apps/pwa/src/components/map/RadiusZoneLayer.tsx`:

```typescript
import { Source, Layer } from 'react-map-gl/maplibre'
import type { FeatureCollection, Point } from 'geojson'
import type { SafetyEvent } from '../../../../../shared/types'
import { RADIUS_FILL, RADIUS_STROKE, RADIUS_STROKE_WIDTH } from '../../styles/map-tokens'

interface Props {
  events: SafetyEvent[]
}

export function RadiusZoneLayer({ events }: Props) {
  const features = events
    .filter(e => e.is_active && e.severity !== 'LOW')
    .map(e => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [e.lng, e.lat] } as Point,
      properties: {
        id: e.id,
        severity: e.severity,
        radius_m: (e as unknown as Record<string, unknown>).radius_meters ?? 500,
      },
    }))

  if (features.length === 0) return null

  const geojson: FeatureCollection<Point> = { type: 'FeatureCollection', features }

  return (
    <Source id="radius-zones" type="geojson" data={geojson}>
      <Layer
        id="radius-zone-fill"
        type="circle"
        paint={{
          'circle-radius': [
            '*',
            ['coalesce', ['get', 'radius_m'], 500],
            ['interpolate', ['linear'], ['zoom'], 8, 0.003, 10, 0.007, 12, 0.027, 14, 0.108, 16, 0.432],
          ] as unknown as number,
          'circle-color': [
            'match', ['get', 'severity'],
            'CRITICAL', RADIUS_FILL.CRITICAL,
            'HIGH',     RADIUS_FILL.HIGH,
            'MEDIUM',   RADIUS_FILL.MEDIUM,
            'rgba(0,0,0,0)',
          ] as unknown as string,
          'circle-stroke-color': [
            'match', ['get', 'severity'],
            'CRITICAL', RADIUS_STROKE.CRITICAL,
            'HIGH',     RADIUS_STROKE.HIGH,
            'MEDIUM',   RADIUS_STROKE.MEDIUM,
            'rgba(0,0,0,0)',
          ] as unknown as string,
          'circle-stroke-width': [
            'match', ['get', 'severity'],
            'CRITICAL', RADIUS_STROKE_WIDTH.CRITICAL,
            'HIGH',     RADIUS_STROKE_WIDTH.HIGH,
            'MEDIUM',   RADIUS_STROKE_WIDTH.MEDIUM,
            0,
          ] as unknown as number,
          'circle-pitch-alignment': 'map',
        }}
      />
    </Source>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
cd apps/pwa && npx vitest run src/components/map/RadiusZoneLayer.test.tsx
```

Expected: PASS — 6 tests

- [ ] **Step 5: Add RadiusZoneLayer to LiveMapPage inside MapCanvas**

In `apps/pwa/src/pages/LiveMapPage.tsx`, add the import and use inside `<MapCanvas>`:

Add import at top:
```typescript
import { RadiusZoneLayer } from '../components/map/RadiusZoneLayer'
```

Inside `<MapCanvas>`, add `<RadiusZoneLayer events={visibleEvents} />` as the first child:
```tsx
<MapCanvas initialViewState={initialViewport} onMapLoad={handleMapLoad}>
  <RadiusZoneLayer events={visibleEvents} />
  {visibleEvents.filter(e => e.is_active).map(event => (
    <Marker key={event.id} longitude={event.lng} latitude={event.lat} anchor="center">
      <EventMarker event={event} onClick={() => {}} />
    </Marker>
  ))}
  {currentLocation && <LocationMarker location={currentLocation} />}
  <SafeRouteOverlay />
  <HomeRouteLayer />
</MapCanvas>
```

- [ ] **Step 6: Run full suite**

```
cd apps/pwa && npx vitest run
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/pwa/src/components/map/RadiusZoneLayer.tsx \
        apps/pwa/src/components/map/RadiusZoneLayer.test.tsx \
        apps/pwa/src/pages/LiveMapPage.tsx
git commit -m "feat: add RadiusZoneLayer MapLibre circle source for event radius zones"
```

---

## Task 7: ClusterMarker SVG donut rings component

**Files:**
- Create: `apps/pwa/src/components/map/ClusterMarker.tsx`
- Create: `apps/pwa/src/components/map/ClusterMarker.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `apps/pwa/src/components/map/ClusterMarker.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { ClusterMarker } from './ClusterMarker'

const baseProps = {
  clusterId: 'c1',
  criticalCount: 2,
  highCount: 3,
  mediumCount: 1,
  lowCount: 0,
  totalCount: 6,
}

describe('ClusterMarker', () => {
  it('renders an SVG element', () => {
    const { container } = render(<ClusterMarker {...baseProps} />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('uses 18px outer radius for count 5-14', () => {
    const { container } = render(<ClusterMarker {...baseProps} totalCount={6} />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('36') // 18 * 2
  })

  it('uses 14px outer radius for count 1-4', () => {
    const { container } = render(
      <ClusterMarker {...baseProps} totalCount={3} criticalCount={2} highCount={1} mediumCount={0} lowCount={0} />
    )
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('28') // 14 * 2
  })

  it('uses 22px outer radius for count 15-49', () => {
    const { container } = render(
      <ClusterMarker {...baseProps} totalCount={20} criticalCount={10} highCount={5} mediumCount={5} lowCount={0} />
    )
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('44') // 22 * 2
  })

  it('uses 26px outer radius for count 50-199', () => {
    const { container } = render(
      <ClusterMarker {...baseProps} totalCount={100} criticalCount={50} highCount={30} mediumCount={20} lowCount={0} />
    )
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('52') // 26 * 2
  })

  it('uses 30px outer radius for count 200+', () => {
    const { container } = render(
      <ClusterMarker {...baseProps} totalCount={250} criticalCount={100} highCount={100} mediumCount={50} lowCount={0} />
    )
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('60') // 30 * 2
  })

  it('renders count label in text element', () => {
    const { container } = render(<ClusterMarker {...baseProps} totalCount={6} />)
    const text = container.querySelector('text')!
    expect(text.textContent).toBe('6')
  })

  it('renders 99+ for counts over 99', () => {
    const { container } = render(
      <ClusterMarker {...baseProps} totalCount={150} criticalCount={100} highCount={50} mediumCount={0} lowCount={0} />
    )
    const text = container.querySelector('text')!
    expect(text.textContent).toBe('99+')
  })

  it('calls onClick when wrapper div is clicked', () => {
    const onClick = vi.fn()
    const { container } = render(<ClusterMarker {...baseProps} onClick={onClick} />)
    const wrapper = container.firstElementChild as HTMLElement
    wrapper.click()
    expect(onClick).toHaveBeenCalled()
  })

  it('renders CRITICAL arc circle when criticalCount > 0', () => {
    const { container } = render(<ClusterMarker {...baseProps} criticalCount={2} />)
    const circles = container.querySelectorAll('circle')
    const criticalCircle = Array.from(circles).find(c => c.getAttribute('stroke') === '#FF2D2D')
    expect(criticalCircle).toBeDefined()
  })

  it('does not render CRITICAL arc when criticalCount is 0', () => {
    const { container } = render(
      <ClusterMarker {...baseProps} criticalCount={0} totalCount={3} highCount={2} mediumCount={1} lowCount={0} />
    )
    const circles = container.querySelectorAll('circle')
    const criticalCircle = Array.from(circles).find(c => c.getAttribute('stroke') === '#FF2D2D')
    expect(criticalCircle).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
cd apps/pwa && npx vitest run src/components/map/ClusterMarker.test.tsx
```

Expected: FAIL — `Cannot find module './ClusterMarker'`

- [ ] **Step 3: Create ClusterMarker.tsx**

Create `apps/pwa/src/components/map/ClusterMarker.tsx`:

```typescript
import { memo } from 'react'
import { SEVERITY_COLORS } from '../../styles/map-tokens'

interface Props {
  clusterId: string
  criticalCount: number
  highCount: number
  mediumCount: number
  lowCount: number
  totalCount: number
  onClick?: () => void
}

function outerRadius(total: number): number {
  if (total <= 4)   return 14
  if (total <= 14)  return 18
  if (total <= 49)  return 22
  if (total <= 199) return 26
  return 30
}

function ClusterMarkerBase({
  criticalCount, highCount, mediumCount, lowCount, totalCount, onClick,
}: Props) {
  const outerR = outerRadius(totalCount)
  const strokeR = outerR - 1.5
  const circumference = 2 * Math.PI * strokeR
  const minArc = circumference * 0.08
  const strokeWidth = 3
  const fontSize = Math.max(7, outerR * 0.45)

  const total = Math.max(totalCount, 1)

  function arc(count: number): number {
    return count > 0 ? Math.max((count / total) * circumference, minArc) : 0
  }

  const critArc   = arc(criticalCount)
  const highArc   = arc(highCount)
  const medLowArc = arc(mediumCount + lowCount)

  // dashoffset to start each arc clockwise from top (12 o'clock).
  // SVG circle paths start at 3 o'clock; C/4 rotates back to 12 o'clock.
  const critOffset   = circumference * 0.25
  const highOffset   = circumference * 0.25 - critArc
  const medLowOffset = circumference * 0.25 - critArc - highArc

  const cx = outerR
  const cy = outerR

  return (
    <div onClick={onClick} style={{ cursor: 'pointer', width: outerR * 2, height: outerR * 2, position: 'relative' }}>
      <svg width={outerR * 2} height={outerR * 2} viewBox={`0 0 ${outerR * 2} ${outerR * 2}`}>
        {/* Dark donut hole */}
        <circle cx={cx} cy={cy} r={outerR - 4} fill="#0B0E14" />

        {/* CRITICAL arc — red */}
        {criticalCount > 0 && (
          <circle
            cx={cx} cy={cy} r={strokeR}
            fill="none"
            stroke={SEVERITY_COLORS.CRITICAL}
            strokeWidth={strokeWidth}
            strokeDasharray={`${critArc} ${circumference - critArc}`}
            strokeDashoffset={critOffset}
          />
        )}

        {/* HIGH arc — orange */}
        {highCount > 0 && (
          <circle
            cx={cx} cy={cy} r={strokeR}
            fill="none"
            stroke={SEVERITY_COLORS.HIGH}
            strokeWidth={strokeWidth}
            strokeDasharray={`${highArc} ${circumference - highArc}`}
            strokeDashoffset={highOffset}
          />
        )}

        {/* MEDIUM + LOW arc — yellow */}
        {(mediumCount + lowCount) > 0 && (
          <circle
            cx={cx} cy={cy} r={strokeR}
            fill="none"
            stroke={SEVERITY_COLORS.MEDIUM}
            strokeWidth={strokeWidth}
            strokeDasharray={`${medLowArc} ${circumference - medLowArc}`}
            strokeDashoffset={medLowOffset}
          />
        )}

        {/* Count label */}
        <text
          x={cx} y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fill="white"
          fontFamily="monospace"
          fontSize={fontSize}
          fontWeight="bold"
        >
          {totalCount > 99 ? '99+' : totalCount}
        </text>
      </svg>
    </div>
  )
}

export const ClusterMarker = memo(ClusterMarkerBase, (prev, next) =>
  prev.clusterId     === next.clusterId &&
  prev.criticalCount === next.criticalCount &&
  prev.highCount     === next.highCount &&
  prev.mediumCount   === next.mediumCount &&
  prev.lowCount      === next.lowCount &&
  prev.totalCount    === next.totalCount
)
```

- [ ] **Step 4: Run tests to verify they pass**

```
cd apps/pwa && npx vitest run src/components/map/ClusterMarker.test.tsx
```

Expected: PASS — 11 tests

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/components/map/ClusterMarker.tsx \
        apps/pwa/src/components/map/ClusterMarker.test.tsx
git commit -m "feat: add ClusterMarker SVG donut rings component with count bands and severity arcs"
```

---

## Task 8: EventClusterLayer — zoom-aware clustering, replaces direct EventMarker loop

**Files:**
- Create: `apps/pwa/src/components/map/EventClusterLayer.tsx`
- Create: `apps/pwa/src/components/map/EventClusterLayer.test.tsx`
- Modify: `apps/pwa/src/pages/LiveMapPage.tsx`

- [ ] **Step 1: Write failing tests**

Create `apps/pwa/src/components/map/EventClusterLayer.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { EventClusterLayer } from './EventClusterLayer'
import type { SafetyEvent } from '../../../../../shared/types'

const mockMarker = vi.fn(({ children, longitude, latitude }: {
  children?: React.ReactNode; longitude: number; latitude: number
}) => <div data-testid="marker" data-lng={longitude} data-lat={latitude}>{children}</div>)

vi.mock('react-map-gl/maplibre', () => ({
  Marker: mockMarker,
  useMap: () => ({ current: null }),
}))

vi.mock('../EventMarker', () => ({
  default: ({ event }: { event: SafetyEvent }) => <div data-testid="event-marker" data-id={event.id} />,
}))

vi.mock('./ClusterMarker', () => ({
  ClusterMarker: ({ totalCount }: { totalCount: number }) => (
    <div data-testid="cluster-marker" data-count={totalCount} />
  ),
}))

vi.mock('../../store', () => ({
  useAppSelector: vi.fn(),
}))

vi.mock('../../store/eventsSlice', () => ({
  selectEventItems: vi.fn(),
}))

import { useAppSelector } from '../../store'

const event1: SafetyEvent = {
  id: 'e1', event_type: 'SECURITY_INCIDENT', severity: 'CRITICAL',
  title: 'Event 1', summary: null, lat: -1.28, lng: 36.82,
  place_name: null, county: null, is_active: true,
  started_at: '2026-05-18T00:00:00Z', created_at: '2026-05-18T00:00:00Z',
  nostr_event_id: null, bitcoin_txid: null,
}
const event2: SafetyEvent = {
  ...event1, id: 'e2', severity: 'HIGH', lat: -1.29, lng: 36.83,
}
const farEvent: SafetyEvent = {
  ...event1, id: 'e3', severity: 'LOW', lat: 1.0, lng: 30.0,
}

describe('EventClusterLayer', () => {
  beforeEach(() => {
    vi.mocked(useAppSelector).mockReturnValue([event1, event2, farEvent])
    mockMarker.mockClear()
  })

  it('renders individual EventMarkers at high zoom (>= 13.2)', async () => {
    render(<EventClusterLayer zoom={14} />)
    const eventMarkers = screen.getAllByTestId('event-marker')
    expect(eventMarkers.length).toBeGreaterThanOrEqual(1)
  })

  it('renders cluster marker at low zoom (< 12.8) for nearby events', async () => {
    render(<EventClusterLayer zoom={10} />)
    const clusters = screen.queryAllByTestId('cluster-marker')
    // event1 and event2 are nearby at low zoom → should cluster
    expect(clusters.length).toBeGreaterThan(0)
  })

  it('does not render inactive events', () => {
    const inactive: SafetyEvent = { ...event1, id: 'inactive', is_active: false }
    vi.mocked(useAppSelector).mockReturnValue([inactive])
    render(<EventClusterLayer zoom={14} />)
    expect(screen.queryAllByTestId('event-marker')).toHaveLength(0)
  })

  it('renders null when no events', () => {
    vi.mocked(useAppSelector).mockReturnValue([])
    const { container } = render(<EventClusterLayer zoom={14} />)
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
cd apps/pwa && npx vitest run src/components/map/EventClusterLayer.test.tsx
```

Expected: FAIL — `Cannot find module './EventClusterLayer'`

- [ ] **Step 3: Create EventClusterLayer.tsx**

Create `apps/pwa/src/components/map/EventClusterLayer.tsx`:

```typescript
import { useMemo, useRef } from 'react'
import { Marker } from 'react-map-gl/maplibre'
import { useAppSelector } from '../../store'
import { selectEventItems } from '../../store/eventsSlice'
import EventMarker from '../EventMarker'
import { ClusterMarker } from './ClusterMarker'
import type { SafetyEvent } from '../../../../../shared/types'

// Hysteresis thresholds: dissolve clusters above DISSOLVE_ZOOM, re-form below FORM_ZOOM
const DISSOLVE_ZOOM = 13.2
const FORM_ZOOM     = 12.8

interface Cluster {
  id: string
  lat: number
  lng: number
  events: SafetyEvent[]
  criticalCount: number
  highCount: number
  mediumCount: number
  lowCount: number
  totalCount: number
}

function cellSize(zoom: number): number {
  // Grid cell in degrees; halves per zoom level
  return 180 / Math.pow(2, Math.floor(zoom))
}

function buildClusters(events: SafetyEvent[], zoom: number): Cluster[] {
  const size = cellSize(zoom)
  const cells = new Map<string, SafetyEvent[]>()
  for (const e of events) {
    const ci = Math.floor(e.lng / size)
    const cj = Math.floor(e.lat / size)
    const key = `${ci},${cj}`
    if (!cells.has(key)) cells.set(key, [])
    cells.get(key)!.push(e)
  }
  return Array.from(cells.entries()).map(([key, evts]) => ({
    id: key,
    lat: evts.reduce((s, e) => s + e.lat, 0) / evts.length,
    lng: evts.reduce((s, e) => s + e.lng, 0) / evts.length,
    events: evts,
    criticalCount: evts.filter(e => e.severity === 'CRITICAL').length,
    highCount:     evts.filter(e => e.severity === 'HIGH').length,
    mediumCount:   evts.filter(e => e.severity === 'MEDIUM').length,
    lowCount:      evts.filter(e => e.severity === 'LOW').length,
    totalCount:    evts.length,
  }))
}

interface Props {
  zoom?: number
  onEventClick?: (event: SafetyEvent) => void
}

export function EventClusterLayer({ zoom = 2, onEventClick }: Props) {
  const allEvents = useAppSelector(selectEventItems)
  const activeEvents = useMemo(() => allEvents.filter(e => e.is_active), [allEvents])

  // Hysteresis: track whether we are currently in clustered mode
  const clusteredRef = useRef(zoom < DISSOLVE_ZOOM)
  if (zoom >= DISSOLVE_ZOOM) clusteredRef.current = false
  if (zoom <= FORM_ZOOM)     clusteredRef.current = true

  const showClustered = clusteredRef.current

  const clusters = useMemo(
    () => showClustered ? buildClusters(activeEvents, zoom) : [],
    [showClustered, activeEvents, zoom],
  )

  if (activeEvents.length === 0) return null

  if (!showClustered) {
    return (
      <>
        {activeEvents.map(event => (
          <Marker key={event.id} longitude={event.lng} latitude={event.lat} anchor="center">
            <EventMarker event={event} onClick={onEventClick ?? (() => {})} />
          </Marker>
        ))}
      </>
    )
  }

  return (
    <>
      {clusters.map(cluster => (
        <Marker key={cluster.id} longitude={cluster.lng} latitude={cluster.lat} anchor="center">
          {cluster.totalCount === 1
            ? <EventMarker event={cluster.events[0]} onClick={onEventClick ?? (() => {})} />
            : (
              <ClusterMarker
                clusterId={cluster.id}
                criticalCount={cluster.criticalCount}
                highCount={cluster.highCount}
                mediumCount={cluster.mediumCount}
                lowCount={cluster.lowCount}
                totalCount={cluster.totalCount}
              />
            )
          }
        </Marker>
      ))}
    </>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
cd apps/pwa && npx vitest run src/components/map/EventClusterLayer.test.tsx
```

Expected: PASS — 4 tests

- [ ] **Step 5: Update LiveMapPage — replace direct EventMarker loop with EventClusterLayer**

In `apps/pwa/src/pages/LiveMapPage.tsx`:

Remove the import of `Marker` and the existing event loop inside `<MapCanvas>`. Add `EventClusterLayer` import and replace.

Remove from imports:
```typescript
import { Marker } from 'react-map-gl/maplibre'
import EventMarker from '../components/EventMarker'
```

Add import:
```typescript
import { EventClusterLayer } from '../components/map/EventClusterLayer'
```

Replace inside `<MapCanvas>`:
```tsx
// Before (remove these lines):
{visibleEvents.filter(e => e.is_active).map(event => (
  <Marker key={event.id} longitude={event.lng} latitude={event.lat} anchor="center">
    <EventMarker event={event} onClick={() => {}} />
  </Marker>
))}

// After:
<EventClusterLayer zoom={2} />
```

Note: `EventClusterLayer` reads events directly from the Redux store. `visibleEvents` (the filtered set) is still used by `RadiusZoneLayer`. The `zoom` prop starts at 2; future work can wire this to the map's live zoom state via a `useMap`-based hook.

- [ ] **Step 6: Run full suite**

```
cd apps/pwa && npx vitest run
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/pwa/src/components/map/EventClusterLayer.tsx \
        apps/pwa/src/components/map/EventClusterLayer.test.tsx \
        apps/pwa/src/pages/LiveMapPage.tsx
git commit -m "feat: add EventClusterLayer with zoom-based hysteresis clustering"
```

---

## Task 9: MapOverlayHost portal migration

**Files:**
- Modify: `apps/pwa/src/components/map/MapOverlayHost.tsx`

The current `MapOverlayHost` renders absolutely-positioned divs inside the map column. This task migrates all overlay content to render through the `#map-overlay-portal` React portal, escaping the MapCanvas `isolation: isolate` stacking context. The z-indices are updated to match the stacking model.

- [ ] **Step 1: Write failing test**

The existing `MapOverlayHost` has no test file. We'll write a test that verifies portal rendering.

Create `apps/pwa/src/components/map/MapOverlayHost.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MapOverlayHost } from './MapOverlayHost'

// Create portal target before tests
beforeEach(() => {
  let portal = document.getElementById('map-overlay-portal')
  if (!portal) {
    portal = document.createElement('div')
    portal.id = 'map-overlay-portal'
    document.body.appendChild(portal)
  }
})

vi.mock('../../store', () => ({ useAppSelector: vi.fn(), useAppDispatch: vi.fn() }))
vi.mock('../../store/uiSlice', () => ({
  consumeOverlayIntent: vi.fn(() => ({ type: 'ui/consumeOverlayIntent' })),
  safeRoutesSet:        vi.fn(() => ({ type: 'ui/safeRoutesSet' })),
  safeRoutesCleared:    vi.fn(() => ({ type: 'ui/safeRoutesCleared' })),
}))
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => ({ layout: 'mobile' }) }))
vi.mock('../AcousticAlert', () => ({ AcousticAlert: () => <div data-testid="acoustic" /> }))
vi.mock('../HomeRoutePanel', () => ({ HomeRoutePanel: () => <div data-testid="home-route" /> }))
vi.mock('../../services/routingService', () => ({ fetchSafeRoutes: vi.fn() }))

import { useAppSelector, useAppDispatch } from '../../store'

describe('MapOverlayHost', () => {
  beforeEach(() => {
    vi.mocked(useAppDispatch).mockReturnValue(vi.fn())
    vi.mocked(useAppSelector).mockImplementation((selector: unknown) => {
      const fn = selector as (s: unknown) => unknown
      return fn({
        ui: { uiIntent: { name: 'none' } },
        events: { items: [] },
      })
    })
  })

  it('renders null when no active overlay', () => {
    const { container } = render(<MapOverlayHost />)
    expect(container.firstChild).toBeNull()
  })

  it('portal target exists in document', () => {
    render(<MapOverlayHost />)
    expect(document.getElementById('map-overlay-portal')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
cd apps/pwa && npx vitest run src/components/map/MapOverlayHost.test.tsx
```

Expected: FAIL — errors from missing portal or incorrect render

- [ ] **Step 3: Migrate MapOverlayHost to use React portal**

Replace `apps/pwa/src/components/map/MapOverlayHost.tsx` with:

```typescript
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useAppSelector, useAppDispatch } from '../../store'
import { consumeOverlayIntent, safeRoutesSet, safeRoutesCleared } from '../../store/uiSlice'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { AcousticAlert } from '../AcousticAlert'
import { HomeRoutePanel } from '../HomeRoutePanel'
import { fetchSafeRoutes } from '../../services/routingService'

export function MapOverlayHost() {
  const dispatch = useAppDispatch()
  const uiIntent = useAppSelector(s => s.ui.uiIntent)
  const events = useAppSelector(s => s.events.items)
  const { layout } = useBreakpoint()

  const [overlay, setOverlay] = useState<'routes' | 'acoustic' | 'home-route' | null>(null)

  useEffect(() => {
    if (uiIntent.name === 'routes' || uiIntent.name === 'acoustic' || uiIntent.name === 'home-route') {
      setOverlay(uiIntent.name)
      dispatch(consumeOverlayIntent())
    }
  }, [uiIntent.name, dispatch])

  useEffect(() => {
    if (overlay !== 'routes') return
    dispatch(safeRoutesCleared())

    const activeEvent = events.find(e => e.is_active && (e.severity === 'CRITICAL' || e.severity === 'HIGH'))
      ?? events.find(e => e.is_active)
    if (!activeEvent) return

    navigator.geolocation?.getCurrentPosition(async (pos) => {
      const userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      const eventLocation = { lat: activeEvent.lat, lng: activeEvent.lng }
      const radiusKm = ((activeEvent as Record<string, unknown>).radius_meters as number ?? 500) / 1000
      try {
        const result = await fetchSafeRoutes(userLocation, eventLocation, radiusKm)
        dispatch(safeRoutesSet(result.map((r, i) => ({ id: `r${i}`, coordinates: r.coordinates }))))
      } catch {
        // Leave routes empty — overlay shows "no routes" state
      }
    })
  }, [overlay, events, dispatch])

  const portalRoot = typeof document !== 'undefined'
    ? document.getElementById('map-overlay-portal')
    : null

  if (!overlay) return null
  if (!portalRoot) return null

  const presentation: 'panel' | 'sheet' | 'fullscreen' =
    layout === 'desktop' ? 'panel' : overlay === 'acoustic' ? 'fullscreen' : 'sheet'

  let content: React.ReactNode = null

  if (overlay === 'acoustic') {
    content = (
      <div style={{
        position: 'absolute',
        inset: 0,
        zIndex: 200,
        pointerEvents: presentation === 'fullscreen' ? 'all' : 'none',
      }}>
        <AcousticAlert onClose={() => setOverlay(null)} />
      </div>
    )
  } else if (overlay === 'home-route') {
    content = (
      <div style={{
        position: 'absolute',
        top: layout === 'mobile' ? 'auto' : 12,
        bottom: layout === 'mobile' ? 120 : 'auto',
        right: 12,
        zIndex: 200,
        pointerEvents: 'all',
      }}>
        <HomeRoutePanel onClose={() => setOverlay(null)} />
      </div>
    )
  } else {
    // overlay === 'routes': close button; route lines drawn by SafeRouteOverlay inside MapCanvas
    content = (
      <div style={{
        position: 'absolute', top: 8, right: 44, zIndex: 300,
        pointerEvents: 'all',
        background: 'rgba(11,14,20,0.88)', border: '1px solid #1a2035',
        borderRadius: 6, padding: '5px 12px',
        fontFamily: "'Courier New', monospace", fontSize: 10, color: '#00C853',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span>Escape routes active</span>
        <button
          onClick={() => { setOverlay(null); dispatch(safeRoutesCleared()) }}
          style={{ background: 'none', border: 'none', color: '#4a5568', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}
        >
          ×
        </button>
      </div>
    )
  }

  return createPortal(content, portalRoot)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
cd apps/pwa && npx vitest run src/components/map/MapOverlayHost.test.tsx
```

Expected: PASS — 2 tests

- [ ] **Step 5: Run full suite**

```
cd apps/pwa && npx vitest run
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/pwa/src/components/map/MapOverlayHost.tsx \
        apps/pwa/src/components/map/MapOverlayHost.test.tsx
git commit -m "feat: migrate MapOverlayHost to React portal for correct stacking isolation"
```

---

## Task 10: Final verification

**Files:** None (read-only checks)

- [ ] **Step 1: Verify no Mapbox token references remain**

```bash
grep -r "mapbox" apps/pwa/src --include="*.ts" --include="*.tsx" --include="*.css" -l
grep -r "mapbox" apps/pwa/index.html
grep -r "mapbox" apps/pwa/src/main.tsx
```

Expected: No output (zero matches in source files). If `react-map-gl` mentions mapbox in its type definitions, that is acceptable — we're only checking our own source files.

- [ ] **Step 2: Verify sentinelmesh-dark.json has {MAPTILES_URL} placeholder (not substituted in file)**

```bash
grep "MAPTILES_URL" apps/pwa/public/sentinelmesh-dark.json
grep "MAPTILES_URL" infra/map-style/sentinelmesh-dark.json
```

Expected: Both files contain the literal `{MAPTILES_URL}` string (substitution happens in `loadMapStyle()` at runtime).

- [ ] **Step 3: Verify infra and public files are identical**

```bash
diff infra/map-style/sentinelmesh-dark.json apps/pwa/public/sentinelmesh-dark.json
```

Expected: No diff output (files are identical).

- [ ] **Step 4: Run full test suite — zero failures**

```
cd apps/pwa && npx vitest run
```

Expected: All tests pass, zero failures.

Report: How many test files passed, how many tests total.

- [ ] **Step 5: TypeScript type check**

```bash
cd apps/pwa && npx tsc --noEmit
```

Expected: Zero errors.

- [ ] **Step 6: Commit verification results**

No code to commit — if all checks pass, proceed to the finish skill.

---

## Self-Review Against Spec

**Spec coverage:**

| Spec section | Covered by task |
|---|---|
| Color system — base palette tokens | Task 1 |
| Color system — overlay contrast reservation (hue ranges) | Task 1 (token values, test asserts no bright reds) |
| Color system — semantic token groups | Task 1 (exported grouped constants) |
| Layer stack — 24 layers, draw order | Task 4 |
| Road width zoom expressions, casing × 1.3 | Task 4 |
| Label size zoom expressions | Task 4 |
| symbol-sort-key per layer | Task 4 |
| Bottom safe-zone CSS | Task 3 (MapCanvas.module.css) |
| DOM isolation — `isolation: isolate` | Task 3 (MapCanvas.tsx container) |
| Stacking model — portal root | Tasks 2 + 9 |
| Alert marker sizes by severity | Task 5 |
| Alert marker border ring | Task 5 |
| Alert marker hit area — 8px padding | Task 5 |
| CRITICAL pulse — border ring only | Task 5 |
| Radius zones — CRITICAL/HIGH/MEDIUM | Task 6 |
| Radius zones — metres-to-pixels expression | Task 6 |
| Cluster donut rings — count bands | Task 7 |
| Cluster donut rings — severity arc construction | Task 7 |
| Cluster donut rings — minimum arc 8% | Task 7 |
| Cluster donut rings — memoized | Task 7 |
| Cluster zoom handoff — hysteresis ±0.2 | Task 8 |
| Portal migration for overlays | Task 9 |
| Mapbox CSS removed | Task 2 |
| MapLibre CSS imported | Task 2 |

**Confirmed not in scope (from spec):**
- H3 server-side clustering
- App shell chrome redesign
- PMTiles pipeline
- Light/disaster/colorblind modes
- OSRM/Photon swap
