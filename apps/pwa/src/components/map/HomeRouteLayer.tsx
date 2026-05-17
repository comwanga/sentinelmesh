import { Source, Layer } from 'react-map-gl/mapbox'
import { useAppSelector } from '../../store'

export function HomeRouteLayer() {
  const homeRoute = useAppSelector(s => s.ui.homeRoute)
  if (!homeRoute) return null
  return (
    <Source
      id="home-route"
      type="geojson"
      data={{
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: homeRoute.coordinates },
        properties: {},
      }}
    >
      {/* Glow casing */}
      <Layer
        id="home-route-casing"
        type="line"
        paint={{ 'line-color': '#00E5FF', 'line-width': 8, 'line-opacity': 0.25 }}
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
      />
      {/* Main line */}
      <Layer
        id="home-route-line"
        type="line"
        paint={{ 'line-color': '#00E5FF', 'line-width': 3, 'line-opacity': 0.9 }}
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
      />
    </Source>
  )
}
