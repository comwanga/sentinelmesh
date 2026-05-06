# SentinelMesh UI Redesign — Design Spec

**Date:** 2026-05-05  
**Status:** Approved  
**Scope:** Full UI/UX overhaul from 2-tab toggle to multi-route PWA matching the final design mockup

---

## 1. Overview

Replace the current `useState`-based 2-view toggle with a React Router v6 multi-page architecture. Wrap all pages in a new `AppShell` (Sidebar + Header + BottomNav). Preserve all existing components, Redux slices, and privacy/crypto logic. No rewrites of working features.

The design reference is `sentinelmesh final design.jpeg` in the project root.

---

## 2. Architecture Layers

```
AppShell
├── Header (all layouts)
├── Sidebar (desktop ≥768px)
├── <Outlet /> (page content)
└── BottomNav (mobile <768px)
```

**Three strict layers — never mix:**

| Layer | Role |
|---|---|
| Shell | Navigation structure only — no feature logic |
| Page | Domain orchestration — wires state, renders layout subcomponents |
| Component | UI leaf — receives props, emits events, no store access |

---

## 3. Routing

React Router v6. All routes wrapped in `AppShell`.

| Route | Page Component | Type |
|---|---|---|
| `/` | Redirect → `/map` | — |
| `/map` | `LiveMapPage` | Full page + overlay host |
| `/alerts` | `AlertsPage` | Full page |
| `/reports` | `ReportsPage` | Full page |
| `/circles` | `CirclesPage` | Full page |
| `/zaps` | `ZapsPage` | Full page |
| `/insights` | `InsightsPage` | Full page |
| `/settings` | `SettingsPage` | Full page |

Routes and Acoustic Detect are **not routes** — they are overlay panels rendered inside `LiveMapPage` only.

---

## 4. Shell Components

### 4.1 `AppShell`
Top-level layout wrapper. Reads `layout` token from `useBreakpoint`. Renders:
- `Header` always
- `Sidebar` when `layout === "desktop"`
- `BottomNav` when `layout === "mobile"`
- `<Outlet />` for page content

### 4.2 `Header`
Fixed 56px top bar across all pages.
- Left: SentinelMesh logo + "Safer communities. Zero compromise." tagline
- Center: Search bar ("Search location in Kenya...") — scoped to Mapbox geocoder, navigates to `/map` on selection
- Right: Live indicator (memoized selector on `eventsSlice.connected` only — no per-event re-render), Kenya flag, Filters button, Notification bell (badge = `eventsSlice.activeAlerts.length`)

### 4.3 `Sidebar` (desktop only)
Fixed left column. 64px collapsed, 220px expanded on hover. Contains:
- 9 nav items (icon + label): Live Map, Alerts, Reports, Family Circles, Routes, Acoustic Detect, Zaps, Insights, Settings
- Routes and Acoustic Detect items: dispatch `uiSlice.setOverlayIntent({ type: 'overlay', name: 'routes' | 'acoustic' })` + navigate to `/map`. Sidebar has zero knowledge of map internals.
- "All systems operational" indicator at bottom (driven by `eventsSlice.connected`)
- **No marketing content** — Privacy First and protocol badges live in `SettingsPage`

### 4.4 `BottomNav` (mobile only)
Fixed 56px bottom bar. 5 tabs — all navigate to routes, no modal behaviour:
- Map → `/map`
- Alerts → `/alerts`
- Report → `/reports`
- Family → `/circles`
- Profile → `/settings`

Routes, Acoustic, Insights, Zaps accessible from within their parent pages or via Settings.

---

## 5. Responsive Layout

### 5.1 Breakpoint
Single breakpoint at **768px**.

`useBreakpoint` hook:
- Single `matchMedia('(max-width: 767px)')` listener
- Cleaned up on unmount
- Returns `layout: "mobile" | "desktop"` (token, not boolean)
- Used only for major structural switches (show/hide Sidebar, show/hide BottomNav)
- Fine-grained presentation differences handled by CSS `@media` queries via shared `responsiveStyles` utility

### 5.2 Desktop (≥768px)
- Sidebar left (64–220px) + Header top + main content fills remainder
- `LiveMapPage`: map full-height, `AlertsDock` fixed 320px right column, `MapStatsBar` pinned above map, `MapFeatureStrip` pinned below map

### 5.3 Mobile (<768px)
- Header simplified: logo left, notification bell right
- `BottomNav` fixed bottom
- `LiveMapPage`: full-screen map, `MapStatsBar` collapses to single summary chip, `AlertsSheet` bottom sheet slides up on tap, `MapFeatureStrip` hidden
- `AcousticPanel`: full-screen overlay
- `RoutesOverlay`: bottom sheet with route cards + pinned Start Navigation button
- `CirclesPage`: compact inline map retained (not hidden) — "View on Map" button navigates to `/map` with circle overlay

**Core safety features (map, routes, circles) never hidden on mobile — only presentation adapts.**

---

## 6. Page Components

### 6.1 `LiveMapPage`
Orchestrator only — no UI logic inline.

