import { createSlice, createSelector, PayloadAction } from '@reduxjs/toolkit'
import type { SafetyEvent } from '../../../../shared/types'
import type { RootState } from '.'

interface EventsState {
  items: SafetyEvent[]
  viewportIds: string[]
  connected: boolean
  initialized: boolean
  error: string | null
}

const initialState: EventsState = {
  items: [],
  viewportIds: [],
  connected: false,
  initialized: false,
  error: null,
}

function mergeEvent(current: SafetyEvent | undefined, incoming: SafetyEvent): SafetyEvent {
  if (!current) return incoming
  const merged = { ...current }
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== undefined) (merged as unknown as Record<string, unknown>)[key] = value
  }
  return merged
}

function upsert(state: EventsState, event: SafetyEvent) {
  const idx = state.items.findIndex(e => e.id === event.id)
  if (idx >= 0) {
    const current = state.items[idx]!
    if (current.updated_at && event.updated_at && event.updated_at < current.updated_at) return
    state.items[idx] = mergeEvent(current, event)
  }
  else state.items.unshift(event)
}

const eventsSlice = createSlice({
  name: 'events',
  initialState,
  reducers: {
    eventReceived(state, action: PayloadAction<SafetyEvent>) {
      upsert(state, action.payload)
    },
    eventsHydrated(state, action: PayloadAction<SafetyEvent[]>) {
      // Preserve fields received live while the initial request was in flight.
      for (const event of action.payload) {
        const current = state.items.find(e => e.id === event.id)
        upsert(state, current ? mergeEvent(event, current) : event)
      }
      state.initialized = true
      state.error = null
    },
    eventsHydrationFailed(state, action: PayloadAction<string>) {
      state.initialized = true
      state.error = action.payload
    },
    viewportEventsSet(state, action: PayloadAction<SafetyEvent[]>) {
      for (const event of action.payload) upsert(state, event)
      state.viewportIds = [...new Set(action.payload.map(event => event.id))]
    },
    viewportEventsBatchApply(
      state,
      action: PayloadAction<{ added: SafetyEvent[]; removed: string[]; updated: SafetyEvent[] }>,
    ) {
      for (const event of [...action.payload.added, ...action.payload.updated]) upsert(state, event)
      const ids = new Set(state.viewportIds)
      for (const id of action.payload.removed) ids.delete(id)
      for (const event of action.payload.added) ids.add(event.id)
      for (const event of action.payload.updated) ids.add(event.id)
      state.viewportIds = [...ids]
    },
    eventResolved(state, action: PayloadAction<{ id: string }>) {
      const idx = state.items.findIndex(e => e.id === action.payload.id)
      if (idx >= 0) state.items[idx]!.is_active = false
    },
    setConnected(state, action: PayloadAction<boolean>) {
      state.connected = action.payload
    },
  },
})

export const {
  eventReceived,
  eventsHydrated,
  eventsHydrationFailed,
  eventResolved,
  viewportEventsSet,
  viewportEventsBatchApply,
  setConnected,
} = eventsSlice.actions
export default eventsSlice.reducer

export const selectEventItems = (state: RootState) => state.events.items

export const selectViewportEventItems = createSelector(
  [(state: RootState) => state.events.items, (state: RootState) => state.events.viewportIds],
  (items, viewportIds) => {
    const ids = new Set(viewportIds)
    return items.filter(event => ids.has(event.id))
  },
)

export const selectActiveViewportEvents = createSelector(
  selectViewportEventItems,
  items => items.filter(event => event.is_active),
)

export const selectMapStats = createSelector(
  (state: RootState) => state.events.items,
  items => {
    const activeAlerts = items.filter(e => e.is_active).length
    return { activeAlerts }
  }
)
