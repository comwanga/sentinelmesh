import { Router, Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { getPool } from '../db/pool'
import { requireNostrAuth } from '../middleware/nostrAuth'

export const circlesRouter = Router()

// POST /api/circles
circlesRouter.post('/', requireNostrAuth, async (req: Request, res: Response) => {
  const { name } = req.body as { name?: string }
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ code: 'INVALID_INPUT', message: 'name is required', retryable: false })
    return
  }
  const circle_id = randomUUID()
  const pool = getPool()
  try {
    const result = await pool.query(
      'INSERT INTO circles (circle_id, owner_pubkey, name) VALUES ($1, $2, $3) RETURNING *',
      [circle_id, req.nostrPubkey, name.trim()],
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('POST /api/circles error:', err)
    res.status(500).json({ code: 'DB_ERROR', message: 'Could not create circle', retryable: true })
  }
})

// GET /api/circles/:id
circlesRouter.get('/:id', requireNostrAuth, async (req: Request, res: Response) => {
  const pool = getPool()
  try {
    const [circleResult, membersResult] = await Promise.all([
      pool.query('SELECT * FROM circles WHERE circle_id = $1', [req.params['id']]),
      pool.query('SELECT * FROM circle_members WHERE circle_id = $1', [req.params['id']]),
    ])
    if (circleResult.rowCount === 0) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Circle not found', retryable: false })
      return
    }
    res.json({ ...circleResult.rows[0], members: membersResult.rows })
  } catch (err) {
    console.error('GET /api/circles/:id error:', err)
    res.status(500).json({ code: 'DB_ERROR', message: 'Could not fetch circle', retryable: true })
  }
})

// POST /api/circles/:id/members
circlesRouter.post('/:id/members', requireNostrAuth, async (req: Request, res: Response) => {
  const pool = getPool()
  const { member_pubkey, alert_radius_km = 1, alert_severity = 'HIGH' } = req.body as {
    member_pubkey?: string
    alert_radius_km?: number
    alert_severity?: string
  }
  if (!member_pubkey) {
    res.status(400).json({ code: 'INVALID_INPUT', message: 'member_pubkey is required', retryable: false })
    return
  }
  try {
    const circleResult = await pool.query(
      'SELECT owner_pubkey FROM circles WHERE circle_id = $1', [req.params['id']],
    )
    if (circleResult.rowCount === 0) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Circle not found', retryable: false })
      return
    }
    if (circleResult.rows[0].owner_pubkey !== req.nostrPubkey) {
      res.status(403).json({ code: 'FORBIDDEN', message: 'Only the circle owner can add members', retryable: false })
      return
    }
    const result = await pool.query(
      `INSERT INTO circle_members (circle_id, member_pubkey, alert_radius_km, alert_severity)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (circle_id, member_pubkey) DO UPDATE
         SET alert_radius_km = EXCLUDED.alert_radius_km,
             alert_severity  = EXCLUDED.alert_severity
       RETURNING *`,
      [req.params['id'], member_pubkey, alert_radius_km, alert_severity],
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('POST /api/circles/:id/members error:', err)
    res.status(500).json({ code: 'DB_ERROR', message: 'Could not add member', retryable: true })
  }
})

// DELETE /api/circles/:id/members/:pubkey
circlesRouter.delete('/:id/members/:pubkey', requireNostrAuth, async (req: Request, res: Response) => {
  const pool = getPool()
  const { id, pubkey } = req.params as { id: string; pubkey: string }
  const isSelf = req.nostrPubkey === pubkey
  try {
    if (!isSelf) {
      const circleResult = await pool.query('SELECT owner_pubkey FROM circles WHERE circle_id = $1', [id])
      if (circleResult.rowCount === 0 || circleResult.rows[0].owner_pubkey !== req.nostrPubkey) {
        res.status(403).json({ code: 'FORBIDDEN', message: 'Only owner or self can remove members', retryable: false })
        return
      }
    }
    await pool.query('DELETE FROM circle_members WHERE circle_id = $1 AND member_pubkey = $2', [id, pubkey])
    res.status(204).send()
  } catch (err) {
    console.error('DELETE /api/circles/:id/members/:pubkey error:', err)
    res.status(500).json({ code: 'DB_ERROR', message: 'Could not remove member', retryable: true })
  }
})

// DELETE /api/circles/:id
circlesRouter.delete('/:id', requireNostrAuth, async (req: Request, res: Response) => {
  const pool = getPool()
  try {
    const circleResult = await pool.query('SELECT owner_pubkey FROM circles WHERE circle_id = $1', [req.params['id']])
    if (circleResult.rowCount === 0) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Circle not found', retryable: false })
      return
    }
    if (circleResult.rows[0].owner_pubkey !== req.nostrPubkey) {
      res.status(403).json({ code: 'FORBIDDEN', message: 'Only owner can delete circle', retryable: false })
      return
    }
    await pool.query('DELETE FROM circles WHERE circle_id = $1', [req.params['id']])
    res.status(204).send()
  } catch (err) {
    console.error('DELETE /api/circles/:id error:', err)
    res.status(500).json({ code: 'DB_ERROR', message: 'Could not delete circle', retryable: true })
  }
})
