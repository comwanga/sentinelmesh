import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { RootState } from '.'

export interface ZapRecord {
  id: string
  amount: number          // satoshis
  recipientPubkey: string
  reportId: string
  timestamp: number       // Unix ms
}

interface ZapsState {
  records: ZapRecord[]
}

const initialState: ZapsState = { records: [] }

const zapsSlice = createSlice({
  name: 'zaps',
  initialState,
  reducers: {
    // Prepend so newest zap is first
    zapSent(state, action: PayloadAction<ZapRecord>) {
      state.records.unshift(action.payload)
    },
    zapsCleared(state) {
      state.records = []
    },
  },
})

export const { zapSent, zapsCleared } = zapsSlice.actions
export default zapsSlice.reducer

export const selectZapRecords = (state: RootState) => state.zaps.records
