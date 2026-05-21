import { searchAddress } from './mapApiService'

export type { GeocodeSuggestion } from './mapApiService'

const NOMINATIM = 'https://nominatim.openstreetmap.org'

export async function geocodeAddress(
  query: string,
  proximity?: { lat: number; lng: number },
): Promise<import('./mapApiService').GeocodeSuggestion[]> {
  // Try backend (Mapbox-backed) first
  const backendResults = await searchAddress(query, proximity)
  if (backendResults.length > 0) return backendResults

  // Nominatim fallback — works without a running gateway
  try {
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      limit: '5',
      'accept-language': 'en',
      addressdetails: '0',
    })
    if (proximity) {
      // Soft-bias results toward user location (not a hard boundary)
      const d = 1.5
      params.set(
        'viewbox',
        `${proximity.lng - d},${proximity.lat + d},${proximity.lng + d},${proximity.lat - d}`,
      )
      params.set('bounded', '0')
    }
    const res = await fetch(`${NOMINATIM}/search?${params}`, {
      headers: { 'User-Agent': 'SentinelMesh/1.0 (safety-app)' },
    })
    if (!res.ok) return []
    const data = await res.json() as Array<{
      display_name: string
      lat: string
      lon: string
    }>
    return data.map(d => ({
      label: d.display_name,
      lat: parseFloat(d.lat),
      lng: parseFloat(d.lon),
    }))
  } catch {
    return []
  }
}
