import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export type TravelMode = 'walking' | 'driving' | 'transit'

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
  label: string
  mode: TravelMode
}

interface UiState {
  uiIntent: UiIntent
  safeRoutes: { id: string; coordinates: [number, number][] }[]
  homeLocation: HomeLocation | null
  homeRoute: HomeRoute | null      // currently selected/displayed route
  homeRoutes: HomeRoute[]          // all alternatives from last fetch
}

const initialState: UiState = {
  uiIntent: { type: 'overlay', name: null },
  safeRoutes: [],
  homeLocation: null,
  homeRoute: null,
  homeRoutes: [],
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
    // Set all alternatives at once; first becomes the selected route
    homeRoutesSet(state, action: PayloadAction<HomeRoute[]>) {
      state.homeRoutes = action.payload
      state.homeRoute = action.payload[0] ?? null
    },
    // Select a specific alternative by index
    homeRouteSelect(state, action: PayloadAction<number>) {
      state.homeRoute = state.homeRoutes[action.payload] ?? state.homeRoute
    },
    homeRoutesCleared(state) {
      state.homeRoutes = []
      state.homeRoute = null
    },
    // Legacy single-route actions kept for backward compat
    homeRouteSet(state, action: PayloadAction<HomeRoute>) {
      state.homeRoute = action.payload
      state.homeRoutes = [action.payload]
    },
    homeRouteCleared(state) {
      state.homeRoute = null
      state.homeRoutes = []
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
  homeRoutesSet,
  homeRouteSelect,
  homeRoutesCleared,
  homeRouteSet,
  homeRouteCleared,
} = uiSlice.actions
export default uiSlice.reducer
