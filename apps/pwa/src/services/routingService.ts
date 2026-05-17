import { bearingBetween, destinationPoint, pointToLineDistance, LatLng } from '../utils/geo'

const DIRECTIONS_BASE = 'https://api.mapbox.com/directions/v5/mapbox/walking'

export interface HomeRoute {
  coordinates: [number, number][]
  distanceKm: number
  durationMin: number
  warnings: string[]
}

export async function fetchRouteToHome(
  from: LatLng,
  to: LatLng,
  dangerZones: { lat: number; lng: number; radiusKm: number }[],
  mapboxToken: string,
): Promise<HomeRoute | null> {
  const url =
    `${DIRECTIONS_BASE}/${from.lng},${from.lat};${to.lng},${to.lat}` +
    `?access_token=${mapboxToken}&geometries=geojson&overview=full`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json() as {
      routes?: { geometry: { coordinates: [number, number][] }; distance: number; duration: number }[]
    }
    const route = data.routes?.[0]
    if (!route) return null
    const coords = route.geometry.coordinates
    const warnings: string[] = []
    for (const zone of dangerZones) {
      const passes = coords.some(([lng, lat]) => {
        const dx = lat - zone.lat
        const dy = lng - zone.lng
        return Math.sqrt(dx * dx + dy * dy) * 111 < zone.radiusKm
      })
      if (passes) warnings.push(`Route passes near a danger zone`)
    }
    return {
      coordinates: coords,
      distanceKm: Math.round(route.distance / 100) / 10,
      durationMin: Math.round(route.duration / 60),
      warnings: [...new Set(warnings)],
    }
  } catch {
    return null
  }
}
const ESCAPE_DISTANCE_KM = 2.0
const SAFETY_BUFFER_KM = 0.2

export interface SafeRoute {
  coordinates: [number, number][]
  distanceKm: number
  durationMin: number
  label: string
}

/**
 * Returns up to 3 walking routes from userLocation that avoid eventLocation ± eventRadiusKm.
 * Falls back to [] on any API failure. mapboxToken must be the caller's public access token.
 */
export async function fetchSafeRoutes(
  userLocation: LatLng,
  eventLocation: LatLng,
  eventRadiusKm: number,
  mapboxToken: string,
): Promise<SafeRoute[]> {
  const safeBearing = bearingBetween(eventLocation, userLocation)
  const bearings = [safeBearing, (safeBearing + 45) % 360, (safeBearing - 45 + 360) % 360]
  const waypoints = bearings.map((b) => destinationPoint(userLocation, ESCAPE_DISTANCE_KM, b))
  const exclusionRadiusKm = eventRadiusKm + SAFETY_BUFFER_KM
  const safeRoutes: SafeRoute[] = []

  for (const wp of waypoints) {
    try {
      const url =
        `${DIRECTIONS_BASE}/${userLocation.lng},${userLocation.lat};${wp.lng},${wp.lat}` +
        `?access_token=${mapboxToken}&geometries=geojson&overview=full`
      const res = await fetch(url)
      if (!res.ok) continue

      const data = await res.json() as {
        routes?: { geometry: { coordinates: [number, number][] }; distance: number; duration: number }[]
      }
      const route = data.routes?.[0]
      if (!route) continue

      const coords = route.geometry.coordinates
      const passesThrough = coords.some(([lng, lat]) =>
        pointToLineDistance(
          { lat, lng },
          [[eventLocation.lng, eventLocation.lat], [eventLocation.lng, eventLocation.lat]],
        ) < exclusionRadiusKm,
      )
      if (passesThrough) continue

      safeRoutes.push({
        coordinates: coords,
        distanceKm: Math.round(route.distance / 100) / 10,
        durationMin: Math.round(route.duration / 60),
        label: `Route ${safeRoutes.length + 1} — ${Math.round(route.distance / 100) / 10} km`,
      })
    } catch {
      // Partial failure — continue to next waypoint
    }
  }

  return safeRoutes.slice(0, 3)
}
