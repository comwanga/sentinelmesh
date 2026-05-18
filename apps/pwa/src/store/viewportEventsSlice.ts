import { createSlice, createSelector, PayloadAction } from '@reduxjs/toolkit'
import type { SafetyEvent } from '../../../../shared/types'
import type { RootState } from '.'

interface ViewportEventsState {
  items: SafetyEvent[]
}

const initialState: ViewportEventsState = {
  items: [],
}

const viewportEventsSlice = createSlice({
  name: 'viewportEvents',
  initialState,
  reducers: {
    viewportEventsSet(state, action: PayloadAction<SafetyEvent[]>) {
      state.items = action.payload
    },
    viewportEventsBatchApply(
      state,
      action: PayloadAction<{ added: SafetyEvent[]; removed: string[]; updated: SafetyEvent[] }>,
    ) {
      const { added, removed, updated } = action.payload
      const removedSet = new Set(removed)
      state.items = state.items.filter(e => !removedSet.has(e.id))
      for (const u of updated) {
        const idx = state.items.findIndex(e => e.id === u.id)
        if (idx >= 0) state.items[idx] = u
      }
      state.items.push(...added)
    },
  },
})

export const { viewportEventsSet, viewportEventsBatchApply } = viewportEventsSlice.actions
export default viewportEventsSlice.reducer

export const selectViewportEventItems = (state: RootState) => state.viewportEvents.items

export const selectActiveViewportEvents = createSelector(
  selectViewportEventItems,
  items => items.filter(e => e.is_active),
)
