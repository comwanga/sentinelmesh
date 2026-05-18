import { describe, test, expect } from 'vitest'
import viewportEventsReducer, {
  viewportEventsSet,
  viewportEventsBatchApply,
  selectViewportEventItems,
  selectActiveViewportEvents,
} from '../store/viewportEventsSlice'
import type { RootState } from '../store'
import type { SafetyEvent } from '../../../../shared/types'

function makeEvent(id: string, overrides: Partial<SafetyEvent> = {}): SafetyEvent {
  return {
    id,
    event_type: 'FLOOD',
    severity: 'HIGH',
    title: `Event ${id}`,
    summary: null,
    lat: -1.29,
    lng: 36.82,
    place_name: null,
    county: null,
    is_active: true,
    state: 'ACTIVE',
    started_at: '2026-05-18T00:00:00Z',
    created_at: '2026-05-18T00:00:00Z',
    nostr_event_id: null,
    bitcoin_txid: null,
    ...overrides,
  }
}

const e1 = makeEvent('e1')
const e2 = makeEvent('e2', { severity: 'CRITICAL' })
const e3 = makeEvent('e3', { is_active: false, state: 'RESOLVED' })

describe('viewportEventsSlice', () => {
  test('initial state is empty', () => {
    const state = viewportEventsReducer(undefined, { type: '@@INIT' })
    expect(state.items).toEqual([])
  })

  test('viewportEventsSet replaces all items', () => {
    const s1 = viewportEventsReducer(undefined, viewportEventsSet([e1, e2]))
    expect(s1.items).toHaveLength(2)
    const s2 = viewportEventsReducer(s1, viewportEventsSet([e3]))
    expect(s2.items).toHaveLength(1)
    expect(s2.items[0]!.id).toBe('e3')
  })

  test('viewportEventsBatchApply adds new events', () => {
    const state = viewportEventsReducer(
      undefined,
      viewportEventsBatchApply({ added: [e1], removed: [], updated: [] }),
    )
    expect(state.items).toHaveLength(1)
    expect(state.items[0]!.id).toBe('e1')
  })

  test('viewportEventsBatchApply removes events by id', () => {
    const base = viewportEventsReducer(undefined, viewportEventsSet([e1, e2]))
    const state = viewportEventsReducer(
      base,
      viewportEventsBatchApply({ added: [], removed: ['e1'], updated: [] }),
    )
    expect(state.items).toHaveLength(1)
    expect(state.items[0]!.id).toBe('e2')
  })

  test('viewportEventsBatchApply updates events in-place', () => {
    const base = viewportEventsReducer(undefined, viewportEventsSet([e1]))
    const updated = makeEvent('e1', { severity: 'CRITICAL', title: 'Updated' })
    const state = viewportEventsReducer(
      base,
      viewportEventsBatchApply({ added: [], removed: [], updated: [updated] }),
    )
    expect(state.items).toHaveLength(1)
    expect(state.items[0]!.severity).toBe('CRITICAL')
    expect(state.items[0]!.title).toBe('Updated')
  })

  test('viewportEventsBatchApply handles all three operations together', () => {
    const base = viewportEventsReducer(undefined, viewportEventsSet([e1, e2]))
    const updatedE2 = makeEvent('e2', { severity: 'LOW' })
    const state = viewportEventsReducer(
      base,
      viewportEventsBatchApply({ added: [e3], removed: ['e1'], updated: [updatedE2] }),
    )
    const ids = state.items.map(e => e.id).sort()
    expect(ids).toEqual(['e2', 'e3'])
    expect(state.items.find(e => e.id === 'e2')!.severity).toBe('LOW')
  })
})

describe('selectors', () => {
  const stateWith = (items: SafetyEvent[]): Pick<RootState, 'viewportEvents'> => ({
    viewportEvents: { items },
  })

  test('selectViewportEventItems returns all items', () => {
    const s = stateWith([e1, e3])
    expect(selectViewportEventItems(s as RootState)).toHaveLength(2)
  })

  test('selectActiveViewportEvents filters to is_active only', () => {
    const s = stateWith([e1, e3])
    const active = selectActiveViewportEvents(s as RootState)
    expect(active).toHaveLength(1)
    expect(active[0]!.id).toBe('e1')
  })
})
