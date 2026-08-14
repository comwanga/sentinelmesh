import { useCallback, useEffect, useRef, useState } from 'react'

export interface CurrentLocation {
  lat: number
  lng: number
  accuracy: number  // metres
}

export type LocationStatus = 'idle' | 'requesting' | 'following' | 'located-not-following' | 'denied' | 'unavailable'

export interface CurrentLocationController {
  location: CurrentLocation | null
  status: LocationStatus
  error: string | null
  startFollowing: () => void
  stopFollowing: () => void
  disable: () => void
}

export function useCurrentLocation(): CurrentLocationController {
  const [location, setLocation] = useState<CurrentLocation | null>(null)
  const [status, setStatus] = useState<LocationStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const watchId = useRef<number | null>(null)
  const following = useRef(false)

  const disable = useCallback(() => {
    following.current = false
    if (watchId.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId.current)
    watchId.current = null
    setLocation(null)
    setError(null)
    setStatus('idle')
  }, [])

  const startFollowing = useCallback(() => {
    if (!navigator.geolocation) {
      following.current = false
      setError('Geolocation not supported by this browser')
      setStatus('unavailable')
      return
    }
    following.current = true
    setError(null)
    if (watchId.current !== null) {
      setStatus(location ? 'following' : 'requesting')
      return
    }
    setStatus('requesting')
    watchId.current = navigator.geolocation.watchPosition(
      pos => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy })
        setError(null)
        setStatus(following.current ? 'following' : 'located-not-following')
      },
      err => {
        following.current = false
        if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)
        watchId.current = null
        setError(err.message)
        setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable')
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
    )
  }, [location])

  const stopFollowing = useCallback(() => {
    following.current = false
    setStatus(current => current === 'following' ? 'located-not-following' : current)
  }, [])

  useEffect(() => () => {
    if (watchId.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId.current)
  }, [])

  return { location, status, error, startFollowing, stopFollowing, disable }
}
