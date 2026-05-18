import { useState, useCallback } from 'react'
import { Map } from 'react-map-gl/maplibre'
import { MAP_STYLE_URL, WORLD_CENTER } from '../../config/mapConfig'
import { persistViewport } from '../../hooks/useInitialViewport'

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
  const handleMove = useCallback((evt: { viewState: ViewState }) => {
    setViewState(evt.viewState)
    persistViewport(evt.viewState)
  }, [])
  return (
    <Map
      {...viewState}
      onMove={handleMove}
      onLoad={onMapLoad}
      style={{ width: '100%', height: '100%' }}
      mapStyle={MAP_STYLE_URL}
    >
      {children}
    </Map>
  )
}
