import { useEffect, useRef, useMemo } from 'react'
import { useAppDispatch, useAppSelector } from '../store'
import { proximityAlertAdded } from '../store/circlesSlice'
import { haversineKm } from '../utils/geo'
import { randomUUID } from '../utils/uuid'
import type { SafetyEvent, ProximityAlert, Severity } from '../../../../shared/types'

const SEVERITY_RANK: Record<Severity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 }

export function computeProximityAlerts(
  locations: Record<string, { lat: number; lng: number }>,
  events: SafetyEvent[],
): Omit<ProximityAlert, 'id'>[] {
  // Degraded (C-3 Phase A): the roster carries opaque member_tokens the client
  // cannot map to the pubkey-keyed live locations, so per-member alert
  // radius/severity are unavailable. Alert on any circle member with a known live
  // location using default thresholds; per-member settings return in Phase B.
  const DEFAULT_RADIUS_KM = 5
  const DEFAULT_MIN_SEVERITY: Severity = 'MEDIUM'
  const alerts: Omit<ProximityAlert, 'id'>[] = []
  for (const [pubkey, loc] of Object.entries(locations)) {
    for (const event of events) {
      if (!event.is_active) continue
      if (SEVERITY_RANK[event.severity] < SEVERITY_RANK[DEFAULT_MIN_SEVERITY]) continue
      const distKm = haversineKm(loc, { lat: event.lat, lng: event.lng })
      if (distKm <= DEFAULT_RADIUS_KM) {
        alerts.push({
          member_pubkey: pubkey,
          zone_name: event.title,
          event_id: event.id,
          severity: event.severity,
          triggered_at: new Date().toISOString(),
        })
      }
    }
  }
  return alerts
}

export function useProximityAlerts(): void {
  const dispatch = useAppDispatch()
  const locations = useAppSelector(s => s.circles.decryptedLocations)
  const proximityAlerts = useAppSelector(s => s.circles.proximityAlerts)
  const existingAlertKeys = useMemo(
    () => new Set(proximityAlerts.map(a => `${a.member_pubkey}:${a.event_id}`)),
    [proximityAlerts],
  )
  const events = useAppSelector(s => s.events.items)
  const prevLocationsRef = useRef<typeof locations>({})

  useEffect(() => {
    if (locations === prevLocationsRef.current) return
    prevLocationsRef.current = locations

    const newAlerts = computeProximityAlerts(locations, events)
    for (const alert of newAlerts) {
      const key = `${alert.member_pubkey}:${alert.event_id}`
      if (!existingAlertKeys.has(key)) {
        dispatch(proximityAlertAdded({ ...alert, id: randomUUID() }))
      }
    }
  }, [locations, events, dispatch, existingAlertKeys])
}
