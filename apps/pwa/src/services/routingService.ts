import { getRoute } from './mapApiService'
import { bearingBetween, destinationPoint, pointToLineDistance } from '../utils/geo'
import type { LatLng } from '../utils/geo'

const ESCAPE_DISTANCE_KM = 2.0
const SAFETY_BUFFER_KM = 0.2

export interface HomeRoute {
  coordinates: [number, number][]
  distanceKm: number
  durationMin: number
  warnings: string[]
}

export interface SafeRoute {
  coordinates: [number, number][]
  distanceKm: number
  durationMin: number
  label: string
}

export async function fetchRouteToHome(
  from: LatLng,
  to: LatLng,
  dangerZones: { lat: number; lng: number; radiusKm: number }[],
): Promise<HomeRoute | null> {
  const result = await getRoute(from, to)
  if (!result) return null
  const coords = result.coordinates
  const warnings: string[] = []
  for (const zone of dangerZones) {
    const passes = coords.some(([lng, lat]) => {
      const dx = lat - zone.lat
      const dy = lng - zone.lng
      return Math.sqrt(dx * dx + dy * dy) * 111 < zone.radiusKm
    })
    if (passes) warnings.push('Route passes near a danger zone')
  }
  return {
    coordinates: coords,
    distanceKm: Math.round(result.distance / 100) / 10,
    durationMin: Math.round(result.duration / 60),
    warnings: [...new Set(warnings)],
  }
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
      const result = await getRoute(userLocation, wp)
      if (!result) continue

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
      // Partial failure — continue to next waypoint
    }
  }

  return safeRoutes.slice(0, 3)
}
