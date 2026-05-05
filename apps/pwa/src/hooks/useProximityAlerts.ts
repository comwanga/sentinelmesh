import { useEffect, useRef, useMemo } from 'react'
import { useAppDispatch, useAppSelector } from '../store'
import { proximityAlertAdded } from '../store/circlesSlice'
import { haversineKm } from '../utils/geo'
import { randomUUID } from '../utils/uuid'
import type { CircleMember, SafetyEvent, ProximityAlert, Severity } from '../../../../shared/types'

const EMPTY_MEMBERS: CircleMember[] = []

const SEVERITY_RANK: Record<Severity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 }

export function computeProximityAlerts(
  members: CircleMember[],
  locations: Record<string, { lat: number; lng: number }>,
  events: SafetyEvent[],
): Omit<ProximityAlert, 'id'>[] {
  const alerts: Omit<ProximityAlert, 'id'>[] = []

  for (const member of members) {
    const loc = locations[member.member_pubkey]
    if (!loc) continue

    for (const event of events) {
      if (!event.is_active || !event.location) continue
      if (SEVERITY_RANK[event.severity] < SEVERITY_RANK[member.alert_severity]) continue

      const distKm = haversineKm(loc, { lat: event.location.lat, lng: event.location.lng })
      if (distKm <= member.alert_radius_km) {
        alerts.push({
          member_pubkey: member.member_pubkey,
          zone_name: event.title,
          event_id: event.event_id,
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
  const members = useAppSelector(s => { const id = s.circles.activeCircleId; return id ? (s.circles.members[id] ?? EMPTY_MEMBERS) : EMPTY_MEMBERS })
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
