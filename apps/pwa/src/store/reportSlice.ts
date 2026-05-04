import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface CommunityReport {
  report_id: string
  event_type: string
  severity: string
  description: string | null
  submitted_at: string
  nostr_event_id?: string | null
}

interface ReportState {
  items: CommunityReport[]
}

const initialState: ReportState = {
  items: [],
}

const reportSlice = createSlice({
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

export const { reportReceived } = reportSlice.actions
export default reportSlice.reducer
