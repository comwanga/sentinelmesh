import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import type { ReactNode } from 'react'
import eventsReducer from '../store/eventsSlice'
import uiReducer from '../store/uiSlice'
import { LiveMapPage } from './LiveMapPage'
import type { SafetyEvent } from '../../../../shared/types'

vi.mock('../components/map/MapCanvas', () => ({
  MapCanvas: () => <div data-testid="map-canvas" />,
}))

vi.mock('react-map-gl/maplibre', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="mapbox">{children}</div>,
  Marker: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Map: ({ children }: { children: ReactNode }) => <div data-testid="mapbox">{children}</div>,
}))

vi.mock('../hooks/useViewportWs', () => ({
  useViewportWs: vi.fn(),
}))

const mockUseNearestThreat = vi.fn(() => ({ nearest: null as SafetyEvent | null, distanceKm: null as number | null, geoError: null as GeolocationPositionError | null }))
vi.mock('../hooks/useNearestThreat', () => ({
  useNearestThreat: () => mockUseNearestThreat(),
}))

const mockUseBreakpoint = vi.fn(() => ({ layout: 'desktop' as 'desktop' | 'mobile' }))
vi.mock('../hooks/useBreakpoint', () => ({
  useBreakpoint: () => mockUseBreakpoint(),
}))

vi.mock('../components/map/MapOverlayHost', () => ({
  MapOverlayHost: () => <div data-testid="map-overlay-host" />,
}))

vi.mock('../hooks/useCurrentLocation', () => ({
  useCurrentLocation: () => ({ location: null, error: null }),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

function makeStore() {
  return configureStore({
    reducer: { events: eventsReducer, ui: uiReducer },
  })
}

function renderPage(store = makeStore()) {
  return render(
    <Provider store={store}>
      <LiveMapPage />
    </Provider>
  )
}

beforeEach(() => {
  mockUseNearestThreat.mockReturnValue({ nearest: null, distanceKm: null, geoError: null })
  mockUseBreakpoint.mockReturnValue({ layout: 'desktop' })
})

describe('LiveMapPage', () => {
  it('renders MapStatsBar', () => {
    renderPage()
    expect(screen.getByText('Loaded active alerts')).toBeInTheDocument()
  })

  it('desktop: renders AlertsDock, not AlertsSheet', () => {
    mockUseBreakpoint.mockReturnValue({ layout: 'desktop' })
    renderPage()
    expect(screen.getByText('LIVE ALERTS')).toBeInTheDocument()
  })

  it('mobile: renders AlertsSheet, not AlertsDock', () => {
    mockUseBreakpoint.mockReturnValue({ layout: 'mobile' })
    renderPage()
    expect(screen.getByText(/0 ALERTS/)).toBeInTheDocument()
    expect(screen.queryByText('LIVE ALERTS')).not.toBeInTheDocument()
  })

  it('desktop: renders MapFeatureStrip', () => {
    mockUseBreakpoint.mockReturnValue({ layout: 'desktop' })
    renderPage()
    expect(screen.getByText('Report Incident')).toBeInTheDocument()
  })

  it('mobile: does not render MapFeatureStrip', () => {
    mockUseBreakpoint.mockReturnValue({ layout: 'mobile' })
    renderPage()
    expect(screen.queryByText('Report Incident')).not.toBeInTheDocument()
  })

  it('shows NEAR YOU banner when nearestThreat is non-null and distanceKm is set', () => {
    const threat: SafetyEvent = {
      id: 'threat-1',
      event_type: 'SECURITY_INCIDENT',
      severity: 'HIGH',
      title: 'Armed robbery near CBD',
      summary: null,
      lat: -1.286,
      lng: 36.817,
      place_name: null,
      county: null,
      is_active: true,
      state: 'ACTIVE',
      started_at: '',
      created_at: '',
      nostr_event_id: null,
      bitcoin_txid: null,
    }
    mockUseNearestThreat.mockReturnValue({ nearest: threat, distanceKm: 1.4, geoError: null })
    renderPage()
    expect(screen.getByText(/NEAR YOU/)).toBeInTheDocument()
  })

  it('does not show NEAR YOU banner when nearestThreat is null', () => {
    mockUseNearestThreat.mockReturnValue({ nearest: null, distanceKm: null, geoError: null })
    renderPage()
    expect(screen.queryByText(/NEAR YOU/)).not.toBeInTheDocument()
  })

  it('shows GPS notice when geoError is set', () => {
    mockUseNearestThreat.mockReturnValue({
      nearest: null,
      distanceKm: null,
      geoError: { code: 1, message: 'Permission denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError,
    })
    renderPage()
    expect(screen.getByText(/Enable GPS/)).toBeInTheDocument()
  })
})
