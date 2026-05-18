import { useState, useCallback, useEffect } from 'react'
import { Map } from 'react-map-gl/maplibre'
import { loadMapStyle, WORLD_CENTER } from '../../config/mapConfig'
import { persistViewport } from '../../hooks/useInitialViewport'
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
}

export function MapCanvas({ initialViewState = WORLD_CENTER, children, onMapLoad }: Props = {}) {
  const [viewState, setViewState] = useState<ViewState>(initialViewState)
  const [mapStyle, setMapStyle] = useState<object | string | undefined>(undefined)

  useEffect(() => {
    loadMapStyle().then(setMapStyle).catch(console.error)
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
        {children}
      </Map>
    </div>
  )
}
