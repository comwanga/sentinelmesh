import { Source, Layer } from 'react-map-gl/maplibre'
import { useAppSelector } from '../store'

const ROUTE_COLOURS = ['#00C853', '#FFD600', '#FF6D00']

export function SafeRouteOverlay() {
  const safeRoutes = useAppSelector(s => s.ui.safeRoutes)
  return (
    <>
      {safeRoutes.map((route, index) => (
        <Source
          key={`safe-route-${route.id}`}
          id={`safe-route-${route.id}`}
          type="geojson"
          data={{
            type: 'Feature' as const,
            geometry: { type: 'LineString' as const, coordinates: route.coordinates },
            properties: {},
          }}
        >
          <Layer
            id={`safe-route-line-${route.id}`}
            type="line"
            paint={{
              'line-color': ROUTE_COLOURS[index] ?? '#00C853',
              'line-width': 4,
              'line-opacity': 0.85,
            }}
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          />
        </Source>
      ))}
    </>
  )
}
