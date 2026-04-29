// Generated from shared/contracts/events.schema.json
// Do not edit by hand — update the schema and regenerate.

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
  radius_meters: number
}

export interface SafetyEvent {
  event_id: string
  event_type: EventType
  severity: Severity
  title: string
  summary: string | null
  location: EventLocation | null
  confidence: number
  source_count: number
  source_breakdown: Record<string, number>
  is_active: boolean
  started_at: string
  last_updated: string
  nostr_event_id: string | null
  bitcoin_txid: string | null
}

export interface WsMessage {
  type: 'NEW_EVENT' | 'EVENT_UPDATED' | 'EVENT_RESOLVED' | 'NEW_REPORT' | 'PROXIMITY_ALERT'
  payload: SafetyEvent | Record<string, unknown>
}

export interface SentinelError {
  code: string
  message: string
  retryable: boolean
  context?: Record<string, unknown>
}
