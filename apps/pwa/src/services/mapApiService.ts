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

export type TravelMode = 'walking' | 'driving' | 'transit'

const OSRM_BASE = 'https://router.project-osrm.org/route/v1'
const OSRM_PROFILE: Record<TravelMode, string> = {
  walking: 'foot',
  driving: 'driving',
  transit: 'driving', // OSRM has no transit; callers show a UI message for transit
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

export async function getRoute(
  from: LatLng,
  to: LatLng,
  mode: TravelMode = 'walking',
): Promise<RouteResult[]> {
  // Try backend first (has danger-zone enrichment)
  try {
    const params = new URLSearchParams({
      from: `${from.lng},${from.lat}`,
      to: `${to.lng},${to.lat}`,
      mode,
    })
    const res = await fetch(`/api/maps/route?${params}`)
    if (res.ok) {
      const data = await res.json() as RouteResult | RouteResult[]
      return Array.isArray(data) ? data : [data]
    }
  } catch { /* fall through */ }

  // Direct OSRM fallback — works without backend
  try {
    const profile = OSRM_PROFILE[mode]
    const url =
      `${OSRM_BASE}/${profile}/${from.lng},${from.lat};${to.lng},${to.lat}` +
      `?geometries=geojson&alternatives=true&steps=false`
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json() as {
      code: string
      routes: Array<{
        geometry: { coordinates: [number, number][] }
        distance: number
        duration: number
      }>
    }
    if (data.code !== 'Ok') return []
    return data.routes.map(r => ({
      coordinates: r.geometry.coordinates,
      distance: r.distance,
      duration: r.duration,
    }))
  } catch {
    return []
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
