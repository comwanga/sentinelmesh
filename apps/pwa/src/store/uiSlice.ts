import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface UiIntent {
  type: 'overlay' | 'modal'
  name: string | null
}

interface UiState {
  uiIntent: UiIntent
}

const initialState: UiState = {
  uiIntent: { type: 'overlay', name: null },
}

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setOverlayIntent(state, action: PayloadAction<{ name: 'routes' | 'acoustic' }>) {
      state.uiIntent = { type: 'overlay', name: action.payload.name }
    },
    consumeOverlayIntent(state) {
      state.uiIntent = { type: 'overlay', name: null }
    },
  },
})

export const { setOverlayIntent, consumeOverlayIntent } = uiSlice.actions
export default uiSlice.reducer
