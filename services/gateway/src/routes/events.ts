import { Router, Request, Response } from 'express'
import { getPool } from '../db/pool'

export const eventsRouter = Router()

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
