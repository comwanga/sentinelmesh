# SentinelMesh UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 2-tab toggle in App.tsx with a React Router v6 multi-page PWA wrapped in a responsive AppShell matching the final design mockup (`sentinelmesh final design.jpeg`).

**Architecture:** New `AppShell` (Sidebar + Header + BottomNav) wraps all routes as a React Router v6 layout route. Existing components slot into page wrappers with no rewrites. `uiSlice` carries overlay intent from Sidebar to `MapOverlayHost` via a reducer-cleared one-shot pattern. Acoustic detection and WebSocket init move to a root-level hook so they run globally regardless of active route.

**Tech Stack:** React 18, React Router DOM v6, Redux Toolkit, Mapbox GL 3, Vitest + @testing-library/react, TypeScript 5

---

## File Map

**New files:**
```
apps/pwa/src/hooks/useBreakpoint.ts
apps/pwa/src/hooks/useBreakpoint.test.ts
apps/pwa/src/hooks/useNearestThreat.ts
apps/pwa/src/hooks/useNearestThreat.test.ts
apps/pwa/src/hooks/useAcousticEngine.ts
apps/pwa/src/store/uiSlice.ts
apps/pwa/src/store/uiSlice.test.ts
apps/pwa/src/store/zapsSlice.ts
apps/pwa/src/store/zapsSlice.test.ts
apps/pwa/src/store/insightsEventsSlice.ts
apps/pwa/src/store/communityStatsSlice.ts
apps/pwa/src/store/safetyLogSlice.ts
apps/pwa/src/components/shell/AppShell.tsx
apps/pwa/src/components/shell/AppShell.test.tsx
apps/pwa/src/components/shell/Header.tsx
apps/pwa/src/components/shell/Header.test.tsx
apps/pwa/src/components/shell/Sidebar.tsx
apps/pwa/src/components/shell/Sidebar.test.tsx
apps/pwa/src/components/shell/BottomNav.tsx
apps/pwa/src/components/shell/BottomNav.test.tsx
apps/pwa/src/components/shared/AlertCard.tsx
apps/pwa/src/components/shared/AlertCard.test.tsx
apps/pwa/src/components/map/MapCanvas.tsx
apps/pwa/src/components/map/MapStatsBar.tsx
apps/pwa/src/components/map/MapStatsBar.test.tsx
apps/pwa/src/components/map/MapFeatureStrip.tsx
apps/pwa/src/components/map/MapFeatureStrip.test.tsx
apps/pwa/src/components/map/AlertsDock.tsx
apps/pwa/src/components/map/AlertsSheet.tsx
apps/pwa/src/components/map/MapOverlayHost.tsx
apps/pwa/src/pages/LiveMapPage.tsx
apps/pwa/src/pages/AlertsPage.tsx
apps/pwa/src/pages/AlertsPage.test.tsx
apps/pwa/src/pages/ReportsPage.tsx
apps/pwa/src/pages/CirclesPage.tsx
apps/pwa/src/pages/ZapsPage.tsx
apps/pwa/src/pages/ZapsPage.test.tsx
apps/pwa/src/pages/InsightsPage.tsx
apps/pwa/src/pages/InsightsPage.test.tsx
apps/pwa/src/pages/SettingsPage.tsx
```

**Modified files:**
```
apps/pwa/package.json        — add react-router-dom
apps/pwa/src/App.tsx         — replace 2-tab toggle with BrowserRouter + routes
apps/pwa/src/store/index.ts  — register 5 new slices
```

---

## Design Tokens (reference for all components)

```ts
const T = {
  bg:      '#0B0E14',
  bgCard:  '#0d1118',
  border:  '#1a2035',
  cyan:    '#00E5FF',
  purple:  '#BB86FC',
  green:   '#4CAF50',
  red:     '#FF2D2D',
  text:    '#e2e8f0',
  muted:   '#4a5568',
  font:    "'Courier New', monospace",
}
```

---

### Task 1: Install react-router-dom

**Files:**
- Modify: `apps/pwa/package.json`

- [ ] **Step 1: Install the package**

```bash
cd apps/pwa && npm install react-router-dom
```

Expected: `added N packages` with `react-router-dom` listed.

- [ ] **Step 2: Verify**

`apps/pwa/package.json` must list `react-router-dom` under `dependencies`.

- [ ] **Step 3: Commit**

```bash
git add apps/pwa/package.json apps/pwa/package-lock.json
git commit -m "feat: install react-router-dom v6"
```

---

### Task 2: useBreakpoint hook

**Files:**
- Create: `apps/pwa/src/hooks/useBreakpoint.ts`
- Create: `apps/pwa/src/hooks/useBreakpoint.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/pwa/src/hooks/useBreakpoint.test.ts
import { renderHook, act } from '@testing-library/react'
import { useBreakpoint } from './useBreakpoint'

function mockMatchMedia(matches: boolean) {
  const listeners: Array<(e: MediaQueryListEvent) => void> = []
  const mql = {
    matches,
    addEventListener: vi.fn((_: string, fn: (e: MediaQueryListEvent) => void) => {
      listeners.push(fn)
    }),
    removeEventListener: vi.fn(),
  }
  Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn(() => mql) })
  return { mql, listeners }
}

describe('useBreakpoint', () => {
  it('returns desktop when viewport is wide', () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current.layout).toBe('desktop')
  })

  it('returns mobile when viewport is narrow', () => {
    mockMatchMedia(true)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current.layout).toBe('mobile')
  })

  it('updates layout when media query changes', () => {
    const { listeners } = mockMatchMedia(false)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current.layout).toBe('desktop')
    act(() => listeners[0]!({ matches: true } as MediaQueryListEvent))
    expect(result.current.layout).toBe('mobile')
  })

  it('removes listener on unmount', () => {
    const { mql } = mockMatchMedia(false)
    const { unmount } = renderHook(() => useBreakpoint())
    unmount()
    expect(mql.removeEventListener).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/pwa && npm test -- --reporter verbose useBreakpoint
```

Expected: `Cannot find module './useBreakpoint'`

- [ ] **Step 3: Implement hook**

```ts
// apps/pwa/src/hooks/useBreakpoint.ts
import { useState, useEffect } from 'react'

export type Layout = 'mobile' | 'desktop'

export function useBreakpoint(): { layout: Layout } {
  const query = '(max-width: 767px)'
  const [layout, setLayout] = useState<Layout>(
    () => (window.matchMedia(query).matches ? 'mobile' : 'desktop')
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const handler = (e: MediaQueryListEvent) => {
      setLayout(e.matches ? 'mobile' : 'desktop')
    }
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  return { layout }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd apps/pwa && npm test -- --reporter verbose useBreakpoint
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/hooks/useBreakpoint.ts apps/pwa/src/hooks/useBreakpoint.test.ts
git commit -m "feat: add useBreakpoint hook"
```

---

### Task 3: uiSlice

**Files:**
- Create: `apps/pwa/src/store/uiSlice.ts`
- Create: `apps/pwa/src/store/uiSlice.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/pwa/src/store/uiSlice.test.ts
import uiReducer, { setOverlayIntent, consumeOverlayIntent } from './uiSlice'

const initial = { uiIntent: { type: 'overlay' as const, name: null } }

describe('uiSlice', () => {
  it('has null intent as initial state', () => {
    expect(uiReducer(undefined, { type: '' })).toEqual(initial)
  })

  it('sets routes overlay intent', () => {
    const state = uiReducer(undefined, setOverlayIntent({ name: 'routes' }))
    expect(state.uiIntent).toEqual({ type: 'overlay', name: 'routes' })
  })

  it('sets acoustic overlay intent', () => {
    const state = uiReducer(undefined, setOverlayIntent({ name: 'acoustic' }))
    expect(state.uiIntent).toEqual({ type: 'overlay', name: 'acoustic' })
  })

  it('clears intent on consumeOverlayIntent', () => {
    const loaded = uiReducer(undefined, setOverlayIntent({ name: 'routes' }))
    const cleared = uiReducer(loaded, consumeOverlayIntent())
    expect(cleared.uiIntent.name).toBeNull()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/pwa && npm test -- --reporter verbose uiSlice.test
```

Expected: `Cannot find module './uiSlice'`

- [ ] **Step 3: Implement slice**

```ts
// apps/pwa/src/store/uiSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface UiIntent {
  type: 'overlay' | 'modal'
  name: string | null
}

interface UiState {
  uiIntent: UiIntent
}

const initialState: UiState = {
  uiIntent: { type: 'overlay', name: null },
}

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setOverlayIntent(state, action: PayloadAction<{ name: 'routes' | 'acoustic' }>) {
      state.uiIntent = { type: 'overlay', name: action.payload.name }
    },
    consumeOverlayIntent(state) {
      state.uiIntent = { type: 'overlay', name: null }
    },
  },
})

export const { setOverlayIntent, consumeOverlayIntent } = uiSlice.actions
export default uiSlice.reducer
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd apps/pwa && npm test -- --reporter verbose uiSlice.test
```

Expected: 4 tests pass.

- [ ] **Step 5: Register in store**

```ts
// apps/pwa/src/store/index.ts
import { configureStore } from '@reduxjs/toolkit'
import eventsReducer from './eventsSlice'
import acousticReducer from './acousticSlice'
import reportsReducer from './reportSlice'
import circlesReducer from './circlesSlice'
import uiReducer from './uiSlice'
import { useSelector, TypedUseSelectorHook, useDispatch } from 'react-redux'

export const store = configureStore({
  reducer: {
    events: eventsReducer,
    acoustic: acousticReducer,
    reports: reportsReducer,
    circles: circlesReducer,
    ui: uiReducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector
export const useAppDispatch = () => useDispatch<AppDispatch>()
```

- [ ] **Step 6: Run full suite — no regressions**

```bash
cd apps/pwa && npm test
```

Expected: All existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/pwa/src/store/uiSlice.ts apps/pwa/src/store/uiSlice.test.ts apps/pwa/src/store/index.ts
git commit -m "feat: uiSlice with overlay intent, register in store"
```

---

### Task 4: AppShell

**Files:**
- Create: `apps/pwa/src/components/shell/AppShell.tsx`
- Create: `apps/pwa/src/components/shell/AppShell.test.tsx`

Note: Header, Sidebar, BottomNav are stubbed here and swapped in Tasks 5–7.

- [ ] **Step 1: Write failing test**

```tsx
// apps/pwa/src/components/shell/AppShell.test.tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { Provider } from 'react-redux'
import { store } from '../../store'
import { AppShell } from './AppShell'

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <Provider store={store}>
      <MemoryRouter initialEntries={['/map']}>{children}</MemoryRouter>
    </Provider>
  )
}

