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
    state: 'ACTIVE',
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
