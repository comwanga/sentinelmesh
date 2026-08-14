import { useCallback, useEffect, useRef, useState } from 'react'
import { Crosshair, Layers3, LocateFixed, Radio, ScanLine } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import type { EventType, SafetyEvent } from '../../../../shared/types'
import { useBreakpoint } from '../hooks/useBreakpoint'
import { useCurrentLocation } from '../hooks/useCurrentLocation'
import { useInitialViewport } from '../hooks/useInitialViewport'
import { useViewportWs, type ViewportBounds } from '../hooks/useViewportWs'
import { useAppSelector } from '../store'
import { selectEventItems, selectViewportEventItems } from '../store/eventsSlice'
import { EventClusterLayer } from '../components/map/EventClusterLayer'
import { FieldLedger } from '../components/map/FieldLedger'
import { LocationMarker } from '../components/map/LocationMarker'
import { MapCanvas, type CameraCommand } from '../components/map/MapCanvas'
import { MapSearch } from '../components/map/MapSearch'
import { RadiusZoneLayer } from '../components/map/RadiusZoneLayer'
import { SearchResultMarker } from '../components/map/SearchResultMarker'
import type { GeocodeSuggestion } from '../services/mapApiService'

type FilterId = 'security' | 'unrest' | 'traffic' | 'environment' | 'response' | 'other'
const FILTERS: { id: FilterId; label: string; color: string; types: EventType[] }[] = [
  { id: 'security', label: 'Security', color: '#d83d3d', types: ['SECURITY_INCIDENT'] },
  { id: 'unrest', label: 'Unrest', color: '#e27032', types: ['CIVIL_UNREST'] },
  { id: 'traffic', label: 'Traffic', color: '#2e87a7', types: ['TRAFFIC_INCIDENT'] },
  { id: 'environment', label: 'Fire + flood', color: '#0b6b61', types: ['FIRE', 'FLOOD'] },
  { id: 'response', label: 'Public safety', color: '#b38119', types: ['MEDICAL_EMERGENCY', 'INFRASTRUCTURE_FAILURE'] },
  { id: 'other', label: 'Other', color: '#687c78', types: ['FALSE_ALARM'] },
]

