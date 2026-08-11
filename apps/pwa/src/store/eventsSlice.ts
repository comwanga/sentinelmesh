import { createSlice, createSelector, PayloadAction } from '@reduxjs/toolkit'
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
      const idx = state.items.findIndex(e => e.id === action.payload.id)
      if (idx >= 0) {
        state.items[idx] = action.payload
      } else {
        state.items.unshift(action.payload)
        if (state.items.length > 200) state.items.pop()
      }
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

export const { eventReceived, eventResolved, setConnected } = eventsSlice.actions
export default eventsSlice.reducer

export const selectEventItems = (state: RootState) => state.events.items

export const selectMapStats = createSelector(
  (state: RootState) => state.events.items,
  items => {
    const activeAlerts = items.filter(e => e.is_active).length
    return { activeAlerts }
  }
)
