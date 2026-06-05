import { describe, it, expect } from 'vitest'
import reducer, {
  circleLoaded,
  memberStatusUpdated,
  locationReceived,
  proximityAlertAdded,
  activeAlertDismissed,
  circleLeft,
} from '../circlesSlice'
import type { Circle, CircleMember } from '../../../../../shared/types'

const mockCircle: Circle = {
  circle_id: 'c1',
  name: 'Wanga Family',
  created_at: '2026-05-03T00:00:00Z',
}

const mockMember: CircleMember = {
  circle_id: 'c1',
  member_token: 'v1:tok_bbb',
  alert_radius_km: 1,
  alert_severity: 'HIGH',
  joined_at: '2026-05-03T00:00:00Z',
}

describe('circlesSlice', () => {
  it('loads circle and members', () => {
    const state = reducer(undefined, circleLoaded({ circle: mockCircle, members: [mockMember] }))
    expect(state.activeCircleId).toBe('c1')
    expect(state.circles).toHaveLength(1)
    expect(state.members['c1']).toHaveLength(1)
  })

  it('does not seed memberStatuses from roster (tokens are opaque)', () => {
    const state = reducer(undefined, circleLoaded({ circle: mockCircle, members: [mockMember] }))
    // memberStatuses must remain empty after loading; presence is keyed by
    // sender_pubkey from the circle WS, not from roster member_tokens.
    expect(Object.keys(state.memberStatuses)).toHaveLength(0)
  })

  it('updates member status by pubkey when WS presence arrives', () => {
    let state = reducer(undefined, circleLoaded({ circle: mockCircle, members: [mockMember] }))
    state = reducer(state, memberStatusUpdated({ pubkey: 'sender_bbb', status: 'GHOST' }))
    expect(state.memberStatuses['sender_bbb']).toBe('GHOST')
  })

  it('stores decrypted location', () => {
    const state = reducer(undefined, locationReceived({ pubkey: 'bbb', lat: -1.29, lng: 36.82, ts: '2026-05-03T00:00:00Z' }))
    expect(state.decryptedLocations['bbb']?.lat).toBeCloseTo(-1.29)
  })

  it('adds proximity alert and sets activeAlert', () => {
    const alert = { id: 'a1', member_pubkey: 'bbb', zone_name: 'Crisis Zone B', event_id: 'e1', severity: 'HIGH' as const, triggered_at: '2026-05-03T00:00:00Z' }
    const state = reducer(undefined, proximityAlertAdded(alert))
    expect(state.proximityAlerts).toHaveLength(1)
    expect(state.activeAlert?.id).toBe('a1')
  })

  it('dismisses active alert without removing from log', () => {
    const alert = { id: 'a1', member_pubkey: 'bbb', zone_name: 'Zone B', event_id: null, severity: 'HIGH' as const, triggered_at: '2026-05-03T00:00:00Z' }
    let state = reducer(undefined, proximityAlertAdded(alert))
    state = reducer(state, activeAlertDismissed())
    expect(state.activeAlert).toBeNull()
    expect(state.proximityAlerts).toHaveLength(1)
  })

  it('clears all circle state on circleLeft', () => {
    let state = reducer(undefined, circleLoaded({ circle: mockCircle, members: [mockMember] }))
    state = reducer(state, circleLeft())
    expect(state.activeCircleId).toBeNull()
    expect(state.circles).toHaveLength(0)
  })
})
