import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface UiIntent {
  type: 'overlay' | 'modal'
  name: 'routes' | 'acoustic' | 'home-route' | null
}

export interface HomeLocation {
  lat: number
  lng: number
  label: string
}

export interface HomeRoute {
  coordinates: [number, number][]
  distanceKm: number
  durationMin: number
  warnings: string[]
}

interface UiState {
  uiIntent: UiIntent
  safeRoutes: { id: string; coordinates: [number, number][] }[]
  homeLocation: HomeLocation | null
  homeRoute: HomeRoute | null
}

const initialState: UiState = {
  uiIntent: { type: 'overlay', name: null },
  safeRoutes: [],
  homeLocation: null,
  homeRoute: null,
}

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setOverlayIntent(state, action: PayloadAction<{ name: 'routes' | 'acoustic' | 'home-route' }>) {
      state.uiIntent = { type: 'overlay', name: action.payload.name }
    },
    consumeOverlayIntent(state) {
      state.uiIntent = { type: 'overlay', name: null }
    },
    safeRoutesSet(state, action: PayloadAction<{ id: string; coordinates: [number, number][] }[]>) {
      state.safeRoutes = action.payload
    },
    safeRoutesCleared(state) {
      state.safeRoutes = []
    },
    setHomeLocation(state, action: PayloadAction<HomeLocation>) {
      state.homeLocation = action.payload
    },
    clearHomeLocation(state) {
      state.homeLocation = null
    },
    homeRouteSet(state, action: PayloadAction<HomeRoute>) {
      state.homeRoute = action.payload
    },
    homeRouteCleared(state) {
      state.homeRoute = null
    },
  },
})

export const {
  setOverlayIntent,
  consumeOverlayIntent,
  safeRoutesSet,
  safeRoutesCleared,
  setHomeLocation,
  clearHomeLocation,
  homeRouteSet,
  homeRouteCleared,
} = uiSlice.actions
export default uiSlice.reducer
