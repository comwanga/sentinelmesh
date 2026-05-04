import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { Circle, CircleMember, MemberStatus, ProximityAlert } from '../../../../shared/types'

interface DecryptedLocation { lat: number; lng: number; ts: string }

interface CirclesState {
  circles: Circle[]
  activeCircleId: string | null
  members: Record<string, CircleMember[]>
  memberStatuses: Record<string, MemberStatus>
  decryptedLocations: Record<string, DecryptedLocation>
  proximityAlerts: ProximityAlert[]
  activeAlert: ProximityAlert | null
}

const initialState: CirclesState = {
  circles: [],
  activeCircleId: null,
  members: {},
  memberStatuses: {},
  decryptedLocations: {},
  proximityAlerts: [],
  activeAlert: null,
}

const circlesSlice = createSlice({
  name: 'circles',
  initialState,
  reducers: {
    circleLoaded(state, action: PayloadAction<{ circle: Circle; members: CircleMember[] }>) {
      const { circle, members } = action.payload
      const existing = state.circles.findIndex(c => c.circle_id === circle.circle_id)
      if (existing >= 0) {
        state.circles[existing] = circle
      } else {
        state.circles.push(circle)
      }
      state.members[circle.circle_id] = members
      state.activeCircleId = circle.circle_id
      members.forEach(m => {
        if (!state.memberStatuses[m.member_pubkey]) {
          state.memberStatuses[m.member_pubkey] = 'OFFLINE'
        }
      })
    },
    memberStatusUpdated(state, action: PayloadAction<{ pubkey: string; status: MemberStatus }>) {
      state.memberStatuses[action.payload.pubkey] = action.payload.status
    },
    locationReceived(state, action: PayloadAction<{ pubkey: string; lat: number; lng: number; ts: string }>) {
      const { pubkey, lat, lng, ts } = action.payload
      state.decryptedLocations[pubkey] = { lat, lng, ts }
      state.memberStatuses[pubkey] = 'ONLINE'
    },
    proximityAlertAdded(state, action: PayloadAction<ProximityAlert>) {
      const exists = state.proximityAlerts.some(a => a.id === action.payload.id)
      if (!exists) {
        state.proximityAlerts.unshift(action.payload)
        state.activeAlert = action.payload
      }
    },
    activeAlertDismissed(state) {
      state.activeAlert = null
    },
    circleLeft(state) {
      state.circles = []
      state.activeCircleId = null
      state.members = {}
      state.memberStatuses = {}
      state.decryptedLocations = {}
      state.proximityAlerts = []
      state.activeAlert = null
    },
  },
})

export const {
  circleLoaded,
  memberStatusUpdated,
  locationReceived,
  proximityAlertAdded,
  activeAlertDismissed,
  circleLeft,
} = circlesSlice.actions
export default circlesSlice.reducer
