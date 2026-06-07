import { describe, it, expect } from 'vitest'
import { computeProximityAlerts } from '../useProximityAlerts'
import type { SafetyEvent, CircleMember } from '../../../../../shared/types'

// Nairobi CBD coordinates
const NAIROBI_CBD = { lat: -1.2921, lng: 36.8219 }

const nearbyEvent: SafetyEvent = {
  id: 'e1',
  event_type: 'CIVIL_UNREST',
  severity: 'CRITICAL',
  title: 'Crisis Zone B',
  summary: null,
  lat: NAIROBI_CBD.lat,
  lng: NAIROBI_CBD.lng,
  place_name: 'Nairobi CBD',
  county: 'Nairobi',
  is_active: true,
  state: 'ACTIVE',
  started_at: '',
  created_at: '',
  nostr_event_id: null,
  bitcoin_txid: null,
}

function makeMember(pubkey: string, radiusKm = 5, severity: CircleMember['alert_severity'] = 'MEDIUM'): CircleMember {
  return {
    circle_id: 'c1',
    member_token: `tok_${pubkey}`,
    alert_radius_km: radiusKm,
    alert_severity: severity,
    joined_at: '',
    pubkey,
  }
}

describe('computeProximityAlerts', () => {
  it('triggers alert when a member location is within their alert_radius_km of an active event >= their severity', () => {
    // 0.04 km from CBD — well within the 5 km radius
    const members = [makeMember('pubkey_bbb', 5, 'MEDIUM')]
    const locations = { 'pubkey_bbb': { lat: -1.2925, lng: 36.8220 } }
    const alerts = computeProximityAlerts(members, locations, [nearbyEvent])
    expect(alerts).toHaveLength(1)
    expect(alerts[0]!.member_pubkey).toBe('pubkey_bbb')
    expect(alerts[0]!.event_id).toBe('e1')
    expect(alerts[0]!.severity).toBe('CRITICAL')
  })

  it('does not trigger when the location is outside the member alert_radius_km', () => {
    // ~100 km away from CBD — outside the 5 km radius
    const members = [makeMember('pubkey_bbb', 5, 'MEDIUM')]
    const locations = { 'pubkey_bbb': { lat: -2.0, lng: 37.5 } }
    const alerts = computeProximityAlerts(members, locations, [nearbyEvent])
    expect(alerts).toHaveLength(0)
  })

  it('does not trigger for events below the member alert_severity threshold', () => {
    // Member requires HIGH; event is MEDIUM
    const members = [makeMember('pubkey_bbb', 5, 'HIGH')]
    const mediumEvent = { ...nearbyEvent, severity: 'MEDIUM' as const }
    const locations = { 'pubkey_bbb': { lat: -1.2925, lng: 36.8220 } }
    const alerts = computeProximityAlerts(members, locations, [mediumEvent])
    expect(alerts).toHaveLength(0)
  })

  it('triggers when event severity exactly matches member threshold', () => {
    const members = [makeMember('pubkey_bbb', 5, 'MEDIUM')]
    const mediumEvent = { ...nearbyEvent, severity: 'MEDIUM' as const }
    const locations = { 'pubkey_bbb': { lat: -1.2925, lng: 36.8220 } }
    const alerts = computeProximityAlerts(members, locations, [mediumEvent])
    expect(alerts).toHaveLength(1)
  })

  it('does not trigger for inactive events', () => {
    const members = [makeMember('pubkey_bbb')]
    const inactiveEvent = { ...nearbyEvent, is_active: false }
    const locations = { 'pubkey_bbb': { lat: -1.2925, lng: 36.8220 } }
    const alerts = computeProximityAlerts(members, locations, [inactiveEvent])
    expect(alerts).toHaveLength(0)
  })

  it('skips unlabeled members with no pubkey', () => {
    const unlabeled: CircleMember = {
      circle_id: 'c1',
      member_token: 'tok_nopub',
      alert_radius_km: 5,
      alert_severity: 'MEDIUM',
      joined_at: '',
      // no pubkey
    }
    const locations = { 'pubkey_bbb': { lat: -1.2925, lng: 36.8220 } }
    const alerts = computeProximityAlerts([unlabeled], locations, [nearbyEvent])
    expect(alerts).toHaveLength(0)
  })

  it('applies per-member radius: small radius member does not fire when far, large radius member does', () => {
    // ~100 km from CBD
    const farLocation = { lat: -2.0, lng: 37.5 }
    const memberClose = makeMember('pubkey_close', 5, 'MEDIUM')
    const memberFar = makeMember('pubkey_far', 200, 'MEDIUM') // 200 km radius
    const locations = {
      'pubkey_close': { lat: -1.2925, lng: 36.8220 }, // near CBD
      'pubkey_far': farLocation,                        // far from CBD
    }
    const alerts = computeProximityAlerts([memberClose, memberFar], locations, [nearbyEvent])
    // pubkey_close fires, pubkey_far fires (within 200 km)
    expect(alerts).toHaveLength(2)
    const pubkeys = alerts.map(a => a.member_pubkey).sort()
    expect(pubkeys).toContain('pubkey_close')
    expect(pubkeys).toContain('pubkey_far')
  })

  it('produces one alert per member-event pair', () => {
    const members = [makeMember('pubkey_aaa'), makeMember('pubkey_bbb')]
    const locations = {
      'pubkey_aaa': { lat: -1.2925, lng: 36.8220 },
      'pubkey_bbb': { lat: -1.2930, lng: 36.8215 },
    }
    const alerts = computeProximityAlerts(members, locations, [nearbyEvent])
    expect(alerts).toHaveLength(2)
    const pubkeys = alerts.map(a => a.member_pubkey).sort()
    expect(pubkeys).toEqual(['pubkey_aaa', 'pubkey_bbb'])
  })

  it('returns empty when locations map is empty', () => {
    const members = [makeMember('pubkey_bbb')]
    const alerts = computeProximityAlerts(members, {}, [nearbyEvent])
    expect(alerts).toHaveLength(0)
  })

  it('returns empty when members list is empty', () => {
    const locations = { 'pubkey_bbb': { lat: -1.2925, lng: 36.8220 } }
    const alerts = computeProximityAlerts([], locations, [nearbyEvent])
    expect(alerts).toHaveLength(0)
  })
})
