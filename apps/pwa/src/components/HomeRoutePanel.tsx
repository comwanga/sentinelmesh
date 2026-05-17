import { useState, useCallback, useEffect, useRef } from 'react'
import { useAppSelector, useAppDispatch } from '../store'
import { setHomeLocation, clearHomeLocation, homeRouteSet, homeRouteCleared } from '../store/uiSlice'
import { geocodeAddress, type GeocodeSuggestion } from '../services/geocodingService'
import { fetchRouteToHome } from '../services/routingService'
import { useCurrentLocation } from '../hooks/useCurrentLocation'

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string
const HOME_KEY = 'sentinel_home_location'

interface Props {
  onClose: () => void
}

export function HomeRoutePanel({ onClose }: Props) {
  const dispatch = useAppDispatch()
  const homeLocation = useAppSelector(s => s.ui.homeLocation)
  const homeRoute = useAppSelector(s => s.ui.homeRoute)
  const events = useAppSelector(s => s.events.items)
  const { location } = useCurrentLocation()

  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([])
  const [searching, setSearching] = useState(false)
  const [routing, setRouting] = useState(false)
  const [routeError, setRouteError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced autocomplete — fires 400ms after user stops typing
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = query.trim()
    if (trimmed.length < 2) { setSuggestions([]); return }
    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      const results = await geocodeAddress(trimmed, TOKEN, location ?? undefined)
      setSuggestions(results)
      setSearching(false)
    }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, location])

  const handleSelectHome = useCallback((s: GeocodeSuggestion) => {
    const home = { lat: s.lat, lng: s.lng, label: s.label }
    dispatch(setHomeLocation(home))
    localStorage.setItem(HOME_KEY, JSON.stringify(home))
    setSuggestions([])
    setQuery('')
    dispatch(homeRouteCleared())
    setRouteError(null)
  }, [dispatch])

  const handleClearHome = useCallback(() => {
    dispatch(clearHomeLocation())
    dispatch(homeRouteCleared())
    localStorage.removeItem(HOME_KEY)
    setRouteError(null)
  }, [dispatch])

  const handleGetRoute = useCallback(async () => {
    if (!homeLocation || !location) return
    setRouting(true)
    setRouteError(null)
    dispatch(homeRouteCleared())
    const dangerZones = events
      .filter(e => e.is_active)
      .map(e => ({ lat: e.lat, lng: e.lng, radiusKm: ((e as any).radius_meters ?? 400) / 1000 }))
    const route = await fetchRouteToHome(
      { lat: location.lat, lng: location.lng },
      { lat: homeLocation.lat, lng: homeLocation.lng },
      dangerZones,
      TOKEN,
    )
    setRouting(false)
    if (!route) {
      setRouteError('Could not fetch route — check your connection.')
      return
    }
    dispatch(homeRouteSet(route))
  }, [homeLocation, location, events, dispatch])

  const route = homeRoute

  return (
    <div style={{
      background: '#0d1118', border: '1px solid #1a2035', borderRadius: 10,
      padding: 16, width: 300, maxWidth: '100%',
      fontFamily: "'Courier New', monospace",
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 11, letterSpacing: '0.12em', color: '#00E5FF', fontWeight: 700 }}>
          NAVIGATE HOME
        </span>
        <button
          onClick={() => { onClose(); dispatch(homeRouteCleared()) }}
          style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#4a5568', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}
        >
          ×
        </button>
      </div>

      {/* Saved home */}
      {homeLocation ? (
        <div style={{ background: '#050709', border: '1px solid rgba(0,229,255,0.2)', borderRadius: 6, padding: '8px 10px', marginBottom: 12 }}>
          <div style={{ fontSize: 9, color: '#4a5568', letterSpacing: '0.08em', marginBottom: 4 }}>SAVED HOME</div>
          <div style={{ fontSize: 10, color: '#e2e8f0', lineHeight: 1.4, marginBottom: 6 }}>
            {homeLocation.label}
          </div>
          <button
            onClick={handleClearHome}
            style={{ fontSize: 9, color: '#FF6B6B', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            ✕ Clear
          </button>
        </div>
      ) : (
        <div style={{ fontSize: 9, color: '#4a5568', marginBottom: 10 }}>
          No home saved. Search below to set your home location.
        </div>
      )}

      {/* Address search */}
      <div style={{ fontSize: 9, color: '#4a5568', letterSpacing: '0.06em', marginBottom: 5 }}>
        SET HOME ADDRESS
      </div>
      <div style={{ position: 'relative', marginBottom: 6 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); setSuggestions([]) } }}
          placeholder="Type a place or road name…"
          autoComplete="off"
          style={{
            width: '100%', boxSizing: 'border-box',
            background: '#050709', border: '1px solid #1a2035', borderRadius: 4,
            color: '#e2e8f0', fontSize: 10, padding: '6px 28px 6px 8px', outline: 'none',
          }}
        />
        {searching && (
          <span style={{
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            fontSize: 10, color: '#4a5568',
          }}>…</span>
        )}
      </div>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div style={{ marginBottom: 12, border: '1px solid #1a2035', borderRadius: 6, overflow: 'hidden' }}>
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => handleSelectHome(s)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                background: '#050709', border: 'none', borderBottom: i < suggestions.length - 1 ? '1px solid #1a2035' : 'none',
                color: '#e2e8f0', fontSize: 10, padding: '7px 10px', cursor: 'pointer',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#0d1118')}
              onMouseLeave={e => (e.currentTarget.style.background = '#050709')}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* Get Route button */}
      {homeLocation && (
        <button
          onClick={handleGetRoute}
          disabled={routing || !location}
          style={{
            width: '100%', padding: '9px 0', marginBottom: 10,
            background: routing ? '#050709' : 'rgba(0,229,255,0.1)',
            border: `1px solid ${routing ? '#1a2035' : 'rgba(0,229,255,0.4)'}`,
            borderRadius: 6, color: routing ? '#4a5568' : '#00E5FF',
            fontSize: 11, letterSpacing: '0.06em', cursor: routing ? 'default' : 'pointer',
          }}
        >
          {routing ? 'Calculating…' : !location ? 'Enable GPS first' : 'Get Route Home'}
        </button>
      )}

      {routeError && (
        <div style={{ fontSize: 9, color: '#FF2D2D', marginBottom: 8 }}>{routeError}</div>
      )}

      {/* Route info */}
      {route && (
        <div style={{ background: '#050709', border: '1px solid #1a2035', borderRadius: 6, padding: '10px 12px' }}>
          <div style={{ display: 'flex', gap: 16, marginBottom: route.warnings.length ? 8 : 0 }}>
            <div>
              <div style={{ fontSize: 9, color: '#4a5568', marginBottom: 2 }}>DISTANCE</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#00E5FF' }}>{route.distanceKm} km</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: '#4a5568', marginBottom: 2 }}>WALKING</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{route.durationMin} min</div>
            </div>
          </div>
          {route.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 9, color: '#FF9800', display: 'flex', gap: 4, marginTop: 4 }}>
              <span>⚠</span><span>{w}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
