import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'

// Set env vars before any module loads.
process.env['ZAP_WEBHOOK_SECRET'] = 'testsecret32charsexactlyhereok!'
process.env['DATABASE_URL'] = 'postgres://test'
process.env['REDIS_URL'] = 'redis://test'
process.env['JWT_SECRET'] = 'testsecret'
process.env['INTERNAL_SERVICE_SECRET'] = 'testinternalsecret'

// Mock config so require_env validation doesn't fail at module load time.
vi.mock('../src/config', () => ({
  config: {
    port: 3000,
    nodeEnv: 'test',
    databaseUrl: 'postgres://test',
    redisUrl: 'redis://test',
    jwtSecret: 'testsecret',
    internalSecret: 'testinternalsecret',
    zapWebhookSecret: 'testsecret32charsexactlyhereok!',
  },
}))

vi.mock('../src/lightning/zapService', () => ({
  createZapRequest: vi.fn(),
  handlePaymentWebhook: vi.fn(),
}))

import { createZapRequest, handlePaymentWebhook } from '../src/lightning/zapService'
import { buildTestApp } from './testApp'

const app = buildTestApp()

const mockCreateZapRequest = createZapRequest as ReturnType<typeof vi.fn>
const mockHandlePaymentWebhook = handlePaymentWebhook as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/zaps/request', () => {
  it('returns 201 with payment_request on valid input', async () => {
    mockCreateZapRequest.mockResolvedValueOnce({
      zap_id: 'zap-uuid-001',
      payment_request: 'lnbc500n1...',
      amount_sats: 1000,
    })

    const res = await request(app)
      .post('/api/zaps/request')
      .send({ report_id: 'report-uuid', amount_sats: 1000 })

    expect(res.status).toBe(201)
    expect(res.body.payment_request).toBe('lnbc500n1...')
    expect(res.body.zap_id).toBe('zap-uuid-001')
    expect(res.body.amount_sats).toBe(1000)
  })

  it('returns 400 when report_id is missing', async () => {
    const res = await request(app)
      .post('/api/zaps/request')
      .send({ amount_sats: 1000 })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('VALIDATION_ERROR')
    expect(res.body.retryable).toBe(false)
  })

  it('returns 400 when amount_sats is missing', async () => {
    const res = await request(app)
      .post('/api/zaps/request')
      .send({ report_id: 'report-uuid' })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('VALIDATION_ERROR')
    expect(res.body.retryable).toBe(false)
  })

  it('returns 404 when service throws "report not found"', async () => {
    mockCreateZapRequest.mockRejectedValueOnce(new Error('report not found'))

    const res = await request(app)
      .post('/api/zaps/request')
      .send({ report_id: 'missing-id', amount_sats: 500 })

    expect(res.status).toBe(404)
    expect(res.body.code).toBe('NOT_FOUND')
    expect(res.body.retryable).toBe(false)
  })
})

describe('POST /api/zaps/webhook', () => {
  it('returns 200 with valid HMAC', async () => {
    mockHandlePaymentWebhook.mockResolvedValueOnce(undefined)

    const payload = JSON.stringify({ payment_hash: 'abc123' })
    const sig = crypto
      .createHmac('sha256', 'testsecret32charsexactlyhereok!')
      .update(payload)
      .digest('hex')

    const res = await request(app)
      .post('/api/zaps/webhook')
      .set('Content-Type', 'application/json')
      .set('x-lnd-signature', sig)
      .send(payload)

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('returns 401 with invalid HMAC', async () => {
    const payload = JSON.stringify({ payment_hash: 'abc123' })

    const res = await request(app)
      .post('/api/zaps/webhook')
      .set('Content-Type', 'application/json')
      .set('x-lnd-signature', 'badsignature')
      .send(payload)

    expect(res.status).toBe(401)
    expect(res.body.code).toBe('UNAUTHORIZED')
    expect(res.body.retryable).toBe(false)
  })
})
