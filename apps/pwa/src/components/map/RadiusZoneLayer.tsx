import { Source, Layer } from 'react-map-gl/maplibre'
import type { FeatureCollection, Point } from 'geojson'
import type { SafetyEvent } from '../../../../../shared/types'
import { RADIUS_FILL, RADIUS_STROKE, RADIUS_STROKE_WIDTH } from '../../styles/map-tokens'

interface Props {
  events: SafetyEvent[]
}

export function RadiusZoneLayer({ events }: Props) {
  const features = events
    .filter(e => e.is_active && e.severity !== 'LOW')
    .map(e => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [e.lng, e.lat] } as Point,
      properties: {
        id: e.id,
        severity: e.severity,
        radius_m: (e as unknown as Record<string, unknown>).radius_meters ?? 500,
      },
    }))

  if (features.length === 0) return null

  const geojson: FeatureCollection<Point> = { type: 'FeatureCollection', features }

  return (
    <Source id="radius-zones" type="geojson" data={geojson}>
      <Layer
        id="radius-zone-fill"
        type="circle"
        paint={{
          'circle-radius': [
            '*',
            ['coalesce', ['get', 'radius_m'], 500],
            ['interpolate', ['linear'], ['zoom'], 8, 0.003, 10, 0.007, 12, 0.027, 14, 0.108, 16, 0.432],
          ] as unknown as number,
          'circle-color': [
            'match', ['get', 'severity'],
            'CRITICAL', RADIUS_FILL.CRITICAL,
            'HIGH',     RADIUS_FILL.HIGH,
            'MEDIUM',   RADIUS_FILL.MEDIUM,
            'rgba(0,0,0,0)',
          ] as unknown as string,
          'circle-stroke-color': [
            'match', ['get', 'severity'],
            'CRITICAL', RADIUS_STROKE.CRITICAL,
            'HIGH',     RADIUS_STROKE.HIGH,
            'MEDIUM',   RADIUS_STROKE.MEDIUM,
            'rgba(0,0,0,0)',
          ] as unknown as string,
          'circle-stroke-width': [
            'match', ['get', 'severity'],
            'CRITICAL', RADIUS_STROKE_WIDTH.CRITICAL,
            'HIGH',     RADIUS_STROKE_WIDTH.HIGH,
            'MEDIUM',   RADIUS_STROKE_WIDTH.MEDIUM,
            0,
          ] as unknown as number,
          'circle-pitch-alignment': 'map',
        }}
      />
    </Source>
  )
}
