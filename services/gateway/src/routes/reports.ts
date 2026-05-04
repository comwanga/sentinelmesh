import { Router, Request, Response } from 'express'
import { getPool } from '../db/pool'
import { nudgeBlockchain } from '../utils/nudge'

export const reportsRouter = Router()

// GET /api/reports — list community reports
reportsRouter.get('/', async (req: Request, res: Response) => {
  const pool = getPool()
  const { lat, lng, radius_km = '10', limit = '50' } = req.query
  const params: unknown[] = []
  const conditions: string[] = []

  if (lat && lng) {
    const latNum = parseFloat(String(lat))
    const lngNum = parseFloat(String(lng))
    const radiusMeters = parseFloat(String(radius_km)) * 1000
    params.push(latNum, lngNum, radiusMeters)
    conditions.push(
      `earth_distance(ll_to_earth($${params.length - 2}, $${params.length - 1}), ll_to_earth(lat, lng)) <= $${params.length}`
    )
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  params.push(parseInt(String(limit), 10))

  try {
    const result = await pool.query(
      `SELECT * FROM community_reports ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    )
    res.json({ reports: result.rows, total: result.rowCount })
  } catch (err) {
    console.error('GET /api/reports error:', err)
    res.status(500).json({ code: 'DB_ERROR', message: 'Could not fetch reports', retryable: true })
  }
})

// GET /api/reports/:id
reportsRouter.get('/:id', async (req: Request, res: Response) => {
  const pool = getPool()
  try {
    const result = await pool.query(
      'SELECT * FROM community_reports WHERE id = $1',
      [req.params['id']]
    )
    if (result.rowCount === 0) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Report not found', retryable: false })
      return
    }
    res.json(result.rows[0])
  } catch (err) {
    console.error('GET /api/reports/:id error:', err)
    res.status(500).json({ code: 'DB_ERROR', message: 'Could not fetch report', retryable: true })
  }
})

// POST /api/reports — submit a new community report
reportsRouter.post('/', async (req: Request, res: Response) => {
  const pool = getPool()
  const body = req.body as {
    report_type?: string
    description?: string
    lat?: number
    lng?: number
    place_name?: string
    nostr_pubkey?: string
    nostr_signature?: string
    nostr_event_id?: string
    reporter_tier?: string
    photo_ipfs_cid?: string
    linked_event_id?: string
  }

  if (!body.report_type || !body.lat || !body.lng || !body.nostr_pubkey || !body.nostr_signature) {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: 'Missing required fields: report_type, lat, lng, nostr_pubkey, nostr_signature',
      retryable: false,
    })
    return
  }

  try {
    const result = await pool.query(
      `INSERT INTO community_reports (
        report_type, description, lat, lng, place_name,
        nostr_pubkey, nostr_signature, nostr_event_id,
        reporter_tier, photo_ipfs_cid, linked_event_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *`,
      [
        body.report_type,
        body.description ?? null,
        body.lat,
        body.lng,
        body.place_name ?? null,
        body.nostr_pubkey,
        body.nostr_signature,
        body.nostr_event_id ?? null,
        body.reporter_tier ?? 'NEWCOMER',
        body.photo_ipfs_cid ?? null,
        body.linked_event_id ?? null,
      ]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('POST /api/reports error:', err)
    res.status(500).json({ code: 'DB_ERROR', message: 'Could not create report', retryable: true })
  }
})

// POST /api/reports/:id/vote — cast a vote on a community report
reportsRouter.post('/:id/vote', async (req: Request, res: Response) => {
  const pool = getPool()
  const reportId = req.params['id']
  const body = req.body as {
    voter_pubkey?: string
    vote?: string
    voter_lat?: number
    voter_lng?: number
  }

  if (!body.voter_pubkey || !body.vote) {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: 'Missing required fields: voter_pubkey, vote',
      retryable: false,
    })
    return
  }

  if (!['CONFIRM', 'DENY'].includes(String(body.vote).toUpperCase())) {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: 'vote must be CONFIRM or DENY',
      retryable: false,
    })
    return
  }

  try {
    // Fetch the report to get current consensus_score before the vote
    const reportResult = await pool.query(
      'SELECT * FROM community_reports WHERE id = $1',
      [reportId]
    )
    if (reportResult.rowCount === 0) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Report not found', retryable: false })
      return
    }

    const existingReport = reportResult.rows[0] as { id: string; consensus_score: number; confirmation_count: number; denial_count: number }
    const previousScore = existingReport.consensus_score

    // Insert the vote (unique constraint on report_id + voter_pubkey prevents duplicates)
    try {
      await pool.query(
        `INSERT INTO report_votes (report_id, voter_pubkey, vote, voter_lat, voter_lng)
         VALUES ($1, $2, $3, $4, $5)`,
        [reportId, body.voter_pubkey, body.vote.toUpperCase(), body.voter_lat ?? null, body.voter_lng ?? null]
      )
    } catch (voteErr: unknown) {
      // Unique constraint violation means duplicate vote
      if ((voteErr as { code?: string }).code === '23505') {
        res.status(409).json({ code: 'DUPLICATE_VOTE', message: 'Already voted on this report', retryable: false })
        return
      }
      throw voteErr
    }

    // Update confirmation/denial counts and consensus_score
    const isConfirm = body.vote.toUpperCase() === 'CONFIRM'
    const updatedResult = await pool.query(
      `UPDATE community_reports
       SET confirmation_count = confirmation_count + $1,
           denial_count = denial_count + $2,
           consensus_score = consensus_score + $3,
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [
        isConfirm ? 1 : 0,
        isConfirm ? 0 : 1,
        isConfirm ? 1 : -1,
        reportId,
      ]
    )

    const updatedReport = updatedResult.rows[0] as { id: string; consensus_score: number }
    const newScore = updatedReport.consensus_score

    // Enqueue a publish_job when consensus_score crosses 3 for the first time
    if (previousScore < 3 && newScore >= 3) {
      await pool.query(
        `INSERT INTO publish_jobs (source_type, source_id)
         VALUES ('COMMUNITY_REPORT', $1)
         ON CONFLICT DO NOTHING`,
        [reportId],
      )
      nudgeBlockchain()  // fire-and-forget
    }

    res.json(updatedReport)
  } catch (err) {
    console.error('POST /api/reports/:id/vote error:', err)
    res.status(500).json({ code: 'DB_ERROR', message: 'Could not process vote', retryable: true })
  }
})
