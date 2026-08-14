import { useCallback, useEffect, useRef, useState } from 'react'
import { Crosshair, Home, Layers3, LocateFixed, Radio, ScanLine } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import type { EventType, SafetyEvent } from '../../../../shared/types'
import { useBreakpoint } from '../hooks/useBreakpoint'
import { useCurrentLocation } from '../hooks/useCurrentLocation'
import { useInitialViewport } from '../hooks/useInitialViewport'
import { useViewportWs, type ViewportBounds } from '../hooks/useViewportWs'
import { useAppDispatch, useAppSelector } from '../store'
import { selectEventItems, selectViewportEventItems } from '../store/eventsSlice'
import { EventClusterLayer } from '../components/map/EventClusterLayer'
import { FieldLedger } from '../components/map/FieldLedger'
import { LocationMarker } from '../components/map/LocationMarker'
import { MapCanvas, type CameraCommand } from '../components/map/MapCanvas'
import { MapSearch } from '../components/map/MapSearch'
import { RadiusZoneLayer } from '../components/map/RadiusZoneLayer'
import { SearchResultMarker } from '../components/map/SearchResultMarker'
import type { GeocodeSuggestion } from '../services/mapApiService'
import { HomeRoutePanel } from '../components/HomeRoutePanel'
import { HomeLocationMarker } from '../components/map/HomeLocationMarker'
import { HomeRouteLayer } from '../components/map/HomeRouteLayer'
import { loadHomeLocation } from '../services/homeLocationStore'
import { homeRoutesCleared, setHomeLocation, type HomeRoute } from '../store/uiSlice'

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
  const dispatch = useAppDispatch()
  const [loaded, setLoaded] = useState(false)
  const [viewport, setViewport] = useState<{ bounds: ViewportBounds; zoom: number } | null>(null)
  const [filters, setFilters] = useState<Set<FilterId>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchResult, setSearchResult] = useState<GeocodeSuggestion | null>(null)
  const [cameraCommand, setCameraCommand] = useState<CameraCommand | null>(null)
  const [showRadii, setShowRadii] = useState(true)
  const [showHome, setShowHome] = useState(false)
  const [gpsAnnouncement, setGpsAnnouncement] = useState('Location is off.')
  const [searchParams, setSearchParams] = useSearchParams()
  const [searchSeed, setSearchSeed] = useState(() => ({ id: 0, query: searchParams.get('q') ?? '' }))
  const cameraSequence = useRef(0)
  const deepLinkFocused = useRef<string | null>(null)
  const initialViewport = useInitialViewport()
  const { location, status: locationStatus = 'idle', error: locationError, startFollowing = () => undefined, stopFollowing = () => undefined, disable = () => undefined } = useCurrentLocation()
  const homeLocation = useAppSelector(state => state.ui.homeLocation)
  const events = useAppSelector(selectViewportEventItems).filter(event => event.is_active)
  const allEvents = useAppSelector(selectEventItems)
  useViewportWs(viewport?.bounds ?? null, viewport?.zoom ?? 12)
  const onBoundsChange = useCallback((bounds: ViewportBounds, zoom: number) => setViewport({ bounds, zoom }), [])

  useEffect(() => {
    let active = true
    loadHomeLocation().then(home => { if (active && home) dispatch(setHomeLocation(home)) })
    return () => { active = false }
  }, [dispatch])

  useEffect(() => {
    if (!location || locationStatus !== 'following') return
    setCameraCommand({ id: ++cameraSequence.current, center: [location.lng, location.lat], zoom: 15, padding: cameraPadding })
  }, [location, locationStatus, layout])

  useEffect(() => {
    const messages = {
      idle: 'Location is off.',
      requesting: 'Requesting high accuracy location.',
      following: 'Location acquired. Map is following your position.',
      'located-not-following': 'Map follow paused after map interaction.',
      denied: 'Location permission was denied.',
      unavailable: 'Location is unavailable.',
    }
    setGpsAnnouncement(messages[locationStatus])
  }, [locationStatus])

  const activeTypes = new Set([...filters].flatMap(id => FILTERS.find(filter => filter.id === id)?.types ?? []))
  const visible = filters.size ? events.filter(event => activeTypes.has(event.event_type)) : events
  const confirmed = visible.filter(event => event.trust_state === 'confirmed').length
  const selected = selectedId ? allEvents.find(event => event.id === selectedId) ?? null : null
  const eventParam = searchParams.get('event')
  const cameraPadding = layout === 'mobile'
    ? { top: 180, right: 24, bottom: 140, left: 24 }
    : { top: 150, right: 400, bottom: 60, left: 40 }
  const mapSearchProximity = viewport ? {
    lat: Number(((viewport.bounds.north + viewport.bounds.south) / 2).toFixed(2)),
    lng: Number(((viewport.bounds.east + viewport.bounds.west) / 2).toFixed(2)),
  } : undefined

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

  function activateLocation() {
    if (locationStatus === 'following' || locationStatus === 'requesting') disable()
    else startFollowing()
  }

  function fitRoutePreview(routes: HomeRoute[], selectedIndex: number) {
    const route = routes[selectedIndex]
    if (!route || !location || !homeLocation) return
    const points = [...route.coordinates, [location.lng, location.lat] as [number, number], [homeLocation.lng, homeLocation.lat] as [number, number]]
    const lngs = points.map(point => point[0])
    const lats = points.map(point => point[1])
    const west = Math.min(...lngs)
    const east = Math.max(...lngs)
    const south = Math.min(...lats)
    const north = Math.max(...lats)
    setCameraCommand({
      id: ++cameraSequence.current,
      bounds: [west - (west === east ? 0.001 : 0), south - (south === north ? 0.001 : 0), east + (west === east ? 0.001 : 0), north + (south === north ? 0.001 : 0)],
      padding: cameraPadding,
    })
  }

  return <div data-testid="live-map-page" className="atlas-workspace">
    <section className="map-stage" aria-label="Live incident atlas">
      {!loaded && <div className="map-loading"><ScanLine /><span>Preparing the safety map</span><i /></div>}
      <MapCanvas initialViewState={initialViewport} onMapLoad={() => setLoaded(true)} onBoundsChange={onBoundsChange} cameraCommand={cameraCommand} onUserInteraction={stopFollowing}>
        {showRadii && <RadiusZoneLayer events={visible} />}
        <EventClusterLayer events={visible} onEventClick={selectEvent} onClusterClick={focusCluster} selectedEventId={selected?.id} />
        {location && <LocationMarker location={location} />}
        {homeLocation && <HomeLocationMarker home={homeLocation} />}
        <HomeRouteLayer />
        {searchResult && <SearchResultMarker result={searchResult} />}
      </MapCanvas>

      <MapSearch
        key={searchSeed.id}
        initialQuery={searchSeed.query}
        proximity={mapSearchProximity}
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
        <button className={locationStatus === 'following' ? 'active' : ''} onClick={activateLocation} aria-pressed={locationStatus === 'following'} aria-label={locationStatus === 'requesting' ? 'Cancel location request' : locationStatus === 'following' ? 'Disable location' : location ? 'Recenter and follow current location' : 'Enable current location'} title={locationStatus === 'requesting' ? 'Cancel location request' : locationStatus === 'following' ? 'Disable location' : 'Recenter and follow'}><LocateFixed /></button>
        <button className={showHome ? 'active' : ''} onClick={() => setShowHome(value => !value)} aria-expanded={showHome} aria-label="Set home and preview route" title="Home route preview"><Home /></button>
      </div>

      <div className="map-legend"><span><i className="confirmed" />Confirmed</span><span><i className="developing" />Developing evidence</span><span><Crosshair size={13} />Approximate impact zone</span></div>
      {locationError && <div className="geo-note">Location is optional. {typeof locationError === 'string' ? locationError : String(locationError)} The atlas remains fully browsable.</div>}
      <div className="sr-only" aria-live="polite">{gpsAnnouncement}</div>
      {showHome && <div className="home-route-host"><HomeRoutePanel location={location} locationStatus={locationStatus} searchProximity={mapSearchProximity} onRoutePreview={fitRoutePreview} onClose={() => { setShowHome(false); dispatch(homeRoutesCleared()) }} /></div>}
      {eventParam && !selected && <div className="map-selection-status" role="status" aria-live="polite">Alert {eventParam} is not currently available. It will open if it arrives in the live feed.</div>}
      <FieldLedger events={visible} selected={selected} onSelect={selectEvent} mobile={layout === 'mobile'} />
    </section>
  </div>
}
