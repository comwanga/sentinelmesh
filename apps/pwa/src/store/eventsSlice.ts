import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { createSelector } from '@reduxjs/toolkit'
import type { SafetyEvent } from '../../../../shared/types'
import type { RootState } from '.'

interface EventsState {
  items: SafetyEvent[]
  connected: boolean
}

const initialState: EventsState = {
  items: [],
  connected: false,
}

const eventsSlice = createSlice({
  name: 'events',
  initialState,
  reducers: {
    eventReceived(state, action: PayloadAction<SafetyEvent>) {
      const idx = state.items.findIndex(e => e.event_id === action.payload.event_id)
      if (idx >= 0) {
        state.items[idx] = action.payload
      } else {
        state.items.unshift(action.payload)
        // Keep last 200 events in memory
        if (state.items.length > 200) state.items.pop()
      }
    },
    eventResolved(state, action: PayloadAction<{ event_id: string }>) {
      const idx = state.items.findIndex(e => e.event_id === action.payload.event_id)
      if (idx >= 0) state.items[idx]!.is_active = false
    },
    setConnected(state, action: PayloadAction<boolean>) {
      state.connected = action.payload
    },
  },
})

export const { eventReceived, eventResolved, setConnected } = eventsSlice.actions
export default eventsSlice.reducer

export const selectMapStats = createSelector(
  (state: RootState) => state.events.items,
  items => {
    const activeAlerts = items.filter(e => e.is_active).length
    const verified = items.filter(e => e.is_active && e.confidence >= 0.7).length
    const verifiedPct = activeAlerts > 0 ? Math.round((verified / activeAlerts) * 100) : 0
    const communityScore = items.length > 0
      ? Math.round(items.reduce((sum, e) => sum + e.confidence, 0) / items.length * 100)
      : 0
    const sources = new Set(items.flatMap(e => Object.keys(e.source_breakdown))).size
    return { activeAlerts, verified, verifiedPct, communityScore, sources }
  }
)
