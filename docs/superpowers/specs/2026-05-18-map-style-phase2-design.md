# SentinelMesh Map Style — Phase 2 Design Spec

**Date:** 2026-05-18
**Status:** Approved for implementation planning
**Scope:** Production-quality dark map style, overlay visualisation language, cluster semantics, mobile-first rendering

---

## Product Principle

The map is an operational tool, not a decorative surface. Every rendering decision is measured against one question: does this help a person under stress understand where danger is and how to move away from it?

Visual hierarchy is therefore a safety architecture constraint. Overlays must dominate the base map. Base map must provide orientation without competing with overlays. This is non-negotiable.

---

## Decisions Summary

| Question | Decision |
|---|---|
| Base detail level | Rich detail — globally familiar cartographic quality |
| Road palette | Slate-blue hybrid — desaturated, restrained, overlay-safe |
| Label system | Operational — districts bold, major roads z12+, hospital/police symbols only |
| Overlay system | High-contrast — scale + contrast + layering, no shape coding |
| Cluster style | Donut rings — severity arc segments + count bands |
| Mobile target | Mobile-first — 44pt tap targets, bottom safe zone, zoom expressions |

---

## Section 1: Color System

### Base palette tokens

| Token | Value | Used for |
|---|---|---|
| `bg` | `#0B0E14` | Map canvas background |
| `water` | `#0c1828` | Rivers, lakes, ocean |
| `park` | `#0b1c10` | Parks, forest, nature areas |
| `landuse-residential` | `#0c1320` | Residential fill |
| `landuse-commercial` | `#0d1525` | Commercial/industrial fill |
| `road-casing` | `#111827` | All road casings (distinctly darker than any road fill) |
| `road-motorway` | `#2c3a52` | Motorway fill |
| `road-primary` | `#1f2c3e` | Primary road fill |
| `road-secondary` | `#182030` | Secondary road fill |
| `road-tertiary` | `#131820` | Tertiary road fill |
| `road-minor` | `#10131a` | Minor/service road fill |
| `building-fill` | `#101520` | Building footprints (z14+) |
| `building-outline` | `#1a2030` | Building edges |
| `label-district` | `#a8b8cc` | CBD and major district names |
| `label-suburb` | `#7a9ab5` | Neighbourhood names |
| `label-minor` | `#607a90` | Minor place names |
| `label-road` | `#4e6a85` | Road name labels |
| `label-poi` | `#527a9e` | Hospital/police symbol colour |

### Overlay contrast reservation

Base-map colors intentionally avoid high-saturation reds, oranges, yellows, and cyans. The following hue ranges are **reserved exclusively for the overlay system** — no base-map layer may use these hue ranges at saturation above 20%:

- `hsl(0°, *, *)` — red range (CRITICAL alerts)
- `hsl(30°, *, *)` — orange range (HIGH alerts)
- `hsl(50°, *, *)` — yellow range (MEDIUM alerts)
- `hsl(185°, *, *)` — cyan range (escape routes)
- `hsl(165°, *, *)` — teal range (family/circle overlays)

This is a safety architecture constraint, not a stylistic preference.

### Semantic token groups

Defined now to enable future rendering modes without rewriting the style:

```
surface-*        bg, water, park, landuse-*              geographic fills
elevated-*       road-*, building-*                      above-ground structures
text-primary     label-district                          highest-contrast labels
text-secondary   label-suburb, label-minor               context labels
text-tertiary    label-road, label-poi                   supporting labels
overlay-danger   #FF2D2D (CRITICAL), #FF9800 (HIGH)      reserved, no base use
overlay-caution  #FFD500 (MEDIUM), #9C27B0 (LOW)         reserved, no base use
overlay-safe     #00E5FF (route), #00E6B4 (family)       reserved, no base use
```

Future modes enabled by this structure (not in scope): `light`, `disaster` (maximum contrast), `colorblind-safe`, `amoled` (true-black surfaces).

---

## Section 2: Layer Stack

### Draw order — 28 layers, bottom to top

**Surfaces (5 layers)**
- `background` — fill, `#0B0E14`, always visible
- `water` — fill, source-layer `water`
- `waterway` — line, source-layer `waterway` (rivers, streams), z8+
- `landcover` — fill, source-layer `landcover` (park, forest, scrub, grass)
- `landuse` — fill, source-layer `landuse`, filtered to residential/commercial/industrial

