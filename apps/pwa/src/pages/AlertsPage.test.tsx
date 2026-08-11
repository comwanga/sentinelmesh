import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import eventsReducer, { eventReceived } from '../store/eventsSlice'
import acousticReducer from '../store/acousticSlice'
import reportsReducer from '../store/reportSlice'
import circlesReducer from '../store/circlesSlice'
import uiReducer from '../store/uiSlice'
import { AlertsPage } from './AlertsPage'
import type { SafetyEvent } from '../../../../shared/types'

function makeStore(events: SafetyEvent[] = []) {
  const store = configureStore({
    reducer: {
      events: eventsReducer,
      acoustic: acousticReducer,
      reports: reportsReducer,
      circles: circlesReducer,
      ui: uiReducer,
    },
  })
  events.forEach(e => store.dispatch(eventReceived(e)))
  return store
}

function makeEvent(overrides: Partial<SafetyEvent> & { id: string }): SafetyEvent {
  return {
    event_type: 'SECURITY_INCIDENT',
    severity: 'HIGH',
    title: 'Test alert',
    summary: null,
    lat: -1.286,
    lng: 36.817,
    place_name: 'Nairobi CBD',
    county: null,
    is_active: true,
    state: 'ACTIVE',
    started_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    nostr_event_id: null,
    bitcoin_txid: null,
    ...overrides,
  }
}

function renderPage(events: SafetyEvent[] = []) {
  const store = makeStore(events)
  return render(
    <Provider store={store}>
      <AlertsPage />
    </Provider>
  )
}

describe('AlertsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders heading "ACTIVE ALERTS"', () => {
    renderPage()
    expect(screen.getByText('ACTIVE ALERTS')).toBeInTheDocument()
  })

  it('renders all 8 EventType filter chips', () => {
    renderPage()
    const expectedTypes = [
      'SECURITY_INCIDENT',
      'CIVIL_UNREST',
      'TRAFFIC_INCIDENT',
      'FLOOD',
      'FIRE',
      'MEDICAL_EMERGENCY',
      'INFRASTRUCTURE_FAILURE',
      'FALSE_ALARM',
    ]
    for (const type of expectedTypes) {
      expect(screen.getByTestId(`type-chip-${type}`)).toBeInTheDocument()
    }
  })

  it('shows only confirmed events when status filter is confirmed', () => {
    const events = [
      makeEvent({ id: 'v1', title: 'Confirmed alert', severity: 'LOW', trust_state: 'confirmed' }),
      makeEvent({ id: 'p1', title: 'Unverified alert', severity: 'CRITICAL', trust_state: 'heuristic' }),
    ]
    renderPage(events)

    fireEvent.click(screen.getByTestId('status-filter-CONFIRMED'))

    expect(screen.getByText('Confirmed alert')).toBeInTheDocument()
    expect(screen.queryByText('Unverified alert')).not.toBeInTheDocument()
  })

  it('shows only events in last 1 hour when timeRange = "1h"', () => {
    const recentTs = new Date(Date.now() - 30 * 60 * 1000).toISOString()  // 30 min ago
    const oldTs = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() // 3 hours ago

    const events = [
      makeEvent({ id: 'r1', title: 'Recent event', created_at: recentTs }),
      makeEvent({ id: 'o1', title: 'Old event', created_at: oldTs }),
    ]
    renderPage(events)

    fireEvent.click(screen.getByTestId('time-range-1h'))

    expect(screen.getByText('Recent event')).toBeInTheDocument()
    expect(screen.queryByText('Old event')).not.toBeInTheDocument()
  })

  it('shows all events when no filters active', () => {
    const events = [
      makeEvent({ id: 'e1', title: 'Alert one' }),
      makeEvent({ id: 'e2', title: 'Alert two', event_type: 'FLOOD' }),
      makeEvent({ id: 'e3', title: 'Alert three' }),
    ]
    renderPage(events)

    expect(screen.getByText('Alert one')).toBeInTheDocument()
    expect(screen.getByText('Alert two')).toBeInTheDocument()
    expect(screen.getByText('Alert three')).toBeInTheDocument()
  })

  it('clicking a type chip toggles that type filter', () => {
    const events = [
      makeEvent({ id: 's1', title: 'Security event', event_type: 'SECURITY_INCIDENT' }),
      makeEvent({ id: 'f1', title: 'Flood event', event_type: 'FLOOD' }),
    ]
    renderPage(events)

    // Before filter: both visible
    expect(screen.getByText('Security event')).toBeInTheDocument()
    expect(screen.getByText('Flood event')).toBeInTheDocument()

    // Click SECURITY_INCIDENT chip — only security events should show
    fireEvent.click(screen.getByTestId('type-chip-SECURITY_INCIDENT'))

    expect(screen.getByText('Security event')).toBeInTheDocument()
    expect(screen.queryByText('Flood event')).not.toBeInTheDocument()

    // Click again to deselect — both visible again
    fireEvent.click(screen.getByTestId('type-chip-SECURITY_INCIDENT'))

    expect(screen.getByText('Security event')).toBeInTheDocument()
    expect(screen.getByText('Flood event')).toBeInTheDocument()
  })
})
