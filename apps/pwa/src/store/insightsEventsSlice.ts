import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

export interface BucketedEvent {
  bucket: string
  lat: number
  lng: number
  count: number
  eventType: string
}

interface InsightsEventsState {
  buckets: BucketedEvent[]
  loading: boolean
  error: string | null
}

export const fetchInsightsEvents = createAsyncThunk<BucketedEvent[], { from: string; to: string; bucket: string }>(
  'insightsEvents/fetch',
  async ({ from, to, bucket }) => {
    const params = new URLSearchParams({ from, to, bucket, page: '1', limit: '500' })
    const res = await fetch(`/api/events/history?${params}`)
    if (!res.ok) throw new Error('Failed to fetch event history')
    return res.json() as Promise<BucketedEvent[]>
  }
)

const insightsEventsSlice = createSlice({
  name: 'insightsEvents',
  initialState: { buckets: [], loading: false, error: null } as InsightsEventsState,
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(fetchInsightsEvents.pending,   state => { state.loading = true; state.error = null })
      .addCase(fetchInsightsEvents.fulfilled, (state, { payload }) => { state.loading = false; state.buckets = payload })
      .addCase(fetchInsightsEvents.rejected,  (state, { error }) => { state.loading = false; state.error = error.message ?? 'Error' })
  },
})

export default insightsEventsSlice.reducer
