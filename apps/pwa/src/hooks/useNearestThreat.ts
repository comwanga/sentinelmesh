import { useEffect, useRef, useState } from 'react'
import { createSelector } from '@reduxjs/toolkit'
import { useAppSelector } from '../store'
import type { RootState } from '../store'
import type { SafetyEvent } from '../../../../shared/types'

const selectHighRiskEvents = createSelector(
  (state: RootState) => state.events.items,
  items => items.filter(e => e.confidence >= 0.7 && e.is_active)
)

export function useNearestThreat(): { nearest: SafetyEvent | null; geoError: GeolocationPositionError | null } {
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null)
  const [geoError, setGeoError] = useState<GeolocationPositionError | null>(null)
  const lastUpdateRef = useRef<number>(0)
  const events = useAppSelector(selectHighRiskEvents)

  useEffect(() => {
    const watchId = navigator.geolocation.watchPosition(
      geo => {
        const now = Date.now()
        if (now - lastUpdateRef.current < 1000) return
        lastUpdateRef.current = now
        setPos({ lat: geo.coords.latitude, lng: geo.coords.longitude })
      },
      err => setGeoError(err),
      { enableHighAccuracy: false, timeout: 10_000 }
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  if (!pos || events.length === 0) return { nearest: null, geoError }

  let nearest: SafetyEvent | null = null
  let minDist = Infinity
  for (const e of events) {
    const lat = e.location?.lat
    const lng = e.location?.lng
    if (lat == null || lng == null) continue // == catches both null and undefined
    const dLat = (lat - pos.lat) * 111
    const dLng = (lng - pos.lng) * 111 * Math.cos(pos.lat * Math.PI / 180)
    const d = Math.hypot(dLat, dLng)
    if (d < minDist) {
      minDist = d
      nearest = e
    }
  }
  return { nearest, geoError }
}