describe('AppShell', () => {
  it('renders outlet content', () => {
    render(
      <Wrapper>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/map" element={<div>map page</div>} />
          </Route>
        </Routes>
      </Wrapper>
    )
    expect(screen.getByText('map page')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/pwa && npm test -- --reporter verbose AppShell.test
```

Expected: `Cannot find module './AppShell'`

- [ ] **Step 3: Implement AppShell with stubs**

```tsx
// apps/pwa/src/components/shell/AppShell.tsx
import { Outlet } from 'react-router-dom'
import { useBreakpoint } from '../../hooks/useBreakpoint'

function SidebarStub() {
  return <div style={{ width: 64, background: '#0B0E14', borderRight: '1px solid #1a2035', flexShrink: 0 }} />
}
function HeaderStub() {
  return <div style={{ height: 56, background: '#0B0E14', borderBottom: '1px solid #1a2035', flexShrink: 0 }} />
}
function BottomNavStub() {
  return <div style={{ height: 56, background: '#0B0E14', borderTop: '1px solid #1a2035', flexShrink: 0 }} />
}

export function AppShell() {
  const { layout } = useBreakpoint()
  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', background: '#0B0E14' }}>
      <HeaderStub />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {layout === 'desktop' && <SidebarStub />}
        <main style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          <Outlet />
        </main>
      </div>
      {layout === 'mobile' && <BottomNavStub />}
    </div>
  )
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd apps/pwa && npm test -- --reporter verbose AppShell.test
```

Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/components/shell/AppShell.tsx apps/pwa/src/components/shell/AppShell.test.tsx
git commit -m "feat: AppShell layout wrapper with stubs"
```

---

### Task 5: Header

**Files:**
- Create: `apps/pwa/src/components/shell/Header.tsx`
- Create: `apps/pwa/src/components/shell/Header.test.tsx`
- Modify: `apps/pwa/src/components/shell/AppShell.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/pwa/src/components/shell/Header.test.tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import eventsReducer from '../../store/eventsSlice'
import uiReducer from '../../store/uiSlice'
import type { SafetyEvent } from '../../../../../shared/types'
import { Header } from './Header'

const baseEvent: SafetyEvent = {
  event_id: 'e1', event_type: 'SECURITY_INCIDENT', severity: 'HIGH',
  title: 'Test', summary: null, location: null, confidence: 0.9,
  source_count: 1, source_breakdown: {}, is_active: true,
  started_at: '2026-01-01T00:00:00Z', last_updated: '2026-01-01T00:00:00Z',
  nostr_event_id: null, bitcoin_txid: null,
}

function makeStore(opts: { connected?: boolean; items?: SafetyEvent[] } = {}) {
  return configureStore({
    reducer: { events: eventsReducer, ui: uiReducer },
    preloadedState: { events: { items: opts.items ?? [], connected: opts.connected ?? false } },
  })
}

function wrap(store: ReturnType<typeof makeStore>) {
  return ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}><MemoryRouter>{children}</MemoryRouter></Provider>
  )
}

describe('Header', () => {
  it('renders SentinelMesh brand', () => {
    render(<Header />, { wrapper: wrap(makeStore()) })
    expect(screen.getByText('SentinelMesh')).toBeInTheDocument()
  })

  it('shows Live when WS connected', () => {
    render(<Header />, { wrapper: wrap(makeStore({ connected: true })) })
    expect(screen.getByText('Live')).toBeInTheDocument()
  })

  it('shows Offline when WS disconnected', () => {
    render(<Header />, { wrapper: wrap(makeStore({ connected: false })) })
    expect(screen.getByText('Offline')).toBeInTheDocument()
  })

  it('shows active event count in notification badge', () => {
    render(<Header />, { wrapper: wrap(makeStore({ items: [baseEvent] })) })
    expect(screen.getByText('1')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/pwa && npm test -- --reporter verbose Header.test
```

Expected: `Cannot find module './Header'`

- [ ] **Step 3: Implement Header**

```tsx
// apps/pwa/src/components/shell/Header.tsx
import { useNavigate } from 'react-router-dom'
import { useAppSelector } from '../../store'

export function Header() {
  const navigate = useNavigate()
  const connected = useAppSelector(s => s.events.connected)
  const activeCount = useAppSelector(s => s.events.items.filter(e => e.is_active).length)

  return (
    <div style={{
      height: 56, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12,
      padding: '0 16px', background: '#0B0E14', borderBottom: '1px solid #1a2035',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 28, height: 28, background: '#00E5FF', borderRadius: 6,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700, color: '#0B0E14',
        }}>S</div>
        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 14, fontWeight: 700, color: '#e2e8f0', letterSpacing: '0.05em' }}>
          SentinelMesh
        </span>
      </div>

      <input
        style={{
          flex: 1, maxWidth: 320, background: '#0d1118', border: '1px solid #1a2035',
          borderRadius: 8, padding: '6px 12px', color: '#e2e8f0',
          fontFamily: "'Courier New', monospace", fontSize: 12, outline: 'none',
        }}
        placeholder="Search location in Kenya..."
        onKeyDown={e => { if (e.key === 'Enter') navigate('/map') }}
      />

      <div style={{ flex: 1 }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: "'Courier New', monospace", fontSize: 11, letterSpacing: '0.1em' }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: connected ? '#4CAF50' : '#4a5568' }} />
        <span style={{ color: connected ? '#4CAF50' : '#4a5568' }}>{connected ? 'Live' : 'Offline'}</span>
      </div>

      <span style={{ fontSize: 16 }}>🇰🇪</span>

      <button
        aria-label="notifications"
        style={{ position: 'relative', background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: '#e2e8f0', fontSize: 16 }}
      >
        🔔
        {activeCount > 0 && (
          <span style={{
            position: 'absolute', top: 0, right: 0,
            background: '#FF2D2D', color: '#fff', borderRadius: '50%',
            width: 16, height: 16, fontSize: 9,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Courier New', monospace",
          }}>{activeCount}</span>
        )}
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd apps/pwa && npm test -- --reporter verbose Header.test
```

Expected: 4 tests pass.

- [ ] **Step 5: Swap stub in AppShell**

Replace `HeaderStub` in `apps/pwa/src/components/shell/AppShell.tsx`:

```tsx
// apps/pwa/src/components/shell/AppShell.tsx
import { Outlet } from 'react-router-dom'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { Header } from './Header'

function SidebarStub() {
  return <div style={{ width: 64, background: '#0B0E14', borderRight: '1px solid #1a2035', flexShrink: 0 }} />
}
function BottomNavStub() {
  return <div style={{ height: 56, background: '#0B0E14', borderTop: '1px solid #1a2035', flexShrink: 0 }} />
}

export function AppShell() {
  const { layout } = useBreakpoint()
  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', background: '#0B0E14' }}>
      <Header />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {layout === 'desktop' && <SidebarStub />}
        <main style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          <Outlet />
        </main>
      </div>
      {layout === 'mobile' && <BottomNavStub />}
    </div>
  )
}
```

- [ ] **Step 6: Run full suite — no regressions**

```bash
cd apps/pwa && npm test
```

- [ ] **Step 7: Commit**

```bash
git add apps/pwa/src/components/shell/Header.tsx apps/pwa/src/components/shell/Header.test.tsx apps/pwa/src/components/shell/AppShell.tsx
git commit -m "feat: Header with live indicator and notification bell"
```

---

### Task 6: Sidebar

**Files:**
- Create: `apps/pwa/src/components/shell/Sidebar.tsx`
- Create: `apps/pwa/src/components/shell/Sidebar.test.tsx`
- Modify: `apps/pwa/src/components/shell/AppShell.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/pwa/src/components/shell/Sidebar.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import eventsReducer from '../../store/eventsSlice'
import uiReducer from '../../store/uiSlice'
import { Sidebar } from './Sidebar'

function makeStore() {
  return configureStore({ reducer: { events: eventsReducer, ui: uiReducer } })
}
function Wrapper({ store }: { store: ReturnType<typeof makeStore> }) {
  return ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}><MemoryRouter initialEntries={['/map']}>{children}</MemoryRouter></Provider>
  )
}

describe('Sidebar', () => {
  it('renders all 9 nav item labels', () => {
    const s = makeStore()
    render(<Sidebar />, { wrapper: Wrapper({ store: s }) })
    ;['Live Map', 'Alerts', 'Reports', 'Family Circles', 'Routes',
      'Acoustic Detect', 'Zaps', 'Insights', 'Settings'].forEach(label => {
      expect(screen.getByText(label)).toBeInTheDocument()
    })
  })

  it('shows NEW badge on Insights', () => {
    const s = makeStore()
    render(<Sidebar />, { wrapper: Wrapper({ store: s }) })
    expect(screen.getByText('NEW')).toBeInTheDocument()
  })

  it('dispatches routes overlay intent when Routes clicked', () => {
    const s = makeStore()
    render(<Sidebar />, { wrapper: Wrapper({ store: s }) })
    fireEvent.click(screen.getByText('Routes'))
    expect(s.getState().ui.uiIntent).toEqual({ type: 'overlay', name: 'routes' })
  })

  it('dispatches acoustic overlay intent when Acoustic Detect clicked', () => {
    const s = makeStore()
    render(<Sidebar />, { wrapper: Wrapper({ store: s }) })
    fireEvent.click(screen.getByText('Acoustic Detect'))
    expect(s.getState().ui.uiIntent).toEqual({ type: 'overlay', name: 'acoustic' })
  })

  it('shows operational status indicator', () => {
    const s = makeStore()
    render(<Sidebar />, { wrapper: Wrapper({ store: s }) })
    expect(screen.getByText('All systems operational')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/pwa && npm test -- --reporter verbose Sidebar.test
```

Expected: `Cannot find module './Sidebar'`

- [ ] **Step 3: Implement Sidebar**

```tsx
// apps/pwa/src/components/shell/Sidebar.tsx
import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAppDispatch } from '../../store'
import { setOverlayIntent } from '../../store/uiSlice'

type OverlayName = 'routes' | 'acoustic'

const routeItems = [
  { path: '/map',      label: 'Live Map',       icon: '◉' },
  { path: '/alerts',   label: 'Alerts',         icon: '🔔' },
  { path: '/reports',  label: 'Reports',        icon: '📋' },
  { path: '/circles',  label: 'Family Circles', icon: '👥' },
  { path: '/zaps',     label: 'Zaps',           icon: '⚡' },
  { path: '/insights', label: 'Insights',       icon: '📊', badge: 'NEW' },
  { path: '/settings', label: 'Settings',       icon: '⚙️' },
] as const

const overlayItems: { overlay: OverlayName; label: string; icon: string }[] = [
  { overlay: 'routes',   label: 'Routes',         icon: '🛣' },
  { overlay: 'acoustic', label: 'Acoustic Detect', icon: '🎙' },
]

const itemBase: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px',
  fontFamily: "'Courier New', monospace", fontSize: 11, letterSpacing: '0.08em',
  color: '#4a5568', textDecoration: 'none', whiteSpace: 'nowrap',
  border: 'none', background: 'none', width: '100%', cursor: 'pointer',
  boxSizing: 'border-box',
}

export function Sidebar() {
  const [expanded, setExpanded] = useState(false)
  const dispatch = useAppDispatch()
  const navigate = useNavigate()

  function handleOverlay(name: OverlayName) {
    dispatch(setOverlayIntent({ name }))
    navigate('/map')
  }

  return (
    <div
      style={{
        width: expanded ? 220 : 64, flexShrink: 0, transition: 'width 200ms ease',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: '#0B0E14', borderRight: '1px solid #1a2035',
      }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {routeItems.map(item => (
        <NavLink
          key={item.path}
          to={item.path}
          style={({ isActive }) => ({
            ...itemBase,
            color: isActive ? '#00E5FF' : '#4a5568',
            borderLeft: isActive ? '2px solid #00E5FF' : '2px solid transparent',
          })}
        >
          <span style={{ fontSize: 16, flexShrink: 0, width: 24, textAlign: 'center' as const }}>{item.icon}</span>
          <span style={{ opacity: expanded ? 1 : 0, transition: 'opacity 150ms', pointerEvents: 'none' }}>
            {item.label}
          </span>
          {'badge' in item && item.badge && (
            <span style={{
              opacity: expanded ? 1 : 0, marginLeft: 4,
              background: '#BB86FC', color: '#0B0E14', borderRadius: 4,
              padding: '1px 4px', fontSize: 9, fontFamily: "'Courier New', monospace",
            }}>{item.badge}</span>
          )}
        </NavLink>
      ))}

      {overlayItems.map(item => (
        <button key={item.overlay} style={itemBase} onClick={() => handleOverlay(item.overlay)}>
          <span style={{ fontSize: 16, flexShrink: 0, width: 24, textAlign: 'center' as const }}>{item.icon}</span>
          <span style={{ opacity: expanded ? 1 : 0, transition: 'opacity 150ms', pointerEvents: 'none' }}>
            {item.label}
          </span>
        </button>
      ))}

      <div style={{ marginTop: 'auto', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#4CAF50', flexShrink: 0 }} />
        <span style={{
          opacity: expanded ? 1 : 0, transition: 'opacity 150ms',
          fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4CAF50',
          letterSpacing: '0.05em', whiteSpace: 'nowrap',
        }}>All systems operational</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd apps/pwa && npm test -- --reporter verbose Sidebar.test
```

Expected: 5 tests pass.

- [ ] **Step 5: Swap SidebarStub in AppShell**

```tsx
// apps/pwa/src/components/shell/AppShell.tsx
import { Outlet } from 'react-router-dom'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { Header } from './Header'
import { Sidebar } from './Sidebar'

function BottomNavStub() {
  return <div style={{ height: 56, background: '#0B0E14', borderTop: '1px solid #1a2035', flexShrink: 0 }} />
}

export function AppShell() {
  const { layout } = useBreakpoint()
  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', background: '#0B0E14' }}>
      <Header />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {layout === 'desktop' && <Sidebar />}
        <main style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          <Outlet />
        </main>
      </div>
      {layout === 'mobile' && <BottomNavStub />}
    </div>
  )
}
```

- [ ] **Step 6: Run full suite — no regressions**

```bash
cd apps/pwa && npm test
```

- [ ] **Step 7: Commit**

```bash
git add apps/pwa/src/components/shell/Sidebar.tsx apps/pwa/src/components/shell/Sidebar.test.tsx apps/pwa/src/components/shell/AppShell.tsx
git commit -m "feat: Sidebar with overlay intent dispatch"
```

---

### Task 7: BottomNav

**Files:**
- Create: `apps/pwa/src/components/shell/BottomNav.tsx`
- Create: `apps/pwa/src/components/shell/BottomNav.test.tsx`
- Modify: `apps/pwa/src/components/shell/AppShell.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/pwa/src/components/shell/BottomNav.test.tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BottomNav } from './BottomNav'

describe('BottomNav', () => {
  it('renders 5 navigation tabs', () => {
    render(<MemoryRouter><BottomNav /></MemoryRouter>)
    expect(screen.getByText('Map')).toBeInTheDocument()
    expect(screen.getByText('Alerts')).toBeInTheDocument()
    expect(screen.getByText('Report')).toBeInTheDocument()
    expect(screen.getByText('Family')).toBeInTheDocument()
    expect(screen.getByText('Profile')).toBeInTheDocument()
  })

  it('all tabs are links', () => {
    render(<MemoryRouter><BottomNav /></MemoryRouter>)
    expect(screen.getAllByRole('link')).toHaveLength(5)
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/pwa && npm test -- --reporter verbose BottomNav.test
```

- [ ] **Step 3: Implement BottomNav**

```tsx
// apps/pwa/src/components/shell/BottomNav.tsx
import { NavLink } from 'react-router-dom'

const tabs = [
  { path: '/map',      label: 'Map',     icon: '◉' },
  { path: '/alerts',   label: 'Alerts',  icon: '🔔' },
  { path: '/reports',  label: 'Report',  icon: '📋' },
  { path: '/circles',  label: 'Family',  icon: '👥' },
  { path: '/settings', label: 'Profile', icon: '⚙️' },
] as const

export function BottomNav() {
  return (
    <nav style={{
      height: 56, flexShrink: 0, display: 'flex', alignItems: 'stretch',
      background: '#0B0E14', borderTop: '1px solid #1a2035',
    }}>
      {tabs.map(tab => (
        <NavLink
          key={tab.path}
          to={tab.path}
          style={({ isActive }) => ({
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 2,
            textDecoration: 'none',
            color: isActive ? '#00E5FF' : '#4a5568',
            fontFamily: "'Courier New', monospace", fontSize: 9, letterSpacing: '0.08em',
            borderTop: isActive ? '2px solid #00E5FF' : '2px solid transparent',
          })}
        >
          <span style={{ fontSize: 18 }}>{tab.icon}</span>
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd apps/pwa && npm test -- --reporter verbose BottomNav.test
```

- [ ] **Step 5: Swap BottomNavStub in AppShell**

```tsx
// apps/pwa/src/components/shell/AppShell.tsx
import { Outlet } from 'react-router-dom'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'

export function AppShell() {
  const { layout } = useBreakpoint()
  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', background: '#0B0E14' }}>
      <Header />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {layout === 'desktop' && <Sidebar />}
        <main style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          <Outlet />
        </main>
      </div>
      {layout === 'mobile' && <BottomNav />}
    </div>
  )
}
```

- [ ] **Step 6: Run full suite**

```bash
cd apps/pwa && npm test
```

- [ ] **Step 7: Commit**

```bash
git add apps/pwa/src/components/shell/BottomNav.tsx apps/pwa/src/components/shell/BottomNav.test.tsx apps/pwa/src/components/shell/AppShell.tsx
git commit -m "feat: BottomNav, finalize AppShell shell"
```

---

### Task 8: AlertCard shared component

**Files:**
- Create: `apps/pwa/src/components/shared/AlertCard.tsx`
- Create: `apps/pwa/src/components/shared/AlertCard.test.tsx`

Note: `AlertCard` is the single source of truth for event card UI, used in `AlertsDock`, `AlertsSheet`, and `AlertsPage`. `type` uses `EventType` from shared types (the actual data format) rather than the design-mockup display labels.

- [ ] **Step 1: Write failing test**

```tsx
// apps/pwa/src/components/shared/AlertCard.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import type { AlertCardProps } from './AlertCard'
import { AlertCard } from './AlertCard'

const base: AlertCardProps = {
  eventId: 'e1',
  eventType: 'SECURITY_INCIDENT',
  title: 'Gunshots reported',
  location: 'Pangani, Nairobi',
  timestamp: Date.now() - 120_000,
  confidence: 0.86,
  status: 'VERIFIED',
  sources: ['NLP', 'Community'],
  voteCount: 12,
  onBookmark: vi.fn(),
}

describe('AlertCard', () => {
  it('renders title and location', () => {
    render(<AlertCard {...base} />)
    expect(screen.getByText('Gunshots reported')).toBeInTheDocument()
    expect(screen.getByText('Pangani, Nairobi')).toBeInTheDocument()
  })

  it('renders VERIFIED status badge', () => {
    render(<AlertCard {...base} status="VERIFIED" />)
    expect(screen.getByText('VERIFIED')).toBeInTheDocument()
  })

  it('renders PENDING status badge', () => {
    render(<AlertCard {...base} status="PENDING" />)
    expect(screen.getByText('PENDING')).toBeInTheDocument()
  })

  it('renders confidence percentage', () => {
    render(<AlertCard {...base} confidence={0.86} />)
    expect(screen.getByText('86%')).toBeInTheDocument()
  })

  it('renders all source tags', () => {
    render(<AlertCard {...base} sources={['NLP', 'Radio', 'Community']} />)
    expect(screen.getByText('NLP')).toBeInTheDocument()
    expect(screen.getByText('Radio')).toBeInTheDocument()
    expect(screen.getByText('Community')).toBeInTheDocument()
  })

  it('calls onBookmark with eventId when bookmark clicked', () => {
    const onBookmark = vi.fn()
    render(<AlertCard {...base} onBookmark={onBookmark} />)
    fireEvent.click(screen.getByLabelText('bookmark'))
    expect(onBookmark).toHaveBeenCalledWith('e1')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/pwa && npm test -- --reporter verbose AlertCard.test
```

- [ ] **Step 3: Implement AlertCard**

```tsx
// apps/pwa/src/components/shared/AlertCard.tsx
import type { EventType } from '../../../../shared/types'

export interface AlertCardProps {
  eventId: string
  eventType: EventType
  title: string
  location: string
  timestamp: number
  confidence: number
  status: 'VERIFIED' | 'PENDING'
  sources: Array<'NLP' | 'Radio' | 'Community' | 'Social'>
  voteCount: number
  onBookmark: (eventId: string) => void
}

// Shared mapping helper — used by AlertsDock, AlertsSheet, AlertsPage.
// Export here so there is one source of truth.
export function safetyEventToCardProps(e: SafetyEvent, onBookmark = (_id: string) => {}): AlertCardProps {
  return {
    eventId:    e.event_id,
    eventType:  e.event_type,
    title:      e.title,
    location:   e.location?.place_name ?? 'Unknown location',
    timestamp:  new Date(e.last_updated).getTime(),
    confidence: e.confidence,
    status:     e.confidence >= 0.7 ? 'VERIFIED' : 'PENDING',
    sources:    Object.keys(e.source_breakdown) as Array<'NLP' | 'Radio' | 'Community' | 'Social'>,
    voteCount:  e.source_count,
    onBookmark,
  }
}

const typeColor: Record<EventType, string> = {
  SECURITY_INCIDENT:    '#FF2D2D',
  CIVIL_UNREST:         '#FF9800',
  TRAFFIC_INCIDENT:     '#2196F3',
  FLOOD:                '#00BCD4',
  FIRE:                 '#FF5722',
  MEDICAL_EMERGENCY:    '#E91E63',
  INFRASTRUCTURE_FAILURE: '#9C27B0',
  FALSE_ALARM:          '#4a5568',
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  return `${Math.floor(m / 60)}h ago`
}

export function AlertCard({ eventId, eventType, title, location, timestamp, confidence, status, sources, voteCount, onBookmark }: AlertCardProps) {
  const accent = typeColor[eventType] ?? '#4a5568'
  const pct = Math.round(confidence * 100)

  return (
    <div style={{
      background: '#0d1118', border: '1px solid #1a2035', borderRadius: 8,
      padding: '10px 12px', marginBottom: 8,
      borderLeft: `3px solid ${accent}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 12, fontWeight: 700, color: '#e2e8f0', marginBottom: 2 }}>
            {title}
          </div>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4a5568' }}>
            {location}
          </div>
        </div>
        <button
          aria-label="bookmark"
          onClick={() => onBookmark(eventId)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4a5568', fontSize: 14, padding: 2 }}
        >
          🔖
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const }}>
        <span style={{
          fontFamily: "'Courier New', monospace", fontSize: 9, padding: '2px 6px',
          borderRadius: 4, letterSpacing: '0.08em',
          background: status === 'VERIFIED' ? '#1B5E20' : '#1A237E',
          color: status === 'VERIFIED' ? '#4CAF50' : '#BB86FC',
        }}>{status}</span>

        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#4a5568' }}>
          {pct}% confidence
        </span>

        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#4a5568' }}>
          {timeAgo(timestamp)}
        </span>

        {sources.map(src => (
          <span key={src} style={{
            fontFamily: "'Courier New', monospace", fontSize: 9, padding: '1px 5px',
            borderRadius: 3, background: '#1a2035', color: '#4a5568',
          }}>{src}</span>
        ))}

        <span style={{ marginLeft: 'auto', fontFamily: "'Courier New', monospace", fontSize: 9, color: '#4a5568' }}>
          {voteCount} votes
        </span>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd apps/pwa && npm test -- --reporter verbose AlertCard.test
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/components/shared/AlertCard.tsx apps/pwa/src/components/shared/AlertCard.test.tsx
git commit -m "feat: AlertCard shared component, single source of truth for event cards"
```

---

### Task 9: MapStatsBar + MapFeatureStrip

**Files:**
- Create: `apps/pwa/src/components/map/MapStatsBar.tsx`
- Create: `apps/pwa/src/components/map/MapStatsBar.test.tsx`
- Create: `apps/pwa/src/components/map/MapFeatureStrip.tsx`
- Create: `apps/pwa/src/components/map/MapFeatureStrip.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// apps/pwa/src/components/map/MapStatsBar.test.tsx
import { render, screen } from '@testing-library/react'
import { MapStatsBar } from './MapStatsBar'

describe('MapStatsBar', () => {
  it('renders active alert count', () => {
    render(<MapStatsBar activeAlerts={27} verified={18} verifiedPct={87} communityScore={4.6} sources={12} />)
    expect(screen.getByText('27')).toBeInTheDocument()
  })

  it('renders verified count', () => {
    render(<MapStatsBar activeAlerts={27} verified={18} verifiedPct={87} communityScore={4.6} sources={12} />)
    expect(screen.getByText('18')).toBeInTheDocument()
  })

  it('renders community score', () => {
    render(<MapStatsBar activeAlerts={27} verified={18} verifiedPct={87} communityScore={4.6} sources={12} />)
    expect(screen.getByText('4.6')).toBeInTheDocument()
  })

  it('renders source count', () => {
    render(<MapStatsBar activeAlerts={27} verified={18} verifiedPct={87} communityScore={4.6} sources={12} />)
    expect(screen.getByText('12')).toBeInTheDocument()
  })
})
```

```tsx
// apps/pwa/src/components/map/MapFeatureStrip.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { MapFeatureStrip } from './MapFeatureStrip'

describe('MapFeatureStrip', () => {
  it('renders 5 feature cards', () => {
    const noop = vi.fn()
    render(<MapFeatureStrip onReport={noop} onAcoustic={noop} onCircles={noop} onRoutes={noop} onZaps={noop} />)
    expect(screen.getByText('Report Incident')).toBeInTheDocument()
    expect(screen.getByText('Acoustic Detect')).toBeInTheDocument()
    expect(screen.getByText('Family Circles')).toBeInTheDocument()
    expect(screen.getByText('Escape Routes')).toBeInTheDocument()
    expect(screen.getByText('Zap Reporter')).toBeInTheDocument()
  })

  it('calls onAcoustic when Acoustic Detect clicked', () => {
    const onAcoustic = vi.fn()
    const noop = vi.fn()
    render(<MapFeatureStrip onReport={noop} onAcoustic={onAcoustic} onCircles={noop} onRoutes={noop} onZaps={noop} />)
    fireEvent.click(screen.getByText('Acoustic Detect'))
    expect(onAcoustic).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd apps/pwa && npm test -- --reporter verbose MapStatsBar.test
cd apps/pwa && npm test -- --reporter verbose MapFeatureStrip.test
```

- [ ] **Step 3: Implement MapStatsBar**

```tsx
// apps/pwa/src/components/map/MapStatsBar.tsx
interface Props {
  activeAlerts: number
  verified: number
  verifiedPct: number
  communityScore: number
  sources: number
}

export function MapStatsBar({ activeAlerts, verified, verifiedPct, communityScore, sources }: Props) {
  const stat = (label: string, value: string | number, sub?: string): React.ReactNode => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 16px', borderRight: '1px solid #1a2035' }}>
      <span style={{ fontFamily: "'Courier New', monospace", fontSize: 22, fontWeight: 700, color: '#e2e8f0' }}>{value}</span>
      <span style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#4a5568', letterSpacing: '0.08em', textTransform: 'uppercase' as const }}>{label}</span>
      {sub && <span style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#4CAF50' }}>{sub}</span>}
    </div>
  )

  return (
    <div style={{
      display: 'flex', alignItems: 'stretch', flexShrink: 0,
      background: '#0B0E14', borderBottom: '1px solid #1a2035', padding: '8px 0',
    }}>
      {stat('Active Alerts', activeAlerts, `+6 since 1h`)}
      {stat('Verified', verified, `${verifiedPct}% of alerts`)}
      {stat('Community Score', communityScore)}
      {stat('Sources', sources, 'NLP + Social + Radio')}
    </div>
  )
}
```

- [ ] **Step 4: Implement MapFeatureStrip**

```tsx
// apps/pwa/src/components/map/MapFeatureStrip.tsx
interface Props {
  onReport: () => void
  onAcoustic: () => void
  onCircles: () => void
  onRoutes: () => void
  onZaps: () => void
}

const cards: { label: string; icon: string; key: keyof Props }[] = [
  { label: 'Report Incident',  icon: '📢', key: 'onReport'   },
  { label: 'Acoustic Detect',  icon: '🎙', key: 'onAcoustic' },
  { label: 'Family Circles',   icon: '👥', key: 'onCircles'  },
  { label: 'Escape Routes',    icon: '🛣', key: 'onRoutes'   },
  { label: 'Zap Reporter',     icon: '⚡', key: 'onZaps'     },
]

export function MapFeatureStrip(props: Props) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '8px 12px', background: '#0B0E14', borderTop: '1px solid #1a2035', flexShrink: 0 }}>
      {cards.map(c => (
        <button
          key={c.key}
          onClick={props[c.key]}
          style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            padding: '8px 4px', background: '#0d1118', border: '1px solid #1a2035',
            borderRadius: 8, cursor: 'pointer', color: '#e2e8f0',
          }}
        >
          <span style={{ fontSize: 20 }}>{c.icon}</span>
          <span style={{ fontFamily: "'Courier New', monospace", fontSize: 9, letterSpacing: '0.06em', color: '#4a5568', textAlign: 'center' as const }}>
            {c.label}
          </span>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd apps/pwa && npm test -- --reporter verbose "MapStatsBar|MapFeatureStrip"
```

Expected: 6 tests pass total.

- [ ] **Step 6: Commit**

```bash
git add apps/pwa/src/components/map/MapStatsBar.tsx apps/pwa/src/components/map/MapStatsBar.test.tsx apps/pwa/src/components/map/MapFeatureStrip.tsx apps/pwa/src/components/map/MapFeatureStrip.test.tsx
git commit -m "feat: MapStatsBar and MapFeatureStrip components"
```

---

### Task 10: MapCanvas + AlertsDock + AlertsSheet + MapOverlayHost

**Files:**
- Create: `apps/pwa/src/components/map/MapCanvas.tsx`
- Create: `apps/pwa/src/components/map/AlertsDock.tsx`
- Create: `apps/pwa/src/components/map/AlertsSheet.tsx`
- Create: `apps/pwa/src/components/map/MapOverlayHost.tsx`

No separate tests for these — they wrap existing components or are layout containers. Integration is tested via LiveMapPage in Task 11.

- [ ] **Step 1: Implement MapCanvas**

`MapCanvas` is a thin wrapper ensuring `SafetyMap` fills its container and receives filter props.

```tsx
// apps/pwa/src/components/map/MapCanvas.tsx
import SafetyMap from '../SafetyMap'
import type { EventType } from '../../../../shared/types'

interface Props {
  activeFilters: EventType[]
}

export function MapCanvas({ activeFilters }: Props) {
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <SafetyMap activeFilters={activeFilters} />
    </div>
  )
}
```

Note: `SafetyMap` currently takes no props. Add `activeFilters?: EventType[]` to its props signature and use it to filter markers. Do NOT rewrite SafetyMap — just add the optional prop.

- [ ] **Step 2: Add activeFilters prop to SafetyMap**

Open `apps/pwa/src/components/SafetyMap.tsx`. Find the component function. Change the function signature from:

```tsx
export default function SafetyMap() {
```

to:

```tsx
import type { EventType } from '../../../../shared/types'

interface SafetyMapProps {
  activeFilters?: EventType[]
}

export default function SafetyMap({ activeFilters = [] }: SafetyMapProps) {
```

Then find where events are mapped to markers (look for `events.map` or `items.map`). Add this line immediately before that `.map()` call:

```tsx
const visibleEvents = activeFilters.length === 0
  ? events
  : events.filter(e => activeFilters.includes(e.event_type))
```

Replace the `events` or `items` variable in the `.map()` call with `visibleEvents`.

- [ ] **Step 3: Implement AlertsDock (desktop right panel)**

```tsx
// apps/pwa/src/components/map/AlertsDock.tsx
import { AlertCard, safetyEventToCardProps } from '../shared/AlertCard'
import { useAppSelector } from '../../store'

export function AlertsDock() {
  const events = useAppSelector(s => s.events.items.filter(e => e.is_active).slice(0, 20))

  return (
    <div style={{
      width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column',
      background: '#0B0E14', borderLeft: '1px solid #1a2035', overflowY: 'auto',
    }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #1a2035', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#e2e8f0', letterSpacing: '0.1em', textTransform: 'uppercase' as const }}>Live Alerts</span>
        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#00E5FF', cursor: 'pointer' }}>See All</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {events.map(e => <AlertCard key={e.event_id} {...toCardProps(e)} />)}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Implement AlertsSheet (mobile bottom sheet)**

```tsx
// apps/pwa/src/components/map/AlertsSheet.tsx
import { useState } from 'react'
import { AlertCard, safetyEventToCardProps } from '../shared/AlertCard'
import { useAppSelector } from '../../store'

export function AlertsSheet() {
  const [open, setOpen] = useState(false)
  const events = useAppSelector(s => s.events.items.filter(e => e.is_active).slice(0, 10))
  const activeCount = events.length

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
          background: '#0d1118', border: '1px solid #1a2035', borderRadius: 20,
          padding: '8px 20px', color: '#e2e8f0', cursor: 'pointer',
          fontFamily: "'Courier New', monospace", fontSize: 11, zIndex: 10,
        }}
      >
        {activeCount} Live Alerts {open ? '▼' : '▲'}
      </button>
      {open && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20,
          background: '#0B0E14', borderTop: '1px solid #1a2035',
          maxHeight: '50vh', overflowY: 'auto', padding: 8,
        }}>
          {events.map(e => <AlertCard key={e.event_id} {...toCardProps(e)} />)}
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 5: Implement MapOverlayHost**

`MapOverlayHost` reads `uiSlice.uiIntent`, consumes it via `consumeOverlayIntent()`, and manages local overlay state. Device-agnostic: derives presentation from `layout` token.

```tsx
// apps/pwa/src/components/map/MapOverlayHost.tsx
import { useEffect, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../../store'
import { consumeOverlayIntent } from '../../store/uiSlice'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { AcousticAlert } from '../AcousticAlert'
import { SafeRouteOverlay } from '../SafeRouteOverlay'
import { alertDismissed } from '../../store/acousticSlice'

type OverlayName = 'routes' | 'acoustic' | null
type Presentation = 'panel' | 'sheet' | 'fullscreen'

export function MapOverlayHost() {
  const dispatch = useAppDispatch()
  const { layout } = useBreakpoint()
  const intent = useAppSelector(s => s.ui.uiIntent)
  const currentAlert = useAppSelector(s => s.acoustic.currentAlert)
  const [overlay, setOverlay] = useState<OverlayName>(null)

  useEffect(() => {
    if (intent.name) {
      setOverlay(intent.name as OverlayName)
      dispatch(consumeOverlayIntent())
    }
  }, [intent.name, dispatch])

  const presentation: Presentation =
    layout === 'mobile' ? 'fullscreen' : 'panel'

  if (!overlay && !currentAlert) return null

  const panelStyle: React.CSSProperties =
    presentation === 'fullscreen'
      ? { position: 'absolute', inset: 0, zIndex: 30, background: '#0B0E14' }
      : { position: 'absolute', right: 0, top: 0, bottom: 0, width: 320, zIndex: 30, background: '#0B0E14', borderLeft: '1px solid #1a2035' }

  return (
    <div style={panelStyle}>
      {currentAlert && (
        <AcousticAlert detection={currentAlert} onDismiss={() => dispatch(alertDismissed())} />
      )}
      {overlay === 'acoustic' && !currentAlert && (
        <div style={{ padding: 16, fontFamily: "'Courier New', monospace", fontSize: 12, color: '#4a5568' }}>
          Acoustic detection active — listening locally...
        </div>
      )}
      {overlay === 'routes' && (
        <SafeRouteOverlay onClose={() => setOverlay(null)} />
      )}
      <button
        onClick={() => setOverlay(null)}
        style={{
          position: 'absolute', top: 8, right: 8, background: 'none', border: 'none',
          color: '#4a5568', fontSize: 18, cursor: 'pointer',
        }}
      >✕</button>
    </div>
  )
}
```

Note: `SafeRouteOverlay` may not accept an `onClose` prop today. Add `onClose?: () => void` to its props and wire a close button inside it.

- [ ] **Step 6: Commit**

```bash
git add apps/pwa/src/components/map/MapCanvas.tsx apps/pwa/src/components/map/AlertsDock.tsx apps/pwa/src/components/map/AlertsSheet.tsx apps/pwa/src/components/map/MapOverlayHost.tsx
git commit -m "feat: map subcomponents — MapCanvas, AlertsDock, AlertsSheet, MapOverlayHost"
```

---

### Task 11: useNearestThreat + LiveMapPage

**Files:**
- Create: `apps/pwa/src/hooks/useNearestThreat.ts`
- Create: `apps/pwa/src/hooks/useNearestThreat.test.ts`
- Create: `apps/pwa/src/pages/LiveMapPage.tsx`

- [ ] **Step 1: Write failing test for useNearestThreat**

```ts
// apps/pwa/src/hooks/useNearestThreat.test.ts
import { renderHook } from '@testing-library/react'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import eventsReducer from '../store/eventsSlice'
import { useNearestThreat } from './useNearestThreat'
import type { SafetyEvent } from '../../../../shared/types'

const makeEvent = (id: string, lat: number, lng: number): SafetyEvent => ({
  event_id: id, event_type: 'SECURITY_INCIDENT', severity: 'HIGH',
  title: `Event ${id}`, summary: null, location: { lat, lng, place_name: null, county: null },
  confidence: 0.9, source_count: 1, source_breakdown: {}, is_active: true,
  started_at: '2026-01-01T00:00:00Z', last_updated: '2026-01-01T00:00:00Z',
  nostr_event_id: null, bitcoin_txid: null,
})

function makeStore(events: SafetyEvent[]) {
  return configureStore({
    reducer: { events: eventsReducer },
    preloadedState: { events: { items: events, connected: false } },
  })
}

function wrapper(store: ReturnType<typeof makeStore>) {
  return ({ children }: { children: React.ReactNode }) => (
    // @ts-expect-error — Provider type mismatch in test context
    <Provider store={store}>{children}</Provider>
  )
}

describe('useNearestThreat', () => {
  it('returns null when no events', () => {
    const { result } = renderHook(
      () => useNearestThreat({ lat: -1.286, lng: 36.817 }),
      { wrapper: wrapper(makeStore([])) }
    )
    expect(result.current).toBeNull()
  })

  it('returns the closest active event to given position', () => {
    const near  = makeEvent('near',  -1.290, 36.820) // ~0.5 km away
    const far   = makeEvent('far',   -1.400, 36.900) // ~15 km away
    const { result } = renderHook(
      () => useNearestThreat({ lat: -1.286, lng: 36.817 }),
      { wrapper: wrapper(makeStore([near, far])) }
    )
    expect(result.current?.event_id).toBe('near')
  })

  it('ignores inactive events', () => {
    const inactive = { ...makeEvent('inactive', -1.290, 36.820), is_active: false }
    const { result } = renderHook(
      () => useNearestThreat({ lat: -1.286, lng: 36.817 }),
      { wrapper: wrapper(makeStore([inactive])) }
    )
    expect(result.current).toBeNull()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/pwa && npm test -- --reporter verbose useNearestThreat.test
```

- [ ] **Step 3: Implement useNearestThreat**

```ts
// apps/pwa/src/hooks/useNearestThreat.ts
import { useMemo } from 'react'
import { useAppSelector } from '../store'
import type { SafetyEvent } from '../../../../shared/types'

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function useNearestThreat(userPos: { lat: number; lng: number } | null): SafetyEvent | null {
  const events = useAppSelector(s => s.events.items)

  return useMemo(() => {
    if (!userPos) return null
    const active = events.filter(e => e.is_active && e.location)
    if (!active.length) return null
    return active.reduce((closest, e) => {
      const dCurrent = haversineKm(userPos.lat, userPos.lng, closest.location!.lat, closest.location!.lng)
      const dCandidate = haversineKm(userPos.lat, userPos.lng, e.location!.lat, e.location!.lng)
      return dCandidate < dCurrent ? e : closest
    })
  }, [events, userPos?.lat, userPos?.lng])
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd apps/pwa && npm test -- --reporter verbose useNearestThreat.test
```

Expected: 3 tests pass.

- [ ] **Step 5: Implement LiveMapPage**

```tsx
// apps/pwa/src/pages/LiveMapPage.tsx
import { useState, useEffect } from 'react'
import { useAppSelector, useAppDispatch } from '../store'
import { useBreakpoint } from '../hooks/useBreakpoint'
import { useNearestThreat } from '../hooks/useNearestThreat'
import { setOverlayIntent } from '../store/uiSlice'
import { MapCanvas } from '../components/map/MapCanvas'
import { MapStatsBar } from '../components/map/MapStatsBar'
import { MapFeatureStrip } from '../components/map/MapFeatureStrip'
import { AlertsDock } from '../components/map/AlertsDock'
import { AlertsSheet } from '../components/map/AlertsSheet'
import { MapOverlayHost } from '../components/map/MapOverlayHost'
import { useNavigate } from 'react-router-dom'
import type { EventType } from '../../../../shared/types'

const ALL_TYPES: EventType[] = ['TRAFFIC_INCIDENT', 'FLOOD', 'CIVIL_UNREST', 'SECURITY_INCIDENT', 'FIRE', 'MEDICAL_EMERGENCY', 'INFRASTRUCTURE_FAILURE', 'FALSE_ALARM']

export function LiveMapPage() {
  const { layout } = useBreakpoint()
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const [activeFilters, setActiveFilters] = useState<EventType[]>([])
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null)

  const events = useAppSelector(s => s.events.items)
  const activeAlerts = events.filter(e => e.is_active).length
  const verified = events.filter(e => e.is_active && e.confidence >= 0.7).length
  const verifiedPct = activeAlerts > 0 ? Math.round((verified / activeAlerts) * 100) : 0
  const sources = useAppSelector(s =>
    new Set(s.events.items.flatMap(e => Object.keys(e.source_breakdown))).size
  )

  useNearestThreat(userPos)

  useEffect(() => {
    let id: number
    navigator.geolocation?.getCurrentPosition(pos => {
      setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude })
    })
    id = window.setInterval(() => {
      navigator.geolocation?.getCurrentPosition(pos => {
        setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      })
    }, 30_000)
    return () => clearInterval(id)
  }, [])

  function openOverlay(name: 'routes' | 'acoustic') {
    dispatch(setOverlayIntent({ name }))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <MapStatsBar
        activeAlerts={activeAlerts}
        verified={verified}
        verifiedPct={verifiedPct}
        communityScore={4.6}
        sources={sources}
      />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <MapCanvas activeFilters={activeFilters} />
          <MapOverlayHost />
          {layout === 'mobile' && <AlertsSheet />}
        </div>
        {layout === 'desktop' && <AlertsDock />}
      </div>

      {layout === 'desktop' && (
        <MapFeatureStrip
          onReport={() => navigate('/reports')}
          onAcoustic={() => openOverlay('acoustic')}
          onCircles={() => navigate('/circles')}
          onRoutes={() => openOverlay('routes')}
          onZaps={() => navigate('/zaps')}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/pwa/src/hooks/useNearestThreat.ts apps/pwa/src/hooks/useNearestThreat.test.ts apps/pwa/src/pages/LiveMapPage.tsx
git commit -m "feat: useNearestThreat hook, LiveMapPage orchestrator"
```

---

### Task 12: AlertsPage, ReportsPage, CirclesPage

**Files:**
- Create: `apps/pwa/src/pages/AlertsPage.tsx`
- Create: `apps/pwa/src/pages/AlertsPage.test.tsx`
- Create: `apps/pwa/src/pages/ReportsPage.tsx`
- Create: `apps/pwa/src/pages/CirclesPage.tsx`

- [ ] **Step 1: Write failing test for AlertsPage**

```tsx
// apps/pwa/src/pages/AlertsPage.test.tsx
import { render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import eventsReducer from '../store/eventsSlice'
import uiReducer from '../store/uiSlice'
import { AlertsPage } from './AlertsPage'
import type { SafetyEvent } from '../../../../shared/types'

const event: SafetyEvent = {
  event_id: 'e1', event_type: 'SECURITY_INCIDENT', severity: 'HIGH',
  title: 'Gunshots in Pangani', summary: null,
  location: { lat: -1.28, lng: 36.82, place_name: 'Pangani', county: null },
  confidence: 0.86, source_count: 3, source_breakdown: { NLP: 1, Community: 2 },
  is_active: true, started_at: '2026-01-01T00:00:00Z', last_updated: '2026-01-01T00:00:00Z',
  nostr_event_id: null, bitcoin_txid: null,
}

function makeStore(items: SafetyEvent[] = []) {
  return configureStore({
    reducer: { events: eventsReducer, ui: uiReducer },
    preloadedState: { events: { items, connected: false } },
  })
}

describe('AlertsPage', () => {
  it('renders page heading', () => {
    render(<Provider store={makeStore()}><AlertsPage /></Provider>)
    expect(screen.getByText('Live Alerts')).toBeInTheDocument()
  })

  it('renders alert cards for active events', () => {
    render(<Provider store={makeStore([event])}><AlertsPage /></Provider>)
    expect(screen.getByText('Gunshots in Pangani')).toBeInTheDocument()
  })

  it('renders empty state when no events', () => {
    render(<Provider store={makeStore([])}><AlertsPage /></Provider>)
    expect(screen.getByText(/no active alerts/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/pwa && npm test -- --reporter verbose AlertsPage.test
```

- [ ] **Step 3: Implement AlertsPage**

```tsx
// apps/pwa/src/pages/AlertsPage.tsx
import { useAppSelector } from '../store'
import { AlertCard, safetyEventToCardProps } from '../components/shared/AlertCard'

export function AlertsPage() {
  const events = useAppSelector(s => s.events.items.filter(e => e.is_active))

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0B0E14' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #1a2035', flexShrink: 0 }}>
        <h1 style={{ fontFamily: "'Courier New', monospace", fontSize: 16, color: '#e2e8f0', margin: 0, letterSpacing: '0.1em' }}>
          Live Alerts
        </h1>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {events.length === 0 ? (
          <p style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#4a5568', textAlign: 'center' as const, marginTop: 40 }}>
            No active alerts in your area.
          </p>
        ) : (
          events.map(e => <AlertCard key={e.event_id} {...toCardProps(e)} />)
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd apps/pwa && npm test -- --reporter verbose AlertsPage.test
```

Expected: 3 tests pass.

- [ ] **Step 5: Implement ReportsPage**

```tsx
// apps/pwa/src/pages/ReportsPage.tsx
import { useState } from 'react'
import { ReportList } from '../components/ReportList'
import { ReportSubmit } from '../components/ReportSubmit'
import { useBreakpoint } from '../hooks/useBreakpoint'

export function ReportsPage() {
  const { layout } = useBreakpoint()
  const [showSubmit, setShowSubmit] = useState(false)

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0B0E14' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #1a2035', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontFamily: "'Courier New', monospace", fontSize: 16, color: '#e2e8f0', margin: 0, letterSpacing: '0.1em' }}>
          Reports
        </h1>
        <button
          onClick={() => setShowSubmit(v => !v)}
          style={{ background: '#2E7D32', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontFamily: "'Courier New', monospace", fontSize: 11 }}
        >
          + Report
        </button>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: layout === 'mobile' ? 'column' : 'row', overflow: 'hidden' }}>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <ReportList />
        </div>
        {showSubmit && (
          <div style={{ width: layout === 'mobile' ? '100%' : 360, borderLeft: layout === 'mobile' ? 'none' : '1px solid #1a2035', overflowY: 'auto' }}>
            <ReportSubmit onClose={() => setShowSubmit(false)} />
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Implement CirclesPage**

```tsx
// apps/pwa/src/pages/CirclesPage.tsx
import { FamilyCircleDashboard } from '../components/FamilyCircleDashboard'

export function CirclesPage() {
  return (
    <div style={{ height: '100%', overflow: 'hidden', background: '#0B0E14' }}>
      <FamilyCircleDashboard />
    </div>
  )
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/pwa/src/pages/AlertsPage.tsx apps/pwa/src/pages/AlertsPage.test.tsx apps/pwa/src/pages/ReportsPage.tsx apps/pwa/src/pages/CirclesPage.tsx
git commit -m "feat: AlertsPage, ReportsPage, CirclesPage"
```

---

### Task 13: zapsSlice + ZapsPage

**Files:**
- Create: `apps/pwa/src/store/zapsSlice.ts`
- Create: `apps/pwa/src/store/zapsSlice.test.ts`
- Create: `apps/pwa/src/pages/ZapsPage.tsx`
- Create: `apps/pwa/src/pages/ZapsPage.test.tsx`

- [ ] **Step 1: Write failing test for zapsSlice**

```ts
// apps/pwa/src/store/zapsSlice.test.ts
import zapsReducer, { zapSent, fetchZapHistory } from './zapsSlice'

describe('zapsSlice', () => {
  it('has empty state initially', () => {
    const state = zapsReducer(undefined, { type: '' })
    expect(state.history).toEqual([])
    expect(state.loading).toBe(false)
  })

  it('adds a sent zap to history', () => {
    const zap = { id: 'z1', amount: 100, recipientPubkey: 'abc', reportId: 'r1', timestamp: 1000 }
    const state = zapsReducer(undefined, zapSent(zap))
    expect(state.history).toHaveLength(1)
    expect(state.history[0]!.id).toBe('z1')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/pwa && npm test -- --reporter verbose zapsSlice.test
```

- [ ] **Step 3: Implement zapsSlice**

```ts
// apps/pwa/src/store/zapsSlice.ts
import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'

export interface ZapRecord {
  id: string
  amount: number
  recipientPubkey: string
  reportId: string
  timestamp: number
}

interface ZapsState {
  history: ZapRecord[]
  loading: boolean
  error: string | null
}

const initialState: ZapsState = {
  history: [],
  loading: false,
  error: null,
}

export const fetchZapHistory = createAsyncThunk<ZapRecord[], string>(
  'zaps/fetchHistory',
  async (pubkey) => {
    const res = await fetch(`/api/zaps/history?pubkey=${encodeURIComponent(pubkey)}&limit=50`)
    if (!res.ok) throw new Error('Failed to fetch zap history')
    return res.json() as Promise<ZapRecord[]>
  }
)

const zapsSlice = createSlice({
  name: 'zaps',
  initialState,
  reducers: {
    zapSent(state, action: PayloadAction<ZapRecord>) {
      state.history.unshift(action.payload)
    },
  },
  extraReducers: builder => {
    builder
      .addCase(fetchZapHistory.pending,   state => { state.loading = true; state.error = null })
      .addCase(fetchZapHistory.fulfilled, (state, { payload }) => { state.loading = false; state.history = payload })
      .addCase(fetchZapHistory.rejected,  (state, { error }) => { state.loading = false; state.error = error.message ?? 'Unknown error' })
  },
})

export const { zapSent } = zapsSlice.actions
export default zapsSlice.reducer
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd apps/pwa && npm test -- --reporter verbose zapsSlice.test
```

- [ ] **Step 5: Write failing test for ZapsPage**

```tsx
// apps/pwa/src/pages/ZapsPage.test.tsx
import { render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import zapsReducer from '../store/zapsSlice'
import reportsReducer from '../store/reportSlice'
import { ZapsPage } from './ZapsPage'

function makeStore() {
  return configureStore({ reducer: { zaps: zapsReducer, reports: reportsReducer } })
}

describe('ZapsPage', () => {
  it('renders Send Zap section heading', () => {
    render(<Provider store={makeStore()}><ZapsPage /></Provider>)
    expect(screen.getByText('Send Zap')).toBeInTheDocument()
  })

  it('renders Zap History section heading', () => {
    render(<Provider store={makeStore()}><ZapsPage /></Provider>)
    expect(screen.getByText('Zap History')).toBeInTheDocument()
  })
})
```

- [ ] **Step 6: Run test — expect FAIL**

```bash
cd apps/pwa && npm test -- --reporter verbose ZapsPage.test
```

- [ ] **Step 7: Implement ZapsPage**

```tsx
// apps/pwa/src/pages/ZapsPage.tsx
import { useAppSelector } from '../store'
import { ZapButton } from '../components/ZapButton'
import type { CommunityReport } from '../../../../shared/types'
import type { ZapRecord } from '../store/zapsSlice'

export function ZapsPage() {
  const reports: CommunityReport[] = useAppSelector(s => s.reports.items ?? [])
  const history: ZapRecord[] = useAppSelector(s => s.zaps?.history ?? [])

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#0B0E14' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #1a2035' }}>
        <h1 style={{ fontFamily: "'Courier New', monospace", fontSize: 16, color: '#e2e8f0', margin: 0, letterSpacing: '0.1em' }}>
          Zaps
        </h1>
      </div>

      <section style={{ padding: '16px 20px', borderBottom: '1px solid #1a2035' }}>
        <h2 style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#00E5FF', letterSpacing: '0.1em', marginBottom: 12 }}>
          Send Zap
        </h2>
        {reports.length === 0 ? (
          <p style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#4a5568' }}>No reports to tip yet.</p>
        ) : (
          reports.slice(0, 20).map((r: CommunityReport) => (
            <div key={r.report_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #1a2035' }}>
              <span style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#e2e8f0' }}>{r.description ?? r.report_type}</span>
              <ZapButton reportId={r.report_id} recipientPubkey={r.nostr_pubkey} />
            </div>
          ))
        )}
      </section>

      <section style={{ padding: '16px 20px' }}>
        <h2 style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#00E5FF', letterSpacing: '0.1em', marginBottom: 12 }}>
          Zap History
        </h2>
        {history.length === 0 ? (
          <p style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#4a5568' }}>No zaps sent yet.</p>
        ) : (
          history.map((z: ZapRecord) => (
            <div key={z.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #1a2035' }}>
              <span style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#e2e8f0' }}>{z.amount} sats</span>
              <span style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4a5568' }}>
                {new Date(z.timestamp).toLocaleDateString()}
              </span>
            </div>
          ))
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 8: Run test — expect PASS**

```bash
cd apps/pwa && npm test -- --reporter verbose ZapsPage.test
```

- [ ] **Step 9: Commit**

```bash
git add apps/pwa/src/store/zapsSlice.ts apps/pwa/src/store/zapsSlice.test.ts apps/pwa/src/pages/ZapsPage.tsx apps/pwa/src/pages/ZapsPage.test.tsx
git commit -m "feat: zapsSlice, ZapsPage with send/history sections"
```

---

### Task 14: Insights slices + InsightsPage

**Files:**
- Create: `apps/pwa/src/store/insightsEventsSlice.ts`
- Create: `apps/pwa/src/store/communityStatsSlice.ts`
- Create: `apps/pwa/src/store/safetyLogSlice.ts`
- Create: `apps/pwa/src/pages/InsightsPage.tsx`
- Create: `apps/pwa/src/pages/InsightsPage.test.tsx`

- [ ] **Step 1: Implement insightsEventsSlice**

```ts
// apps/pwa/src/store/insightsEventsSlice.ts
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

export interface BucketedEvent {
  bucket: string
  lat: number
  lng: number
  count: number
  eventType: string
}

interface InsightsEventsState {
  buckets: BucketedEvent[]
  loading: boolean
  error: string | null
}

export const fetchInsightsEvents = createAsyncThunk<BucketedEvent[], { from: string; to: string; bucket: string }>(
  'insightsEvents/fetch',
  async ({ from, to, bucket }) => {
    const params = new URLSearchParams({ from, to, bucket, page: '1', limit: '500' })
    const res = await fetch(`/api/events/history?${params}`)
    if (!res.ok) throw new Error('Failed to fetch event history')
    return res.json() as Promise<BucketedEvent[]>
  }
)

const insightsEventsSlice = createSlice({
  name: 'insightsEvents',
  initialState: { buckets: [], loading: false, error: null } as InsightsEventsState,
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(fetchInsightsEvents.pending,   state => { state.loading = true; state.error = null })
      .addCase(fetchInsightsEvents.fulfilled, (state, { payload }) => { state.loading = false; state.buckets = payload })
      .addCase(fetchInsightsEvents.rejected,  (state, { error }) => { state.loading = false; state.error = error.message ?? 'Error' })
  },
})

export default insightsEventsSlice.reducer
```

- [ ] **Step 2: Implement communityStatsSlice**

```ts
// apps/pwa/src/store/communityStatsSlice.ts
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

export interface ReporterStat {
  pubkey: string
  reportCount: number
  trustScore: number
  tier: string
}

interface CommunityStatsState {
  reporters: ReporterStat[]
  totalVerified: number
  loading: boolean
  error: string | null
}

export const fetchCommunityStats = createAsyncThunk<{ reporters: ReporterStat[]; totalVerified: number }>(
  'communityStats/fetch',
  async () => {
    const res = await fetch('/api/insights/community?limit=20')
    if (!res.ok) throw new Error('Failed to fetch community stats')
    return res.json() as Promise<{ reporters: ReporterStat[]; totalVerified: number }>
  }
)

const communityStatsSlice = createSlice({
  name: 'communityStats',
  initialState: { reporters: [], totalVerified: 0, loading: false, error: null } as CommunityStatsState,
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(fetchCommunityStats.pending,   state => { state.loading = true; state.error = null })
      .addCase(fetchCommunityStats.fulfilled, (state, { payload }) => { state.loading = false; state.reporters = payload.reporters; state.totalVerified = payload.totalVerified })
      .addCase(fetchCommunityStats.rejected,  (state, { error }) => { state.loading = false; state.error = error.message ?? 'Error' })
  },
})

export default communityStatsSlice.reducer
```

- [ ] **Step 3: Implement safetyLogSlice**

```ts
// apps/pwa/src/store/safetyLogSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface SafetyLogEntry {
  type: 'proximity' | 'acoustic' | 'route'
  label: string
  timestamp: number
}

interface SafetyLogState {
  entries: SafetyLogEntry[]
}

const safetyLogSlice = createSlice({
  name: 'safetyLog',
  initialState: { entries: [] } as SafetyLogState,
  reducers: {
    logSafetyEvent(state, action: PayloadAction<SafetyLogEntry>) {
      state.entries.unshift(action.payload)
      if (state.entries.length > 100) state.entries.pop()
    },
  },
})

export const { logSafetyEvent } = safetyLogSlice.actions
export default safetyLogSlice.reducer
```

- [ ] **Step 4: Write failing test for InsightsPage**

```tsx
// apps/pwa/src/pages/InsightsPage.test.tsx
import { render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import insightsEventsReducer from '../store/insightsEventsSlice'
import communityStatsReducer from '../store/communityStatsSlice'
import safetyLogReducer from '../store/safetyLogSlice'
import { InsightsPage } from './InsightsPage'

function makeStore() {
  return configureStore({
    reducer: {
      insightsEvents: insightsEventsReducer,
      communityStats: communityStatsReducer,
      safetyLog: safetyLogReducer,
    },
  })
}

describe('InsightsPage', () => {
  it('renders Overview tab by default', () => {
    render(<Provider store={makeStore()}><InsightsPage /></Provider>)
    expect(screen.getByText('Overview')).toBeInTheDocument()
  })

  it('renders Heatmap tab', () => {
    render(<Provider store={makeStore()}><InsightsPage /></Provider>)
    expect(screen.getByText('Heatmap')).toBeInTheDocument()
  })

  it('renders Personal Safety tab', () => {
    render(<Provider store={makeStore()}><InsightsPage /></Provider>)
    expect(screen.getByText('Personal Safety')).toBeInTheDocument()
  })
})
```

- [ ] **Step 5: Run test — expect FAIL**

```bash
cd apps/pwa && npm test -- --reporter verbose InsightsPage.test
```

- [ ] **Step 6: Implement InsightsPage**

```tsx
// apps/pwa/src/pages/InsightsPage.tsx
import { useState, useEffect } from 'react'
import { useAppSelector, useAppDispatch } from '../store'
import { fetchInsightsEvents } from '../store/insightsEventsSlice'
import { fetchCommunityStats } from '../store/communityStatsSlice'

type Tab = 'Overview' | 'Heatmap' | 'Personal Safety'
const TABS: Tab[] = ['Overview', 'Heatmap', 'Personal Safety']

export function InsightsPage() {
  const [tab, setTab] = useState<Tab>('Overview')
  const dispatch = useAppDispatch()
  const reporters = useAppSelector(s => s.communityStats?.reporters ?? [])
  const totalVerified = useAppSelector(s => s.communityStats?.totalVerified ?? 0)
  const safetyLog = useAppSelector(s => s.safetyLog?.entries ?? [])
  const statsLoading = useAppSelector(s => s.communityStats?.loading ?? false)

  useEffect(() => {
    const now = new Date()
    const from = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString()
    dispatch(fetchInsightsEvents({ from, to: now.toISOString(), bucket: '1h' }))
    dispatch(fetchCommunityStats())
  }, [dispatch])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0B0E14' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #1a2035', flexShrink: 0 }}>
        <h1 style={{ fontFamily: "'Courier New', monospace", fontSize: 16, color: '#e2e8f0', margin: 0, letterSpacing: '0.1em' }}>
          Insights
        </h1>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid #1a2035', flexShrink: 0, overflowX: 'auto' }}>
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '10px 20px', background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: tab === t ? '2px solid #00E5FF' : '2px solid transparent',
              color: tab === t ? '#00E5FF' : '#4a5568',
              fontFamily: "'Courier New', monospace", fontSize: 11, letterSpacing: '0.08em',
              whiteSpace: 'nowrap',
            }}
          >{t}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {tab === 'Overview' && (
          <div>
            <div style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#e2e8f0', marginBottom: 16 }}>
              Total verified reports: <strong>{totalVerified}</strong>
            </div>
            {statsLoading ? (
              <p style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#4a5568' }}>Loading...</p>
            ) : reporters.length === 0 ? (
              <p style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#4a5568' }}>No community data yet.</p>
            ) : (
              reporters.map(r => (
                <div key={r.pubkey} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #1a2035' }}>
                  <span style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#e2e8f0' }}>
                    {r.pubkey.slice(0, 12)}…
                  </span>
                  <span style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#BB86FC' }}>
                    {r.reportCount} reports · {r.tier}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'Heatmap' && (
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#4a5568', textAlign: 'center' as const, marginTop: 40 }}>
            Heatmap requires the /api/events/history backend endpoint.<br />
            Integrate Mapbox heatmap layer once endpoint is live.
          </div>
        )}

        {tab === 'Personal Safety' && (
          <div>
            {safetyLog.length === 0 ? (
              <p style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#4a5568' }}>No personal safety events logged yet.</p>
            ) : (
              safetyLog.map((entry, i) => (
                <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid #1a2035' }}>
                  <span style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#e2e8f0' }}>{entry.label}</span>
                  <span style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4a5568', marginLeft: 12 }}>
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Run test — expect PASS**

```bash
cd apps/pwa && npm test -- --reporter verbose InsightsPage.test
```

- [ ] **Step 8: Commit**

```bash
git add apps/pwa/src/store/insightsEventsSlice.ts apps/pwa/src/store/communityStatsSlice.ts apps/pwa/src/store/safetyLogSlice.ts apps/pwa/src/pages/InsightsPage.tsx apps/pwa/src/pages/InsightsPage.test.tsx
git commit -m "feat: insights slices (events, community, safety log), InsightsPage with 3 tabs"
```

---

### Task 15: SettingsPage

**Files:**
- Create: `apps/pwa/src/pages/SettingsPage.tsx`

- [ ] **Step 1: Implement SettingsPage**

```tsx
// apps/pwa/src/pages/SettingsPage.tsx
export function SettingsPage() {
  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#0B0E14' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #1a2035' }}>
        <h1 style={{ fontFamily: "'Courier New', monospace", fontSize: 16, color: '#e2e8f0', margin: 0, letterSpacing: '0.1em' }}>
          Settings
        </h1>
      </div>

      <section style={{ padding: '20px', borderBottom: '1px solid #1a2035' }}>
        <h2 style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#00E5FF', letterSpacing: '0.1em', marginBottom: 12 }}>
          Identity
        </h2>
        <p style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#4a5568' }}>
          Nostr key management — connect your existing Nostr key or generate a new one.
        </p>
      </section>

      <section style={{ padding: '20px', borderBottom: '1px solid #1a2035' }}>
        <h2 style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#00E5FF', letterSpacing: '0.1em', marginBottom: 8 }}>
          Privacy First
        </h2>
        {['No personal data collected.', 'No readable location logs.', 'All reports signed with your Nostr key.', 'Audio never leaves your device.'].map(item => (
          <p key={item} style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#4a5568', margin: '4px 0' }}>✓ {item}</p>
        ))}
      </section>

      <section style={{ padding: '20px' }}>
        <h2 style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#00E5FF', letterSpacing: '0.1em', marginBottom: 8 }}>
          Built on Open Protocols
        </h2>
        <div style={{ display: 'flex', gap: 12 }}>
          {['Nostr', 'Bitcoin'].map(proto => (
            <span key={proto} style={{
              fontFamily: "'Courier New', monospace", fontSize: 10, padding: '4px 10px',
              border: '1px solid #1a2035', borderRadius: 6, color: '#BB86FC',
            }}>{proto}</span>
          ))}
        </div>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/pwa/src/pages/SettingsPage.tsx
git commit -m "feat: SettingsPage with identity, privacy, and protocol sections"
```

---

### Task 16: Wire App.tsx + finalize store

**Files:**
- Modify: `apps/pwa/src/App.tsx`
- Modify: `apps/pwa/src/store/index.ts`
- Create: `apps/pwa/src/hooks/useAcousticEngine.ts`

This is the final wiring task. It replaces the old App.tsx toggle with React Router and registers all new slices.

- [ ] **Step 1: Extract acoustic detection to a hook**

```ts
// apps/pwa/src/hooks/useAcousticEngine.ts
import { useEffect } from 'react'
import { useAppDispatch } from '../store'
import { detectionReceived, detectionStarted, detectionStopped } from '../store/acousticSlice'
import { AudioCapture } from '../services/audioCapture'
import { AcousticDetectionService } from '../services/acousticDetectionService'
import { autoSubmitAcousticReport } from '../services/reportAutoSubmit'

export function useAcousticEngine() {
  const dispatch = useAppDispatch()

  useEffect(() => {
    let capture: AudioCapture | null = null
    let detector: AcousticDetectionService | null = null

    async function start() {
      detector = new AcousticDetectionService((detection) => {
        dispatch(detectionReceived(detection))
        navigator.geolocation?.getCurrentPosition(pos => {
          autoSubmitAcousticReport(detection, { lat: pos.coords.latitude, lng: pos.coords.longitude })
        })
      })
      try {
        await detector.init()
        capture = new AudioCapture(samples => detector?.processWindow(samples))
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

- [ ] **Step 2: Register all new slices in store**

```ts
// apps/pwa/src/store/index.ts
import { configureStore } from '@reduxjs/toolkit'
import eventsReducer from './eventsSlice'
import acousticReducer from './acousticSlice'
import reportsReducer from './reportSlice'
import circlesReducer from './circlesSlice'
import uiReducer from './uiSlice'
import zapsReducer from './zapsSlice'
import insightsEventsReducer from './insightsEventsSlice'
import communityStatsReducer from './communityStatsSlice'
import safetyLogReducer from './safetyLogSlice'
import { useSelector, TypedUseSelectorHook, useDispatch } from 'react-redux'

export const store = configureStore({
  reducer: {
    events:          eventsReducer,
    acoustic:        acousticReducer,
    reports:         reportsReducer,
    circles:         circlesReducer,
    ui:              uiReducer,
    zaps:            zapsReducer,
    insightsEvents:  insightsEventsReducer,
    communityStats:  communityStatsReducer,
    safetyLog:       safetyLogReducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector
export const useAppDispatch = () => useDispatch<AppDispatch>()
```

- [ ] **Step 3: Rewrite App.tsx**

```tsx
// apps/pwa/src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppShell } from './components/shell/AppShell'
import { LiveMapPage } from './pages/LiveMapPage'
import { AlertsPage } from './pages/AlertsPage'
import { ReportsPage } from './pages/ReportsPage'
import { CirclesPage } from './pages/CirclesPage'
import { ZapsPage } from './pages/ZapsPage'
import { InsightsPage } from './pages/InsightsPage'
import { SettingsPage } from './pages/SettingsPage'
import { useWsConnection } from './services/websocket'
import { useAcousticEngine } from './hooks/useAcousticEngine'

function AppRoot() {
  useWsConnection()
  useAcousticEngine()

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/map" replace />} />
          <Route path="/map"      element={<LiveMapPage />} />
          <Route path="/alerts"   element={<AlertsPage />} />
          <Route path="/reports"  element={<ReportsPage />} />
          <Route path="/circles"  element={<CirclesPage />} />
          <Route path="/zaps"     element={<ZapsPage />} />
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default AppRoot
```

- [ ] **Step 4: Run full test suite**

```bash
cd apps/pwa && npm test
```

Expected: All tests pass. Fix any TypeScript type errors before committing.

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/App.tsx apps/pwa/src/store/index.ts apps/pwa/src/hooks/useAcousticEngine.ts
git commit -m "feat: wire React Router, AppShell routes, register all slices — UI redesign complete"
```

---

## Backend Endpoints Required

The following backend endpoints are needed by `InsightsPage` and `ZapsPage` but are **out of scope for this plan**. The UI renders gracefully without them (loading states, empty states). Implement these in a separate backend plan:

| Endpoint | Consumer | Notes |
|---|---|---|
| `GET /api/events/history?from&to&bucket&page&limit` | `insightsEventsSlice` | Time-bucketed events for heatmap. Cache server-side. |
| `GET /api/insights/community?limit` | `communityStatsSlice` | Reporter leaderboard + trust scores. |
| `GET /api/zaps/history?pubkey&page&limit` | `zapsSlice` | Lightning transaction ledger. |
