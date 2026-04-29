import { configureStore } from '@reduxjs/toolkit'
import eventsReducer from './eventsSlice'
import { useSelector, TypedUseSelectorHook } from 'react-redux'

export const store = configureStore({
  reducer: {
    events: eventsReducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector
