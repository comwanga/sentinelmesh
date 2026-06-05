import { describe, it, expect } from 'vitest'
import { computeProximityAlerts } from '../useProximityAlerts'
import type { SafetyEvent } from '../../../../../shared/types'

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

describe('computeProximityAlerts', () => {
  it('triggers alert when a live location is within DEFAULT_RADIUS_KM of a >=MEDIUM active event', () => {
    // 0.04 km from CBD — well within the 5 km default radius
    const locations = { 'pubkey_bbb': { lat: -1.2925, lng: 36.8220 } }
    const alerts = computeProximityAlerts(locations, [nearbyEvent])
    expect(alerts).toHaveLength(1)
    expect(alerts[0]!.member_pubkey).toBe('pubkey_bbb')
    expect(alerts[0]!.event_id).toBe('e1')
    expect(alerts[0]!.severity).toBe('CRITICAL')
  })

  it('does not trigger when the location is outside the default 5 km radius', () => {
    // ~100 km away from CBD
    const locations = { 'pubkey_bbb': { lat: -2.0, lng: 37.5 } }
    const alerts = computeProximityAlerts(locations, [nearbyEvent])
    expect(alerts).toHaveLength(0)
  })

  it('does not trigger for LOW severity events (below MEDIUM threshold)', () => {
    const lowEvent = { ...nearbyEvent, severity: 'LOW' as const }
    const locations = { 'pubkey_bbb': { lat: -1.2925, lng: 36.8220 } }
    const alerts = computeProximityAlerts(locations, [lowEvent])
    expect(alerts).toHaveLength(0)
  })

  it('does not trigger for inactive events', () => {
    const inactiveEvent = { ...nearbyEvent, is_active: false }
    const locations = { 'pubkey_bbb': { lat: -1.2925, lng: 36.8220 } }
    const alerts = computeProximityAlerts(locations, [inactiveEvent])
    expect(alerts).toHaveLength(0)
  })

  it('triggers for MEDIUM severity events (at the threshold)', () => {
    const mediumEvent = { ...nearbyEvent, severity: 'MEDIUM' as const }
    const locations = { 'pubkey_bbb': { lat: -1.2925, lng: 36.8220 } }
    const alerts = computeProximityAlerts(locations, [mediumEvent])
    expect(alerts).toHaveLength(1)
  })

  it('produces one alert per pubkey-event pair', () => {
    const locations = {
      'pubkey_aaa': { lat: -1.2925, lng: 36.8220 },
      'pubkey_bbb': { lat: -1.2930, lng: 36.8215 },
    }
    const alerts = computeProximityAlerts(locations, [nearbyEvent])
    expect(alerts).toHaveLength(2)
    const pubkeys = alerts.map(a => a.member_pubkey).sort()
    expect(pubkeys).toEqual(['pubkey_aaa', 'pubkey_bbb'])
  })

  it('returns empty when locations map is empty', () => {
    const alerts = computeProximityAlerts({}, [nearbyEvent])
    expect(alerts).toHaveLength(0)
  })
})
