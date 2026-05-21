import { useState, useCallback, useEffect, useRef } from 'react'
import { useAppSelector, useAppDispatch } from '../store'
import {
  setHomeLocation,
  clearHomeLocation,
  homeRoutesSet,
  homeRoutesCleared,
  homeRouteSelect,
  type TravelMode,
} from '../store/uiSlice'
import { geocodeAddress, type GeocodeSuggestion } from '../services/geocodingService'
import { fetchRouteToHome } from '../services/routingService'
import { useCurrentLocation } from '../hooks/useCurrentLocation'

const HOME_KEY = 'sentinel_home_location'

const MODES: { id: TravelMode; label: string }[] = [
  { id: 'walking', label: 'WALK' },
  { id: 'driving', label: 'DRIVE' },
  { id: 'transit', label: 'TRANSIT' },
]

const MODE_DURATION_LABEL: Record<TravelMode, string> = {
  walking: 'WALKING',
  driving: 'DRIVING',
  transit: 'TRANSIT',
}

interface Props {
  onClose: () => void
}

export function HomeRoutePanel({ onClose }: Props) {
  const dispatch = useAppDispatch()
  const homeLocation = useAppSelector(s => s.ui.homeLocation)
  const homeRoutes = useAppSelector(s => s.ui.homeRoutes)
  const rawEvents = useAppSelector(s => (s as any).events?.items ?? [])
  const { location } = useCurrentLocation()

  // Keep events in a ref so doFetch always reads latest without re-creating callback
  const eventsRef = useRef(rawEvents)
  eventsRef.current = rawEvents

  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([])
  const [searching, setSearching] = useState(false)
  const [routing, setRouting] = useState(false)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [mode, setMode] = useState<TravelMode>('walking')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced autocomplete
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = query.trim()
    if (trimmed.length < 2) { setSuggestions([]); return }
    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      const results = await geocodeAddress(trimmed, location ?? undefined)
      setSuggestions(results)
      setSearching(false)
    }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, location])

  // Clear stale routes when mode changes
  useEffect(() => {
    if (homeRoutes.length > 0) {
      dispatch(homeRoutesCleared())
      setSelectedIdx(0)
    }
  // only re-run when mode changes, not on every homeRoutes update
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, dispatch])

  const handleSelectHome = useCallback((s: GeocodeSuggestion) => {
    const home = { lat: s.lat, lng: s.lng, label: s.label }
    dispatch(setHomeLocation(home))
    localStorage.setItem(HOME_KEY, JSON.stringify(home))
    setSuggestions([])
    setQuery('')
    dispatch(homeRoutesCleared())
    setRouteError(null)
    setSelectedIdx(0)
  }, [dispatch])

  const handleClearHome = useCallback(() => {
    dispatch(clearHomeLocation())
    dispatch(homeRoutesCleared())
    localStorage.removeItem(HOME_KEY)
    setRouteError(null)
    setSelectedIdx(0)
  }, [dispatch])

  const doFetch = useCallback(async () => {
    if (!homeLocation || !location) return
    setRouting(true)
    setRouteError(null)
    dispatch(homeRoutesCleared())
    setSelectedIdx(0)
    const dangerZones = (eventsRef.current as any[])
      .filter((e: any) => e.is_active)
      .map((e: any) => ({ lat: e.lat, lng: e.lng, radiusKm: (e.radius_meters ?? 400) / 1000 }))
    const routes = await fetchRouteToHome(
      { lat: location.lat, lng: location.lng },
      { lat: homeLocation.lat, lng: homeLocation.lng },
      dangerZones,
      mode,
    )
    setRouting(false)
    if (!routes.length) {
      setRouteError('Could not calculate route. Check your connection.')
      return
    }
    dispatch(homeRoutesSet(routes))
  }, [homeLocation, location, mode, dispatch])

  const handleSelectRoute = useCallback((idx: number) => {
    setSelectedIdx(idx)
    dispatch(homeRouteSelect(idx))
  }, [dispatch])

  const activeRoute = homeRoutes[selectedIdx] ?? null

  const labelStyle: React.CSSProperties = { fontSize: 9, color: '#4a5568', letterSpacing: '0.06em', marginBottom: 5 }

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
          onClick={() => { onClose(); dispatch(homeRoutesCleared()) }}
          style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#4a5568', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}
        >
          ×
        </button>
      </div>

      {/* Saved home */}
      {homeLocation ? (
        <div style={{ background: '#050709', border: '1px solid rgba(0,229,255,0.2)', borderRadius: 6, padding: '8px 10px', marginBottom: 12 }}>
          <div style={{ fontSize: 9, color: '#4a5568', letterSpacing: '0.08em', marginBottom: 4 }}>SAVED HOME</div>
          <div style={{ fontSize: 10, color: '#e2e8f0', lineHeight: 1.4, marginBottom: 6 }}>{homeLocation.label}</div>
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
      <div style={labelStyle}>SET HOME ADDRESS</div>
      <div style={{ position: 'relative', marginBottom: 6 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); setSuggestions([]) } }}
          placeholder="Type any address or place worldwide…"
          autoComplete="off"
          style={{
            width: '100%', boxSizing: 'border-box',
            background: '#050709', border: '1px solid #1a2035', borderRadius: 4,
            color: '#e2e8f0', fontSize: 10, padding: '6px 28px 6px 8px', outline: 'none',
          }}
        />
        {searching && (
          <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: '#4a5568' }}>…</span>
        )}
      </div>

      {/* Autocomplete suggestions */}
      {suggestions.length > 0 && (
        <div style={{ marginBottom: 12, border: '1px solid #1a2035', borderRadius: 6, overflow: 'hidden' }}>
          {suggestions.map((sg, i) => (
            <button
              key={i}
              onClick={() => handleSelectHome(sg)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                background: '#050709', border: 'none',
                borderBottom: i < suggestions.length - 1 ? '1px solid #1a2035' : 'none',
                color: '#e2e8f0', fontSize: 10, padding: '7px 10px', cursor: 'pointer',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#0d1118')}
              onMouseLeave={e => (e.currentTarget.style.background = '#050709')}
            >
              {sg.label}
            </button>
          ))}
        </div>
      )}

      {/* Travel mode + route button only visible once home is saved */}
      {homeLocation && (
        <>
          <div style={{ ...labelStyle, marginTop: 4 }}>TRAVEL MODE</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {MODES.map(m => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                style={{
                  flex: 1, padding: '5px 0', fontSize: 9, letterSpacing: '0.06em',
                  cursor: 'pointer', borderRadius: 4,
                  background: mode === m.id ? 'rgba(0,229,255,0.12)' : '#050709',
                  border: `1px solid ${mode === m.id ? 'rgba(0,229,255,0.5)' : '#1a2035'}`,
                  color: mode === m.id ? '#00E5FF' : '#4a5568',
                }}
              >
                {m.label}
              </button>
            ))}
          </div>

          {mode === 'transit' && (
            <div style={{
              fontSize: 9, color: '#FF9800', background: '#0d1118',
              border: '1px solid rgba(255,152,0,0.2)', borderRadius: 4,
              padding: '6px 8px', marginBottom: 8, lineHeight: 1.5,
            }}>
              Live transit routing requires GTFS feed data.
              Showing driving estimate — verify with a local transit app.
            </div>
          )}

          <button
            onClick={doFetch}
            disabled={routing || !location}
            style={{
              width: '100%', padding: '9px 0', marginBottom: 10,
              background: routing ? '#050709' : 'rgba(0,229,255,0.1)',
              border: `1px solid ${routing ? '#1a2035' : 'rgba(0,229,255,0.4)'}`,
              borderRadius: 6,
              color: routing ? '#4a5568' : '#00E5FF',
              fontSize: 11, letterSpacing: '0.06em', cursor: routing ? 'default' : 'pointer',
            }}
          >
            {routing ? 'Calculating…' : !location ? 'Enable GPS first' : 'Get Route Home'}
          </button>
        </>
      )}

      {routeError && (
        <div style={{ fontSize: 9, color: '#FF2D2D', marginBottom: 8 }}>{routeError}</div>
      )}

      {/* Route alternatives */}
      {homeRoutes.length > 0 && (
        <div>
          <div style={labelStyle}>ROUTES</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {homeRoutes.map((r, i) => (
              <button
                key={i}
                onClick={() => handleSelectRoute(i)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  textAlign: 'left', cursor: 'pointer', borderRadius: 6, padding: '8px 10px',
                  background: i === selectedIdx ? 'rgba(0,229,255,0.08)' : '#050709',
                  border: `1px solid ${i === selectedIdx ? 'rgba(0,229,255,0.35)' : '#1a2035'}`,
                }}
              >
                <div style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: i === selectedIdx ? '#00E5FF' : 'transparent',
                  border: `1.5px solid ${i === selectedIdx ? '#00E5FF' : '#2a3a55'}`,
                }} />
                <span style={{ fontSize: 9, color: i === selectedIdx ? '#e2e8f0' : '#4a6080', flex: 1 }}>
                  {r.label}
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, color: i === selectedIdx ? '#00E5FF' : '#4a6080' }}>
                  {r.distanceKm} km
                </span>
                <span style={{ fontSize: 9, color: '#4a5568', minWidth: 36, textAlign: 'right' }}>
                  {r.durationMin} min
                </span>
              </button>
            ))}
          </div>

          {/* Selected route detail + warnings */}
          {activeRoute && (
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', gap: 12, padding: '6px 10px', background: '#050709', border: '1px solid #1a2035', borderRadius: 6 }}>
                <div>
                  <div style={{ fontSize: 9, color: '#4a5568', marginBottom: 2 }}>DISTANCE</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#00E5FF' }}>{activeRoute.distanceKm} km</div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: '#4a5568', marginBottom: 2 }}>{MODE_DURATION_LABEL[activeRoute.mode]}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{activeRoute.durationMin} min</div>
                </div>
              </div>
              {activeRoute.warnings.map((w, wi) => (
                <div key={wi} style={{ fontSize: 9, color: '#FF9800', display: 'flex', gap: 4, marginTop: 4 }}>
                  <span>⚠</span><span>{w}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