**Built environment (2 layers)**
- `building-fill` — fill, source-layer `building`, minzoom 14
- `building-outline` — line, source-layer `building`, minzoom 14, stroke `#1a2030` 0.7px

**Road casings (3 layers — rendered before fills)**

Casing width rule: **casing width = fill width × 1.3** at every zoom stop. Casing uses `#111827` — distinctly darker than all road fills. This creates the outline effect. Drawn in dedicated layer pass before fills so fills paint over the centre, leaving only the edge visible.

- `road-casing-motorway-trunk` — line, filter: `motorway`, `trunk`
- `road-casing-primary` — line, filter: `primary`
- `road-casing-secondary-tertiary` — line, filter: `secondary`, `tertiary`

**Road fills (6 layers)**
- `road-fill-motorway`
- `road-fill-trunk`
- `road-fill-primary`
- `road-fill-secondary`
- `road-fill-tertiary`
- `road-fill-minor-service`

**Bridges (2 layers)**
- `bridge-casing` — same expressions as road casings, filter: `brunnel = bridge`
- `bridge-fill` — same expressions as road fills, filter: `brunnel = bridge`

**Labels (6 symbol layers)**
- `road-label-motorway-primary` — symbol, placement: line
- `road-label-secondary` — symbol, placement: line, minzoom 12
- `poi-safety` — symbol, filter: `class IN (hospital, police)`, icon only, z14+; tap/click reveals tooltip label
- `place-label-suburb` — symbol, minzoom 10
- `place-label-district` — symbol, minzoom 8
- `place-label-city` — symbol, minzoom 4

**Label priority weighting**

MapLibre collision detection handles spacing but does not enforce information hierarchy in contested regions. `symbol-sort-key` must be set explicitly:

| Layer | sort-key | Survives collision |
|---|---|---|
| `place-label-city` | 1 | Always |
| `place-label-district` | 2 | High priority |
| `place-label-suburb` | 3 | Medium priority |
| `road-label-motorway-primary` | 4 | Medium priority |
| `poi-safety` | 5 | Lower priority |
| `road-label-secondary` | 6 | Lowest |

This is required for dense cities (Nairobi, Lagos, Mumbai, Cairo) where collision detection alone drops important labels.

### Road width zoom expressions

All widths use `interpolate linear zoom`. Casing widths are fill × 1.3 (shown separately for clarity).

| Class | z6 fill | z10 fill | z14 fill | z18 fill | z6 casing | z10 casing | z14 casing |
|---|---|---|---|---|---|---|---|
| Motorway | 2px | 6px | 12px | 22px | 2.6px | 7.8px | 15.6px |
| Trunk | 1.5px | 5px | 10px | 18px | 2px | 6.5px | 13px |
| Primary | — | 3.5px | 8px | 16px | — | 4.5px | 10.4px |
| Secondary | — | — | 3px | 7px | — | — | 3.9px |
| Tertiary | — | — | 2px | 5px | — | — | 2.6px |
| Minor/service | — | — | 1.5px | 3.5px | — | — | — |

"—" = layer has `minzoom` set; does not render at that zoom.

### Label size zoom expressions

Zoom expressions are designed so effective rendered size never falls below the readability threshold at any zoom level. This is a design constraint on the expression, not a MapLibre API guarantee.

| Label | Floor | z8 | z10 | z12 | z14 |
|---|---|---|---|---|---|
| City name | 12px | 12px | 14px | 16px | 18px |
| District | 11px | — | 12px | 13px | 15px |
| Suburb | 10px | — | — | 11px | 13px |
| Road (motorway/primary) | 9px | — | — | 10px | 11px |
| Road (secondary) | 8px | — | — | — | 9px |
| POI symbol | 11px | — | — | — | 11px (fixed) |

### Bottom safe zone

Not a MapLibre layer — a CSS rule on the map container. Specified here because overlay visibility is an operational requirement.

```css
/* MapCanvas.module.css */
.mapContainer::after {
  content: '';
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 120px;
  background: linear-gradient(to bottom, transparent 0%, rgba(11,14,20,0.72) 100%);
  pointer-events: none;
  z-index: 5;
}
```

Height of 120px covers the nav bar and bottom sheet handle. `pointer-events: none` ensures the gradient does not block taps on markers in this zone.

