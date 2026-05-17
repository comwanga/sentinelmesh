import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBreakpoint } from '../hooks/useBreakpoint'
import { useNearestThreat } from '../hooks/useNearestThreat'
import { useCurrentLocation } from '../hooks/useCurrentLocation'
import { useAppSelector, useAppDispatch } from '../store'
import { setOverlayIntent } from '../store/uiSlice'
import { selectMapStats, selectEventItems } from '../store/eventsSlice'
import { Marker } from 'react-map-gl'
import EventMarker from '../components/EventMarker'
import { MapCanvas } from '../components/map/MapCanvas'
import { MapStatsBar } from '../components/map/MapStatsBar'
import { MapFeatureStrip } from '../components/map/MapFeatureStrip'
import { AlertsDock } from '../components/map/AlertsDock'
import { AlertsSheet } from '../components/map/AlertsSheet'
import { MapOverlayHost } from '../components/map/MapOverlayHost'
import { LocationMarker } from '../components/map/LocationMarker'
import { HomeRouteLayer } from '../components/map/HomeRouteLayer'
import { SafeRouteOverlay } from '../components/SafeRouteOverlay'
import type { EventType } from '../../../../shared/types'

type FilterId = 'gunshots' | 'violence' | 'protests' | 'accidents' | 'other'

const FILTER_DEFS: { id: FilterId; label: string; color: string; types: EventType[] }[] = [
  { id: 'gunshots',  label: 'Gunshots',  color: '#FF2D2D', types: ['SECURITY_INCIDENT'] },
  { id: 'violence',  label: 'Violence',  color: '#FF9800', types: ['CIVIL_UNREST'] },
  { id: 'protests',  label: 'Protests',  color: '#9C27B0', types: ['CIVIL_UNREST'] },
  { id: 'accidents', label: 'Accidents', color: '#2196F3', types: ['TRAFFIC_INCIDENT'] },
  { id: 'other',     label: 'Other',     color: '#607D8B', types: ['FLOOD', 'FIRE', 'MEDICAL_EMERGENCY', 'INFRASTRUCTURE_FAILURE', 'FALSE_ALARM'] },
]

