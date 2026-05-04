import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { CommunityReport } from '../../../../shared/types'

interface ReportsState {
  items: CommunityReport[]
}

const initialState: ReportsState = { items: [] }

const reportsSlice = createSlice({
  name: 'reports',
  initialState,
  reducers: {
    reportReceived(state, action: PayloadAction<CommunityReport>) {
      const idx = state.items.findIndex(r => r.report_id === action.payload.report_id)
      if (idx >= 0) {
        state.items[idx] = action.payload
      } else {
        state.items.unshift(action.payload)
        if (state.items.length > 100) state.items.pop()
      }
    },
  },
})

export const { reportReceived } = reportsSlice.actions
export default reportsSlice.reducer
