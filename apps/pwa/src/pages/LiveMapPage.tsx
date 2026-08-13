import { useCallback, useEffect, useState } from 'react'
import { Crosshair, Layers3, LocateFixed, Radio, ScanLine } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import type { EventType, SafetyEvent } from '../../../../shared/types'
import { useBreakpoint } from '../hooks/useBreakpoint'
import { useCurrentLocation } from '../hooks/useCurrentLocation'
import { useInitialViewport } from '../hooks/useInitialViewport'
import { useViewportWs, type ViewportBounds } from '../hooks/useViewportWs'
import { useAppSelector } from '../store'
import { selectViewportEventItems } from '../store/eventsSlice'
import { EventClusterLayer } from '../components/map/EventClusterLayer'
import { FieldLedger } from '../components/map/FieldLedger'
import { LocationMarker } from '../components/map/LocationMarker'
import { MapCanvas } from '../components/map/MapCanvas'
import { RadiusZoneLayer } from '../components/map/RadiusZoneLayer'

type FilterId = 'security' | 'unrest' | 'traffic' | 'environment' | 'response' | 'other'
const FILTERS: { id: FilterId; label: string; color: string; types: EventType[] }[] = [
  { id: 'security', label: 'Security', color: '#ff5c57', types: ['SECURITY_INCIDENT'] },
  { id: 'unrest', label: 'Unrest', color: '#ff9f43', types: ['CIVIL_UNREST'] },
  { id: 'traffic', label: 'Traffic', color: '#50a7ff', types: ['TRAFFIC_INCIDENT'] },
  { id: 'environment', label: 'Fire + flood', color: '#29d6c7', types: ['FIRE', 'FLOOD'] },
  { id: 'response', label: 'Public safety', color: '#d9c27c', types: ['MEDICAL_EMERGENCY', 'INFRASTRUCTURE_FAILURE'] },
  { id: 'other', label: 'Other', color: '#879499', types: ['FALSE_ALARM'] },
]

export function LiveMapPage() {
  const { layout } = useBreakpoint()
  const [loaded, setLoaded] = useState(false)
  const [viewport, setViewport] = useState<{ bounds: ViewportBounds; zoom: number } | null>(null)
  const [filters, setFilters] = useState<Set<FilterId>>(new Set())
  const [selected, setSelected] = useState<SafetyEvent | null>(null)
  const [showRadii, setShowRadii] = useState(true)
  const [searchParams] = useSearchParams()
  const initialViewport = useInitialViewport()
  const { location, error: locationError } = useCurrentLocation()
  const events = useAppSelector(selectViewportEventItems).filter(event => event.is_active)
  useViewportWs(viewport?.bounds ?? null, viewport?.zoom ?? 12)
  const onBoundsChange = useCallback((bounds: ViewportBounds, zoom: number) => setViewport({ bounds, zoom }), [])

  const activeTypes = new Set([...filters].flatMap(id => FILTERS.find(filter => filter.id === id)?.types ?? []))
  const visible = filters.size ? events.filter(event => activeTypes.has(event.event_type)) : events
  const confirmed = visible.filter(event => event.trust_state === 'confirmed').length

  useEffect(() => {
    const eventId = searchParams.get('event')
    if (eventId) setSelected(events.find(event => event.id === eventId) ?? null)
  }, [events, searchParams])

  function toggleFilter(id: FilterId) {
    setFilters(current => {
      const next = new Set(current)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return <div data-testid="live-map-page" className="atlas-workspace">
    <section className="map-stage" aria-label="Live incident atlas">
      {!loaded && <div className="map-loading"><ScanLine /><span>Calibrating field atlas</span><i /></div>}
      <MapCanvas initialViewState={initialViewport} onMapLoad={() => setLoaded(true)} onBoundsChange={onBoundsChange}>
        {showRadii && <RadiusZoneLayer events={visible} />}
        <EventClusterLayer events={visible} onEventClick={setSelected} selectedEventId={selected?.id} />
        {location && <LocationMarker location={location} />}
      </MapCanvas>

      <div className="map-instrument" aria-label="Viewport status">
        <div className="instrument-brand"><Radio size={15} /><span>FIELD / {viewport ? `${viewport.zoom.toFixed(1)}Z` : 'SYNC'}</span></div>
        <div><strong>{visible.length}</strong><span>IN VIEW</span></div>
        <div><strong>{confirmed}</strong><span>CONFIRMED</span></div>
        <div className="feed-live"><i /><span>LIVE FEED</span></div>
      </div>

      <div className="atlas-filters" aria-label="Incident filters">
        {FILTERS.map(filter => <button key={filter.id} className={filters.has(filter.id) ? 'active' : ''} onClick={() => toggleFilter(filter.id)} style={{ '--signal': filter.color } as React.CSSProperties}><i />{filter.label}</button>)}
      </div>

      <div className="map-tools">
        <button className={showRadii ? 'active' : ''} onClick={() => setShowRadii(value => !value)} aria-pressed={showRadii} title="Toggle impact zones"><Layers3 /></button>
        <button title={location ? 'Location acquired' : 'Location unavailable'} aria-label="Current location status"><LocateFixed /></button>
      </div>

      <div className="map-legend"><span><i className="confirmed" />Confirmed</span><span><i className="developing" />Developing evidence</span><span><Crosshair size={13} />Approximate impact zone</span></div>
      {locationError && <div className="geo-note">Location is optional. The atlas remains fully browsable.</div>}
      <FieldLedger events={visible} selected={selected} onSelect={setSelected} mobile={layout === 'mobile'} />
    </section>
  </div>
}
