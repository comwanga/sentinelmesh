import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'
import type { RootState } from '.'
import { signAuthEvent } from '../services/nostrService'

export type ZapStatus = 'pending' | 'paid' | 'expired' | 'failed'

export interface ZapRecord {
  id: string
  amount: number          // satoshis
  recipientPubkey: string
  reportId: string
  timestamp: number       // Unix ms
  status: ZapStatus
}

interface ZapsState {
  records: ZapRecord[]
}

const initialState: ZapsState = { records: [] }

export const sendZap = createAsyncThunk(
  'zaps/sendZap',
  async (payload: { reportId: string; recipientPubkey: string; amountSats: number }) => {
    const authEvent = await signAuthEvent()
    const res = await fetch('/api/zaps/request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Nostr-Auth': JSON.stringify(authEvent),
      },
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
    zapSent(state, action: PayloadAction<ZapRecord>) {
      state.records.unshift(action.payload)
    },
    zapsCleared(state) {
      state.records = []
    },
  },
  extraReducers: (builder) => {
    builder.addCase(sendZap.fulfilled, (state, action) => {
      state.records.unshift({
        id: action.payload.id,
        amount: action.payload.amount_sats,
        recipientPubkey: action.meta.arg.recipientPubkey,
        reportId: action.meta.arg.reportId,
        timestamp: Date.now(),
        status: 'pending',
      })
    })
  },
})

export const { zapSent, zapsCleared } = zapsSlice.actions
export default zapsSlice.reducer

export const selectZapRecords = (state: RootState) => state.zaps.records

export const selectZapTotalForReport =
  (reportId: string) =>
  (state: RootState): number =>
    state.zaps.records
      .filter(r => r.reportId === reportId && r.status === 'paid')
      .reduce((sum, r) => sum + r.amount, 0)
