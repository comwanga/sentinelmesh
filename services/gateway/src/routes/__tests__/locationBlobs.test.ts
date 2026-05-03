import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import { createLocationBlobsRouter } from '../locationBlobs'
import type { CircleHub } from '../../ws/circleHub'

const mockHub: CircleHub = { broadcast: vi.fn() }

vi.mock('../../db/pool', () => ({
  getPool: () => ({
    query: vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('INSERT')) {
        return { rows: [{ blob_id: 'b1', sender_pubkey: 'aaa', encrypted_payload: 'abc', sent_at: new Date().toISOString(), expires_at: '' }], rowCount: 1 }
      }
      if (sql.includes('SELECT')) {
        return { rows: [{ blob_id: 'b1', sender_pubkey: 'aaa', encrypted_payload: 'abc', sent_at: new Date().toISOString() }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    }),
  }),
}))

vi.mock('../../middleware/nostrAuth', () => ({
  requireNostrAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.nostrPubkey = 'aaa'
    next()
  },
}))

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/circles', createLocationBlobsRouter(mockHub))
  return app
}

describe('POST /api/circles/:id/location', () => {
  it('stores blob and broadcasts to circle hub', async () => {
    const res = await request(makeApp())
      .post('/api/circles/c1/location')
      .send({ sender_pubkey: 'aaa', encrypted_payload: 'abc123' })
    expect(res.status).toBe(201)
    expect(mockHub.broadcast).toHaveBeenCalledWith('c1', expect.objectContaining({ type: 'CIRCLE_LOCATION_BLOB' }))
  })

  it('returns 400 when encrypted_payload is missing', async () => {
    const res = await request(makeApp())
      .post('/api/circles/c1/location')
      .send({ sender_pubkey: 'aaa' })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/circles/:id/location', () => {
  it('returns non-expired blobs', async () => {
    const res = await request(makeApp()).get('/api/circles/c1/location')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.blobs)).toBe(true)
  })
})
