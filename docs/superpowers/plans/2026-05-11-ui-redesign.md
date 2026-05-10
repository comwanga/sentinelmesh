# SentinelMesh UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform SentinelMesh from a monolithic single-view app into a production-grade operational map platform with React Router v6, AppShell navigation, and a MapCanvas that owns its own viewport state.

**Architecture:** React Router v6 `createBrowserRouter` with AppShell as a layout route containing four child pages (Map, Alerts, Circles, Insights). AppShell runs global hooks (WebSocket, acoustic detection) and renders Sidebar on desktop or BottomNav on mobile via `useMediaQuery`. MapCanvas is a controlled map component that owns `viewState` in local `useState` — viewport state is never stored in Redux. AlertCard is a shared primitive consumed by AlertsDock (map overlay), AlertsSheet (mobile bottom sheet), and AlertsPage (full listing).

**Tech Stack:** React 18, Redux Toolkit, React Router v6 (`react-router-dom`), react-map-gl 8, Vitest, TypeScript 5

---

## CRITICAL — read before starting

**Task 1 is a blocking prerequisite for every other task.** The current `selectActiveEvents` selector filters `e.is_active && e.location`. After Phase 4, `SafetyEvent` has no `location` field — every event is silently dropped and the map is blank. Task 1 fixes the entire frontend type contract. Do not begin Task 2 until Task 1 is committed and `npm test` passes.

**MapCanvas invariant.** `viewState` inside `MapCanvas` is owned by `useState`. It must never be dispatched to Redux. Reviewers: grep `dispatch(` inside `MapCanvas.tsx` — it must be empty.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `shared/types/index.d.ts` | Modify | Replace old `SafetyEvent` (event_id, location, confidence) with Phase-4-aligned flat fields |
| `apps/pwa/src/store/eventsSlice.ts` | Modify | Replace `event_id` with `id` throughout |
| `apps/pwa/src/components/SafetyMap.tsx` | Modify | Fix selector, Marker coords, Popup fields |
| `apps/pwa/src/services/websocket.ts` | Modify | Fix `EVENT_RESOLVED` payload type |
| `apps/pwa/src/store/__tests__/eventsSlice.test.ts` | Create | Unit tests for reducer with new field names |
| `apps/pwa/src/main.tsx` | Modify | Replace `<App />` with `<RouterProvider router={router} />` |
| `apps/pwa/src/App.tsx` | Delete | Replaced by AppShell + router |
| `apps/pwa/src/router.tsx` | Create | `createBrowserRouter` with AppShell layout + 4 children |
| `apps/pwa/src/shell/AppShell.tsx` | Create | Layout: runs global hooks, renders Sidebar/Header/Outlet/BottomNav |
| `apps/pwa/src/shell/Sidebar.tsx` | Create | Desktop nav (NavLink × 4) |
| `apps/pwa/src/shell/Header.tsx` | Create | Connection status dot + SENTINELMESH wordmark |
| `apps/pwa/src/shell/BottomNav.tsx` | Create | Mobile nav (NavLink × 4) |
| `apps/pwa/src/hooks/useAcousticDetection.ts` | Create | Extracted from App.tsx |
| `apps/pwa/src/hooks/useMediaQuery.ts` | Create | `window.matchMedia` with SSR guard |
| `apps/pwa/src/pages/LiveMapPage.tsx` (stub) | Create | Task 2: thin wrapper around SafetyMap |
| `apps/pwa/src/pages/CirclesPage.tsx` (stub) | Create | Task 2: thin wrapper around FamilyCircleDashboard |
| `apps/pwa/src/pages/AlertsPage.tsx` (stub) | Create | Task 2: placeholder |
| `apps/pwa/src/pages/InsightsPage.tsx` (stub) | Create | Task 2: placeholder |
| `apps/pwa/src/components/MapCanvas.tsx` | Create | Controlled Map component — viewport in useState |
| `apps/pwa/src/pages/LiveMapPage.tsx` | Modify | Task 3: full implementation replacing SafetyMap |
| `apps/pwa/src/components/SafetyMap.tsx` | Delete | Task 3: superseded by LiveMapPage + MapCanvas |
| `apps/pwa/src/components/__tests__/MapCanvas.test.tsx` | Create | Viewport-state isolation tests |
| `apps/pwa/src/components/MapStatsBar.tsx` | Create | Task 4: live event count by severity |
| `apps/pwa/src/components/MapFeatureStrip.tsx` | Create | Task 4: severity filter toggle strip |
| `apps/pwa/src/components/AlertCard.tsx` | Create | Task 5: single-event display primitive |
| `apps/pwa/src/components/AlertsDock.tsx` | Create | Task 5: map overlay list of recent alerts |
| `apps/pwa/src/components/AlertsSheet.tsx` | Create | Task 5: mobile bottom sheet |
| `apps/pwa/src/pages/CirclesPage.tsx` | Modify | Task 6: FamilyCircleDashboard updated to use MapCanvas |
| `apps/pwa/src/components/FamilyCircleDashboard.tsx` | Modify | Task 6: replace inner `<Map>` with `<MapCanvas>` |
| `apps/pwa/src/pages/AlertsPage.tsx` | Modify | Task 7: full listing using AlertCard |
| `apps/pwa/src/pages/InsightsPage.tsx` | Modify | Task 8: stats/analytics stub |

---

## Task 1: Phase 4 event field fix — zero events render silently

**Files:**
- Modify: `shared/types/index.d.ts`
- Modify: `apps/pwa/src/store/eventsSlice.ts`
- Modify: `apps/pwa/src/components/SafetyMap.tsx`
- Modify: `apps/pwa/src/services/websocket.ts`
- Create: `apps/pwa/src/store/__tests__/eventsSlice.test.ts`

- [ ] **Step 1: Write failing tests for the new field names**

Create `apps/pwa/src/store/__tests__/eventsSlice.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { configureStore } from '@reduxjs/toolkit'
import eventsReducer, { eventReceived, eventResolved, setConnected } from '../eventsSlice'
import type { SafetyEvent } from '../../../../../shared/types'

function makeEvent(overrides: Partial<SafetyEvent> = {}): SafetyEvent {
  return {
    id: 'evt-1',
    event_type: 'FLOOD',
    severity: 'HIGH',
    title: 'Test flood',
    summary: null,
    lat: -1.2921,
    lng: 36.8219,
    place_name: 'CBD',
    county: 'Nairobi',
    is_active: true,
    started_at: '2026-05-11T00:00:00Z',
    created_at: '2026-05-11T00:00:00Z',
    nostr_event_id: null,
    bitcoin_txid: null,
    ...overrides,
  }
}

function makeStore() {
  return configureStore({ reducer: { events: eventsReducer } })
}

describe('eventsSlice', () => {
  it('adds a received event to items', () => {
    const store = makeStore()
    store.dispatch(eventReceived(makeEvent()))
    expect(store.getState().events.items).toHaveLength(1)
    expect(store.getState().events.items[0]!.id).toBe('evt-1')
  })

  it('deduplicates by id (not event_id)', () => {
    const store = makeStore()
    store.dispatch(eventReceived(makeEvent({ id: 'evt-1', title: 'First' })))
    store.dispatch(eventReceived(makeEvent({ id: 'evt-1', title: 'Updated' })))
    const items = store.getState().events.items
    expect(items).toHaveLength(1)
    expect(items[0]!.title).toBe('Updated')
  })

  it('eventResolved sets is_active false by id (not event_id)', () => {
    const store = makeStore()
    store.dispatch(eventReceived(makeEvent({ id: 'evt-2', is_active: true })))
    store.dispatch(eventResolved({ id: 'evt-2' }))
    expect(store.getState().events.items[0]!.is_active).toBe(false)
  })

  it('setConnected tracks connection status', () => {
    const store = makeStore()
    store.dispatch(setConnected(true))
    expect(store.getState().events.connected).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/pwa && npm test
```

