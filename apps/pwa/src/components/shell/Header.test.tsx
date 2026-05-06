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

function wrap(s: ReturnType<typeof makeStore>) {
  return ({ children }: { children: React.ReactNode }) => (
    <Provider store={s}><MemoryRouter>{children}</MemoryRouter></Provider>
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
