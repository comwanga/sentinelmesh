import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface SafetyLogEntry {
  type: 'proximity' | 'acoustic' | 'route'
  label: string
  timestamp: number
}

interface SafetyLogState {
  entries: SafetyLogEntry[]
}

const safetyLogSlice = createSlice({
  name: 'safetyLog',
  initialState: { entries: [] } as SafetyLogState,
  reducers: {
    logSafetyEvent(state, action: PayloadAction<SafetyLogEntry>) {
      state.entries.unshift(action.payload)
      if (state.entries.length > 100) state.entries.pop()
    },
  },
})

export const { logSafetyEvent } = safetyLogSlice.actions
export default safetyLogSlice.reducer
