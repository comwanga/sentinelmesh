import { describe, it, expect } from 'vitest'
import { computeProximityAlerts } from '../useProximityAlerts'
import type { CircleMember, SafetyEvent } from '../../../../../shared/types'

const member: CircleMember = {
  circle_id: 'c1',
  member_pubkey: 'bbb',
  alert_radius_km: 1,
  alert_severity: 'HIGH',
  joined_at: '',
}

const nearbyEvent: SafetyEvent = {
  event_id: 'e1',
  event_type: 'CIVIL_UNREST',
  severity: 'CRITICAL',
  title: 'Crisis Zone B',
  summary: null,
  location: { lat: -1.2921, lng: 36.8219, place_name: 'Nairobi CBD', county: 'Nairobi' },
  confidence: 0.9,
  source_count: 3,
  source_breakdown: {},
  is_active: true,
  started_at: '',
  last_updated: '',
  nostr_event_id: null,
  bitcoin_txid: null,
}

describe('computeProximityAlerts', () => {
  it('triggers alert when member is within radius of a high-severity event', () => {
    const memberLocation = { lat: -1.2925, lng: 36.8220 }
    const alerts = computeProximityAlerts([member], { [member.member_pubkey]: memberLocation }, [nearbyEvent])
    expect(alerts).toHaveLength(1)
    expect(alerts[0]!.member_pubkey).toBe('bbb')
    expect(alerts[0]!.event_id).toBe('e1')
  })

  it('does not trigger when member is outside radius', () => {
    const memberLocation = { lat: -2.0, lng: 37.5 }
    const alerts = computeProximityAlerts([member], { [member.member_pubkey]: memberLocation }, [nearbyEvent])
    expect(alerts).toHaveLength(0)
  })

  it('does not trigger when event severity is below member threshold', () => {
    const lowEvent = { ...nearbyEvent, severity: 'LOW' as const }
    const memberLocation = { lat: -1.2925, lng: 36.8220 }
    const alerts = computeProximityAlerts([member], { [member.member_pubkey]: memberLocation }, [lowEvent])
    expect(alerts).toHaveLength(0)
  })

  it('does not trigger for inactive events', () => {
    const inactiveEvent = { ...nearbyEvent, is_active: false }
    const memberLocation = { lat: -1.2925, lng: 36.8220 }
    const alerts = computeProximityAlerts([member], { [member.member_pubkey]: memberLocation }, [inactiveEvent])
    expect(alerts).toHaveLength(0)
  })
})
