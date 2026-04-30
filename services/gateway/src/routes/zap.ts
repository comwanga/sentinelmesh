import { Router, Request, Response } from 'express'
import express from 'express'
import crypto from 'crypto'
import { config } from '../config'
import { createZapRequest, handlePaymentWebhook } from '../lightning/zapService'

export const zapRouter = Router()

// POST /api/zaps/request — create a Lightning invoice for tipping a report author
zapRouter.post('/request', async (req: Request, res: Response) => {
  const { report_id, amount_sats } = req.body

  if (!report_id || typeof report_id !== 'string' || report_id.trim() === '') {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'report_id must be a non-empty string', retryable: false })
    return
  }

  if (amount_sats === undefined || amount_sats === null || !Number.isInteger(amount_sats) || amount_sats <= 0) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'amount_sats must be a positive integer', retryable: false })
    return
  }

  try {
    const result = await createZapRequest(report_id, amount_sats)
    res.status(201).json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('not found')) {
      res.status(404).json({ code: 'NOT_FOUND', message, retryable: false })
    } else if (message.includes('exceeds maximum')) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message, retryable: false })
    } else {
      console.error('POST /api/zaps/request error:', err)
      res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Failed to create zap request', retryable: true })
    }
  }
})

// POST /api/zaps/webhook — LND payment confirmation callback
// Uses express.raw so we can verify the HMAC before parsing JSON.
zapRouter.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response) => {
    const rawBody = req.body as Buffer
    const signature = req.headers['x-lnd-signature']

    if (!signature || typeof signature !== 'string') {
      res.status(401).json({ code: 'UNAUTHORIZED', message: 'Invalid signature', retryable: false })
      return
    }

    const expected = crypto
      .createHmac('sha256', config.zapWebhookSecret)
      .update(rawBody)
      .digest('hex')

    let expectedBuf: Buffer
    let sigBuf: Buffer
    try {
      expectedBuf = Buffer.from(expected, 'utf8')
      sigBuf = Buffer.from(signature, 'utf8')
    } catch {
      res.status(401).json({ code: 'UNAUTHORIZED', message: 'Invalid signature', retryable: false })
      return
    }

    if (expectedBuf.length !== sigBuf.length || !crypto.timingSafeEqual(expectedBuf, sigBuf)) {
      res.status(401).json({ code: 'UNAUTHORIZED', message: 'Invalid signature', retryable: false })
      return
    }

    let body: { payment_hash: string }
    try {
      body = JSON.parse(rawBody.toString('utf8'))
    } catch {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid JSON body', retryable: false })
      return
    }

    try {
      await handlePaymentWebhook(body.payment_hash)
      res.status(200).json({ ok: true })
    } catch (err) {
      console.error('POST /api/zaps/webhook error:', err)
      res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Webhook processing failed', retryable: true })
    }
  }
)