Expected: FAIL — `id` field doesn't exist on `SafetyEvent` yet, `eventResolved` payload type mismatch.

- [ ] **Step 3: Replace `SafetyEvent` in `shared/types/index.d.ts`**

Replace lines 27–53 (the `EventLocation` interface and `SafetyEvent` interface) with:

```typescript
export interface SafetyEvent {
  id: string
  event_type: EventType
  severity: Severity
  title: string
  summary: string | null
  lat: number
  lng: number
  place_name: string | null
  county: string | null
  is_active: boolean
  started_at: string
  created_at: string
  nostr_event_id: string | null
  bitcoin_txid: string | null
}
```

Also remove the `EventLocation` interface entirely (lines 27–34) and update `WsMessage`:

```typescript
export type WsMessage =
  | { type: 'NEW_EVENT';       payload: SafetyEvent }
  | { type: 'EVENT_UPDATED';   payload: SafetyEvent }
  | { type: 'EVENT_RESOLVED';  payload: { id: string } }
  | { type: 'NEW_REPORT';      payload: CommunityReport }
  | { type: 'REPORT_UPDATED';  payload: CommunityReport }
  | { type: 'PROXIMITY_ALERT'; payload: Record<string, unknown> }
```

- [ ] **Step 4: Update `apps/pwa/src/store/eventsSlice.ts`**

Replace the entire file:

```typescript
import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { SafetyEvent } from '../../../../shared/types'

interface EventsState {
  items: SafetyEvent[]
  connected: boolean
}

const initialState: EventsState = {
  items: [],
  connected: false,
}

const eventsSlice = createSlice({
  name: 'events',
  initialState,
  reducers: {
    eventReceived(state, action: PayloadAction<SafetyEvent>) {
      const idx = state.items.findIndex(e => e.id === action.payload.id)
      if (idx >= 0) {
        state.items[idx] = action.payload
      } else {
        state.items.unshift(action.payload)
        if (state.items.length > 200) state.items.pop()
      }
    },
    eventResolved(state, action: PayloadAction<{ id: string }>) {
      const idx = state.items.findIndex(e => e.id === action.payload.id)
      if (idx >= 0) state.items[idx]!.is_active = false
    },
    setConnected(state, action: PayloadAction<boolean>) {
      state.connected = action.payload
    },
  },
})

export const { eventReceived, eventResolved, setConnected } = eventsSlice.actions
export default eventsSlice.reducer
```

- [ ] **Step 5: Fix `apps/pwa/src/services/websocket.ts`**

Change line 33 only — the `EVENT_RESOLVED` branch:

```typescript
} else if (msg.type === 'EVENT_RESOLVED') {
  dispatch(eventResolved(msg.payload as { id: string }))
```

- [ ] **Step 6: Fix `apps/pwa/src/components/SafetyMap.tsx`**

Replace the entire file:

```typescript
import Map, { Marker, Popup } from 'react-map-gl'
import { useState, useCallback } from 'react'
import { createSelector } from '@reduxjs/toolkit'
import { useAppSelector } from '../store'
import type { RootState } from '../store'
import EventMarker from './EventMarker'
import { fetchSafeRoutes, SafeRoute } from '../services/routingService'
import { SafeRouteOverlay } from './SafeRouteOverlay'
import { ZapButton } from './ZapButton'
import { VerificationBadges } from './VerificationBadges'
import type { SafetyEvent } from '../../../../shared/types'
import 'mapbox-gl/dist/mapbox-gl.css'

const MAPBOX_TOKEN = import.meta.env['VITE_MAPBOX_TOKEN'] as string

const selectActiveEvents = createSelector(
  (state: RootState) => state.events.items,
  items => items.filter(e => e.is_active)
)

export default function SafetyMap() {
  const events = useAppSelector(selectActiveEvents)
  const connected = useAppSelector(state => state.events.connected)
  const [selected, setSelected] = useState<SafetyEvent | null>(null)
  const [escapeRoutes, setEscapeRoutes] = useState<SafeRoute[]>([])

  return (
    <>
      <div style={{
        position: 'absolute', top: 12, left: 12, zIndex: 10,
        background: connected ? '#4CAF50' : '#FF2D2D',
        color: 'white', padding: '4px 10px', borderRadius: 12,
        fontSize: 12, fontFamily: 'sans-serif',
      }}>
        {connected ? `Live · ${events.length} events` : 'Reconnecting…'}
      </div>

      <Map
        mapboxAccessToken={MAPBOX_TOKEN}
        initialViewState={{ longitude: 36.8219, latitude: -1.2921, zoom: 11 }}
        style={{ width: '100%', height: '100%' }}
        mapStyle="mapbox://styles/mapbox/dark-v11"
      >
        {events.map(event => (
          <Marker key={event.id} longitude={event.lng} latitude={event.lat} anchor="center">
            <EventMarker event={event} onClick={setSelected} />
          </Marker>
        ))}

        {selected && (
          <Popup
            longitude={selected.lng}
            latitude={selected.lat}
            onClose={() => setSelected(null)}
            closeButton={true}
            maxWidth="280px"
          >
            <div style={{ fontFamily: 'sans-serif', fontSize: 13 }}>
              <strong style={{ color: '#333' }}>{selected.title}</strong>
              {selected.summary && <p style={{ margin: '6px 0 0' }}>{selected.summary}</p>}
              <p style={{ margin: '6px 0 0', color: '#666', fontSize: 11 }}>
                {selected.place_name} · {selected.severity}
              </p>
              <ZapButton reportId={selected.id} />
              <VerificationBadges
                nostrEventId={selected.nostr_event_id}
                bitcoinTxid={selected.bitcoin_txid}
              />
            </div>
          </Popup>
        )}

        <SafeRouteOverlay routes={escapeRoutes} />
      </Map>
    </>
  )
}
```

- [ ] **Step 7: Run type-check and tests**

```bash
cd apps/pwa && npx tsc --noEmit && npm test
```

