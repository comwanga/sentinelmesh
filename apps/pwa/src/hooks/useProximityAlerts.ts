import { useEffect, useRef, useMemo } from 'react'
import { useAppDispatch, useAppSelector } from '../store'
import { proximityAlertAdded } from '../store/circlesSlice'
import { haversineKm } from '../utils/geo'
import { randomUUID } from '../utils/uuid'
import type { SafetyEvent, ProximityAlert, Severity, CircleMember } from '../../../../shared/types'

const SEVERITY_RANK: Record<Severity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 }

export function computeProximityAlerts(
  members: CircleMember[],
  locations: Record<string, { lat: number; lng: number }>,
  events: SafetyEvent[],
): Omit<ProximityAlert, 'id'>[] {
  const alerts: Omit<ProximityAlert, 'id'>[] = []
  for (const member of members) {
    if (!member.pubkey) continue // unlabeled (legacy/unknown) member: no live join
    const loc = locations[member.pubkey]
    if (!loc) continue
    for (const event of events) {
      if (!event.is_active) continue
      if (SEVERITY_RANK[event.severity] < SEVERITY_RANK[member.alert_severity ?? 'MEDIUM']) continue
      const distKm = haversineKm(loc, { lat: event.lat, lng: event.lng })
      if (distKm <= (member.alert_radius_km ?? 5)) {
        alerts.push({
          member_pubkey: member.pubkey,
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
  const activeCircleId = useAppSelector(s => s.circles.activeCircleId)
  const members = useAppSelector(s => (activeCircleId ? (s.circles.members[activeCircleId] ?? []) : []))
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

    const newAlerts = computeProximityAlerts(members, locations, events)
    for (const alert of newAlerts) {
      const key = `${alert.member_pubkey}:${alert.event_id}`
      if (!existingAlertKeys.has(key)) {
        dispatch(proximityAlertAdded({ ...alert, id: randomUUID() }))
      }
    }
  }, [locations, members, events, dispatch, existingAlertKeys])
}
