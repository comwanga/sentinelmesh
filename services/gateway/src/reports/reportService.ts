import { getPool } from '../db/pool'
import type { CommunityReport } from '../../../../shared/types'

export interface CreateReportInput {
  report_type: string
  description: string | null
  lat: number
  lng: number
  place_name: string | null
  nostr_pubkey: string
  nostr_signature: string
  nostr_event_id: string
  photo_ipfs_cid: string | null
  linked_event_id: string | null
}

const TIER_SCORES: Record<string, number> = {
  NEWCOMER: 1, TRUSTED: 2, VETERAN: 3, SENTINEL: 4,
}

export async function createReport(input: CreateReportInput): Promise<CommunityReport> {
  const pool = getPool()

  await pool.query(
    `INSERT INTO users (nostr_pubkey) VALUES ($1)
     ON CONFLICT (nostr_pubkey) DO UPDATE
       SET last_active = NOW(), total_reports = users.total_reports + 1`,
    [input.nostr_pubkey]
  )

  const userRow = await pool.query(
    'SELECT reputation_tier FROM users WHERE nostr_pubkey = $1',
    [input.nostr_pubkey]
  )
  const tier: string = userRow.rows[0]?.reputation_tier ?? 'NEWCOMER'
  const initialScore = TIER_SCORES[tier] ?? 1

  const result = await pool.query(
    `INSERT INTO community_reports
       (report_type, description, lat, lng, place_name,
        nostr_pubkey, nostr_signature, nostr_event_id,
        reporter_tier, consensus_score, photo_ipfs_cid, linked_event_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      input.report_type, input.description, input.lat, input.lng, input.place_name,
      input.nostr_pubkey, input.nostr_signature, input.nostr_event_id,
      tier, initialScore, input.photo_ipfs_cid, input.linked_event_id,
    ]
  )
  return rowToReport(result.rows[0])
}

export interface CastVoteInput {
  report_id: string
  voter_pubkey: string
  vote: 'CONFIRM' | 'DENY'
  voter_lat: number | null
  voter_lng: number | null
}

export async function castVote(input: CastVoteInput): Promise<CommunityReport> {
  const pool = getPool()

  const reportRes = await pool.query(
    'SELECT * FROM community_reports WHERE id = $1',
    [input.report_id]
  )
  if (reportRes.rowCount === 0) throw new Error('report not found')
  if (reportRes.rows[0].nostr_pubkey === input.voter_pubkey) throw new Error('cannot vote on own report')

  await pool.query(
    `INSERT INTO report_votes (report_id, voter_pubkey, vote, voter_lat, voter_lng)
     VALUES ($1,$2,$3,$4,$5)`,
    [input.report_id, input.voter_pubkey, input.vote, input.voter_lat, input.voter_lng]
  )

  const nearby = await isNearby(pool, input, reportRes.rows[0])
  const { scoreDelta, confirmDelta, denyDelta } = voteDeltas(input.vote, nearby)

  const updated = await pool.query(
    `UPDATE community_reports
     SET consensus_score    = consensus_score    + $1,
         confirmation_count = confirmation_count + $2,
         denial_count       = denial_count       + $3,
         updated_at         = NOW()
     WHERE id = $4
     RETURNING *`,
    [scoreDelta, confirmDelta, denyDelta, input.report_id]
  )
  return rowToReport(updated.rows[0])
}

export async function applyStatusTransition(report: CommunityReport, newStatus: string): Promise<void> {
  const pool = getPool()
  await pool.query(
    'UPDATE community_reports SET status = $1, updated_at = NOW() WHERE id = $2',
    [newStatus, report.report_id]
  )
  if (newStatus === 'VERIFIED') {
    await pool.query(
      `UPDATE users
       SET accurate_reports = accurate_reports + 1,
           reputation_score = reputation_score + 10
       WHERE nostr_pubkey = $1`,
      [report.nostr_pubkey]
    )
    await refreshReputationTier(report.nostr_pubkey)
  }
}

async function refreshReputationTier(pubkey: string): Promise<void> {
  const pool = getPool()
  const res = await pool.query(
    'SELECT accurate_reports FROM users WHERE nostr_pubkey = $1',
    [pubkey]
  )
  const count: number = res.rows[0]?.accurate_reports ?? 0
  const tier =
    count >= 50 ? 'SENTINEL' :
    count >= 20 ? 'VETERAN'  :
    count >= 5  ? 'TRUSTED'  : 'NEWCOMER'
  await pool.query(
    'UPDATE users SET reputation_tier = $1 WHERE nostr_pubkey = $2',
    [tier, pubkey]
  )
}

export interface ListReportsParams {
  lat?: number
  lng?: number
  radius_km?: number
  status?: string
  reporter_tier?: string
  linked_event_id?: string
  limit?: number
}

export async function listReports(params: ListReportsParams): Promise<CommunityReport[]> {
  const pool = getPool()
  const conditions: string[] = []
  const values: unknown[] = []

  if (params.status) {
    values.push(params.status.toUpperCase())
    conditions.push(`status = $${values.length}`)
  }
  if (params.reporter_tier) {
    values.push(params.reporter_tier.toUpperCase())
    conditions.push(`reporter_tier = $${values.length}`)
  }
  if (params.linked_event_id) {
    values.push(params.linked_event_id)
    conditions.push(`linked_event_id = $${values.length}`)
  }
  if (params.lat != null && params.lng != null) {
    const radiusM = (params.radius_km ?? 10) * 1000
    values.push(params.lat, params.lng, radiusM)
    conditions.push(
      `earth_distance(ll_to_earth($${values.length - 2},$${values.length - 1}), ll_to_earth(lat,lng)) <= $${values.length}`
    )
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  values.push(params.limit ?? 50)

  const result = await pool.query(
    `SELECT * FROM community_reports ${where} ORDER BY created_at DESC LIMIT $${values.length}`,
    values
  )
  return result.rows.map(rowToReport)
}

export function rowToReport(row: Record<string, unknown>): CommunityReport {
  return {
    report_id:          row['id'] as string,
    report_type:        row['report_type'] as CommunityReport['report_type'],
    description:        row['description'] as string | null,
    lat:                parseFloat(row['lat'] as string),
    lng:                parseFloat(row['lng'] as string),
    place_name:         row['place_name'] as string | null,
    nostr_pubkey:       row['nostr_pubkey'] as string,
    nostr_signature:    row['nostr_signature'] as string,
    nostr_event_id:     row['nostr_event_id'] as string | null,
    reporter_tier:      row['reporter_tier'] as CommunityReport['reporter_tier'],
    consensus_score:    row['consensus_score'] as number,
    status:             row['status'] as CommunityReport['status'],
    confirmation_count: row['confirmation_count'] as number,
    denial_count:       row['denial_count'] as number,
    photo_ipfs_cid:     row['photo_ipfs_cid'] as string | null,
    linked_event_id:    row['linked_event_id'] as string | null,
    created_at:         (row['created_at'] as Date).toISOString(),
    updated_at:         (row['updated_at'] as Date).toISOString(),
  }
}

async function isNearby(pool: ReturnType<typeof getPool>, input: CastVoteInput, reportRow: Record<string, unknown>): Promise<boolean> {
  if (input.voter_lat == null || input.voter_lng == null) return false
  const res = await pool.query(
    'SELECT earth_distance(ll_to_earth($1,$2), ll_to_earth($3,$4)) <= 1000 AS nearby',
    [input.voter_lat, input.voter_lng, reportRow['lat'], reportRow['lng']]
  )
  return res.rows[0]?.nearby ?? false
}

function voteDeltas(vote: string, nearby: boolean) {
  if (vote === 'CONFIRM') return { scoreDelta: nearby ? 2 : 1, confirmDelta: 1, denyDelta: 0 }
  return { scoreDelta: nearby ? -3 : -2, confirmDelta: 0, denyDelta: 1 }
}
