import type { LatLng } from '../utils/geo'

export interface GeocodeSuggestion {
  label: string
  lat: number
  lng: number
}

export interface RouteResult {
  coordinates: [number, number][]
  distance: number
  duration: number
}

export async function searchAddress(
  query: string,
  proximity?: { lat: number; lng: number },
): Promise<GeocodeSuggestion[]> {
  const params = new URLSearchParams({ q: query, limit: '5' })
  if (proximity) {
    params.set('lat', String(proximity.lat))
    params.set('lng', String(proximity.lng))
  }
  try {
    const res = await fetch(`/api/maps/search?${params}`)
    if (!res.ok) return []
    const data = await res.json() as { features?: GeocodeSuggestion[] }
    return data.features ?? []
  } catch {
    return []
  }
}

export async function getRoute(from: LatLng, to: LatLng): Promise<RouteResult | null> {
  const params = new URLSearchParams({
    from: `${from.lng},${from.lat}`,
    to: `${to.lng},${to.lat}`,
    mode: 'walking',
  })
  try {
    const res = await fetch(`/api/maps/route?${params}`)
    if (!res.ok) return null
    return await res.json() as RouteResult
  } catch {
    return null
  }
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(`/api/maps/reverse?lat=${lat}&lng=${lng}`)
    if (!res.ok) return null
    const data = await res.json() as { label?: string }
    return data.label ?? null
  } catch {
    return null
  }
}
