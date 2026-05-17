import { searchAddress } from './mapApiService'

export type { GeocodeSuggestion } from './mapApiService'

export async function geocodeAddress(
  query: string,
  proximity?: { lat: number; lng: number },
): Promise<import('./mapApiService').GeocodeSuggestion[]> {
  return searchAddress(query, proximity)
}
