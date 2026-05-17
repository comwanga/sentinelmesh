import { useState, useCallback } from 'react'
import Map from 'react-map-gl'

// Token is only used for library initialisation; all network requests are
// rewritten by transformRequest to go through the server-side tile proxy so
// the real token is never sent directly to Mapbox from the client.
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string

interface ViewState {
  longitude: number
  latitude: number
  zoom: number
}

const DEFAULT_VIEW: ViewState = { longitude: 36.8219, latitude: -1.2921, zoom: 11 }

interface Props {
  initialViewState?: ViewState
  children?: React.ReactNode
  onMapLoad?: () => void
}

export function MapCanvas({ initialViewState = DEFAULT_VIEW, children, onMapLoad }: Props = {}) {
  const [viewState, setViewState] = useState<ViewState>(initialViewState)
  const handleMove = useCallback(
    (evt: { viewState: ViewState }) => setViewState(evt.viewState),
    []
  )
  return (
    <Map
      {...viewState}
      onMove={handleMove}
      onLoad={onMapLoad}
      mapboxAccessToken={MAPBOX_TOKEN}
      style={{ width: '100%', height: '100%' }}
      mapStyle="mapbox://styles/mapbox/dark-v11"
    >
      {children}
    </Map>
  )
}
