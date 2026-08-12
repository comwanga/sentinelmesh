import type { CommunityReport, SafetyEvent } from '../../../../shared/types'

const API_BASE = import.meta.env['VITE_API_BASE_URL'] ?? ''

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function parseEvent(value: unknown): SafetyEvent | null {
  if (!isRecord(value) || typeof value['id'] !== 'string') return null
  if (typeof value['event_type'] !== 'string' || typeof value['severity'] !== 'string') return null
  if (typeof value['title'] !== 'string' || typeof value['lat'] !== 'number' || typeof value['lng'] !== 'number') return null
  if (typeof value['started_at'] !== 'string') return null

  const state = typeof value['state'] === 'string' ? value['state'] : 'ACTIVE'
  const trust = typeof value['trust_state'] === 'string' ? value['trust_state'].toLowerCase() : 'heuristic'
  return {
    ...value,
    id: value['id'],
    event_type: value['event_type'],
    severity: value['severity'],
    title: value['title'],
    lat: value['lat'],
    lng: value['lng'],
    state,
    is_active: typeof value['is_active'] === 'boolean'
      ? value['is_active']
      : state !== 'RESOLVED' && state !== 'EXPIRED',
    started_at: value['started_at'],
    created_at: typeof value['created_at'] === 'string' ? value['created_at'] : value['started_at'],
    trust_state: trust === 'confirmed' || trust === 'corroborating' ? trust : 'heuristic',
  } as SafetyEvent
}

export function parseReport(value: unknown): CommunityReport | null {
  if (!isRecord(value) || typeof value['id'] !== 'string') return null
  if (typeof value['report_type'] !== 'string' || typeof value['status'] !== 'string') return null
  if (typeof value['lat'] !== 'number' || typeof value['lng'] !== 'number') return null
  if (typeof value['reporter_tier'] !== 'string' || typeof value['consensus_score'] !== 'number') return null
  if (typeof value['confirmation_count'] !== 'number' || typeof value['denial_count'] !== 'number') return null
  if (typeof value['created_at'] !== 'string' || typeof value['updated_at'] !== 'string') return null
  return value as unknown as CommunityReport
}

async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`${API_BASE}${path}`, { signal })
  if (!response.ok) throw new Error(`request failed with status ${response.status}`)
  return response.json()
}

export async function fetchInitialEvents(signal?: AbortSignal): Promise<SafetyEvent[]> {
  const body = await getJson('/api/events?limit=200', signal)
  if (!isRecord(body) || !Array.isArray(body['events'])) throw new Error('invalid events response')
  return body['events'].map(parseEvent).filter((event): event is SafetyEvent => event !== null)
}

export async function fetchInitialReports(signal?: AbortSignal): Promise<CommunityReport[]> {
  const body = await getJson('/api/reports?limit=100', signal)
  if (!isRecord(body) || !Array.isArray(body['reports'])) throw new Error('invalid reports response')
  return body['reports'].map(parseReport).filter((report): report is CommunityReport => report !== null)
}
