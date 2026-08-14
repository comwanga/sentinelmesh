import { getRoute } from './mapApiService'
import type { TravelMode } from './mapApiService'
import { bearingBetween, destinationPoint, pointToLineDistance } from '../utils/geo'
import type { LatLng } from '../utils/geo'

const ESCAPE_DISTANCE_KM = 2.0
const SAFETY_BUFFER_KM = 0.2

export interface HomeRoute {
  id: string
  coordinates: [number, number][]
  distanceKm: number
  durationMin: number
  warnings: string[]
  label: string
  mode: TravelMode
  alertIntersections: number
}

export interface SafeRoute {
  coordinates: [number, number][]
  distanceKm: number
  durationMin: number
  label: string
}

const ROUTE_LABELS = ['Best route', 'Route B', 'Route C']

export async function fetchRouteToHome(
  from: LatLng,
  to: LatLng,
  dangerZones: { lat: number; lng: number; radiusKm: number }[],
  mode: TravelMode = 'walking',
): Promise<HomeRoute[]> {
  const results = await getRoute(from, to, mode)
  if (!results.length) return []

  return results.slice(0, 3).map((result, i) => {
    const coords = result.coordinates
    let alertIntersections = 0
    for (const zone of dangerZones) {
      const passes = pointToLineDistance({ lat: zone.lat, lng: zone.lng }, coords) <= zone.radiusKm
      if (passes) alertIntersections++
    }
    const warnings = alertIntersections ? ['Route intersects an alert area'] : []
    return {
      id: result.id,
      coordinates: coords,
      distanceKm: Math.round(result.distance / 100) / 10,
      durationMin: Math.round(result.duration / 60),
      warnings: [...new Set(warnings)],
      label: ROUTE_LABELS[i] ?? `Route ${i + 1}`,
      mode,
      alertIntersections,
    }
  })
}

export async function fetchSafeRoutes(
  userLocation: LatLng,
  eventLocation: LatLng,
  eventRadiusKm: number,
): Promise<SafeRoute[]> {
  const safeBearing = bearingBetween(eventLocation, userLocation)
  const bearings = [safeBearing, (safeBearing + 45) % 360, (safeBearing - 45 + 360) % 360]
  const waypoints = bearings.map((b) => destinationPoint(userLocation, ESCAPE_DISTANCE_KM, b))
  const exclusionRadiusKm = eventRadiusKm + SAFETY_BUFFER_KM
  const safeRoutes: SafeRoute[] = []

  for (const wp of waypoints) {
    try {
      const results = await getRoute(userLocation, wp)
      if (!results.length) continue
      const result = results[0]

      const coords = result.coordinates
      const passesThrough = coords.some(([lng, lat]) =>
        pointToLineDistance(
          { lat, lng },
          [[eventLocation.lng, eventLocation.lat], [eventLocation.lng, eventLocation.lat]],
        ) < exclusionRadiusKm,
      )
      if (passesThrough) continue

      safeRoutes.push({
        coordinates: coords,
        distanceKm: Math.round(result.distance / 100) / 10,
        durationMin: Math.round(result.duration / 60),
        label: `Route ${safeRoutes.length + 1} — ${Math.round(result.distance / 100) / 10} km`,
      })
    } catch {
      // partial failure — continue to next waypoint
    }
  }

  return safeRoutes.slice(0, 3)
}
