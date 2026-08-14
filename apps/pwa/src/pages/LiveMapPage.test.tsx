import { fireEvent, render, screen } from '@testing-library/react'
import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import eventsReducer, { viewportEventsSet } from '../store/eventsSlice'
import uiReducer from '../store/uiSlice'
import type { SafetyEvent } from '../../../../shared/types'
import { LiveMapPage } from './LiveMapPage'

const { breakpoint, currentLocation, router } = vi.hoisted(() => ({ breakpoint: { layout: 'desktop' as 'desktop' | 'mobile' }, currentLocation: { error: null as Error | null }, router: { params: new URLSearchParams(), setParams: vi.fn() } }))
vi.mock('../hooks/useBreakpoint', () => ({ useBreakpoint: () => breakpoint }))
vi.mock('../hooks/useViewportWs', () => ({ useViewportWs: vi.fn() }))
vi.mock('../hooks/useCurrentLocation', () => ({ useCurrentLocation: () => ({ location: null, error: currentLocation.error }) }))
vi.mock('../components/map/MapCanvas', () => ({ MapCanvas: ({ children, cameraCommand }: { children: React.ReactNode; cameraCommand?: unknown }) => <div data-testid="map-canvas" data-camera={cameraCommand ? JSON.stringify(cameraCommand) : ''}>{children}</div> }))
vi.mock('../components/map/MapSearch', () => ({ MapSearch: ({ initialQuery }: { initialQuery: string }) => <div data-testid="map-search">{initialQuery}</div> }))
vi.mock('../components/map/EventClusterLayer', () => ({ EventClusterLayer: ({ events, onEventClick, onClusterClick }: { events: SafetyEvent[]; onEventClick: (event: SafetyEvent) => void; onClusterClick: (events: SafetyEvent[]) => void }) => <div data-testid="event-layer">{events.map(e => e.title).join(',')}<button onClick={() => onEventClick(events[0])}>select marker</button><button onClick={() => onClusterClick(events)}>expand cluster</button></div> }))
vi.mock('../components/map/RadiusZoneLayer', () => ({ RadiusZoneLayer: () => <div data-testid="radius-layer" /> }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useSearchParams: () => [router.params, router.setParams] }))

const event: SafetyEvent = { id: 'e1', event_type: 'SECURITY_INCIDENT', severity: 'HIGH', title: 'Market alert', summary: null, lat: -1.28, lng: 36.82, place_name: 'Market', county: null, is_active: true, state: 'ACTIVE', started_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', nostr_event_id: null, trust_state: 'confirmed' }
function renderPage() { const store = configureStore({ reducer: { events: eventsReducer, ui: uiReducer } }); store.dispatch(viewportEventsSet([event])); return render(<Provider store={store}><LiveMapPage /></Provider>) }

beforeEach(() => { breakpoint.layout = 'desktop'; currentLocation.error = null; router.params = new URLSearchParams(); router.setParams.mockClear() })
describe('LiveMapPage field atlas', () => {
  it('renders viewport instruments and desktop field ledger', () => { renderPage(); expect(screen.getByLabelText('Viewport status')).toBeInTheDocument(); expect(screen.getByText('Incidents in view')).toBeInTheDocument() })
  it('renders a collapsed field ledger on mobile', () => { breakpoint.layout = 'mobile'; renderPage(); expect(screen.getByRole('button', { name: /1 in view/i })).toHaveAttribute('aria-expanded', 'false') })
  it('filters both map events and the ledger', () => { renderPage(); fireEvent.click(screen.getByRole('button', { name: 'Traffic' })); expect(screen.getByTestId('event-layer')).not.toHaveTextContent('Market alert'); expect(screen.getByText('Quiet viewport')).toBeInTheDocument() })
  it('toggles approximate impact zones', () => { renderPage(); fireEvent.click(screen.getByTitle('Toggle impact zones')); expect(screen.queryByTestId('radius-layer')).not.toBeInTheDocument() })
  it('explains that location is optional', () => { currentLocation.error = new Error('denied'); renderPage(); expect(screen.getByText(/Location is optional/)).toBeInTheDocument() })
  it('focuses marker and ledger selections by current event ID', () => { renderPage(); fireEvent.click(screen.getByRole('button', { name: 'select marker' })); expect(JSON.parse(screen.getByTestId('map-canvas').dataset.camera!)).toMatchObject({ center: [36.82, -1.28], zoom: 15 }); expect(screen.getByRole('heading', { name: 'Market alert' })).toBeInTheDocument() })
  it('fits all cluster members without selecting an event', () => { renderPage(); fireEvent.click(screen.getByRole('button', { name: 'expand cluster' })); expect(JSON.parse(screen.getByTestId('map-canvas').dataset.camera!)).toMatchObject({ bounds: [36.819, -1.281, 36.821, -1.2790000000000001] }); expect(screen.getByText('Incidents in view')).toBeInTheDocument() })
  it('consumes q once and automatically seeds map search', () => { router.params = new URLSearchParams('q=Central+Park'); renderPage(); expect(screen.getByTestId('map-search')).toHaveTextContent('Central Park'); expect(router.setParams).toHaveBeenCalledWith(new URLSearchParams(), { replace: true }) })
  it('preserves and announces an unavailable event deep link', () => { router.params = new URLSearchParams('event=missing'); renderPage(); expect(screen.getByRole('status')).toHaveTextContent('not currently available'); expect(router.setParams).not.toHaveBeenCalled() })
  it('resolves and focuses a loaded event deep link', () => { router.params = new URLSearchParams('event=e1'); renderPage(); expect(JSON.parse(screen.getByTestId('map-canvas').dataset.camera!)).toMatchObject({ center: [36.82, -1.28] }); expect(screen.getByRole('heading', { name: 'Market alert' })).toBeInTheDocument() })
})
