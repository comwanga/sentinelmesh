import { useEffect, useMemo, useRef, useState } from 'react'
import { Marker, useMap } from 'react-map-gl/maplibre'
import { useAppSelector } from '../../store'
import { selectViewportEventItems } from '../../store/eventsSlice'
import EventMarker from '../EventMarker'
import { ClusterMarker } from './ClusterMarker'
import type { SafetyEvent } from '../../../../../shared/types'

// Hysteresis thresholds: dissolve clusters above DISSOLVE_ZOOM, re-form below FORM_ZOOM
const DISSOLVE_ZOOM = 13.2
const FORM_ZOOM     = 12.8

const noop = () => {}

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
  zoom?: number  // override for tests; defaults to live map zoom
  onEventClick?: (event: SafetyEvent) => void
  events?: SafetyEvent[]
  selectedEventId?: string | null
  onClusterClick?: (events: SafetyEvent[]) => void
}

export function EventClusterLayer({ zoom: zoomProp, onEventClick, events, selectedEventId, onClusterClick }: Props) {
  const { current: map } = useMap()
  const [mapZoom, setMapZoom] = useState<number>(map?.getZoom() ?? 2)

  useEffect(() => {
    if (!map) return
    const onZoom = () => setMapZoom(map.getZoom())
    map.on('zoom', onZoom)
    return () => { map.off('zoom', onZoom) }
  }, [map])

  const zoom = zoomProp ?? mapZoom

  const storeEvents = useAppSelector(selectViewportEventItems)
  const allEvents = events ?? storeEvents

  const activeEvents = useMemo(() => allEvents.filter(e => e.is_active), [allEvents])

  const clusteredRef = useRef(zoom < DISSOLVE_ZOOM)

  // Compute showClustered from hysteresis: only change mode when crossing a threshold
  let showClustered = clusteredRef.current
  if (zoom >= DISSOLVE_ZOOM) showClustered = false
  if (zoom <= FORM_ZOOM)     showClustered = true

  // Sync ref after render so next render reads the committed value
  useEffect(() => {
    clusteredRef.current = showClustered
  })

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
            <EventMarker event={event} onClick={onEventClick ?? noop} selected={event.id === selectedEventId} />
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
            ? <EventMarker event={cluster.events[0]} onClick={onEventClick ?? noop} selected={cluster.events[0].id === selectedEventId} />
            : (
              <ClusterMarker
                clusterId={cluster.id}
                criticalCount={cluster.criticalCount}
                highCount={cluster.highCount}
                mediumCount={cluster.mediumCount}
                lowCount={cluster.lowCount}
                totalCount={cluster.totalCount}
                onClick={() => onClusterClick?.(cluster.events)}
              />
            )
          }
        </Marker>
      ))}
    </>
  )
}
