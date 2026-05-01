// apps/pwa/src/store/acousticSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { ThreatDetection } from '../constants/acousticThreats'

interface AcousticState {
  isRunning: boolean
  currentAlert: ThreatDetection | null
  lastDetectionAt: number | null
}

const initialState: AcousticState = {
  isRunning: false,
  currentAlert: null,
  lastDetectionAt: null,
}

const acousticSlice = createSlice({
  name: 'acoustic',
  initialState,
  reducers: {
    detectionStarted(state) { state.isRunning = true },
    detectionStopped(state) { state.isRunning = false },
    detectionReceived(state, action: PayloadAction<ThreatDetection>) {
      state.currentAlert = action.payload
      state.lastDetectionAt = Date.now()
    },
    alertDismissed(state) { state.currentAlert = null },
  },
})

export const { detectionStarted, detectionStopped, detectionReceived, alertDismissed } =
  acousticSlice.actions
export default acousticSlice.reducer
