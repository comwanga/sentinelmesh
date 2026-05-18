import { useMemo, useRef } from 'react'
import { Marker } from 'react-map-gl/maplibre'
import { useAppSelector } from '../../store'
import { selectEventItems } from '../../store/eventsSlice'
import EventMarker from '../EventMarker'
import { ClusterMarker } from './ClusterMarker'
import type { SafetyEvent } from '../../../../../shared/types'

// Hysteresis thresholds: dissolve clusters above DISSOLVE_ZOOM, re-form below FORM_ZOOM
const DISSOLVE_ZOOM = 13.2
const FORM_ZOOM     = 12.8

interface Cluster {
  id: string
  lat: number
  lng: number
  events: SafetyEvent[]
  criticalCount: number
  highCount: number
  mediumCount: number
  lowCount: number
  totalCount: number
}

function cellSize(zoom: number): number {
  return 180 / Math.pow(2, Math.floor(zoom))
}

function buildClusters(events: SafetyEvent[], zoom: number): Cluster[] {
  const size = cellSize(zoom)
  const cells = new Map<string, SafetyEvent[]>()
  for (const e of events) {
    const ci = Math.floor(e.lng / size)
    const cj = Math.floor(e.lat / size)
    const key = `${ci},${cj}`
    if (!cells.has(key)) cells.set(key, [])
    cells.get(key)!.push(e)
  }
  return Array.from(cells.entries()).map(([key, evts]) => ({
    id: key,
    lat: evts.reduce((s, e) => s + e.lat, 0) / evts.length,
    lng: evts.reduce((s, e) => s + e.lng, 0) / evts.length,
    events: evts,
    criticalCount: evts.filter(e => e.severity === 'CRITICAL').length,
    highCount:     evts.filter(e => e.severity === 'HIGH').length,
    mediumCount:   evts.filter(e => e.severity === 'MEDIUM').length,
    lowCount:      evts.filter(e => e.severity === 'LOW').length,
    totalCount:    evts.length,
  }))
}

interface Props {
  zoom?: number
  onEventClick?: (event: SafetyEvent) => void
}

export function EventClusterLayer({ zoom = 2, onEventClick }: Props) {
  const allEvents = useAppSelector(selectEventItems)
  const activeEvents = useMemo(() => allEvents.filter(e => e.is_active), [allEvents])

  const clusteredRef = useRef(zoom < DISSOLVE_ZOOM)
  if (zoom >= DISSOLVE_ZOOM) clusteredRef.current = false
  if (zoom <= FORM_ZOOM)     clusteredRef.current = true

  const showClustered = clusteredRef.current

  const clusters = useMemo(
    () => showClustered ? buildClusters(activeEvents, zoom) : [],
    [showClustered, activeEvents, zoom],
  )

  if (activeEvents.length === 0) return null

  if (!showClustered) {
    return (
      <>
        {activeEvents.map(event => (
          <Marker key={event.id} longitude={event.lng} latitude={event.lat} anchor="center">
            <EventMarker event={event} onClick={onEventClick ?? (() => {})} />
          </Marker>
        ))}
      </>
    )
  }

  return (
    <>
      {clusters.map(cluster => (
        <Marker key={cluster.id} longitude={cluster.lng} latitude={cluster.lat} anchor="center">
          {cluster.totalCount === 1
            ? <EventMarker event={cluster.events[0]} onClick={onEventClick ?? (() => {})} />
            : (
              <ClusterMarker
                clusterId={cluster.id}
                criticalCount={cluster.criticalCount}
                highCount={cluster.highCount}
                mediumCount={cluster.mediumCount}
                lowCount={cluster.lowCount}
                totalCount={cluster.totalCount}
              />
            )
          }
        </Marker>
      ))}
    </>
  )
}
