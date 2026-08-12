import { useEffect } from 'react'
import { useAppDispatch } from '../store'
import { eventsHydrated, eventsHydrationFailed } from '../store/eventsSlice'
import { reportsHydrated, reportsHydrationFailed } from '../store/reportSlice'
import { fetchInitialEvents, fetchInitialReports } from '../services/safetyDataApi'
import { useWsConnection } from '../services/websocket'

export function useSafetyDataSync(): void {
  const dispatch = useAppDispatch()
  useWsConnection()

  useEffect(() => {
    const controller = new AbortController()
    void fetchInitialEvents(controller.signal)
      .then(events => dispatch(eventsHydrated(events)))
      .catch(error => {
        if (!controller.signal.aborted) dispatch(eventsHydrationFailed(String(error)))
      })
    void fetchInitialReports(controller.signal)
      .then(reports => dispatch(reportsHydrated(reports)))
      .catch(error => {
        if (!controller.signal.aborted) dispatch(reportsHydrationFailed(String(error)))
      })
    return () => controller.abort()
  }, [dispatch])
}
