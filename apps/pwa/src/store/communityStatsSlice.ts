import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

export interface ReporterStat {
  pubkey: string
  reportCount: number
  trustScore: number
  tier: string
}

interface CommunityStatsState {
  reporters: ReporterStat[]
  totalVerified: number
  loading: boolean
  error: string | null
}

export const fetchCommunityStats = createAsyncThunk<{ reporters: ReporterStat[]; totalVerified: number }>(
  'communityStats/fetch',
  async () => {
    const res = await fetch('/api/insights/community?limit=20')
    if (!res.ok) throw new Error('Failed to fetch community stats')
    return res.json() as Promise<{ reporters: ReporterStat[]; totalVerified: number }>
  }
)

const communityStatsSlice = createSlice({
  name: 'communityStats',
  initialState: { reporters: [], totalVerified: 0, loading: false, error: null } as CommunityStatsState,
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(fetchCommunityStats.pending,   state => { state.loading = true; state.error = null })
      .addCase(fetchCommunityStats.fulfilled, (state, { payload }) => { state.loading = false; state.reporters = payload.reporters; state.totalVerified = payload.totalVerified })
      .addCase(fetchCommunityStats.rejected,  (state, { error }) => { state.loading = false; state.error = error.message ?? 'Error' })
  },
})

export default communityStatsSlice.reducer
