import { useState, useEffect } from 'react'

export interface CurrentLocation {
  lat: number
  lng: number
  accuracy: number  // metres
}

export function useCurrentLocation(): { location: CurrentLocation | null; error: string | null } {
  const [location, setLocation] = useState<CurrentLocation | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!navigator.geolocation) {
      setError('Geolocation not supported by this browser')
      return
    }
    const id = navigator.geolocation.watchPosition(
      pos => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy })
        setError(null)
      },
      err => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  return { location, error }
}
