import { configureStore } from '@reduxjs/toolkit'
import eventsReducer from './eventsSlice'
import acousticReducer from './acousticSlice'
import reportsReducer from './reportSlice'
import circlesReducer from './circlesSlice'
import uiReducer from './uiSlice'
import insightsEventsReducer from './insightsEventsSlice'
import communityStatsReducer from './communityStatsSlice'
import safetyLogReducer from './safetyLogSlice'
import { useSelector, TypedUseSelectorHook, useDispatch } from 'react-redux'

export const store = configureStore({
  reducer: {
    events:         eventsReducer,
    acoustic:       acousticReducer,
    reports:        reportsReducer,
    circles:        circlesReducer,
    ui:             uiReducer,
    insightsEvents: insightsEventsReducer,
    communityStats: communityStatsReducer,
    safetyLog:      safetyLogReducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector
export const useAppDispatch = () => useDispatch<AppDispatch>()