export function LiveMapPage() {
  const [mapLoaded, setMapLoaded] = useState(false)
  const [activeFilters, setActiveFilters] = useState<Set<FilterId>>(new Set())
  const handleMapLoad = useCallback(() => setMapLoaded(true), [])
  const { layout } = useBreakpoint()
  const { nearest: nearestThreat, distanceKm, geoError } = useNearestThreat()
  const { location: currentLocation } = useCurrentLocation()
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const { activeAlerts, verified, verifiedPct, communityScore, sources } = useAppSelector(selectMapStats)
  const events = useAppSelector(selectEventItems)

  function toggleFilter(id: FilterId) {
    setActiveFilters(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const visibleEvents = activeFilters.size === 0
    ? events
    : (() => {
        const activeTypes = new Set(
          [...activeFilters].flatMap(id => FILTER_DEFS.find(f => f.id === id)?.types ?? [])
        )
        return events.filter(e => activeTypes.has(e.event_type))
      })()

  const distanceLabel = distanceKm != null
    ? distanceKm < 1
      ? `${Math.round(distanceKm * 1000)} m away`
      : `${distanceKm.toFixed(1)} km away`
    : null

  return (
    <div data-testid="live-map-page" style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <MapStatsBar
        activeAlerts={activeAlerts}
        verified={verified}
        verifiedPct={verifiedPct}
        communityScore={communityScore}
        sources={sources}
      />

      {/* Main row: map area + alerts dock */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Map column */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

          {/* Loading veil */}
          {!mapLoaded && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 20,
              background: '#0B0E14',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: "'Courier New', monospace", color: '#4a5568', fontSize: 13,
            }}>
              Loading map…
            </div>
          )}

          <MapCanvas onMapLoad={handleMapLoad}>
            {visibleEvents.filter(e => e.is_active).map(event => (
              <Marker key={event.id} longitude={event.lng} latitude={event.lat} anchor="center">
                <EventMarker event={event} onClick={() => {}} />
              </Marker>
            ))}
            {currentLocation && <LocationMarker location={currentLocation} />}
            <SafeRouteOverlay />
            <HomeRouteLayer />
          </MapCanvas>

          {/* Filter chips — overlaid on map top-left */}
          <div style={{
            position: 'absolute', top: 12, left: 12, zIndex: 10,
            display: 'flex', flexWrap: 'wrap', gap: 6,
          }}>
            {FILTER_DEFS.map(f => {
              const active = activeFilters.has(f.id)
              return (
                <button
                  key={f.id}
                  onClick={() => toggleFilter(f.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '4px 10px', borderRadius: 20,
                    background: active ? f.color : 'rgba(11,14,20,0.82)',
                    border: `1px solid ${active ? f.color : 'rgba(255,255,255,0.12)'}`,
                    color: active ? '#fff' : '#94a3b8',
                    fontFamily: "'Courier New', monospace", fontSize: 11,
                    cursor: 'pointer',
                    backdropFilter: 'blur(6px)',
                    transition: 'all 150ms ease',
                  }}
                >
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: f.color, flexShrink: 0,
                    boxShadow: active ? `0 0 6px ${f.color}` : 'none',
                  }} />
                  {f.label}
                </button>
              )
            })}
          </div>

          {/* Near You callout — overlaid on map top-right */}
          {nearestThreat && distanceLabel && (
            <div style={{
              position: 'absolute', top: 12, right: 12, zIndex: 10,
              background: 'rgba(11,14,20,0.88)',
              border: '1px solid rgba(255,45,45,0.5)',
              borderRadius: 8, padding: '8px 12px',
              backdropFilter: 'blur(8px)',
              minWidth: 140,
            }}>
              <div style={{
                fontFamily: "'Courier New', monospace", fontSize: 9,
                color: '#FF2D2D', letterSpacing: '0.12em', marginBottom: 3,
              }}>
                ▲ NEAR YOU
              </div>
              <div style={{
                fontFamily: "'Courier New', monospace", fontSize: 12,
                color: '#e2e8f0', fontWeight: 700, marginBottom: 2,
              }}>
                High risk area
              </div>
              <div style={{
                fontFamily: "'Courier New', monospace", fontSize: 10, color: '#94a3b8',
              }}>
                {distanceLabel}
              </div>
            </div>
          )}

          {/* Geo error notice */}
          {geoError && (
            <div style={{
              position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
              zIndex: 10, background: 'rgba(11,14,20,0.88)',
              border: '1px solid #1a2035', borderRadius: 6,
              padding: '4px 12px',
              fontFamily: "'Courier New', monospace", fontSize: 10, color: '#BB86FC',
              backdropFilter: 'blur(4px)',
            }}>
              Enable GPS for nearest-threat detection
            </div>
          )}

          <MapOverlayHost />

          {/* Mobile quick-actions: Routes + Acoustic + Home */}
          {layout === 'mobile' && (
            <div style={{
              position: 'absolute', bottom: 108, left: 12, zIndex: 10,
              display: 'flex', flexDirection: 'column', gap: 8,
            }}>
              <button
                onClick={() => dispatch(setOverlayIntent({ name: 'home-route' }))}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'rgba(11,14,20,0.88)', border: '1px solid #00E5FF',
                  borderRadius: 20, padding: '6px 12px', cursor: 'pointer',
                  fontFamily: "'Courier New', monospace", fontSize: 11, color: '#00E5FF',
                  backdropFilter: 'blur(6px)',
                }}
              >
                🏠 Home
              </button>
              <button
                onClick={() => dispatch(setOverlayIntent({ name: 'routes' }))}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'rgba(11,14,20,0.88)', border: '1px solid #2196F3',
                  borderRadius: 20, padding: '6px 12px', cursor: 'pointer',
                  fontFamily: "'Courier New', monospace", fontSize: 11, color: '#2196F3',
                  backdropFilter: 'blur(6px)',
                }}
              >
                🛣 Routes
              </button>
              <button
                onClick={() => dispatch(setOverlayIntent({ name: 'acoustic' }))}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'rgba(11,14,20,0.88)', border: '1px solid #BB86FC',
                  borderRadius: 20, padding: '6px 12px', cursor: 'pointer',
                  fontFamily: "'Courier New', monospace", fontSize: 11, color: '#BB86FC',
                  backdropFilter: 'blur(6px)',
                }}
              >
                🎙 Listen
              </button>
            </div>
          )}

          {layout === 'mobile' && <AlertsSheet />}
        </div>

        {/* Alerts dock — desktop only, flex sibling of map */}
        {layout === 'desktop' && <AlertsDock />}
      </div>

      {layout === 'desktop' && (
        <MapFeatureStrip
          onReport={() => navigate('/reports')}
          onAcoustic={() => dispatch(setOverlayIntent({ name: 'acoustic' }))}
          onCircles={() => navigate('/circles')}
          onRoutes={() => dispatch(setOverlayIntent({ name: 'routes' }))}
          onZaps={() => navigate('/zaps')}
          onHomeRoute={() => dispatch(setOverlayIntent({ name: 'home-route' }))}
        />
      )}
    </div>
  )
}
