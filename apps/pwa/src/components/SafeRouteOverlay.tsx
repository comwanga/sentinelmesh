import React from 'react'
import { Source, Layer } from 'react-map-gl/mapbox'
import type { SafeRoute } from '../services/routingService'

const ROUTE_COLOURS = ['#00C853', '#FFD600', '#FF6D00']

interface Props {
  routes?: SafeRoute[]
  onClose?: () => void
}

export function SafeRouteOverlay({ routes = [], onClose }: Props) {
  return (
    <>
      {onClose && (
        <button
          onClick={onClose}
          aria-label="Close safe routes"
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 300,
            background: 'rgba(11,14,20,0.85)',
            border: '1px solid #1a2035',
            borderRadius: 4,
            color: '#e2e8f0',
            fontSize: 16,
            cursor: 'pointer',
            padding: '2px 6px',
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      )}
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