### Stacking model

```
z-index   Layer
──────────────────────────────────────────────
0         MapLibre canvas (base map)
5–10      Bottom safe-zone gradient (CSS ::after)
20        Radius zone circles
21        Escape route glow underlay
22        Escape route line + waypoint dots
23        Family proximity rings
24        Family member dots
25        Alert marker dots (LOW → MED → HIGH → CRITICAL paint order)
26        Cluster donut rings
30        Map UI chrome (filter chips, Near You callout, GPS notice)
──────────────────────────────────────────────
```

**DOM isolation**: map container must declare `position: relative; isolation: isolate` to create a stacking context. All overlay components render through a dedicated React portal root (`<div id="map-overlay-portal">`) that sits as a sibling of the map canvas in the DOM, not a descendant. This prevents CSS stacking drift between MapLibre internals and React overlay layers.

---

## Section 3: Overlay System

### Alert markers

Dominance through contrast, scale, and layering — no shape coding. Colour is processed faster than shape under stress.

| Severity | Fill | Desktop radius | Mobile radius | Border ring | Exclamation |
|---|---|---|---|---|---|
| CRITICAL | `#FF2D2D` | 12px | 15px | `rgba(255,255,255,0.25)` 2px | white `!` |
| HIGH | `#FF9800` | 10px | 13px | `rgba(255,255,255,0.20)` 1.5px | white `!` |
| MEDIUM | `#FFD500` | 8px | 10px | `rgba(255,255,255,0.18)` 1.5px | none |
| LOW | `#9C27B0` | 6px | 8px | none | none |

Mobile radius applies at viewport width ≤ 430px via CSS media query on the marker wrapper — not a MapLibre expression, since markers are React DOM elements.

**Hit area vs visual area (mobile)**: interaction radius = visual radius + 8px, implemented as transparent `padding: 8px` on the marker wrapper `<div>` with `pointer-events: all`. CSS pixels scale with device pixel ratio automatically — this is high-DPI safe.

### Radius zones

Rendered as MapLibre GeoJSON `circle` features. Radius derived from `event.radius_meters` via a metres-to-pixels zoom expression — scales correctly as the user zooms.

| Severity | Fill | Stroke | Stroke width |
|---|---|---|---|
| CRITICAL | `rgba(255,45,45,0.14)` | `rgba(255,45,45,0.52)` | 1.5px |
| HIGH | `rgba(255,152,0,0.11)` | `rgba(255,152,0,0.45)` | 1.3px |
| MEDIUM | `rgba(255,213,0,0.09)` | `rgba(255,213,0,0.35)` | 1.2px |
| LOW | none | none | — |

### Animation

Animation is used only where it serves peripheral detection under stress. It is not decoration.

| Element | Animation | Condition |
|---|---|---|
| CRITICAL radius zone | `opacity 1.0 → 0.4 → 1.0`, 2.5s ease-in-out, infinite | `is_active && severity === CRITICAL` |
| CRITICAL marker border | `opacity 0.25 → 1.0 → 0.25`, 2.5s ease-in-out, infinite (synchronised with radius) | same condition |
| All other elements | none | — |

Border pulse targets the border ring only — not the fill. Dot fill stays visually stable so it remains a reliable tap target. The synchronized secondary cue improves peripheral detection at low zoom without adding visual noise.

No flashing. No aggressive animation. No animation on clusters, routes, or family overlays.

### Escape / safe routes

Two-pass render:

1. **Glow underlay**: `stroke: rgba(0,229,255,0.18)`, width 7px, no dash — creates soft halo
2. **Route line**: `stroke: #00E5FF`, width 3px (desktop) / 3.5px (mobile), `stroke-dasharray: 7 3.5`

Rendered as MapLibre GeoJSON `line` source. Detour waypoints (danger-zone avoidance vertices) rendered as hollow cyan circles: `r=4px`, `stroke: #00E5FF`, no fill.

Stacking: above radius zones, below alert marker dots.

### Family / circle overlays

| Property | Value |
|---|---|
| Member dot fill | `#00E6B4` |
| Member dot radius | 6px desktop / 8px mobile |
| Member dot border | `rgba(255,255,255,0.2)` 1.5px |
| Proximity ring fill | `rgba(0,230,180,0.09)` |
| Proximity ring stroke | `rgba(0,230,180,0.50)` 1.5px, `stroke-dasharray: 4 2` |
| Ring radius | derived from circle proximity threshold in metres |

