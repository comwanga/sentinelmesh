// MapOverlayHost: reads uiIntent, renders AcousticAlert or SafeRouteOverlay
// Intent is consumed reducer-side immediately after setting local overlay state
import { useState, useEffect } from 'react'
import { useAppSelector, useAppDispatch } from '../../store'
import { consumeOverlayIntent } from '../../store/uiSlice'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { AcousticAlert } from '../AcousticAlert'
import { SafeRouteOverlay } from '../SafeRouteOverlay'
import { fetchSafeRoutes } from '../../services/routingService'
import type { SafeRoute } from '../../services/routingService'

export function MapOverlayHost() {
  const dispatch = useAppDispatch()
  const uiIntent = useAppSelector(s => s.ui.uiIntent)
  const events = useAppSelector(s => s.events.items)
  const { layout } = useBreakpoint()

  const [overlay, setOverlay] = useState<'routes' | 'acoustic' | null>(null)
  const [routes, setRoutes] = useState<SafeRoute[]>([])

  useEffect(() => {
    if (uiIntent.name === 'routes' || uiIntent.name === 'acoustic') {
      setOverlay(uiIntent.name)
      dispatch(consumeOverlayIntent())
    }
  }, [uiIntent.name, dispatch])

  useEffect(() => {
    if (overlay !== 'routes') return
    setRoutes([])

    const activeEvent = events.find(e => e.is_active && (e.severity === 'CRITICAL' || e.severity === 'HIGH'))
      ?? events.find(e => e.is_active)
    if (!activeEvent) return

    navigator.geolocation?.getCurrentPosition(async (pos) => {
      const userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      const eventLocation = { lat: activeEvent.lat, lng: activeEvent.lng }
      const radiusKm = ((activeEvent as any).radius_meters ?? 500) / 1000
      const token = import.meta.env.VITE_MAPBOX_TOKEN as string
      try {
        const result = await fetchSafeRoutes(userLocation, eventLocation, radiusKm, token)
        setRoutes(result)
      } catch {
        // Leave routes as [] — overlay shows "no routes" state
      }
    })
  }, [overlay, events])

  const presentation: 'panel' | 'sheet' | 'fullscreen' =
    layout === 'desktop' ? 'panel' : overlay === 'acoustic' ? 'fullscreen' : 'sheet'

  if (!overlay) return null

  if (overlay === 'acoustic') {
    return (
      <div style={
        presentation === 'fullscreen'
          ? { position: 'fixed', inset: 0, zIndex: 200, pointerEvents: 'none' }
          : { position: 'absolute', inset: 0, zIndex: 200, pointerEvents: 'none' }
      }>
        <AcousticAlert onClose={() => setOverlay(null)} />
      </div>
    )
  }

  // overlay === 'routes': render SafeRouteOverlay which draws route lines on the map
  const handleClose = () => { setOverlay(null); setRoutes([]) }
  return <SafeRouteOverlay routes={routes} onClose={handleClose} />
}
