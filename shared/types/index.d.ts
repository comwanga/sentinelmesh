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

export type ReportStatus =
  | 'PENDING'
  | 'UNVERIFIED'
  | 'VERIFIED'
  | 'AUTHORITATIVE'
  | 'DISPUTED'
  | 'REJECTED'

export type ReporterTier = 'NEWCOMER' | 'TRUSTED' | 'VETERAN' | 'SENTINEL'

export interface EventLocation {
  place_name: string | null
  lat: number
  lng: number
  county: string | null
  /** Optional — present when source is a known gazetteer entry */
  radius_meters?: number
}

export interface SafetyEvent {
  event_id: string
  event_type: EventType
  severity: Severity
  /** Max 200 characters */
  title: string
  summary: string | null
  location: EventLocation | null
  /** 0.0–1.0 */
  confidence: number
  source_count: number
  source_breakdown: Record<string, number>
  is_active: boolean
  started_at: string
  last_updated: string
  nostr_event_id: string | null
  bitcoin_txid: string | null
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
  report_id: string
  report_type: ReportType
  description: string | null
  lat: number
  lng: number
  place_name: string | null
  nostr_pubkey: string
  nostr_signature: string
  nostr_event_id: string | null
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
  | { type: 'EVENT_RESOLVED';  payload: { event_id: string } }
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

export interface Circle {
  circle_id: string
  owner_pubkey: string
  name: string
  created_at: string
}

export interface CircleMember {
  circle_id: string
  member_pubkey: string
  alert_radius_km: number
  alert_severity: Severity
  joined_at: string
}

export interface ProximityAlert {
  id: string
  member_pubkey: string
  zone_name: string
  event_id: string | null
  severity: Severity
  triggered_at: string
}

export type CircleWsMessage =
  | { type: 'CIRCLE_LOCATION_BLOB'; payload: { sender_pubkey: string; encrypted_payload: string; sent_at: string } }
  | { type: 'CIRCLE_PRESENCE';      payload: { sender_pubkey: string; mode: PresenceMode } }
