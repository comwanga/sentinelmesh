import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import eventsReducer, { eventReceived } from '../../store/eventsSlice'
import acousticReducer from '../../store/acousticSlice'
import circlesReducer from '../../store/circlesSlice'
import { InsightsPage } from '../InsightsPage'
import type { SafetyEvent } from '../../../../../shared/types'

function makeEvent(id: string, severity: SafetyEvent['severity']): SafetyEvent {
  return {
    id, event_type: 'FLOOD', severity, title: `Event ${id}`, summary: null,
    lat: 0, lng: 0, place_name: null, county: null,
    is_active: true, started_at: '', created_at: '',
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

describe('InsightsPage', () => {
  it('renders heading "Insights"', () => {
    render(<Provider store={makeStore()}><InsightsPage /></Provider>)
    expect(screen.getByText('Insights')).toBeInTheDocument()
  })

  it('has data-testid="insights-page" for routing tests', () => {
    render(<Provider store={makeStore()}><InsightsPage /></Provider>)
    expect(screen.getByTestId('insights-page')).toBeInTheDocument()
  })

  it('shows CRITICAL count from active events', () => {
    const store = makeStore([makeEvent('1', 'CRITICAL'), makeEvent('2', 'CRITICAL')])
    render(<Provider store={store}><InsightsPage /></Provider>)
    expect(screen.getByText('CRITICAL')).toBeInTheDocument()
  })

  it('shows all four severity labels', () => {
    render(<Provider store={makeStore()}><InsightsPage /></Provider>)
    expect(screen.getByText('CRITICAL')).toBeInTheDocument()
    expect(screen.getByText('HIGH')).toBeInTheDocument()
    expect(screen.getByText('MEDIUM')).toBeInTheDocument()
    expect(screen.getByText('LOW')).toBeInTheDocument()
  })
})