Subcomponents:
- `MapCanvas` — `SafetyMap` wrapper, fills available space, receives filter props only
- `MapOverlayHost` — owns `overlay: 'routes' | 'acoustic' | null` as local state. Reads `uiSlice.uiIntent`, consumes via `dispatch(consumeOverlayIntent())` (reducer clears it — no manual component side-effects). Derives `presentation: 'panel' | 'sheet' | 'fullscreen'` from layout token internally.
- `MapStatsBar` — Active Alerts, Verified %, Community Score, Sources count
- `MapFeatureStrip` — 5 quick-action cards: Report Incident, Acoustic Detect, Family Circles, Escape Routes, Zap Reporter (desktop only)
- `AlertsDock` — fixed right panel using `AlertCard`, desktop only
- `AlertsSheet` — bottom sheet using `AlertCard`, mobile only
- "Near You" computed by `useNearestThreat` hook

### 6.2 `AlertsPage`
Full event list. Uses `AlertCard`. Filter bar: type, status, time range.

### 6.3 `ReportsPage`
`ReportList` + `ReportSubmit` side-by-side (desktop) / stacked (mobile). No changes to existing components.

### 6.4 `CirclesPage`
`FamilyCircleDashboard` + `CircleSidebar` + `CircleMapLayer`. E2EE notice. Compact inline map on mobile.

### 6.5 `ZapsPage`
Two sections:
- **Send Zap** — interactive feed of recent reports with `ZapButton` per entry
- **Zap History** — read-only ledger (amount, recipient, report ID, timestamp)

### 6.6 `InsightsPage`
Three internal tabs (horizontal scroll on mobile):
- **Overview** — aggregate numbers, top reporters, trust scores
- **Heatmap** — Mapbox heatmap layer with time-range slider
- **Personal Safety** — alerts near user over time, circles activity, acoustic detections count

### 6.7 `SettingsPage`
Nostr key management, Privacy First content, protocol badges (Bitcoin + Nostr), app info.

---

## 7. Shared Components

### `AlertCard`
Single source of truth for event card UI. Used in `AlertsDock`, `AlertsSheet`, `AlertsPage`.

Strict prop contract — no page-specific overrides:
```ts
type AlertCardProps = {
  eventId: string
  type: 'gunshot' | 'violence' | 'protest' | 'accident' | 'other'
  title: string
  location: string
  timestamp: number
  confidence: number
  status: 'VERIFIED' | 'PENDING'
  sources: Array<'NLP' | 'Radio' | 'Community' | 'Social'>
  voteCount: number
  onBookmark: (eventId: string) => void
}
```

---

## 8. State Additions

### 8.1 `uiSlice`
```ts
uiIntent: { type: 'overlay' | 'modal', name: string | null }
```
- Sidebar dispatches `setOverlayIntent({ type: 'overlay', name: 'routes' })` + navigates to `/map`
- `MapOverlayHost` dispatches `consumeOverlayIntent()` to clear — reducer-driven, never cleared by component read
- Scoped for Phase 1; designed to grow (modal intents, queue-based) without breaking existing consumers

### 8.2 `insightsEventsSlice`
Historical time-bucketed events for heatmap. Fetched on `InsightsPage` mount only.

### 8.3 `communityStatsSlice`
Reporter leaderboard, trust scores, verified report counts. Fetched on `InsightsPage` mount only.

### 8.4 `safetyLogSlice`
Personal safety log: events near user over time, acoustic detection count. Fetched on `InsightsPage` mount only.

### 8.5 `zapsSlice` (extension)
Extend existing Lightning integration to store: `{ id, amount, recipientPubkey, reportId, timestamp }[]`.

---

## 9. New Hooks

### `useBreakpoint`
```ts
(): { layout: "mobile" | "desktop" }
```
Single `matchMedia` listener, cleaned up on unmount, memoized.

### `useNearestThreat`
```ts
(): Event | null
```
Memoized selector over `eventsSlice.events` + user location. Throttled location updates (1s minimum interval) to prevent re-run on every position tick. Returns single nearest high-risk event.

---

## 10. Backend Endpoints (New)

All require pagination and time-window constraints to prevent heavy responses:

| Endpoint | Purpose | Required params |
|---|---|---|
| `GET /events/history` | Time-bucketed events for heatmap | `from`, `to`, `bucket`, `page`, `limit` |
| `GET /insights/community` | Reporter leaderboard + trust scores | `limit`, `page` |
| `GET /zaps/history` | Lightning transaction ledger | `pubkey`, `page`, `limit` |

Heatmap endpoint (`/events/history`) must be cached server-side — raw event fan-out at scale will be expensive.

---

## 11. What Is NOT Changing

- `SafetyMap` — no changes
- `FamilyCircleDashboard`, `CircleSidebar`, `CircleMapLayer` — no changes
- `ReportSubmit`, `ReportList` — no changes
- `AcousticAlert`, acoustic detection service — no changes
- `SafeRouteOverlay` — no changes
- `ZapButton`, `VerificationBadges` — no changes
- All existing Redux slices (`eventsSlice`, `circlesSlice`, `acousticSlice`, `reportSlice`) — no changes
- Nostr signing, E2EE, Lightning, face blur, EXIF strip — untouched

---

## 12. Design Tokens (from existing codebase)

```ts
bg: '#0B0E14'
border: '#1a2035'
cyan: '#00E5FF'
purple: '#BB86FC'
green: '#4CAF50'
red: '#FF2D2D'
text: '#e2e8f0'
font: "'Courier New', monospace"
```
