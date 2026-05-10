import { useState, useCallback } from 'react'
import Map from 'react-map-gl'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string
const DEFAULT_VIEW = { longitude: 36.8219, latitude: -1.2921, zoom: 11 }

export function MapCanvas() {
  const [viewState, setViewState] = useState(DEFAULT_VIEW)
  const handleMove = useCallback(
    (evt: { viewState: typeof DEFAULT_VIEW }) => setViewState(evt.viewState),
    []
  )
  return (
    <Map
      {...viewState}
      onMove={handleMove}
      mapboxAccessToken={MAPBOX_TOKEN}
      style={{ width: '100%', height: '100%' }}
      mapStyle="mapbox://styles/mapbox/dark-v11"
    />
  )
}
