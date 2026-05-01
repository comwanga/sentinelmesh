import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

process.env['ZAP_WEBHOOK_SECRET'] = 'testsecret32charsexactlyhereok!'
process.env['DATABASE_URL'] = 'postgres://test'
process.env['REDIS_URL'] = 'redis://test'
process.env['JWT_SECRET'] = 'testsecret'
process.env['INTERNAL_SERVICE_SECRET'] = 'testinternalsecret'

vi.mock('../src/config', () => ({
  config: {
    port: 3000, nodeEnv: 'test', databaseUrl: 'postgres://test',
    redisUrl: 'redis://test', jwtSecret: 'testsecret',
    internalSecret: 'testinternalsecret', zapWebhookSecret: 'testsecret32charsexactlyhereok!',
  },
}))

vi.mock('../src/nostr/verifier', () => ({ verifyNostrSignature: vi.fn() }))
vi.mock('../src/reports/reportService', () => ({
  createReport: vi.fn(),
  castVote: vi.fn(),
  listReports: vi.fn(),
  applyStatusTransition: vi.fn(),
}))
vi.mock('../src/reports/consensusEngine', () => ({ computeNewStatus: vi.fn() }))

import { verifyNostrSignature } from '../src/nostr/verifier'
import { createReport, castVote, listReports, applyStatusTransition } from '../src/reports/reportService'
import { computeNewStatus } from '../src/reports/consensusEngine'
import { createReportsRouter } from '../src/routes/reports'

const mockVerify        = verifyNostrSignature    as ReturnType<typeof vi.fn>
const mockCreate        = createReport            as ReturnType<typeof vi.fn>
const mockVote          = castVote                as ReturnType<typeof vi.fn>
const mockList          = listReports             as ReturnType<typeof vi.fn>
const mockApply         = applyStatusTransition   as ReturnType<typeof vi.fn>
const mockCompute       = computeNewStatus        as ReturnType<typeof vi.fn>
const mockHub           = { broadcast: vi.fn() }

const app = express()
app.use(express.json())
app.use('/api/reports', createReportsRouter(mockHub as any))

const validEvent = {
  id: 'ev1', pubkey: 'pk1', created_at: 1000000,
  kind: 30078, tags: [], content: '{}', sig: 'sig1',
}

beforeEach(() => { vi.clearAllMocks(); mockVerify.mockReturnValue(true) })

describe('POST /api/reports', () => {
  it('201 and broadcasts NEW_REPORT on success', async () => {
    const fakeReport = { report_id: 'r1', status: 'PENDING', consensus_score: 1 }
    mockCreate.mockResolvedValueOnce(fakeReport)
    const res = await request(app)
      .post('/api/reports')
      .send({ report_type: 'FLOODING', lat: -1.29, lng: 36.82, nostr_pubkey: 'pk1', nostr_event: validEvent })
    expect(res.status).toBe(201)
    expect(res.body.report_id).toBe('r1')
    expect(mockHub.broadcast).toHaveBeenCalledWith(null, { type: 'NEW_REPORT', payload: fakeReport })
  })

  it('400 when report_type missing', async () => {
    const res = await request(app).post('/api/reports')
      .send({ lat: -1, lng: 36, nostr_pubkey: 'pk1', nostr_event: validEvent })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('VALIDATION_ERROR')
  })

  it('401 when signature invalid', async () => {
    mockVerify.mockReturnValueOnce(false)
    const res = await request(app).post('/api/reports')
      .send({ report_type: 'FLOODING', lat: -1, lng: 36, nostr_pubkey: 'pk1', nostr_event: validEvent })
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('INVALID_SIGNATURE')
  })

  it('401 when pubkey mismatch', async () => {
    const res = await request(app).post('/api/reports')
      .send({ report_type: 'FLOODING', lat: -1, lng: 36, nostr_pubkey: 'pk-other', nostr_event: validEvent })
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('PUBKEY_MISMATCH')
  })
})

describe('POST /api/reports/:id/vote', () => {
  it('200 and applies status transition', async () => {
    const fakeReport = {
      report_id: 'r1', status: 'PENDING', consensus_score: 3,
      confirmation_count: 1, denial_count: 0, nostr_pubkey: 'pk1',
    }
    mockVote.mockResolvedValueOnce(fakeReport)
    mockCompute.mockReturnValueOnce('UNVERIFIED')
    mockApply.mockResolvedValueOnce(undefined)
    const res = await request(app).post('/api/reports/r1/vote')
      .send({ voter_pubkey: 'pk2', vote: 'CONFIRM', voter_nostr_event: { ...validEvent, pubkey: 'pk2' } })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('UNVERIFIED')
    expect(mockHub.broadcast).toHaveBeenCalledWith(null, {
      type: 'REPORT_UPDATED', payload: expect.objectContaining({ status: 'UNVERIFIED' }),
    })
  })

  it('400 when vote value invalid', async () => {
    const res = await request(app).post('/api/reports/r1/vote')
      .send({ voter_pubkey: 'pk2', vote: 'MAYBE', voter_nostr_event: { ...validEvent, pubkey: 'pk2' } })
    expect(res.status).toBe(400)
  })

  it('404 when report not found', async () => {
    mockVote.mockRejectedValueOnce(new Error('report not found'))
    const res = await request(app).post('/api/reports/nope/vote')
      .send({ voter_pubkey: 'pk2', vote: 'CONFIRM', voter_nostr_event: { ...validEvent, pubkey: 'pk2' } })
    expect(res.status).toBe(404)
  })

  it('409 on duplicate vote (unique constraint code 23505)', async () => {
    const err = Object.assign(new Error('dup'), { code: '23505' })
    mockVote.mockRejectedValueOnce(err)
    const res = await request(app).post('/api/reports/r1/vote')
      .send({ voter_pubkey: 'pk2', vote: 'CONFIRM', voter_nostr_event: { ...validEvent, pubkey: 'pk2' } })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('ALREADY_VOTED')
  })

  it('403 when voter tries to vote on own report', async () => {
    mockVote.mockRejectedValueOnce(new Error('cannot vote on own report'))
    const res = await request(app).post('/api/reports/r1/vote')
      .send({ voter_pubkey: 'pk1', vote: 'CONFIRM', voter_nostr_event: { ...validEvent, pubkey: 'pk1' } })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('FORBIDDEN')
  })
})

describe('GET /api/reports', () => {
  it('200 with report list', async () => {
    mockList.mockResolvedValueOnce([{ report_id: 'r1' }])
    const res = await request(app).get('/api/reports')
    expect(res.status).toBe(200)
    expect(res.body.reports).toHaveLength(1)
    expect(res.body.total).toBe(1)
  })
})

describe('GET /api/reports/by-event/:event_id', () => {
  it('200 with reports linked to event', async () => {
    mockList.mockResolvedValueOnce([{ report_id: 'r1', linked_event_id: 'ev1' }])
    const res = await request(app).get('/api/reports/by-event/ev1')
    expect(res.status).toBe(200)
    expect(res.body.reports).toHaveLength(1)
    expect(res.body.total).toBe(1)
  })
})
