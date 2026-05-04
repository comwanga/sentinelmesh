import { Router, Request, Response } from 'express'
import { getPool } from '../db/pool'
import { nudgeBlockchain } from '../utils/nudge'

export const eventsRouter = Router()

// POST /api/events — create a new safety event
eventsRouter.post('/', async (req: Request, res: Response) => {
  const pool = getPool()
  const body = req.body as {
    event_type?: string
    severity?: string
    title?: string
    summary?: string
    lat?: number
    lng?: number
    place_name?: string
    county?: string
    radius_meters?: number
    confidence?: number
    source_count?: number
    source_breakdown?: Record<string, number>
    is_active?: boolean
    started_at?: string
  }

  if (!body.event_type || !body.severity || !body.title || !body.lat || !body.lng || !body.started_at) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Missing required fields: event_type, severity, title, lat, lng, started_at', retryable: false })
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const result = await client.query(
      `INSERT INTO safety_events (
        event_type, severity, title, summary,
        lat, lng, place_name, county, radius_meters,
        confidence, source_count, source_breakdown,
        is_active, started_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *`,
      [
        body.event_type,
        body.severity,
        body.title,
        body.summary ?? null,
        body.lat,
        body.lng,
        body.place_name ?? null,
        body.county ?? null,
        body.radius_meters ?? 500,
        body.confidence ?? null,
        body.source_count ?? 1,
        JSON.stringify(body.source_breakdown ?? {}),
        body.is_active ?? true,
        body.started_at,
      ]
    )

    const newEvent = result.rows[0]

    if (['AUTHORITATIVE', 'CRITICAL'].includes(body.severity)) {
      await client.query(
        `INSERT INTO publish_jobs (source_type, source_id) VALUES ('SAFETY_EVENT', $1)`,
        [newEvent.id],
      )
    }

    await client.query('COMMIT')
    client.release()

    // nudge is fire-and-forget after commit, not inside transaction
    if (['AUTHORITATIVE', 'CRITICAL'].includes(body.severity)) {
      nudgeBlockchain()
    }

    res.status(201).json(newEvent)
  } catch (err) {
    await client.query('ROLLBACK')
    client.release()
    console.error('POST /api/events error:', err)
    res.status(500).json({ code: 'DB_ERROR', message: 'Could not create event', retryable: true })
  }
})

// GET /api/events?lat&lng&radius_km&severity&type&active_only
eventsRouter.get('/', async (req: Request, res: Response) => {
  const {
    lat, lng,
    radius_km = '10',
    severity,
    type,
    active_only = 'true',
    limit = '50',
  } = req.query

  const pool = getPool()
  const params: unknown[] = []
  const conditions: string[] = []

  if (active_only === 'true') {
    conditions.push('is_active = true')
  }

  if (severity) {
    const severities = String(severity).split(',').map(s => s.trim().toUpperCase())
    params.push(severities)
    conditions.push(`severity = ANY($${params.length}::text[])`)
  }

  if (type) {
    const types = String(type).split(',').map(t => t.trim().toUpperCase())
    params.push(types)
    conditions.push(`event_type = ANY($${params.length}::text[])`)
  }

  // Radius filter using PostGIS earthdistance (km to meters: * 1000)
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
      `SELECT * FROM safety_events ${where} ORDER BY started_at DESC LIMIT $${params.length}`,
      params
    )
    res.json({ events: result.rows, total: result.rowCount })
  } catch (err) {
    console.error('GET /api/events error:', err)
    res.status(500).json({ code: 'DB_ERROR', message: 'Could not fetch events', retryable: true })
  }
})

// GET /api/events/:id
eventsRouter.get('/:id', async (req: Request, res: Response) => {
  const pool = getPool()
  try {
    const result = await pool.query(
      'SELECT * FROM safety_events WHERE id = $1',
      [req.params['id']]
    )
    if (result.rowCount === 0) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Event not found', retryable: false })
      return
    }
    res.json(result.rows[0])
  } catch (err) {
    console.error('GET /api/events/:id error:', err)
    res.status(500).json({ code: 'DB_ERROR', message: 'Could not fetch event', retryable: true })
  }
})