export function LiveMapPage() {
  const { layout } = useBreakpoint()
  const [loaded, setLoaded] = useState(false)
  const [viewport, setViewport] = useState<{ bounds: ViewportBounds; zoom: number } | null>(null)
  const [filters, setFilters] = useState<Set<FilterId>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchResult, setSearchResult] = useState<GeocodeSuggestion | null>(null)
  const [cameraCommand, setCameraCommand] = useState<CameraCommand | null>(null)
  const [showRadii, setShowRadii] = useState(true)
  const [searchParams, setSearchParams] = useSearchParams()
  const [searchSeed, setSearchSeed] = useState(() => ({ id: 0, query: searchParams.get('q') ?? '' }))
  const cameraSequence = useRef(0)
  const deepLinkFocused = useRef<string | null>(null)
  const initialViewport = useInitialViewport()
  const { location, error: locationError } = useCurrentLocation()
  const events = useAppSelector(selectViewportEventItems).filter(event => event.is_active)
  const allEvents = useAppSelector(selectEventItems)
  useViewportWs(viewport?.bounds ?? null, viewport?.zoom ?? 12)
  const onBoundsChange = useCallback((bounds: ViewportBounds, zoom: number) => setViewport({ bounds, zoom }), [])

  const activeTypes = new Set([...filters].flatMap(id => FILTERS.find(filter => filter.id === id)?.types ?? []))
  const visible = filters.size ? events.filter(event => activeTypes.has(event.event_type)) : events
  const confirmed = visible.filter(event => event.trust_state === 'confirmed').length
  const selected = selectedId ? allEvents.find(event => event.id === selectedId) ?? null : null
  const eventParam = searchParams.get('event')
  const cameraPadding = layout === 'mobile'
    ? { top: 180, right: 24, bottom: 140, left: 24 }
    : { top: 150, right: 400, bottom: 60, left: 40 }

  useEffect(() => {
    const query = searchParams.get('q')
    if (!query) return
    setSearchSeed(current => ({ id: current.id + 1, query }))
    const next = new URLSearchParams(searchParams)
    next.delete('q')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    if (!eventParam) return
    setSelectedId(eventParam)
    const event = allEvents.find(item => item.id === eventParam)
    if (!event || deepLinkFocused.current === eventParam) return
    deepLinkFocused.current = eventParam
    setCameraCommand({ id: ++cameraSequence.current, center: [event.lng, event.lat], zoom: 15, padding: cameraPadding })
  }, [allEvents, eventParam, layout])

  function selectEvent(event: SafetyEvent | null) {
    setSelectedId(event?.id ?? null)
    if (eventParam) {
      const next = new URLSearchParams(searchParams)
      next.delete('event')
      setSearchParams(next, { replace: true })
    }
    if (event) setCameraCommand({ id: ++cameraSequence.current, center: [event.lng, event.lat], zoom: 15, padding: cameraPadding })
  }

  function focusCluster(clusterEvents: SafetyEvent[]) {
    const lngs = clusterEvents.map(event => event.lng)
    const lats = clusterEvents.map(event => event.lat)
    const west = Math.min(...lngs)
    const east = Math.max(...lngs)
    const south = Math.min(...lats)
    const north = Math.max(...lats)
    const longitudePadding = west === east ? 0.001 : 0
    const latitudePadding = south === north ? 0.001 : 0
    setCameraCommand({
      id: ++cameraSequence.current,
      bounds: [
        west - longitudePadding,
        south - latitudePadding,
        east + longitudePadding,
        north + latitudePadding,
      ],
      padding: cameraPadding,
    })
  }

  function selectSearchResult(result: GeocodeSuggestion) {
    setSearchResult(result)
    setCameraCommand(result.bbox
      ? { id: ++cameraSequence.current, bounds: result.bbox, padding: cameraPadding }
      : { id: ++cameraSequence.current, center: [result.lng, result.lat], zoom: 15, padding: cameraPadding })
  }

  function toggleFilter(id: FilterId) {
    setFilters(current => {
      const next = new Set(current)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return <div data-testid="live-map-page" className="atlas-workspace">
    <section className="map-stage" aria-label="Live incident atlas">
      {!loaded && <div className="map-loading"><ScanLine /><span>Preparing the safety map</span><i /></div>}
      <MapCanvas initialViewState={initialViewport} onMapLoad={() => setLoaded(true)} onBoundsChange={onBoundsChange} cameraCommand={cameraCommand}>
        {showRadii && <RadiusZoneLayer events={visible} />}
        <EventClusterLayer events={visible} onEventClick={selectEvent} onClusterClick={focusCluster} selectedEventId={selected?.id} />
        {location && <LocationMarker location={location} />}
        {searchResult && <SearchResultMarker result={searchResult} />}
      </MapCanvas>

      <MapSearch
        key={searchSeed.id}
        initialQuery={searchSeed.query}
        proximity={viewport ? {
          lat: Number(((viewport.bounds.north + viewport.bounds.south) / 2).toFixed(2)),
          lng: Number(((viewport.bounds.east + viewport.bounds.west) / 2).toFixed(2)),
        } : undefined}
        onSelect={selectSearchResult}
        onClear={() => setSearchResult(null)}
      />

      <div className="map-instrument" aria-label="Viewport status">
        <div className="instrument-brand"><Radio size={15} /><span>MAP / {viewport ? `${viewport.zoom.toFixed(1)}Z` : 'SYNC'}</span></div>
        <div><strong>{visible.length}</strong><span>IN AREA</span></div>
        <div><strong>{confirmed}</strong><span>CONFIRMED</span></div>
        <div className="feed-live"><i /><span>LIVE UPDATES</span></div>
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
      {eventParam && !selected && <div className="map-selection-status" role="status" aria-live="polite">Alert {eventParam} is not currently available. It will open if it arrives in the live feed.</div>}
      <FieldLedger events={visible} selected={selected} onSelect={selectEvent} mobile={layout === 'mobile'} />
    </section>
  </div>
}
