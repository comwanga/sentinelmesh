import { useState, useEffect } from 'react'
import { useAppSelector, useAppDispatch } from '../../store'
import { consumeOverlayIntent, safeRoutesSet, safeRoutesCleared } from '../../store/uiSlice'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { AcousticAlert } from '../AcousticAlert'
import { HomeRoutePanel } from '../HomeRoutePanel'
import { fetchSafeRoutes } from '../../services/routingService'

export function MapOverlayHost() {
  const dispatch = useAppDispatch()
  const uiIntent = useAppSelector(s => s.ui.uiIntent)
  const events = useAppSelector(s => s.events.items)
  const { layout } = useBreakpoint()

  const [overlay, setOverlay] = useState<'routes' | 'acoustic' | 'home-route' | null>(null)

  useEffect(() => {
    if (uiIntent.name === 'routes' || uiIntent.name === 'acoustic' || uiIntent.name === 'home-route') {
      setOverlay(uiIntent.name)
      dispatch(consumeOverlayIntent())
    }
  }, [uiIntent.name, dispatch])

  useEffect(() => {
    if (overlay !== 'routes') return
    dispatch(safeRoutesCleared())

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
        dispatch(safeRoutesSet(result.map((r, i) => ({ id: `r${i}`, coordinates: r.coordinates }))))
      } catch {
        // Leave routes empty — overlay shows "no routes" state
      }
    })
  }, [overlay, events, dispatch])

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

  if (overlay === 'home-route') {
    return (
      <div style={{
        position: 'absolute',
        top: layout === 'mobile' ? 'auto' : 12,
        bottom: layout === 'mobile' ? 120 : 'auto',
        right: 12,
        zIndex: 200,
      }}>
        <HomeRoutePanel onClose={() => setOverlay(null)} />
      </div>
    )
  }

  // overlay === 'routes': show close button; route lines drawn by SafeRouteOverlay inside MapCanvas
  return (
    <div style={{
      position: 'absolute', top: 8, right: 44, zIndex: 300,
      background: 'rgba(11,14,20,0.88)', border: '1px solid #1a2035',
      borderRadius: 6, padding: '5px 12px',
      fontFamily: "'Courier New', monospace", fontSize: 10, color: '#00C853',
      backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <span>Escape routes active</span>
      <button
        onClick={() => { setOverlay(null); dispatch(safeRoutesCleared()) }}
        style={{ background: 'none', border: 'none', color: '#4a5568', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}
      >
        ×
      </button>
    </div>
  )
}
