import { configureStore } from '@reduxjs/toolkit'
import eventsReducer from './eventsSlice'
import acousticReducer from './acousticSlice'
import reportsReducer from './reportSlice'
import { useSelector, TypedUseSelectorHook, useDispatch } from 'react-redux'

export const store = configureStore({
  reducer: {
    events: eventsReducer,
    acoustic: acousticReducer,
    reports: reportsReducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector
export const useAppDispatch = () => useDispatch<AppDispatch>()
