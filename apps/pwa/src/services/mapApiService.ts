import type { LatLng } from '../utils/geo'

export interface GeocodeSuggestion {
  id: string
  label: string
  kind: 'address' | 'road' | 'place' | 'poi'
  lat: number
  lng: number
  bbox?: [number, number, number, number]
}

export interface RouteResult {
  id: string
  coordinates: [number, number][]
  distance_m: number
  duration_s: number
  warnings: string[]
  degraded: boolean
  // Downstream route presentation still consumes these aliases.
  distance: number
  duration: number
}

export type TravelMode = 'walking' | 'driving' | 'cycling'

export class MapSearchError extends Error {
  constructor(message = 'Map search is unavailable') {
    super(message)
    this.name = 'MapSearchError'
  }
}

export async function searchAddress(
  query: string,
  proximity?: LatLng,
  signal?: AbortSignal,
): Promise<GeocodeSuggestion[]> {
  const params = new URLSearchParams({ q: query.trim(), limit: '5' })
  if (proximity) {
    params.set('lat', String(proximity.lat))
    params.set('lng', String(proximity.lng))
  }
  let res: Response
  try {
    res = await fetch(`/api/maps/search?${params}`, { signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new MapSearchError()
  }
  if (!res.ok) throw new MapSearchError(`Map search failed (${res.status})`)
  try {
    const data = await res.json() as { results: GeocodeSuggestion[] }
    return data.results
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new MapSearchError()
  }
}

export async function getRoute(
  from: LatLng,
  to: LatLng,
  mode: TravelMode = 'walking',
  signal?: AbortSignal,
): Promise<RouteResult[]> {
  try {
    const res = await fetch('/api/maps/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, mode, alternatives: true }),
      signal,
    })
    if (!res.ok) return []
    const data = await res.json() as {
      routes: Omit<RouteResult, 'distance' | 'duration'>[]
    }
    return data.routes.map(route => ({
      ...route,
      distance: route.distance_m,
      duration: route.duration_s,
    }))
  } catch {
    return []
  }
}

export async function reverseGeocode(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const params = new URLSearchParams({ lat: String(lat), lng: String(lng) })
    const res = await fetch(`/api/maps/reverse?${params}`, { signal })
    if (!res.ok) return null
    const data = await res.json() as { result: GeocodeSuggestion | null }
    return data.result?.label ?? null
  } catch {
    return null
  }
}
