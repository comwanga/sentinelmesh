import { Router, Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { getPool } from '../db/pool'
import { requireNostrAuth } from '../middleware/nostrAuth'
import type { CircleHub } from '../ws/circleHub'

export function createLocationBlobsRouter(circleHub: CircleHub): Router {
  const router = Router({ mergeParams: true })

  // POST /api/circles/:id/location
  router.post('/:id/location', requireNostrAuth, async (req: Request, res: Response) => {
    const { encrypted_payload } = req.body as { encrypted_payload?: string }
    const circleId = (req.params as { id: string }).id

    if (!encrypted_payload) {
      res.status(400).json({ code: 'INVALID_INPUT', message: 'encrypted_payload is required', retryable: false })
      return
    }

    const pool = getPool()
    try {
      const result = await pool.query(
        `INSERT INTO location_blobs (blob_id, circle_id, sender_pubkey, encrypted_payload, expires_at)
         VALUES ($1, $2, $3, $4, NOW() + INTERVAL '10 minutes')
         RETURNING blob_id, sender_pubkey, encrypted_payload, sent_at`,
        [randomUUID(), circleId, req.nostrPubkey, encrypted_payload],
      )
      const blob = result.rows[0]
      circleHub.broadcast(circleId, {
        type: 'CIRCLE_LOCATION_BLOB',
        payload: { sender_pubkey: blob.sender_pubkey, encrypted_payload: blob.encrypted_payload, sent_at: blob.sent_at },
      })
      res.status(201).json(blob)
    } catch (err) {
      console.error('POST location blob error:', err)
      res.status(500).json({ code: 'DB_ERROR', message: 'Could not store location blob', retryable: true })
    }
  })

  // GET /api/circles/:id/location
  router.get('/:id/location', requireNostrAuth, async (req: Request, res: Response) => {
    const pool = getPool()
    try {
      const result = await pool.query(
        `SELECT sender_pubkey, encrypted_payload, sent_at
         FROM location_blobs
         WHERE circle_id = $1 AND expires_at > NOW()
         ORDER BY sent_at DESC`,
        [(req.params as { id: string }).id],
      )
      res.json({ blobs: result.rows })
    } catch (err) {
      console.error('GET location blobs error:', err)
      res.status(500).json({ code: 'DB_ERROR', message: 'Could not fetch blobs', retryable: true })
    }
  })

  return router
}
