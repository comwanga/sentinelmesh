import { MapPin } from 'lucide-react'
import { Marker } from 'react-map-gl/maplibre'
import type { GeocodeSuggestion } from '../../services/mapApiService'

export function SearchResultMarker({ result }: { result: GeocodeSuggestion }) {
  return <Marker longitude={result.lng} latitude={result.lat} anchor="bottom">
    <div className="search-result-marker" role="img" aria-label={`Search result: ${result.label}`} title={result.label}><MapPin /></div>
  </Marker>
}
