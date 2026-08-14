// Shared TypeScript types for SentinelMesh services.
// EventType, Severity, SafetyEvent are derived from shared/contracts/events.schema.json.
// Community Reports types (CommunityReport, ReportVote, ReportType) are maintained here directly.

export type EventType =
  | 'TRAFFIC_INCIDENT'
  | 'FLOOD'
  | 'CIVIL_UNREST'
  | 'SECURITY_INCIDENT'
  | 'FIRE'
  | 'MEDICAL_EMERGENCY'
  | 'INFRASTRUCTURE_FAILURE'
  | 'FALSE_ALARM'

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

export type EventState =
  | 'REPORTED'
  | 'ACTIVE'
  | 'UPDATED'
  | 'RESOLVED'
  | 'EXPIRED'

export type ReportStatus =
  | 'PENDING'
  | 'UNVERIFIED'
  | 'VERIFIED'
  | 'AUTHORITATIVE'
  | 'DISPUTED'
  | 'REJECTED'

export type ReporterTier = 'NEWCOMER' | 'TRUSTED' | 'VETERAN' | 'SENTINEL'

// H-5 NLP trust ladder. Machine-origin detections enter as `heuristic` (visible
// but unverified), climb to `corroborating`, then `confirmed` once independent
// sources across channels agree. `origin_class` records whether the evidence is
// machine- or human-generated.
export type TrustState = 'heuristic' | 'corroborating' | 'confirmed'
export type OriginClass = 'machine' | 'human'

export interface SafetyEvent {
  id: string
  event_type: EventType
  severity: Severity
  title: string
  summary?: string | null
  lat: number
  lng: number
  place_name?: string | null
  county?: string | null
  is_active: boolean
  state: EventState
  started_at: string
  created_at: string
  updated_at?: string
  radius_meters?: number | null
  confidence?: number | null
  source_count?: number | null
  source_breakdown?: Record<string, unknown> | null
  nostr_event_id?: string | null
  // Lightweight realtime projections omit these fields. Missing trust data is
  // unverified, never implicitly confirmed.
  trust_state?: TrustState
  origin_class?: OriginClass
}

export type ReportType =
  | 'ROAD_BLOCKED'
  | 'FLOODING'
  | 'SECURITY_INCIDENT'
  | 'FIRE'
  | 'PROTEST_MARCH'
  | 'ACCIDENT'
  | 'INFRASTRUCTURE'
  | 'ALL_CLEAR'
  | 'OTHER'

export interface CommunityReport {
  id: string
  report_type: ReportType
  description: string | null
  lat: number
  lng: number
  place_name: string | null
  reporter_tier: ReporterTier
  consensus_score: number
  status: ReportStatus
  confirmation_count: number
  denial_count: number
  photo_ipfs_cid: string | null
  linked_event_id: string | null
  created_at: string
  updated_at: string
}

export interface ReportVote {
  vote_id: string
  report_id: string
  voter_pubkey: string
  vote: 'CONFIRM' | 'DENY'
  voter_lat: number | null
  voter_lng: number | null
  created_at: string
}

export type WsMessage =
  | { type: 'NEW_EVENT';       payload: SafetyEvent }
  | { type: 'EVENT_UPDATED';   payload: SafetyEvent }
  | { type: 'EVENT_RESOLVED';  payload: { id: string } }
  | { type: 'NEW_REPORT';      payload: CommunityReport }
  | { type: 'REPORT_UPDATED';  payload: CommunityReport }
  | { type: 'PROXIMITY_ALERT'; payload: Record<string, unknown> }

export interface SentinelError {
  code: string
  message: string
  retryable: boolean
  context?: Record<string, unknown>
}

export type MemberStatus = 'ONLINE' | 'GHOST' | 'OFFLINE'

export type PresenceMode = 'GHOST' | 'OFFLINE'

export type MembershipState = 'PENDING' | 'ACTIVE'

export interface Circle {
  circle_id: string
  name?: string | null
  name_ciphertext?: string | null
  name_version?: number
  key_epoch?: number
  location_protocol_version?: number
  rekey_required?: boolean
  membership_revision?: number
  self_token?: string
  created_at: string
  is_owner?: boolean
}

export interface CircleMember {
  circle_id: string
  // Present only for the circle owner; null for other members (token privacy).
  member_token?: string | null
  alert_radius_km: number
  alert_severity: Severity
  joined_at: string
  member_label_ciphertext?: string | null
  membership_state?: MembershipState
  accepted_at?: string | null
  key_wrap_epoch?: number | null
  pubkey?: string
  label?: string
}

export interface ProximityAlert {
  id: string
  member_pubkey: string
  zone_name: string
  event_id: string | null
  severity: Severity
  triggered_at: string
}

export interface CircleLocationEnvelopeV1 {
  id: string
  version: 1
  circle_id: string
  key_epoch: number
  ciphertext: string
  created_at: string
  expires_at: string
}

export interface CircleEpochChange {
  circle_id: string
  key_epoch: number
  rekey_required: boolean
}

export interface CircleMemberRemoved {
  circle_id: string
  key_epoch: number
  token: string
}

export type CircleWsMessage =
  | { type: 'CIRCLE_LOCATION_SNAPSHOT'; payload: CircleLocationEnvelopeV1[] }
  | { type: 'CIRCLE_LOCATION_ENVELOPE'; payload: CircleLocationEnvelopeV1 }
  | { type: 'CIRCLE_EPOCH_CHANGED'; payload: CircleEpochChange }
  | { type: 'CIRCLE_MEMBER_REMOVED'; payload: CircleMemberRemoved }

/** v2 circle key package carried as the content of a signed kind-30079 event. */
export interface CircleKeyPackageV2 {
  version: 2
  type: 'sentinelmesh-circle-key-v2'
  circle_id: string
  key_epoch: number
  algorithm: 'AES-256-GCM'
  key: string
  issued_at: number
}

/** A decrypted, verified member location (kept in memory only, never persisted). */
export interface VerifiedMemberLocation {
  pubkey: string
  lat: number
  lng: number
  accuracy_m: number
  precision: 'exact' | 'approximate'
  event_id: string
  expires_at: number
  captured_at: number
}
