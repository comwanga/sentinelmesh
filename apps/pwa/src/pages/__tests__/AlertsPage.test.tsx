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
  const store = configureStore({
    reducer: { events: eventsReducer, acoustic: acousticReducer, circles: circlesReducer },
  })
  events.forEach(e => store.dispatch(eventReceived(e)))
  return store
}

describe('AlertsPage', () => {
  it('shows heading "Active Alerts"', () => {
    render(<Provider store={makeStore()}><AlertsPage /></Provider>)
    expect(screen.getByText('Active Alerts')).toBeInTheDocument()
  })

  it('shows active event titles', () => {
    const store = makeStore([makeEvent('1', 'CRITICAL'), makeEvent('2', 'HIGH')])
    render(<Provider store={store}><AlertsPage /></Provider>)
    expect(screen.getByText('Event 1')).toBeInTheDocument()
    expect(screen.getByText('Event 2')).toBeInTheDocument()
  })

  it('does not show inactive events', () => {
    const store = makeStore([makeEvent('3', 'LOW', false)])
    render(<Provider store={store}><AlertsPage /></Provider>)
    expect(screen.queryByText('Event 3')).not.toBeInTheDocument()
  })

  it('shows empty state when no active alerts', () => {
    render(<Provider store={makeStore()}><AlertsPage /></Provider>)
    expect(screen.getByText(/No active alerts/i)).toBeInTheDocument()
  })
})
