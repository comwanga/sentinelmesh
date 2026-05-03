import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { circlesRouter } from '../circles'

vi.mock('../../db/pool', () => ({
  getPool: () => ({
    query: vi.fn().mockImplementation((sql: string, params: unknown[]) => {
      if (sql.includes('INSERT INTO circles')) {
        return { rows: [{ circle_id: 'c1', owner_pubkey: params![1], name: params![0], created_at: new Date().toISOString() }], rowCount: 1 }
      }
      if (sql.includes('SELECT * FROM circles')) {
        return { rows: [{ circle_id: 'c1', owner_pubkey: 'aaa', name: 'Test', created_at: '' }], rowCount: 1 }
      }
      if (sql.includes('circle_members')) {
        return { rows: [], rowCount: 0 }
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
  app.use('/api/circles', circlesRouter)
  return app
}

describe('POST /api/circles', () => {
  it('creates a circle and returns circle_id', async () => {
    const res = await request(makeApp())
      .post('/api/circles')
      .send({ name: 'Wanga Family' })
    expect(res.status).toBe(201)
    expect(res.body.circle_id).toBe('c1')
  })

  it('returns 400 when name is missing', async () => {
    const res = await request(makeApp()).post('/api/circles').send({})
    expect(res.status).toBe(400)
  })
})

describe('GET /api/circles/:id', () => {
  it('returns circle with members array', async () => {
    const res = await request(makeApp()).get('/api/circles/c1')
    expect(res.status).toBe(200)
    expect(res.body.circle_id).toBe('c1')
    expect(Array.isArray(res.body.members)).toBe(true)
  })
})
