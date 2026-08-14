import { searchAddress } from './mapApiService'
import type { LatLng } from '../utils/geo'

export type { GeocodeSuggestion } from './mapApiService'

export function geocodeAddress(query: string, proximity?: LatLng, signal?: AbortSignal) {
  return searchAddress(query, proximity, signal)
}