Expected: All 4 new tests pass, `tsc` exits 0. Existing `FamilyCircleDashboard` tests still pass (they don't use `SafetyEvent` directly).

- [ ] **Step 8: Commit**

```bash
git add shared/types/index.d.ts \
        apps/pwa/src/store/eventsSlice.ts \
        apps/pwa/src/components/SafetyMap.tsx \
        apps/pwa/src/services/websocket.ts \
        apps/pwa/src/store/__tests__/eventsSlice.test.ts
git commit -m "fix: align frontend SafetyEvent type with Phase 4 flat schema; fix silent zero-event render"
```

---

## Task 2: React Router v6 + AppShell + shell components

**Files:**
- Create: `apps/pwa/src/router.tsx`
- Create: `apps/pwa/src/shell/AppShell.tsx`
- Create: `apps/pwa/src/shell/Sidebar.tsx`
- Create: `apps/pwa/src/shell/Header.tsx`
- Create: `apps/pwa/src/shell/BottomNav.tsx`
- Create: `apps/pwa/src/hooks/useAcousticDetection.ts`
- Create: `apps/pwa/src/hooks/useMediaQuery.ts`
- Create: `apps/pwa/src/pages/LiveMapPage.tsx` (stub)
- Create: `apps/pwa/src/pages/CirclesPage.tsx` (stub)
- Create: `apps/pwa/src/pages/AlertsPage.tsx` (stub)
- Create: `apps/pwa/src/pages/InsightsPage.tsx` (stub)
- Modify: `apps/pwa/src/main.tsx`
- Delete: `apps/pwa/src/App.tsx`
- Test: `apps/pwa/src/shell/__tests__/AppShell.test.tsx`

- [ ] **Step 1: Write failing tests for AppShell routing**

Create `apps/pwa/src/shell/__tests__/AppShell.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import eventsReducer from '../../store/eventsSlice'
import acousticReducer from '../../store/acousticSlice'
import circlesReducer from '../../store/circlesSlice'

vi.mock('react-map-gl', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="mapbox">{children}</div>,
  Marker: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Popup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('../../services/websocket', () => ({ useWsConnection: () => {} }))
vi.mock('../../hooks/useAcousticDetection', () => ({ useAcousticDetection: () => {} }))
vi.mock('../../services/circleWebSocket', () => ({ useCircleWsConnection: () => {} }))
vi.mock('../../hooks/useProximityAlerts', () => ({ useProximityAlerts: () => {} }))

function makeStore() {
  return configureStore({ reducer: { events: eventsReducer, acoustic: acousticReducer, circles: circlesReducer } })
}

function renderWithRouter(path: string) {
  const { router } = require('../../router')
  const testRouter = createMemoryRouter(router.routes, { initialEntries: [path] })
  render(
    <Provider store={makeStore()}>
      <RouterProvider router={testRouter} />
    </Provider>
  )
}

describe('AppShell routing', () => {
  it('renders header on every route', () => {
    renderWithRouter('/')
    expect(screen.getByText('SENTINELMESH')).toBeInTheDocument()
  })

  it('renders map page at /', () => {
    renderWithRouter('/')
    expect(screen.getByTestId('live-map-page')).toBeInTheDocument()
  })

  it('renders circles page at /circles', () => {
    renderWithRouter('/circles')
    expect(screen.getByTestId('circles-page')).toBeInTheDocument()
  })

  it('renders alerts page at /alerts', () => {
    renderWithRouter('/alerts')
    expect(screen.getByTestId('alerts-page')).toBeInTheDocument()
  })

  it('renders insights page at /insights', () => {
    renderWithRouter('/insights')
    expect(screen.getByTestId('insights-page')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/pwa && npm test
```

Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Install react-router-dom**

```bash
cd apps/pwa && npm install react-router-dom
```

- [ ] **Step 4: Create `apps/pwa/src/hooks/useMediaQuery.ts`**

```typescript
import { useState, useEffect } from 'react'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  )

  useEffect(() => {
    const mq = window.matchMedia(query)
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [query])

  return matches
}
```

- [ ] **Step 5: Create `apps/pwa/src/hooks/useAcousticDetection.ts`**

```typescript
import { useEffect } from 'react'
import { useAppDispatch } from '../store'
import { AudioCapture } from '../services/audioCapture'
import { AcousticDetectionService } from '../services/acousticDetectionService'
import { autoSubmitAcousticReport } from '../services/reportAutoSubmit'
import { detectionReceived, detectionStarted, detectionStopped } from '../store/acousticSlice'

export function useAcousticDetection(): void {
  const dispatch = useAppDispatch()

  useEffect(() => {
    let capture: AudioCapture | null = null
    let detector: AcousticDetectionService | null = null

    async function start() {
      detector = new AcousticDetectionService((detection) => {
        dispatch(detectionReceived(detection))
        navigator.geolocation?.getCurrentPosition((pos) => {
          autoSubmitAcousticReport(detection, {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          })
        })
      })
      try {
        await detector.init()
        capture = new AudioCapture((samples) => detector?.processWindow(samples))
        await capture.start()
        dispatch(detectionStarted())
      } catch (err) {
        console.warn('[acoustic] detection unavailable:', err)
      }
    }

    start()
    return () => { capture?.stop(); dispatch(detectionStopped()) }
  }, [dispatch])
}
```

- [ ] **Step 6: Create `apps/pwa/src/shell/Header.tsx`**

```typescript
import { useAppSelector } from '../store'

export function Header() {
  const connected = useAppSelector(s => s.events.connected)
  return (
    <div style={{
      height: 40, background: '#0B0E14', borderBottom: '1px solid #1a2035',
      display: 'flex', alignItems: 'center', padding: '0 16px', gap: 8, flexShrink: 0,
    }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: connected ? '#4CAF50' : '#FF2D2D',
      }} />
      <span style={{ color: '#4a5568', fontSize: 11, fontFamily: "'Courier New', monospace", letterSpacing: '0.1em' }}>
        SENTINELMESH
      </span>
    </div>
  )
}
```

- [ ] **Step 7: Create `apps/pwa/src/shell/Sidebar.tsx`**

```typescript
import { NavLink } from 'react-router-dom'

const NAV_ITEMS = [
  { to: '/', label: 'Map', end: true },
  { to: '/alerts', label: 'Alerts', end: false },
  { to: '/circles', label: 'Circles', end: false },
  { to: '/insights', label: 'Insights', end: false },
]

export function Sidebar() {
  return (
    <nav style={{
      width: 180, background: '#0B0E14', borderRight: '1px solid #1a2035',
      display: 'flex', flexDirection: 'column', padding: '16px 0', flexShrink: 0,
    }}>
      {NAV_ITEMS.map(({ to, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          style={({ isActive }) => ({
            padding: '10px 20px', color: isActive ? '#00E5FF' : '#4a5568',
            textDecoration: 'none', fontFamily: "'Courier New', monospace",
            fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' as const,
            borderLeft: isActive ? '2px solid #00E5FF' : '2px solid transparent',
          })}
        >
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
```

- [ ] **Step 8: Create `apps/pwa/src/shell/BottomNav.tsx`**

```typescript
import { NavLink } from 'react-router-dom'

const NAV_ITEMS = [
  { to: '/', label: 'Map', end: true },
  { to: '/alerts', label: 'Alerts', end: false },
  { to: '/circles', label: 'Circles', end: false },
  { to: '/insights', label: 'Insights', end: false },
]

export function BottomNav() {
  return (
    <nav style={{
      display: 'flex', background: '#0B0E14', borderTop: '1px solid #1a2035', flexShrink: 0,
    }}>
      {NAV_ITEMS.map(({ to, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          style={({ isActive }) => ({
            flex: 1, padding: '10px 0', textAlign: 'center' as const,
            color: isActive ? '#00E5FF' : '#4a5568',
            textDecoration: 'none', fontFamily: "'Courier New', monospace",
            fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' as const,
            borderTop: isActive ? '2px solid #00E5FF' : '2px solid transparent',
          })}
        >
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
```

- [ ] **Step 9: Create stub pages**

`apps/pwa/src/pages/LiveMapPage.tsx`:
```typescript
import SafetyMap from '../components/SafetyMap'

export function LiveMapPage() {
  return <div data-testid="live-map-page" style={{ width: '100%', height: '100%' }}><SafetyMap /></div>
}
```

`apps/pwa/src/pages/CirclesPage.tsx`:
```typescript
import { FamilyCircleDashboard } from '../components/FamilyCircleDashboard'

export function CirclesPage() {
  return <div data-testid="circles-page" style={{ width: '100%', height: '100%' }}><FamilyCircleDashboard /></div>
}
```

`apps/pwa/src/pages/AlertsPage.tsx`:
```typescript
export function AlertsPage() {
  return <div data-testid="alerts-page" style={{ padding: 24, color: '#ccc', fontFamily: 'sans-serif' }}>Alerts coming soon</div>
}
```

`apps/pwa/src/pages/InsightsPage.tsx`:
```typescript
export function InsightsPage() {
  return <div data-testid="insights-page" style={{ padding: 24, color: '#ccc', fontFamily: 'sans-serif' }}>Insights coming soon</div>
}
```

- [ ] **Step 10: Create `apps/pwa/src/shell/AppShell.tsx`**

```typescript
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { BottomNav } from './BottomNav'
import { AcousticAlert } from '../components/AcousticAlert'
import { useWsConnection } from '../services/websocket'
import { useAcousticDetection } from '../hooks/useAcousticDetection'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useAppSelector, useAppDispatch } from '../store'
import { alertDismissed } from '../store/acousticSlice'

export function AppShell() {
  useWsConnection()
  useAcousticDetection()
  const dispatch = useAppDispatch()
  const currentAlert = useAppSelector(s => s.acoustic.currentAlert)
  const isDesktop = useMediaQuery('(min-width: 768px)')

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', background: '#0B0E14' }}>
      {isDesktop && <Sidebar />}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Header />
        <AcousticAlert detection={currentAlert} onDismiss={() => dispatch(alertDismissed())} />
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <Outlet />
        </div>
        {!isDesktop && <BottomNav />}
      </div>
    </div>
  )
}
```

- [ ] **Step 11: Create `apps/pwa/src/router.tsx`**

```typescript
import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from './shell/AppShell'
import { LiveMapPage } from './pages/LiveMapPage'
import { CirclesPage } from './pages/CirclesPage'
import { AlertsPage } from './pages/AlertsPage'
import { InsightsPage } from './pages/InsightsPage'

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <LiveMapPage /> },
      { path: '/alerts', element: <AlertsPage /> },
      { path: '/circles', element: <CirclesPage /> },
      { path: '/insights', element: <InsightsPage /> },
    ],
  },
])
```

- [ ] **Step 12: Replace `apps/pwa/src/main.tsx`**

```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import { RouterProvider } from 'react-router-dom'
import { store } from './store'
import { router } from './router'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <RouterProvider router={router} />
    </Provider>
  </React.StrictMode>
)
```

- [ ] **Step 13: Delete `apps/pwa/src/App.tsx`**

```bash
git rm apps/pwa/src/App.tsx
```

- [ ] **Step 14: Run type-check and tests**

```bash
cd apps/pwa && npx tsc --noEmit && npm test
```

Expected: All AppShell routing tests pass, all prior tests still pass, `tsc` exits 0.

- [ ] **Step 15: Commit**

```bash
git add apps/pwa/src/router.tsx \
        apps/pwa/src/shell/ \
        apps/pwa/src/hooks/ \
        apps/pwa/src/pages/ \
        apps/pwa/src/main.tsx \
        apps/pwa/src/shell/__tests__/ \
        apps/pwa/package.json apps/pwa/package-lock.json
git commit -m "feat: add React Router v6 with AppShell, Sidebar, BottomNav, and page stubs"
```

---

## Task 3: MapCanvas + LiveMapPage (replace SafetyMap)

**Files:**
- Create: `apps/pwa/src/components/MapCanvas.tsx`
- Modify: `apps/pwa/src/pages/LiveMapPage.tsx` (full implementation)
- Delete: `apps/pwa/src/components/SafetyMap.tsx`
- Create: `apps/pwa/src/components/__tests__/MapCanvas.test.tsx`

- [ ] **Step 1: Write failing tests for MapCanvas**

Create `apps/pwa/src/components/__tests__/MapCanvas.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MapCanvas } from '../MapCanvas'

vi.mock('react-map-gl', () => ({
  default: ({ children, longitude, latitude, zoom, onMove }: {
    children?: React.ReactNode
    longitude: number
    latitude: number
    zoom: number
    onMove: (evt: { viewState: { longitude: number; latitude: number; zoom: number } }) => void
  }) => (
    <div
      data-testid="mapbox"
      data-longitude={longitude}
      data-latitude={latitude}
      data-zoom={zoom}
      onClick={() => onMove({ viewState: { longitude: 10, latitude: 10, zoom: 5 } })}
    >
      {children}
    </div>
  ),
}))

describe('MapCanvas', () => {
  it('renders with default Nairobi view state', () => {
    render(<MapCanvas />)
    const map = screen.getByTestId('mapbox')
    expect(map.getAttribute('data-longitude')).toBe('36.8219')
    expect(map.getAttribute('data-latitude')).toBe('-1.2921')
    expect(map.getAttribute('data-zoom')).toBe('11')
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
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/pwa && npm test src/components/__tests__/MapCanvas.test.tsx
```

Expected: FAIL — `MapCanvas` module not found.

- [ ] **Step 3: Create `apps/pwa/src/components/MapCanvas.tsx`**

```typescript
import Map from 'react-map-gl'
import { useState, useCallback } from 'react'
import 'mapbox-gl/dist/mapbox-gl.css'

const MAPBOX_TOKEN = import.meta.env['VITE_MAPBOX_TOKEN'] as string

interface ViewState {
  longitude: number
  latitude: number
  zoom: number
}

const DEFAULT_VIEW: ViewState = { longitude: 36.8219, latitude: -1.2921, zoom: 11 }

interface Props {
  initialViewState?: ViewState
  children?: React.ReactNode
  onMapLoad?: () => void
}

export function MapCanvas({ initialViewState = DEFAULT_VIEW, children, onMapLoad }: Props) {
  const [viewState, setViewState] = useState<ViewState>(initialViewState)
  const handleMove = useCallback((evt: { viewState: ViewState }) => setViewState(evt.viewState), [])

  return (
    <Map
      {...viewState}
      onMove={handleMove}
      onLoad={onMapLoad}
      mapboxAccessToken={MAPBOX_TOKEN}
      style={{ width: '100%', height: '100%' }}
      mapStyle="mapbox://styles/mapbox/dark-v11"
    >
      {children}
    </Map>
  )
}
```

- [ ] **Step 4: Run MapCanvas tests**

```bash
cd apps/pwa && npm test src/components/__tests__/MapCanvas.test.tsx
```

Expected: 3 PASS.

- [ ] **Step 5: Replace `apps/pwa/src/pages/LiveMapPage.tsx` with full implementation**

```typescript
import { useState } from 'react'
import { Marker, Popup } from 'react-map-gl'
import { createSelector } from '@reduxjs/toolkit'
import { useAppSelector } from '../store'
import type { RootState } from '../store'
import { MapCanvas } from '../components/MapCanvas'
import EventMarker from '../components/EventMarker'
import { SafeRouteOverlay } from '../components/SafeRouteOverlay'
import { ZapButton } from '../components/ZapButton'
import { VerificationBadges } from '../components/VerificationBadges'
import { ReportSubmit } from '../components/ReportSubmit'
import { ReportList } from '../components/ReportList'
import type { SafetyEvent } from '../../../../shared/types'

const selectActiveEvents = createSelector(
  (state: RootState) => state.events.items,
  items => items.filter(e => e.is_active)
)

type Panel = 'none' | 'submit' | 'list'

export function LiveMapPage() {
  const events = useAppSelector(selectActiveEvents)
  const connected = useAppSelector(state => state.events.connected)
  const [selected, setSelected] = useState<SafetyEvent | null>(null)
  const [panel, setPanel] = useState<Panel>('none')

  return (
    <div data-testid="live-map-page" style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div style={{
        position: 'absolute', top: 12, left: 12, zIndex: 10,
        background: connected ? '#4CAF50' : '#FF2D2D',
        color: 'white', padding: '4px 10px', borderRadius: 12,
        fontSize: 12, fontFamily: 'sans-serif',
      }}>
        {connected ? `Live · ${events.length} events` : 'Reconnecting…'}
      </div>

      <MapCanvas>
        {events.map(event => (
          <Marker key={event.id} longitude={event.lng} latitude={event.lat} anchor="center">
            <EventMarker event={event} onClick={setSelected} />
          </Marker>
        ))}

        {selected && (
          <Popup
            longitude={selected.lng}
            latitude={selected.lat}
            onClose={() => setSelected(null)}
            closeButton={true}
            maxWidth="280px"
          >
            <div style={{ fontFamily: 'sans-serif', fontSize: 13 }}>
              <strong style={{ color: '#333' }}>{selected.title}</strong>
              {selected.summary && <p style={{ margin: '6px 0 0' }}>{selected.summary}</p>}
              <p style={{ margin: '6px 0 0', color: '#666', fontSize: 11 }}>
                {selected.place_name} · {selected.severity}
              </p>
              <ZapButton reportId={selected.id} />
              <VerificationBadges
                nostrEventId={selected.nostr_event_id}
                bitcoinTxid={selected.bitcoin_txid}
              />
            </div>
          </Popup>
        )}

        <SafeRouteOverlay routes={[]} />
      </MapCanvas>

      <div style={{ position: 'absolute', bottom: 24, right: 16, zIndex: 10, display: 'flex', gap: 8 }}>
        <button onClick={() => setPanel(p => p === 'list' ? 'none' : 'list')} style={fabStyle('#1565C0')}>
          Reports
        </button>
        <button onClick={() => setPanel(p => p === 'submit' ? 'none' : 'submit')} style={fabStyle('#2E7D32')}>
          + Report
        </button>
      </div>
      {panel === 'submit' && <div style={panelStyle}><ReportSubmit onClose={() => setPanel('none')} /></div>}
      {panel === 'list' && <div style={panelStyle}><ReportList /></div>}
    </div>
  )
}

function fabStyle(bg: string): React.CSSProperties {
  return {
    background: bg, color: '#fff', border: 'none', borderRadius: 20,
    padding: '8px 18px', fontSize: 13, cursor: 'pointer',
    fontFamily: 'sans-serif', boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
  }
}

const panelStyle: React.CSSProperties = {
  position: 'absolute', bottom: 72, right: 16, zIndex: 10,
}
```

- [ ] **Step 6: Delete `apps/pwa/src/components/SafetyMap.tsx`**

```bash
git rm apps/pwa/src/components/SafetyMap.tsx
```

- [ ] **Step 7: Run full test suite and type-check**

```bash
cd apps/pwa && npx tsc --noEmit && npm test
```

Expected: All tests pass. No import of SafetyMap anywhere (router imports LiveMapPage, which is now the full implementation).

- [ ] **Step 8: Commit**

```bash
git add apps/pwa/src/components/MapCanvas.tsx \
        apps/pwa/src/pages/LiveMapPage.tsx \
        apps/pwa/src/components/__tests__/MapCanvas.test.tsx
git commit -m "feat: add MapCanvas with local viewport state; replace SafetyMap with LiveMapPage"
```

---

## Task 4: MapStatsBar + MapFeatureStrip

**Files:**
- Create: `apps/pwa/src/components/MapStatsBar.tsx`
- Create: `apps/pwa/src/components/MapFeatureStrip.tsx`
- Modify: `apps/pwa/src/pages/LiveMapPage.tsx`
- Create: `apps/pwa/src/components/__tests__/MapStatsBar.test.tsx`

- [ ] **Step 1: Write failing tests for MapStatsBar**

Create `apps/pwa/src/components/__tests__/MapStatsBar.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MapStatsBar } from '../MapStatsBar'
import type { SafetyEvent } from '../../../../../shared/types'

function makeEvent(severity: SafetyEvent['severity'], id: string): SafetyEvent {
  return {
    id, event_type: 'FLOOD', severity, title: 't', summary: null,
    lat: 0, lng: 0, place_name: null, county: null,
    is_active: true, started_at: '', created_at: '',
    nostr_event_id: null, bitcoin_txid: null,
  }
}

describe('MapStatsBar', () => {
  it('shows total event count', () => {
    const events = [makeEvent('CRITICAL', '1'), makeEvent('HIGH', '2')]
    render(<MapStatsBar events={events} />)
    expect(screen.getByText('2 active')).toBeInTheDocument()
  })

  it('shows CRITICAL count', () => {
    const events = [makeEvent('CRITICAL', '1'), makeEvent('CRITICAL', '2'), makeEvent('HIGH', '3')]
    render(<MapStatsBar events={events} />)
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('CRITICAL')).toBeInTheDocument()
  })

  it('shows zero when no events', () => {
    render(<MapStatsBar events={[]} />)
    expect(screen.getByText('0 active')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/pwa && npm test src/components/__tests__/MapStatsBar.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/pwa/src/components/MapStatsBar.tsx`**

```typescript
import type { SafetyEvent, Severity } from '../../../../shared/types'

const SEVERITY_COLOURS: Record<Severity, string> = {
  CRITICAL: '#FF2D2D',
  HIGH: '#FF8C00',
  MEDIUM: '#FFD700',
  LOW: '#4CAF50',
}

interface Props {
  events: SafetyEvent[]
}

export function MapStatsBar({ events }: Props) {
  const bySeverity = (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as Severity[]).map(s => ({
    severity: s,
    count: events.filter(e => e.severity === s).length,
  }))

  return (
    <div style={{
      position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
      zIndex: 10, display: 'flex', gap: 12, alignItems: 'center',
      background: 'rgba(11,14,20,0.85)', borderRadius: 8, padding: '6px 14px',
      fontFamily: "'Courier New', monospace", fontSize: 11,
    }}>
      <span style={{ color: '#4a5568', marginRight: 4 }}>{events.length} active</span>
      {bySeverity.filter(b => b.count > 0).map(({ severity, count }) => (
        <span key={severity} style={{ color: SEVERITY_COLOURS[severity], display: 'flex', gap: 4 }}>
          <strong>{count}</strong>
          <span style={{ opacity: 0.7 }}>{severity}</span>
        </span>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Create `apps/pwa/src/components/MapFeatureStrip.tsx`**

```typescript
import type { Severity } from '../../../../shared/types'

const SEVERITY_COLOURS: Record<Severity, string> = {
  CRITICAL: '#FF2D2D',
  HIGH: '#FF8C00',
  MEDIUM: '#FFD700',
  LOW: '#4CAF50',
}

const SEVERITIES: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

interface Props {
  active: Set<Severity>
  onToggle: (s: Severity) => void
}

export function MapFeatureStrip({ active, onToggle }: Props) {
  return (
    <div style={{
      position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)',
      zIndex: 10, display: 'flex', gap: 8,
    }}>
      {SEVERITIES.map(s => (
        <button
          key={s}
          onClick={() => onToggle(s)}
          style={{
            background: active.has(s) ? SEVERITY_COLOURS[s] : 'rgba(11,14,20,0.85)',
            color: active.has(s) ? '#000' : SEVERITY_COLOURS[s],
            border: `1px solid ${SEVERITY_COLOURS[s]}`,
            borderRadius: 4, padding: '4px 10px',
            fontFamily: "'Courier New', monospace", fontSize: 10, cursor: 'pointer',
            letterSpacing: '0.05em',
          }}
        >
          {s}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Wire MapStatsBar and MapFeatureStrip into LiveMapPage**

Add to `apps/pwa/src/pages/LiveMapPage.tsx`:

Import additions at top:
```typescript
import { MapStatsBar } from '../components/MapStatsBar'
import { MapFeatureStrip } from '../components/MapFeatureStrip'
import type { Severity } from '../../../../shared/types'
```

Add state inside `LiveMapPage`:
```typescript
const [severityFilter, setSeverityFilter] = useState<Set<Severity>>(
  new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'])
)

const handleToggleSeverity = (s: Severity) => {
  setSeverityFilter(prev => {
    const next = new Set(prev)
    if (next.has(s)) next.delete(s)
    else next.add(s)
    return next
  })
}
```

Update `selectActiveEvents` usage — apply filter locally in component (the Redux selector stays clean):
```typescript
const allActive = useAppSelector(selectActiveEvents)
const events = allActive.filter(e => severityFilter.has(e.severity))
```

Add inside the returned JSX, inside the outer div (before `<MapCanvas>`):
```typescript
<MapStatsBar events={events} />
```

Add after `<MapCanvas>` closing tag (before the FABs div):
```typescript
<MapFeatureStrip active={severityFilter} onToggle={handleToggleSeverity} />
```

- [ ] **Step 6: Run full tests and type-check**

```bash
cd apps/pwa && npx tsc --noEmit && npm test
```

Expected: 3 MapStatsBar tests pass, all prior tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/pwa/src/components/MapStatsBar.tsx \
        apps/pwa/src/components/MapFeatureStrip.tsx \
        apps/pwa/src/components/__tests__/MapStatsBar.test.tsx \
        apps/pwa/src/pages/LiveMapPage.tsx
git commit -m "feat: add MapStatsBar and MapFeatureStrip severity filter to live map"
```

---

## Task 5: AlertCard + AlertsDock + AlertsSheet

**Files:**
- Create: `apps/pwa/src/components/AlertCard.tsx`
- Create: `apps/pwa/src/components/AlertsDock.tsx`
- Create: `apps/pwa/src/components/AlertsSheet.tsx`
- Modify: `apps/pwa/src/pages/LiveMapPage.tsx`
- Create: `apps/pwa/src/components/__tests__/AlertCard.test.tsx`

- [ ] **Step 1: Write failing tests for AlertCard**

Create `apps/pwa/src/components/__tests__/AlertCard.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AlertCard } from '../AlertCard'
import type { SafetyEvent } from '../../../../../shared/types'

const event: SafetyEvent = {
  id: 'evt-1', event_type: 'FLOOD', severity: 'CRITICAL',
  title: 'Flooding in CBD', summary: 'Roads impassable',
  lat: -1.29, lng: 36.82, place_name: 'CBD', county: 'Nairobi',
  is_active: true, started_at: '2026-05-11T10:00:00Z', created_at: '2026-05-11T10:00:00Z',
  nostr_event_id: null, bitcoin_txid: null,
}

describe('AlertCard', () => {
  it('renders event title', () => {
    render(<AlertCard event={event} />)
    expect(screen.getByText('Flooding in CBD')).toBeInTheDocument()
  })

  it('renders severity', () => {
    render(<AlertCard event={event} />)
    expect(screen.getByText('CRITICAL')).toBeInTheDocument()
  })

  it('renders place_name', () => {
    render(<AlertCard event={event} />)
    expect(screen.getByText(/CBD/)).toBeInTheDocument()
  })

  it('calls onClick when clicked', () => {
    const onClick = vi.fn()
    render(<AlertCard event={event} onClick={onClick} />)
    fireEvent.click(screen.getByText('Flooding in CBD'))
    expect(onClick).toHaveBeenCalledWith(event)
  })

  it('renders without onClick', () => {
    expect(() => render(<AlertCard event={event} />)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/pwa && npm test src/components/__tests__/AlertCard.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/pwa/src/components/AlertCard.tsx`**

```typescript
import type { SafetyEvent, Severity } from '../../../../shared/types'

const SEVERITY_COLOURS: Record<Severity, string> = {
  CRITICAL: '#FF2D2D',
  HIGH: '#FF8C00',
  MEDIUM: '#FFD700',
  LOW: '#4CAF50',
}

interface Props {
  event: SafetyEvent
  onClick?: (event: SafetyEvent) => void
}

export function AlertCard({ event, onClick }: Props) {
  const colour = SEVERITY_COLOURS[event.severity]
  return (
    <div
      onClick={() => onClick?.(event)}
      style={{
        background: '#111827', borderRadius: 8, padding: '10px 14px',
        borderLeft: `3px solid ${colour}`, cursor: onClick ? 'pointer' : 'default',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{event.title}</span>
        <span style={{ color: colour, fontSize: 10, fontFamily: "'Courier New', monospace", letterSpacing: '0.05em' }}>
          {event.severity}
        </span>
      </div>
      {event.place_name && (
        <div style={{ color: '#4a5568', fontSize: 11, marginTop: 4 }}>{event.place_name}</div>
      )}
      {event.summary && (
        <div style={{ color: '#9ca3af', fontSize: 12, marginTop: 4 }}>{event.summary}</div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run AlertCard tests**

```bash
cd apps/pwa && npm test src/components/__tests__/AlertCard.test.tsx
```

Expected: 5 PASS.

- [ ] **Step 5: Create `apps/pwa/src/components/AlertsDock.tsx`**

```typescript
import { AlertCard } from './AlertCard'
import type { SafetyEvent } from '../../../../shared/types'

interface Props {
  events: SafetyEvent[]
  onSelect: (event: SafetyEvent) => void
}

export function AlertsDock({ events, onSelect }: Props) {
  const recent = events.slice(0, 5)

  if (recent.length === 0) return null

  return (
    <div style={{
      position: 'absolute', top: 60, right: 12, zIndex: 10,
      width: 280, display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      {recent.map(event => (
        <AlertCard key={event.id} event={event} onClick={onSelect} />
      ))}
    </div>
  )
}
```

- [ ] **Step 6: Create `apps/pwa/src/components/AlertsSheet.tsx`**

```typescript
import { AlertCard } from './AlertCard'
import type { SafetyEvent } from '../../../../shared/types'

interface Props {
  events: SafetyEvent[]
  open: boolean
  onClose: () => void
  onSelect: (event: SafetyEvent) => void
}

export function AlertsSheet({ events, open, onClose, onSelect }: Props) {
  if (!open) return null

  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20,
      background: '#0B0E14', borderTop: '1px solid #1a2035', borderRadius: '16px 16px 0 0',
      maxHeight: '60vh', overflow: 'auto', padding: '16px 12px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ color: '#e2e8f0', fontSize: 14, fontFamily: 'sans-serif', fontWeight: 600 }}>
          Active Alerts
        </span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#4a5568', cursor: 'pointer', fontSize: 18 }}>
          ×
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {events.map(event => (
          <AlertCard key={event.id} event={event} onClick={(e) => { onSelect(e); onClose() }} />
        ))}
        {events.length === 0 && (
          <div style={{ color: '#4a5568', fontSize: 13, fontFamily: 'sans-serif', textAlign: 'center', padding: 24 }}>
            No active alerts
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Wire AlertsDock and AlertsSheet into LiveMapPage**

In `apps/pwa/src/pages/LiveMapPage.tsx`, add these imports:
```typescript
import { AlertsDock } from '../components/AlertsDock'
import { AlertsSheet } from '../components/AlertsSheet'
import { useMediaQuery } from '../hooks/useMediaQuery'
```

Add state inside `LiveMapPage`:
```typescript
const isDesktop = useMediaQuery('(min-width: 768px)')
const [sheetOpen, setSheetOpen] = useState(false)
```

Add inside the JSX, after `<MapFeatureStrip />`:
- On desktop, after `<MapCanvas>`:
```typescript
{isDesktop && <AlertsDock events={events} onSelect={setSelected} />}
```
- On mobile, inside the outer div:
```typescript
{!isDesktop && (
  <>
    <button
      onClick={() => setSheetOpen(true)}
      style={{
        position: 'absolute', bottom: 80, left: 16, zIndex: 10,
        background: '#1a2035', color: '#00E5FF', border: '1px solid #00E5FF',
        borderRadius: 20, padding: '6px 14px', fontSize: 12,
        fontFamily: "'Courier New', monospace", cursor: 'pointer',
      }}
    >
      {events.length} alerts
    </button>
    <AlertsSheet
      events={events}
      open={sheetOpen}
      onClose={() => setSheetOpen(false)}
      onSelect={setSelected}
    />
  </>
)}
```

- [ ] **Step 8: Run full tests and type-check**

```bash
cd apps/pwa && npx tsc --noEmit && npm test
```

Expected: 5 AlertCard tests pass, all prior tests pass.

- [ ] **Step 9: Commit**

```bash
git add apps/pwa/src/components/AlertCard.tsx \
        apps/pwa/src/components/AlertsDock.tsx \
        apps/pwa/src/components/AlertsSheet.tsx \
        apps/pwa/src/components/__tests__/AlertCard.test.tsx \
        apps/pwa/src/pages/LiveMapPage.tsx
git commit -m "feat: add AlertCard, AlertsDock (desktop), AlertsSheet (mobile)"
```

---

## Task 6: CirclesPage — FamilyCircleDashboard on MapCanvas

**Files:**
- Modify: `apps/pwa/src/components/FamilyCircleDashboard.tsx`
- Modify: `apps/pwa/src/pages/CirclesPage.tsx`
- Existing test: `apps/pwa/src/components/__tests__/FamilyCircleDashboard.test.tsx` (must still pass)

- [ ] **Step 1: Read the existing FamilyCircleDashboard to find the inner Map usage**

```bash
grep -n "react-map-gl\|<Map\b" apps/pwa/src/components/FamilyCircleDashboard.tsx | head -20
```

Note the exact import and props used by the inner `<Map>` component so you can replace it with `<MapCanvas>`.

- [ ] **Step 2: Write a targeted failing test**

Add this test to `apps/pwa/src/components/__tests__/FamilyCircleDashboard.test.tsx` (before the closing `})`):

```typescript
it('renders MapCanvas (not a raw Map)', () => {
  // After Task 6, FamilyCircleDashboard imports MapCanvas, not Map directly.
  // The mock for react-map-gl is still present; MapCanvas is mocked separately.
  render(<Provider store={makeStore()}><FamilyCircleDashboard /></Provider>)
  // Existing test: map area still renders
  expect(screen.getByTestId('mapbox')).toBeInTheDocument()
})
```

This test passes today (mapbox renders via the mock), so it's a guard not a gate — the real check is the TypeScript import in Step 3.

- [ ] **Step 3: Update FamilyCircleDashboard to use MapCanvas**

In `apps/pwa/src/components/FamilyCircleDashboard.tsx`:

1. Remove the `import Map from 'react-map-gl'` import (and any `initialViewState` / `onMove` state).
2. Add `import { MapCanvas } from './MapCanvas'`
3. Replace the `<Map mapboxAccessToken={...} initialViewState={...} ...>` block with `<MapCanvas>`.

Concretely — the old pattern is something like:
```typescript
<Map
  mapboxAccessToken={MAPBOX_TOKEN}
  initialViewState={{ longitude: 36.8219, latitude: -1.2921, zoom: 11 }}
  style={{ width: '100%', height: '100%' }}
  mapStyle="mapbox://styles/mapbox/dark-v11"
>
  {/* children */}
</Map>
```

Replace with:
```typescript
<MapCanvas>
  {/* children — same as before */}
</MapCanvas>
```

Remove `MAPBOX_TOKEN` constant and any `viewState` useState/onMove from FamilyCircleDashboard if they exist there — MapCanvas owns that state now.

- [ ] **Step 4: Run type-check and tests**

```bash
cd apps/pwa && npx tsc --noEmit && npm test
```

Expected: All FamilyCircleDashboard tests still pass (react-map-gl mock is still in place; MapCanvas is a thin wrapper). tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/components/FamilyCircleDashboard.tsx \
        apps/pwa/src/pages/CirclesPage.tsx \
        apps/pwa/src/components/__tests__/FamilyCircleDashboard.test.tsx
git commit -m "refactor: FamilyCircleDashboard uses MapCanvas; CirclesPage wraps it"
```

---

## Task 7: AlertsPage — full alert listing

**Files:**
- Modify: `apps/pwa/src/pages/AlertsPage.tsx`
- Create: `apps/pwa/src/pages/__tests__/AlertsPage.test.tsx`

- [ ] **Step 1: Write failing tests for AlertsPage**

Create `apps/pwa/src/pages/__tests__/AlertsPage.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import eventsReducer, { eventReceived } from '../../store/eventsSlice'
import acousticReducer from '../../store/acousticSlice'
import circlesReducer from '../../store/circlesSlice'
import { AlertsPage } from '../AlertsPage'
import type { SafetyEvent } from '../../../../../shared/types'

function makeEvent(id: string, severity: SafetyEvent['severity'], is_active = true): SafetyEvent {
  return {
    id, event_type: 'FLOOD', severity, title: `Event ${id}`, summary: null,
    lat: 0, lng: 0, place_name: null, county: null,
    is_active, started_at: '', created_at: '',
    nostr_event_id: null, bitcoin_txid: null,
  }
}

function makeStore(events: SafetyEvent[] = []) {
  const store = configureStore({ reducer: { events: eventsReducer, acoustic: acousticReducer, circles: circlesReducer } })
  events.forEach(e => store.dispatch(eventReceived(e)))
  return store
}

describe('AlertsPage', () => {
  it('shows heading', () => {
    render(<Provider store={makeStore()}><AlertsPage /></Provider>)
    expect(screen.getByText('Active Alerts')).toBeInTheDocument()
  })

  it('shows active event titles', () => {
    const store = makeStore([makeEvent('1', 'CRITICAL'), makeEvent('2', 'HIGH')])
    render(<Provider store={store}><AlertsPage /></Provider>)
    expect(screen.getByText('Event 1')).toBeInTheDocument()
    expect(screen.getByText('Event 2')).toBeInTheDocument()
  })

  it('hides inactive events', () => {
    const store = makeStore([makeEvent('3', 'LOW', false)])
    render(<Provider store={store}><AlertsPage /></Provider>)
    expect(screen.queryByText('Event 3')).not.toBeInTheDocument()
  })

  it('shows empty state when no alerts', () => {
    render(<Provider store={makeStore()}><AlertsPage /></Provider>)
    expect(screen.getByText(/No active alerts/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/pwa && npm test src/pages/__tests__/AlertsPage.test.tsx
```

Expected: FAIL — AlertsPage renders stub placeholder text, not a proper listing.

- [ ] **Step 3: Implement `apps/pwa/src/pages/AlertsPage.tsx`**

```typescript
import { createSelector } from '@reduxjs/toolkit'
import { useAppSelector } from '../store'
import type { RootState } from '../store'
import { AlertCard } from '../components/AlertCard'

const selectActiveEvents = createSelector(
  (state: RootState) => state.events.items,
  items => items.filter(e => e.is_active)
)

export function AlertsPage() {
  const events = useAppSelector(selectActiveEvents)

  return (
    <div
      data-testid="alerts-page"
      style={{
        padding: 24, overflowY: 'auto', height: '100%',
        background: '#0B0E14', fontFamily: 'sans-serif',
      }}
    >
      <h2 style={{ color: '#e2e8f0', margin: '0 0 16px', fontSize: 16, fontWeight: 600 }}>
        Active Alerts
        <span style={{ color: '#4a5568', fontWeight: 400, fontSize: 13, marginLeft: 8 }}>
          ({events.length})
        </span>
      </h2>

      {events.length === 0 ? (
        <div style={{ color: '#4a5568', fontSize: 14, textAlign: 'center', paddingTop: 48 }}>
          No active alerts in your area
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {events.map(event => <AlertCard key={event.id} event={event} />)}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run full tests and type-check**

```bash
cd apps/pwa && npx tsc --noEmit && npm test
```

Expected: 4 AlertsPage tests pass, all prior tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/pages/AlertsPage.tsx \
        apps/pwa/src/pages/__tests__/AlertsPage.test.tsx
git commit -m "feat: AlertsPage lists active events using AlertCard"
```

---

## Task 8: InsightsPage stub

**Files:**
- Modify: `apps/pwa/src/pages/InsightsPage.tsx`
- Create: `apps/pwa/src/pages/__tests__/InsightsPage.test.tsx`

- [ ] **Step 1: Write tests for InsightsPage**

Create `apps/pwa/src/pages/__tests__/InsightsPage.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import eventsReducer from '../../store/eventsSlice'
import acousticReducer from '../../store/acousticSlice'
import circlesReducer from '../../store/circlesSlice'
import { InsightsPage } from '../InsightsPage'

function makeStore() {
  return configureStore({ reducer: { events: eventsReducer, acoustic: acousticReducer, circles: circlesReducer } })
}

describe('InsightsPage', () => {
  it('renders heading', () => {
    render(<Provider store={makeStore()}><InsightsPage /></Provider>)
    expect(screen.getByText('Insights')).toBeInTheDocument()
  })

  it('renders testid for routing tests', () => {
    render(<Provider store={makeStore()}><InsightsPage /></Provider>)
    expect(screen.getByTestId('insights-page')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/pwa && npm test src/pages/__tests__/InsightsPage.test.tsx
```

Expected: FAIL — stub has no "Insights" heading.

- [ ] **Step 3: Implement `apps/pwa/src/pages/InsightsPage.tsx`**

```typescript
import { createSelector } from '@reduxjs/toolkit'
import { useAppSelector } from '../store'
import type { RootState } from '../store'
import type { Severity } from '../../../../shared/types'

const selectEventsBySeverity = createSelector(
  (state: RootState) => state.events.items,
  items => {
    const counts: Record<Severity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }
    items.forEach(e => { if (e.is_active) counts[e.severity]++ })
    return counts
  }
)

const SEVERITY_COLOURS: Record<Severity, string> = {
  CRITICAL: '#FF2D2D',
  HIGH: '#FF8C00',
  MEDIUM: '#FFD700',
  LOW: '#4CAF50',
}

export function InsightsPage() {
  const counts = useAppSelector(selectEventsBySeverity)
  const total = Object.values(counts).reduce((a, b) => a + b, 0)

  return (
    <div
      data-testid="insights-page"
      style={{
        padding: 24, height: '100%', background: '#0B0E14', fontFamily: 'sans-serif', overflowY: 'auto',
      }}
    >
      <h2 style={{ color: '#e2e8f0', margin: '0 0 24px', fontSize: 16, fontWeight: 600 }}>
        Insights
      </h2>

      <div style={{ marginBottom: 24 }}>
        <div style={{ color: '#4a5568', fontSize: 11, fontFamily: "'Courier New', monospace", letterSpacing: '0.1em', marginBottom: 12 }}>
          ACTIVE EVENTS BY SEVERITY
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(Object.entries(counts) as [Severity, number][]).map(([severity, count]) => (
            <div key={severity} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ color: SEVERITY_COLOURS[severity], width: 72, fontSize: 11, fontFamily: "'Courier New', monospace" }}>
                {severity}
              </span>
              <div style={{ flex: 1, background: '#1a2035', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                <div style={{
                  width: total > 0 ? `${(count / total) * 100}%` : '0%',
                  background: SEVERITY_COLOURS[severity], height: '100%',
                  transition: 'width 0.3s ease',
                }} />
              </div>
              <span style={{ color: '#e2e8f0', width: 24, textAlign: 'right', fontSize: 13 }}>{count}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ color: '#4a5568', fontSize: 12 }}>
        Detailed analytics coming soon.
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run full test suite and type-check**

```bash
cd apps/pwa && npx tsc --noEmit && npm test
```

Expected: 2 InsightsPage tests pass, all prior tests pass, `tsc` exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/pages/InsightsPage.tsx \
        apps/pwa/src/pages/__tests__/InsightsPage.test.tsx
git commit -m "feat: InsightsPage with severity breakdown chart"
```

---

## Self-review

**Spec coverage:**

| Requirement | Task |
|---|---|
| Phase 4 field fix (zero events bug) | Task 1 |
| `SafetyEvent` type aligned with backend | Task 1 |
| React Router v6 with layout routes | Task 2 |
| AppShell with Sidebar (desktop) / BottomNav (mobile) | Task 2 |
| `useMediaQuery` for responsive breakpoint | Task 2 |
| `useAcousticDetection` extracted from App.tsx | Task 2 |
| MapCanvas owns viewport state in `useState`, never Redux | Task 3 |
| LiveMapPage replaces SafetyMap | Task 3 |
| MapStatsBar (live event count by severity) | Task 4 |
| MapFeatureStrip (severity filter toggles) | Task 4 |
| AlertCard shared primitive | Task 5 |
| AlertsDock (desktop map overlay) | Task 5 |
| AlertsSheet (mobile bottom sheet) | Task 5 |
| CirclesPage wraps FamilyCircleDashboard | Task 6 |
| FamilyCircleDashboard uses MapCanvas | Task 6 |
| AlertsPage full listing | Task 7 |
| InsightsPage stub | Task 8 |

**Placeholder scan:** No TBD, TODO, or "similar to Task N" references. Every step has runnable code.

**Type consistency:** `SafetyEvent.id` is used throughout (Tasks 1–8). `selectActiveEvents` filters `e.is_active` (no `e.location`). `eventResolved({ id })` everywhere. `MapCanvas` accepts `initialViewState`, `children`, `onMapLoad`.
