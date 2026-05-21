import { Source, Layer } from 'react-map-gl/maplibre'
import { useAppSelector } from '../../store'

export function HomeRouteLayer() {
  const homeRoute = useAppSelector(s => s.ui.homeRoute)
  const homeRoutes = useAppSelector(s => s.ui.homeRoutes)

  if (!homeRoute && !homeRoutes.length) return null

  // Determine which route is selected (homeRoute) and which are alternatives
  const selectedCoords = homeRoute?.coordinates
  const alternatives = homeRoutes.filter(r => r.coordinates !== selectedCoords)

  return (
    <>
      {/* Faded alternative routes drawn first (under selected) */}
      {alternatives.map((alt, i) => (
        <Source
          key={`alt-${i}`}
          id={`home-route-alt-${i}`}
          type="geojson"
          data={{
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: alt.coordinates },
            properties: {},
          }}
        >
          <Layer
            id={`home-route-alt-line-${i}`}
            type="line"
            paint={{ 'line-color': '#3a6080', 'line-width': 2.5, 'line-opacity': 0.45 }}
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          />
        </Source>
      ))}

      {/* Selected / primary route */}
      {selectedCoords && (
        <Source
          id="home-route"
          type="geojson"
          data={{
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: selectedCoords },
            properties: {},
          }}
        >
          {/* Glow casing */}
          <Layer
            id="home-route-casing"
            type="line"
            paint={{ 'line-color': '#00E5FF', 'line-width': 8, 'line-opacity': 0.22 }}
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
      )}
    </>
  )
}
