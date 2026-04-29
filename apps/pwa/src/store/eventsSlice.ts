import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { SafetyEvent } from '../../../../shared/types'

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
