import { Marker } from 'react-map-gl/maplibre'
import type { CurrentLocation } from '../../hooks/useCurrentLocation'

interface Props {
  location: CurrentLocation
}

export function LocationMarker({ location }: Props) {
  return (
    <Marker longitude={location.lng} latitude={location.lat} anchor="center">
      <div style={{ position: 'relative', width: 20, height: 20 }}>
        {/* Pulse ring */}
        <div style={{
          position: 'absolute',
          inset: -6,
          borderRadius: '50%',
          border: '2px solid rgba(0,229,255,0.5)',
          animation: 'sm-pulse 2s ease-out infinite',
        }} />
        {/* Core dot */}
        <div style={{
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: '#00E5FF',
          border: '3px solid #fff',
          boxShadow: '0 0 8px rgba(0,229,255,0.8)',
        }} />
        <style>{`
          @keyframes sm-pulse {
            0%   { transform: scale(1); opacity: 0.8; }
            70%  { transform: scale(2.2); opacity: 0; }
            100% { transform: scale(2.2); opacity: 0; }
          }
        `}</style>
      </div>
    </Marker>
  )
}
