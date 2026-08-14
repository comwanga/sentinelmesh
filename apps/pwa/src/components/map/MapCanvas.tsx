import { useCallback, useEffect } from 'react'
import { Map, useMap } from 'react-map-gl/maplibre'
import { MAP_STYLE, WORLD_CENTER } from '../../config/mapConfig'
import { persistViewport } from '../../hooks/useInitialViewport'
import type { ViewportBounds } from '../../hooks/useViewportWs'
import styles from './MapCanvas.module.css'

interface ViewState {
  longitude: number
  latitude: number
  zoom: number
}

export type CameraCommand =
  | { id: number; center: [number, number]; zoom?: number; padding?: number | { top: number; right: number; bottom: number; left: number } }
  | { id: number; bounds: [number, number, number, number]; padding?: number | { top: number; right: number; bottom: number; left: number } }

interface Props {
  initialViewState?: ViewState
  children?: React.ReactNode
  onMapLoad?: () => void
  onBoundsChange?: (bounds: ViewportBounds, zoom: number) => void
  cameraCommand?: CameraCommand | null
}

function CameraController({ command }: { command: CameraCommand }) {
  const { current: map } = useMap()

  useEffect(() => {
    if (!map) return
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const options = { padding: command.padding, duration: reducedMotion ? 0 : 700 }
    if ('bounds' in command) {
      map.fitBounds([[command.bounds[0], command.bounds[1]], [command.bounds[2], command.bounds[3]]], options)
    } else {
      map.easeTo({
        ...options,
        center: command.center,
        zoom: Math.max(map.getZoom(), command.zoom ?? 15),
      })
    }
  }, [command, map])

  return null
}

interface ViewportReporterProps {
  onBoundsChange: (bounds: ViewportBounds, zoom: number) => void
}

function ViewportReporter({ onBoundsChange }: ViewportReporterProps) {
  const { current: map } = useMap()

  useEffect(() => {
    if (!map) return
    function report() {
      const b = map!.getBounds()
      onBoundsChange(
        { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() },
        map!.getZoom(),
      )
    }
    map.on('moveend', report)
    report()
    return () => { map.off('moveend', report) }
  }, [map, onBoundsChange])

  return null
}

export function MapCanvas({ initialViewState = WORLD_CENTER, children, onMapLoad, onBoundsChange, cameraCommand }: Props = {}) {
  const handleMoveEnd = useCallback((evt: { viewState: ViewState }) => {
    persistViewport(evt.viewState)
  }, [])

  return (
    <div className={styles.container}>
      <Map
        initialViewState={initialViewState}
        onMoveEnd={handleMoveEnd}
        onLoad={onMapLoad}
        style={{ width: '100%', height: '100%' }}
        mapStyle={MAP_STYLE}
      >
        {onBoundsChange && <ViewportReporter onBoundsChange={onBoundsChange} />}
        {cameraCommand && <CameraController command={cameraCommand} />}
        {children}
      </Map>
    </div>
  )
}
