import Map, { Marker, Popup } from 'react-map-gl'
import { useState, useEffect, useCallback } from 'react'
import { useAppSelector } from '../store'
import EventMarker from './EventMarker'
import { fetchSafeRoutes, SafeRoute } from '../services/routingService'
import { SafeRouteOverlay } from './SafeRouteOverlay'
import type { SafetyEvent } from '../../../../shared/types'
import 'mapbox-gl/dist/mapbox-gl.css'

const MAPBOX_TOKEN = import.meta.env['VITE_MAPBOX_TOKEN'] as string

interface ProximityAlert {
  event_id: string
  event_lat: number
  event_lng: number
  event_radius_meters: number
}

export default function SafetyMap({ proximityAlert }: { proximityAlert?: ProximityAlert | null }) {
  const events = useAppSelector(state => state.events.items.filter(e => e.is_active && e.location))
  const connected = useAppSelector(state => state.events.connected)
  const [selected, setSelected] = useState<SafetyEvent | null>(null)
  const [escapeRoutes, setEscapeRoutes] = useState<SafeRoute[]>([])

  const fetchRoutes = useCallback(() => {
    if (!proximityAlert) {
      setEscapeRoutes([])
      return
    }
    setEscapeRoutes([])
    navigator.geolocation?.getCurrentPosition((pos) => {
      fetchSafeRoutes(
        { lat: pos.coords.latitude, lng: pos.coords.longitude },
        { lat: proximityAlert.event_lat, lng: proximityAlert.event_lng },
        (proximityAlert.event_radius_meters ?? 500) / 1000,
        MAPBOX_TOKEN,
      ).then(setEscapeRoutes)
    })
  }, [proximityAlert])

  useEffect(() => { fetchRoutes() }, [fetchRoutes])

  return (
    <>
      {/* Connection status badge */}
      <div style={{
        position: 'absolute', top: 12, left: 12, zIndex: 10,
        background: connected ? '#4CAF50' : '#FF2D2D',
        color: 'white', padding: '4px 10px', borderRadius: 12,
        fontSize: 12, fontFamily: 'sans-serif',
      }}>
        {connected ? `Live · ${events.length} events` : 'Reconnecting…'}
      </div>

      <Map
        mapboxAccessToken={MAPBOX_TOKEN}
        initialViewState={{
          longitude: 36.8219,
          latitude: -1.2921,
          zoom: 11,
        }}
        style={{ width: '100%', height: '100%' }}
        mapStyle="mapbox://styles/mapbox/dark-v11"
      >
        {events.map(event => (
          event.location && (
            <Marker
              key={event.event_id}
              longitude={event.location.lng}
              latitude={event.location.lat}
              anchor="center"
            >
              <EventMarker event={event} onClick={setSelected} />
            </Marker>
          )
        ))}

        {selected && selected.location && (
          <Popup
            longitude={selected.location.lng}
            latitude={selected.location.lat}
            onClose={() => setSelected(null)}
            closeButton={true}
            maxWidth="280px"
          >
            <div style={{ fontFamily: 'sans-serif', fontSize: 13 }}>
              <strong style={{ color: '#333' }}>{selected.title}</strong>
              {selected.summary && <p style={{ margin: '6px 0 0' }}>{selected.summary}</p>}
              <p style={{ margin: '6px 0 0', color: '#666', fontSize: 11 }}>
                {selected.location.place_name} · {selected.severity} · {Math.round(selected.confidence * 100)}% confidence
              </p>
            </div>
          </Popup>
        )}

        <SafeRouteOverlay routes={escapeRoutes} />
      </Map>
    </>
  )
}
