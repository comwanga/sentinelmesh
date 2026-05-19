import { useState, useCallback, useEffect } from 'react'
import { Map, useMap } from 'react-map-gl/maplibre'
import { loadMapStyle, MAP_STYLE_URL, WORLD_CENTER } from '../../config/mapConfig'
import { persistViewport } from '../../hooks/useInitialViewport'
import type { ViewportBounds } from '../../hooks/useViewportWs'
import styles from './MapCanvas.module.css'

interface ViewState {
  longitude: number
  latitude: number
  zoom: number
}

interface Props {
  initialViewState?: ViewState
  children?: React.ReactNode
  onMapLoad?: () => void
  onBoundsChange?: (bounds: ViewportBounds, zoom: number) => void
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

export function MapCanvas({ initialViewState = WORLD_CENTER, children, onMapLoad, onBoundsChange }: Props = {}) {
  const [viewState, setViewState] = useState<ViewState>(initialViewState)
  const [mapStyle, setMapStyle] = useState<object | string>(MAP_STYLE_URL)

  useEffect(() => {
    loadMapStyle().then(setMapStyle).catch(err => {
      console.error('Map style load failed, using fallback:', err)
    })
  }, [])

  const handleMove = useCallback((evt: { viewState: ViewState }) => {
    setViewState(evt.viewState)
    persistViewport(evt.viewState)
  }, [])

  return (
    <div className={styles.container}>
      <Map
        {...viewState}
        onMove={handleMove}
        onLoad={onMapLoad}
        style={{ width: '100%', height: '100%' }}
        mapStyle={mapStyle}
      >
        {onBoundsChange && <ViewportReporter onBoundsChange={onBoundsChange} />}
        {children}
      </Map>
    </div>
  )
}
