import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { Circle, CircleMember, MemberStatus, ProximityAlert } from '../../../../shared/types'

interface DecryptedLocation {
  lat: number
  lng: number
  ts: string
  event_id?: string
  expires_at?: number
  accuracy_m?: number
  precision?: 'exact' | 'approximate'
}

interface CircleEpoch {
  key_epoch: number
  rekey_required: boolean
}

interface CirclesState {
  circles: Circle[]
  activeCircleId: string | null
  members: Record<string, CircleMember[]>
  epochs: Record<string, CircleEpoch>
  memberStatuses: Record<string, MemberStatus>
  decryptedLocations: Record<string, DecryptedLocation>
  proximityAlerts: ProximityAlert[]
  activeAlert: ProximityAlert | null
  decryptErrors: string[]
}

const initialState: CirclesState = {
  circles: [],
  activeCircleId: null,
  members: {},
  epochs: {},
  memberStatuses: {},
  decryptedLocations: {},
  proximityAlerts: [],
  activeAlert: null,
  decryptErrors: [],
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
        if (m.pubkey && !state.memberStatuses[m.pubkey]) {
          state.memberStatuses[m.pubkey] = 'OFFLINE'
        }
      })
    },
    circleEpochChanged(state, action: PayloadAction<{ circle_id: string; key_epoch: number; rekey_required: boolean }>) {
      state.epochs[action.payload.circle_id] = {
        key_epoch: action.payload.key_epoch,
        rekey_required: action.payload.rekey_required,
      }
      const circle = state.circles.find(c => c.circle_id === action.payload.circle_id)
      if (circle) {
        circle.key_epoch = action.payload.key_epoch
        circle.rekey_required = action.payload.rekey_required
      }
    },
    memberStatusUpdated(state, action: PayloadAction<{ pubkey: string; status: MemberStatus }>) {
      state.memberStatuses[action.payload.pubkey] = action.payload.status
    },
    locationReceived(state, action: PayloadAction<DecryptedLocation & { pubkey: string }>) {
      const { pubkey, ...location } = action.payload
      state.decryptedLocations[pubkey] = location
      state.memberStatuses[pubkey] = 'ONLINE'
    },
    memberRemoved(state, action: PayloadAction<{ circle_id: string; pubkey?: string; token?: string }>) {
      const members = state.members[action.payload.circle_id]
      if (members) {
        state.members[action.payload.circle_id] = members.filter(m =>
          action.payload.pubkey !== undefined
            ? m.pubkey !== action.payload.pubkey
            : m.member_token !== action.payload.token,
        )
      }
      if (action.payload.pubkey) {
        delete state.decryptedLocations[action.payload.pubkey]
        delete state.memberStatuses[action.payload.pubkey]
      }
    },
    memberAccepted(state, action: PayloadAction<{ circle_id: string; pubkey: string }>) {
      const members = state.members[action.payload.circle_id]
      if (members) {
        for (const m of members) {
          if (m.pubkey && m.pubkey.toLowerCase() === action.payload.pubkey.toLowerCase()) {
            m.membership_state = 'ACTIVE'
          }
        }
      }
    },
    locationsPruned(state, action: PayloadAction<{ now: number }>) {
      const now = action.payload.now
      for (const [pubkey, loc] of Object.entries(state.decryptedLocations)) {
        if (loc.expires_at !== undefined && loc.expires_at <= now) {
          delete state.decryptedLocations[pubkey]
        }
      }
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
    circleDecryptError(state, action: PayloadAction<string>) {
      // keep only the last 3 errors to avoid unbounded growth
      state.decryptErrors = [action.payload, ...state.decryptErrors].slice(0, 3)
    },
    circleLeft(state) {
      state.circles = []
      state.activeCircleId = null
      state.members = {}
      state.epochs = {}
      state.memberStatuses = {}
      state.decryptedLocations = {}
      state.proximityAlerts = []
      state.activeAlert = null
      state.decryptErrors = []
    },
  },
})

export const {
  circleLoaded,
  circleEpochChanged,
  memberStatusUpdated,
  locationReceived,
  memberRemoved,
  memberAccepted,
  locationsPruned,
  proximityAlertAdded,
  activeAlertDismissed,
  circleDecryptError,
  circleLeft,
} = circlesSlice.actions
export default circlesSlice.reducer
