import { describe, it, expect } from 'vitest'
import { configureStore } from '@reduxjs/toolkit'
import eventsReducer, {
  eventReceived,
  eventsHydrated,
  eventResolved,
  viewportEventsSet,
  viewportEventsBatchApply,
  setConnected,
} from '../eventsSlice'
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

  it('merges hydration without overwriting a live update', () => {
    const store = makeStore()
    store.dispatch(eventReceived(makeEvent({ title: 'Live title', summary: undefined })))
    store.dispatch(eventsHydrated([makeEvent({ title: 'Snapshot title', summary: 'Stored detail' })]))
    expect(store.getState().events.items[0]!.title).toBe('Live title')
    expect(store.getState().events.items[0]!.summary).toBe('Stored detail')
  })

  it('stores viewport membership separately from canonical entities', () => {
    const store = makeStore()
    store.dispatch(eventsHydrated([makeEvent({ id: 'global' })]))
    store.dispatch(viewportEventsSet([makeEvent({ id: 'visible' })]))
    store.dispatch(viewportEventsBatchApply({ added: [], updated: [], removed: ['visible'] }))
    expect(store.getState().events.viewportIds).toEqual([])
    expect(store.getState().events.items.map(event => event.id)).toEqual(['visible', 'global'])
  })

  it('retains viewport snapshots larger than the global list limit', () => {
    const store = makeStore()
    const events = Array.from({ length: 400 }, (_, index) => makeEvent({ id: `event-${index}` }))
    store.dispatch(viewportEventsSet(events))
    expect(store.getState().events.items).toHaveLength(400)
    expect(store.getState().events.viewportIds).toHaveLength(400)
  })
})
