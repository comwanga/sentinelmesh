import { useEffect, useRef, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../store'
import {
  clearHomeLocation as clearHomeState,
  homeRouteSelect,
  homeRoutesCleared,
  homeRoutesSet,
  setHomeLocation,
  type HomeRoute,
  type TravelMode,
} from '../store/uiSlice'
import { geocodeAddress, type GeocodeSuggestion } from '../services/geocodingService'
import { clearHomeLocation, saveHomeLocation } from '../services/homeLocationStore'
import { fetchRouteToHome } from '../services/routingService'
import type { CurrentLocation, LocationStatus } from '../hooks/useCurrentLocation'
import type { LatLng } from '../utils/geo'

const MODES: { id: TravelMode; label: string }[] = [
  { id: 'walking', label: 'Walking' },
  { id: 'driving', label: 'Driving' },
  { id: 'cycling', label: 'Cycling' },
]

interface Props {
  location: CurrentLocation | null
  locationStatus: LocationStatus
  searchProximity?: LatLng
  onClose: () => void
  onRoutePreview?: (routes: HomeRoute[], selectedIndex: number) => void
}

export function HomeRoutePanel({ location, locationStatus, searchProximity, onClose, onRoutePreview }: Props) {
  const dispatch = useAppDispatch()
  const home = useAppSelector(state => state.ui.homeLocation)
  const routes = useAppSelector(state => state.ui.homeRoutes)
  const events = useAppSelector(state => state.events.items)
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([])
  const [pendingHome, setPendingHome] = useState<GeocodeSuggestion | null>(null)
  const [mode, setMode] = useState<TravelMode>('walking')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [state, setState] = useState<'idle' | 'searching' | 'saving' | 'routing'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchAbort = useRef<AbortController | null>(null)
  const searchSequence = useRef(0)

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    searchAbort.current?.abort()
    const sequence = ++searchSequence.current
    const value = query.trim()
    if (value.length < 2) {
      setSuggestions([])
      setState('idle')
      return
    }
    setState('searching')
    debounce.current = setTimeout(async () => {
      const controller = new AbortController()
      searchAbort.current = controller
      try {
        const results = await geocodeAddress(value, searchProximity, controller.signal)
        if (sequence !== searchSequence.current) return
        setSuggestions(results)
        setMessage(null)
      } catch (error) {
        if (controller.signal.aborted || Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')) return
        if (sequence !== searchSequence.current) return
        setSuggestions([])
        setMessage('Home search is unavailable. Try again.')
      } finally {
        if (sequence === searchSequence.current) setState('idle')
      }
    }, 400)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
      searchAbort.current?.abort()
      if (searchSequence.current === sequence) searchSequence.current++
    }
  }, [query, searchProximity?.lat, searchProximity?.lng])

  function chooseSuggestion(suggestion: GeocodeSuggestion) {
    setPendingHome(suggestion)
    setSuggestions([])
    setQuery('')
    setMessage(null)
  }

  async function confirmHome() {
    if (!pendingHome) return
    const next = { lat: pendingHome.lat, lng: pendingHome.lng, label: pendingHome.label }
    setState('saving')
    try {
      await saveHomeLocation(next)
      dispatch(setHomeLocation(next))
      dispatch(homeRoutesCleared())
      setPendingHome(null)
      setMessage('Home saved, encrypted and stored only on this device.')
    } catch {
      setMessage('Home could not be saved on this device. Check private browsing or storage settings.')
    } finally {
      setState('idle')
    }
  }

  async function clearSavedHome() {
    try {
      await clearHomeLocation()
      dispatch(clearHomeState())
      dispatch(homeRoutesCleared())
      setPendingHome(null)
      setMessage('Saved home cleared from this device.')
    } catch {
      setMessage('Saved home could not be cleared. Try again.')
    }
  }

  async function requestRoute() {
    if (!home || !location) return
    setState('routing')
    setMessage(null)
    dispatch(homeRoutesCleared())
    setSelectedIndex(0)
    try {
      const dangerZones = events.filter(event => event.is_active).map(event => ({
        lat: event.lat,
        lng: event.lng,
        radiusKm: (Number((event as unknown as Record<string, unknown>).radius_meters) || 400) / 1000,
      }))
      const next = await fetchRouteToHome(location, home, dangerZones, mode)
      if (!next.length) {
        setMessage('No route preview is available for this trip.')
        return
      }
      dispatch(homeRoutesSet(next))
      onRoutePreview?.(next, 0)
      setMessage(`${next.length} route preview${next.length === 1 ? '' : 's'} loaded.`)
    } catch {
      setMessage('Route preview provider could not be reached. Check your connection and try again.')
    } finally {
      setState('idle')
    }
  }

  function selectRoute(index: number) {
    setSelectedIndex(index)
    dispatch(homeRouteSelect(index))
    onRoutePreview?.(routes, index)
    setMessage(`Route preview ${index + 1} selected.`)
  }

  const controlStyle: React.CSSProperties = { minHeight: 44, borderRadius: 8, cursor: 'pointer' }

  return <aside className="home-route-panel" aria-label="Home route preview">
    <header><strong>Route preview home</strong><button style={controlStyle} onClick={onClose} aria-label="Close home route preview">Close</button></header>
    <p className="home-privacy">Your exact home is encrypted and stored only on this device.</p>

    {home && <div className="home-saved"><small>SAVED HOME</small><span>{home.label}</span><button style={controlStyle} onClick={clearSavedHome}>Clear saved home</button></div>}

    <label htmlFor="home-search">{home ? 'Change home' : 'Set home'}</label>
    <input id="home-search" style={{ minHeight: 44 }} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search address or place" autoComplete="off" />
    {state === 'searching' && <p role="status">Searching...</p>}
    {suggestions.length > 0 && <div className="home-suggestions" role="listbox" aria-label="Home search results">
      {suggestions.map(suggestion => <button style={controlStyle} role="option" aria-selected="false" key={suggestion.id} onClick={() => chooseSuggestion(suggestion)}>{suggestion.label}</button>)}
    </div>}

    {pendingHome && <div className="home-confirm">
      <p>Save <strong>{pendingHome.label}</strong> as home?</p>
      <button style={controlStyle} disabled={state === 'saving'} onClick={confirmHome}>Confirm and save on this device</button>
      <button style={controlStyle} onClick={() => setPendingHome(null)}>Cancel</button>
    </div>}

    {home && <>
      <fieldset><legend>Travel mode</legend>{MODES.map(item => <button style={controlStyle} key={item.id} aria-pressed={mode === item.id} onClick={() => { setMode(item.id); dispatch(homeRoutesCleared()) }}>{item.label}</button>)}</fieldset>
      <button className="route-request" style={controlStyle} disabled={!location || state === 'routing'} onClick={requestRoute}>
        {state === 'routing' ? 'Loading route preview...' : location ? 'Request route preview' : locationStatus === 'requesting' ? 'Waiting for GPS...' : 'Enable GPS to preview route'}
      </button>
    </>}

    {routes.length > 0 && <div className="route-alternatives"><strong>Alternatives</strong>{routes.map((route, index) => <button style={controlStyle} aria-pressed={index === selectedIndex} key={route.id} onClick={() => selectRoute(index)}>
      <span>{route.label}</span><span>{route.distanceKm} km, {route.durationMin} min</span>
      {route.alertIntersections > 0 && <small>Route intersects an alert area</small>}
    </button>)}</div>}
    {message && <p role="status" aria-live="polite">{message}</p>}
    <div className="sr-only" role="status" aria-live="polite">GPS status: {locationStatus}</div>
  </aside>
}
