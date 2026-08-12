import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { CommunityReport } from '../../../../shared/types'

interface ReportsState {
  items: CommunityReport[]
  initialized: boolean
  error: string | null
}

const initialState: ReportsState = { items: [], initialized: false, error: null }

function upsert(state: ReportsState, report: CommunityReport) {
  const idx = state.items.findIndex(r => r.id === report.id)
  if (idx >= 0) {
    if (report.updated_at < state.items[idx]!.updated_at) return
    state.items[idx] = report
  }
  else state.items.unshift(report)
  if (state.items.length > 100) state.items.length = 100
}

const reportsSlice = createSlice({
  name: 'reports',
  initialState,
  reducers: {
    reportReceived(state, action: PayloadAction<CommunityReport>) {
      upsert(state, action.payload)
    },
    reportsHydrated(state, action: PayloadAction<CommunityReport[]>) {
      for (const report of action.payload) {
        upsert(state, report)
      }
      state.initialized = true
      state.error = null
    },
    reportsHydrationFailed(state, action: PayloadAction<string>) {
      state.initialized = true
      state.error = action.payload
    },
  },
})

export const { reportReceived, reportsHydrated, reportsHydrationFailed } = reportsSlice.actions
export default reportsSlice.reducer
