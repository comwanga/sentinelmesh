import { configureStore } from '@reduxjs/toolkit'
import eventsReducer from './eventsSlice'
import acousticReducer from './acousticSlice'
import reportsReducer from './reportSlice'
import circlesReducer from './circlesSlice'
import uiReducer from './uiSlice'
import zapsReducer from './zapsSlice'
import insightsEventsReducer from './insightsEventsSlice'
import communityStatsReducer from './communityStatsSlice'
import safetyLogReducer from './safetyLogSlice'
import viewportEventsReducer from './viewportEventsSlice'
import { useSelector, TypedUseSelectorHook, useDispatch } from 'react-redux'

export const store = configureStore({
  reducer: {
    events:         eventsReducer,
    acoustic:       acousticReducer,
    reports:        reportsReducer,
    circles:        circlesReducer,
    ui:             uiReducer,
    zaps:           zapsReducer,
    insightsEvents: insightsEventsReducer,
    communityStats: communityStatsReducer,
    safetyLog:      safetyLogReducer,
    viewportEvents: viewportEventsReducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector
export const useAppDispatch = () => useDispatch<AppDispatch>()
