import { Home } from 'lucide-react'
import { Marker } from 'react-map-gl/maplibre'
import type { HomeLocation } from '../../store/uiSlice'

export function HomeLocationMarker({ home }: { home: HomeLocation }) {
  return <Marker longitude={home.lng} latitude={home.lat} anchor="bottom">
    <div className="home-location-marker" title="Saved home" aria-label="Saved home"><Home size={18} /></div>
  </Marker>
}
