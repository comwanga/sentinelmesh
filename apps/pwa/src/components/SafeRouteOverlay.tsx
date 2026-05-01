import React from 'react'
import { Source, Layer } from 'react-map-gl/mapbox'
import type { SafeRoute } from '../services/routingService'

const ROUTE_COLOURS = ['#00C853', '#FFD600', '#FF6D00']

interface Props { routes: SafeRoute[] }

export function SafeRouteOverlay({ routes }: Props) {
  if (routes.length === 0) return null

  return (
    <>
      {routes.map((route, index) => (
        <Source
          key={`safe-route-${index}`}
          id={`safe-route-${index}`}
          type="geojson"
          data={{
            type: 'Feature' as const,
            geometry: { type: 'LineString' as const, coordinates: route.coordinates },
            properties: { label: route.label },
          }}
        >
          <Layer
            id={`safe-route-line-${index}`}
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
