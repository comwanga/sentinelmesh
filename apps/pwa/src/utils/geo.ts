const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI
const EARTH_RADIUS_KM = 6371

export interface LatLng { lat: number; lng: number }

export function bearingBetween(from: LatLng, to: LatLng): number {
  const lat1 = from.lat * DEG_TO_RAD
  const lat2 = to.lat * DEG_TO_RAD
  const dLng = (to.lng - from.lng) * DEG_TO_RAD
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return ((Math.atan2(y, x) * RAD_TO_DEG) + 360) % 360
}

export function destinationPoint(origin: LatLng, distanceKm: number, bearingDeg: number): LatLng {
  const d = distanceKm / EARTH_RADIUS_KM
  const bearing = bearingDeg * DEG_TO_RAD
  const lat1 = origin.lat * DEG_TO_RAD
  const lng1 = origin.lng * DEG_TO_RAD
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing),
  )
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
  )
  return { lat: lat2 * RAD_TO_DEG, lng: lng2 * RAD_TO_DEG }
}

export function pointToLineDistance(point: LatLng, lineCoords: [number, number][]): number {
  if (lineCoords.length === 1) return haversineKm(point, { lng: lineCoords[0]![0], lat: lineCoords[0]![1] })
  let minDist = Infinity
  for (let i = 0; i < lineCoords.length - 1; i++) {
    const a: LatLng = { lat: lineCoords[i]![1],     lng: lineCoords[i]![0] }
    const b: LatLng = { lat: lineCoords[i + 1]![1], lng: lineCoords[i + 1]![0] }
    minDist = Math.min(minDist, pointToSegmentDistance(point, a, b))
  }
  return minDist
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * DEG_TO_RAD
  const dLng = (b.lng - a.lng) * DEG_TO_RAD
  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)
  const h = sinDLat * sinDLat +
    Math.cos(a.lat * DEG_TO_RAD) * Math.cos(b.lat * DEG_TO_RAD) * sinDLng * sinDLng
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

function pointToSegmentDistance(p: LatLng, a: LatLng, b: LatLng): number {
  const ab = haversineKm(a, b)
  if (ab === 0) return haversineKm(p, a)
  const t = Math.max(0, Math.min(1,
    ((p.lat - a.lat) * (b.lat - a.lat) + (p.lng - a.lng) * (b.lng - a.lng)) /
    ((b.lat - a.lat) ** 2 + (b.lng - a.lng) ** 2),
  ))
  const closest: LatLng = { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) }
  return haversineKm(p, closest)
}
