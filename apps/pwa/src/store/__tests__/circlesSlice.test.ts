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

const memberWithPubkey: CircleMember = {
  circle_id: 'c1',
  member_token: 'v1:tok_bbb',
  alert_radius_km: 1,
  alert_severity: 'HIGH',
  joined_at: '2026-05-03T00:00:00Z',
  pubkey: 'pubkey_bbb',
  label: 'Alice',
}

const memberWithoutPubkey: CircleMember = {
  circle_id: 'c1',
  member_token: 'v1:tok_ccc',
  alert_radius_km: 2,
  alert_severity: 'MEDIUM',
  joined_at: '2026-05-03T00:00:00Z',
  // no pubkey — legacy/unlabeled member
}

describe('circlesSlice', () => {
  it('loads circle and members', () => {
    const state = reducer(undefined, circleLoaded({ circle: mockCircle, members: [memberWithPubkey] }))
    expect(state.activeCircleId).toBe('c1')
    expect(state.circles).toHaveLength(1)
    expect(state.members['c1']).toHaveLength(1)
  })

  it('seeds OFFLINE in memberStatuses for a labeled member (has pubkey)', () => {
    const state = reducer(undefined, circleLoaded({ circle: mockCircle, members: [memberWithPubkey] }))
    expect(state.memberStatuses['pubkey_bbb']).toBe('OFFLINE')
  })

  it('does not seed memberStatuses for an unlabeled member (no pubkey)', () => {
    const state = reducer(undefined, circleLoaded({ circle: mockCircle, members: [memberWithoutPubkey] }))
    expect(Object.keys(state.memberStatuses)).toHaveLength(0)
  })

  it('does not overwrite an existing status when loading roster', () => {
    // Pre-seed ONLINE status, then load the roster
    let state = reducer(undefined, locationReceived({ pubkey: 'pubkey_bbb', lat: -1.29, lng: 36.82, ts: '2026-05-03T00:00:00Z' }))
    expect(state.memberStatuses['pubkey_bbb']).toBe('ONLINE')
    state = reducer(state, circleLoaded({ circle: mockCircle, members: [memberWithPubkey] }))
    // ONLINE must not be downgraded to OFFLINE
    expect(state.memberStatuses['pubkey_bbb']).toBe('ONLINE')
  })

  it('updates member status by pubkey when WS presence arrives', () => {
    let state = reducer(undefined, circleLoaded({ circle: mockCircle, members: [memberWithPubkey] }))
    state = reducer(state, memberStatusUpdated({ pubkey: 'pubkey_bbb', status: 'GHOST' }))
    expect(state.memberStatuses['pubkey_bbb']).toBe('GHOST')
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
    let state = reducer(undefined, circleLoaded({ circle: mockCircle, members: [memberWithPubkey] }))
    state = reducer(state, circleLeft())
    expect(state.activeCircleId).toBeNull()
    expect(state.circles).toHaveLength(0)
  })
})
