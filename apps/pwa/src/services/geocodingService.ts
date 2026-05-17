const GEOCODE_BASE = 'https://api.mapbox.com/geocoding/v5/mapbox.places'

export interface GeocodeSuggestion {
  label: string
  lat: number
  lng: number
}

export async function geocodeAddress(
  query: string,
  token: string,
  proximity?: { lat: number; lng: number },
): Promise<GeocodeSuggestion[]> {
  const encoded = encodeURIComponent(query)
  const proxParam = proximity
    ? `&proximity=${proximity.lng},${proximity.lat}`
    : '&proximity=36.8219,-1.2921'
  const url = `${GEOCODE_BASE}/${encoded}.json?access_token=${token}&country=KE&types=address,place,poi&limit=5${proxParam}`
  const res = await fetch(url)
  if (!res.ok) return []
  const data = await res.json() as {
    features?: { place_name: string; center: [number, number] }[]
  }
  return (data.features ?? []).map(f => ({
    label: f.place_name,
    lng: f.center[0],
    lat: f.center[1],
  }))
}
