import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import type { ReactNode } from 'react'
import eventsReducer from '../store/eventsSlice'
import uiReducer from '../store/uiSlice'
import { LiveMapPage } from './LiveMapPage'
import type { SafetyEvent } from '../../../../shared/types'

// Mock MapCanvas to avoid mapboxgl errors in jsdom
vi.mock('../components/map/MapCanvas', () => ({
  MapCanvas: () => <div data-testid="map-canvas" />,
}))

// Mock react-map-gl used by sub-components
vi.mock('react-map-gl', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="mapbox">{children}</div>,
  Marker: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

// Mock useNearestThreat so we can control the return value per test
const mockUseNearestThreat = vi.fn(() => ({ nearest: null as SafetyEvent | null, geoError: null }))
vi.mock('../hooks/useNearestThreat', () => ({
  useNearestThreat: () => mockUseNearestThreat(),
}))

// Mock useBreakpoint so we can control layout per test
const mockUseBreakpoint = vi.fn(() => ({ layout: 'desktop' as 'desktop' | 'mobile' }))
vi.mock('../hooks/useBreakpoint', () => ({
  useBreakpoint: () => mockUseBreakpoint(),
}))

// Mock MapOverlayHost — uses its own internal hooks, simplify to a stub
vi.mock('../components/map/MapOverlayHost', () => ({
  MapOverlayHost: () => <div data-testid="map-overlay-host" />,
}))

// Mock react-router-dom navigate used in LiveMapPage
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
  mockUseNearestThreat.mockReturnValue({ nearest: null, geoError: null })
  mockUseBreakpoint.mockReturnValue({ layout: 'desktop' })
})

describe('LiveMapPage', () => {
  it('renders MapStatsBar', () => {
    renderPage()
    // MapStatsBar renders these stat labels
    expect(screen.getByText('Active Alerts')).toBeInTheDocument()
  })

  it('desktop: renders AlertsDock, not AlertsSheet', () => {
    mockUseBreakpoint.mockReturnValue({ layout: 'desktop' })
    renderPage()
    // AlertsDock renders "LIVE ALERTS" header
    expect(screen.getByText('LIVE ALERTS')).toBeInTheDocument()
  })

  it('mobile: renders AlertsSheet, not AlertsDock', () => {
    mockUseBreakpoint.mockReturnValue({ layout: 'mobile' })
    renderPage()
    // AlertsSheet renders a "0 ALERTS" count in the handle
    expect(screen.getByText(/0 ALERTS/)).toBeInTheDocument()
    // AlertsDock "LIVE ALERTS" header should not be present
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

  it('shows NEAR YOU banner when nearestThreat is non-null', () => {
    const threat: SafetyEvent = {
      event_id: 'threat-1',
      event_type: 'SECURITY_INCIDENT',
      severity: 'HIGH',
      title: 'Armed robbery near CBD',
      summary: null,
      location: { place_name: null, lat: -1.286, lng: 36.817, county: null },
      confidence: 0.9,
      source_count: 3,
      source_breakdown: {},
      is_active: true,
      started_at: '',
      last_updated: '',
      nostr_event_id: null,
      bitcoin_txid: null,
    }
    mockUseNearestThreat.mockReturnValue({ nearest: threat, geoError: null })
    renderPage()
    expect(screen.getByText('NEAR YOU: Armed robbery near CBD')).toBeInTheDocument()
  })

  it('does not show NEAR YOU banner when nearestThreat is null', () => {
    mockUseNearestThreat.mockReturnValue({ nearest: null, geoError: null })
    renderPage()
    expect(screen.queryByText(/NEAR YOU/)).not.toBeInTheDocument()
  })

  it('shows location unavailable banner when geoError is set', () => {
    mockUseNearestThreat.mockReturnValue({
      nearest: null,
      geoError: { code: 1, message: 'Permission denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError,
    })
    renderPage()
    expect(screen.getByText(/Location unavailable/)).toBeInTheDocument()
  })
})
