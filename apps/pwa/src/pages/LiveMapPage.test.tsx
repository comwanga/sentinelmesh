import { fireEvent, render, screen } from '@testing-library/react'
import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import eventsReducer, { viewportEventsSet } from '../store/eventsSlice'
import uiReducer from '../store/uiSlice'
import type { SafetyEvent } from '../../../../shared/types'
import { LiveMapPage } from './LiveMapPage'

const { breakpoint, currentLocation } = vi.hoisted(() => ({ breakpoint: { layout: 'desktop' as 'desktop' | 'mobile' }, currentLocation: { error: null as Error | null } }))
vi.mock('../hooks/useBreakpoint', () => ({ useBreakpoint: () => breakpoint }))
vi.mock('../hooks/useViewportWs', () => ({ useViewportWs: vi.fn() }))
vi.mock('../hooks/useCurrentLocation', () => ({ useCurrentLocation: () => ({ location: null, error: currentLocation.error }) }))
vi.mock('../components/map/MapCanvas', () => ({ MapCanvas: ({ children }: { children: React.ReactNode }) => <div data-testid="map-canvas">{children}</div> }))
vi.mock('../components/map/EventClusterLayer', () => ({ EventClusterLayer: ({ events }: { events: SafetyEvent[] }) => <div data-testid="event-layer">{events.map(e => e.title).join(',')}</div> }))
vi.mock('../components/map/RadiusZoneLayer', () => ({ RadiusZoneLayer: () => <div data-testid="radius-layer" /> }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useSearchParams: () => [new URLSearchParams()] }))

const event: SafetyEvent = { id: 'e1', event_type: 'SECURITY_INCIDENT', severity: 'HIGH', title: 'Market alert', summary: null, lat: -1.28, lng: 36.82, place_name: 'Market', county: null, is_active: true, state: 'ACTIVE', started_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', nostr_event_id: null, trust_state: 'confirmed' }
function renderPage() { const store = configureStore({ reducer: { events: eventsReducer, ui: uiReducer } }); store.dispatch(viewportEventsSet([event])); return render(<Provider store={store}><LiveMapPage /></Provider>) }

beforeEach(() => { breakpoint.layout = 'desktop'; currentLocation.error = null })
describe('LiveMapPage field atlas', () => {
  it('renders viewport instruments and desktop field ledger', () => { renderPage(); expect(screen.getByLabelText('Viewport status')).toBeInTheDocument(); expect(screen.getByText('Incidents in view')).toBeInTheDocument() })
  it('renders a collapsed field ledger on mobile', () => { breakpoint.layout = 'mobile'; renderPage(); expect(screen.getByRole('button', { name: /1 in view/i })).toHaveAttribute('aria-expanded', 'false') })
  it('filters both map events and the ledger', () => { renderPage(); fireEvent.click(screen.getByRole('button', { name: 'Traffic' })); expect(screen.getByTestId('event-layer')).toHaveTextContent(''); expect(screen.getByText('Quiet viewport')).toBeInTheDocument() })
  it('toggles approximate impact zones', () => { renderPage(); fireEvent.click(screen.getByTitle('Toggle impact zones')); expect(screen.queryByTestId('radius-layer')).not.toBeInTheDocument() })
  it('explains that location is optional', () => { currentLocation.error = new Error('denied'); renderPage(); expect(screen.getByText(/Location is optional/)).toBeInTheDocument() })
})
