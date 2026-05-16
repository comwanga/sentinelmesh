import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'
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

export const sendZap = createAsyncThunk(
  'zaps/sendZap',
  async (payload: { reportId: string; recipientPubkey: string; amountSats: number }) => {
    const res = await fetch('/api/zaps/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        report_id: payload.reportId,
        recipient_pubkey: payload.recipientPubkey,
        amount_sats: payload.amountSats,
      }),
    })
    if (!res.ok) throw new Error(`Zap request failed: ${res.status}`)
    return res.json() as Promise<{ id: string; amount_sats: number; status: string }>
  }
)

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
  extraReducers: (builder) => {
    builder.addCase(sendZap.fulfilled, (state, action) => {
      // The server response contains the canonical record
      state.records.unshift({
        id: action.payload.id,
        amount: action.payload.amount_sats,
        recipientPubkey: action.meta.arg.recipientPubkey,
        reportId: action.meta.arg.reportId,
        timestamp: Date.now(),
      })
    })
  },
})

export const { zapSent, zapsCleared } = zapsSlice.actions
export default zapsSlice.reducer

export const selectZapRecords = (state: RootState) => state.zaps.records
