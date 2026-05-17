import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBreakpoint } from '../hooks/useBreakpoint'
import { useNearestThreat } from '../hooks/useNearestThreat'
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

export function LiveMapPage() {
  const [mapLoaded, setMapLoaded] = useState(false)
  const handleMapLoad = useCallback(() => setMapLoaded(true), [])
  const { layout } = useBreakpoint()
  const { nearest: nearestThreat, geoError } = useNearestThreat()
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const { activeAlerts, verified, verifiedPct, communityScore, sources } = useAppSelector(selectMapStats)
  const events = useAppSelector(selectEventItems)

  return (
    <div data-testid="live-map-page" style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <MapStatsBar
        activeAlerts={activeAlerts}
        verified={verified}
        verifiedPct={verifiedPct}
        communityScore={communityScore}
        sources={sources}
      />
      {geoError && (
        <div style={{ background: '#1a2035', color: '#BB86FC', fontFamily: "'Courier New', monospace", fontSize: 10, padding: '2px 8px', textAlign: 'center' }}>
          Location unavailable — enable GPS for nearest threat detection
        </div>
      )}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
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
          {events.filter(e => e.is_active).map(event => (
            <Marker key={event.id} longitude={event.lng} latitude={event.lat} anchor="center">
              <EventMarker event={event} onClick={() => {}} />
            </Marker>
          ))}
        </MapCanvas>
        {layout === 'desktop' && <AlertsDock />}
        {layout === 'mobile' && <AlertsSheet />}
        <MapOverlayHost />
        {nearestThreat && (
          <div style={{
            position: 'absolute',
            top: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#FF2D2D',
            color: '#fff',
            fontFamily: "'Courier New', monospace",
            fontSize: 11,
            padding: '4px 12px',
            borderRadius: 4,
            zIndex: 10,
          }}>
            NEAR YOU: {nearestThreat.title}
          </div>
        )}
      </div>
      {layout === 'desktop' && (
        <MapFeatureStrip
          onReport={() => navigate('/reports')}
          onAcoustic={() => dispatch(setOverlayIntent({ name: 'acoustic' }))}
          onCircles={() => navigate('/circles')}
          onRoutes={() => dispatch(setOverlayIntent({ name: 'routes' }))}
          onZaps={() => navigate('/zaps')}
        />
      )}
    </div>
  )
}