Dashed ring stroke distinguishes family overlays from solid alert radius zones at a glance.

---

## Section 4: Cluster Donut Rings

### Count bands

Scaling by count bands prevents large clusters from visually overwhelming nearby individual markers.

| Count | Outer radius |
|---|---|
| 1–4 | 14px |
| 5–14 | 18px |
| 15–49 | 22px |
| 50–199 | 26px |
| 200+ | 30px |

### Severity arc construction

Three `stroke-dasharray` arcs stacked on overlapping `<circle>` elements (SVG technique):

- Arc 1: CRITICAL proportion — `#FF2D2D`
- Arc 2: HIGH proportion — `#FF9800`
- Arc 3: MEDIUM + LOW proportion — `#FFD500`

Arc lengths are proportional to `criticalCount / total`, `highCount / total`, `(mediumCount + lowCount) / total`.

**Minimum arc length**: 8% of circumference. Prevents hairline arcs that fragment the ring when one severity category has very few events.

**Stroke width**: 3px at all band sizes. Size communicates quantity; stroke weight stays consistent.

**Centre count label**: white, `font-family: monospace`. Size = `max(7px, outerRadius × 0.45)`. Mobile minimum: 8px.

**Dark hollow centre**: `fill: #0B0E14`, radius = outerRadius − 7px. Creates the donut negative space.

### Performance

- Cluster renderer components memoised on `{ clusterId, criticalCount, highCount, mediumCount, totalCount }`
- Arc ratios precomputed from event data at render time — no per-frame recalculation
- Cache key invalidates only when counts change (not on pan/zoom)
- Web Worker precomputation path noted for future high-density scenarios (50+ simultaneous clusters)

### Zoom handoff — clusters to individual markers

- Clusters with count ≤ 3 dissolve at z13.2 → individual high-contrast markers appear
- Clusters re-form at z12.8 if user zooms back out (±0.2 hysteresis buffer prevents threshold flicker)
- Dissolve/form uses `opacity` transition, 200ms ease-out — no sudden pop

---

## Section 5: File Structure

**Files modified:**
- `infra/map-style/sentinelmesh-dark.json` — full replacement of the 9-layer skeleton with the 28-layer production stack
- `apps/pwa/src/components/map/MapCanvas.tsx` — add `isolation: isolate` to map container, add `MapCanvas.module.css` import
- `apps/pwa/src/components/map/MapCanvas.module.css` — create; bottom safe-zone CSS
- `apps/pwa/src/components/EventMarker.tsx` — update marker sizes, add border ring, add hit-area padding, add CRITICAL pulse animation
- `apps/pwa/src/components/map/MapOverlayHost.tsx` — render overlays through portal root, update stacking z-indices
- `apps/pwa/src/index.html` (or `App.tsx`) — add `<div id="map-overlay-portal">` as sibling of map container

**Files created:**
- `apps/pwa/src/components/map/ClusterMarker.tsx` — donut ring cluster component (memoised, precomputed arcs)
- `apps/pwa/src/components/map/ClusterMarker.test.tsx`
- `apps/pwa/src/styles/map-tokens.ts` — color token constants (typed, imported by EventMarker and ClusterMarker)

---

## Out of Scope

- H3 server-side clustering logic — Phase 2 Realtime Overlays plan
- App shell chrome redesign (floating nav, compact controls) — separate future initiative
- PMTiles pipeline and tile hosting — completed in Phase 1
- Light mode, disaster mode, colorblind palette — enabled by semantic token structure, implemented later
- OSRM/Photon provider swap — Phase 3

---

## System Invariants

1. No base-map layer uses hue ranges reserved for overlays (red, orange, yellow, cyan, teal above 20% saturation)
2. Alert markers are always rendered above all base-map and radius-zone layers
3. Cluster count is always visible — minimum 7px, never clipped by ring stroke
4. Mobile tap targets are never smaller than 44pt effective area (visual radius + 8px padding)
5. The bottom 120px of the map viewport always has a safe-zone gradient ensuring overlay visibility above nav chrome
6. No animation except CRITICAL severity — and only on radius zone + border ring, never on fill
