// Zap service: creates Lightning invoices for community report tips and
// publishes Nostr Kind 9735 zap receipts when payment is confirmed.

import { createInvoice } from './lndClient'
import { getPool } from '../db/pool'
import { finalizeEvent } from 'nostr-tools'
import { Relay } from 'nostr-tools/relay'

export interface CreateZapResult {
  zap_id: string
  payment_request: string
  amount_sats: number
}

/**
 * Creates a Lightning invoice for tipping the author of a community report.
 * Inserts a pending zap record and returns the BOLT11 payment request.
 */
export async function createZapRequest(reportId: string, amountSats: number): Promise<CreateZapResult> {
  if (amountSats > 100_000) {
    throw new Error('amount exceeds maximum of 100000 sats')
  }

  const pool = getPool()

  const reportResult = await pool.query<{ id: string; nostr_pubkey: string; report_type: string }>(
    'SELECT id, nostr_pubkey, report_type FROM community_reports WHERE id = $1',
    [reportId]
  )

  const report = reportResult.rows[0]
  if (!report) {
    throw new Error('report not found')
  }

  const invoice = await createInvoice({
    amountSats,
    memo: `SentinelMesh zap: tip for ${report.report_type} report`,
  })

  const insertResult = await pool.query<{ id: string }>(
    `INSERT INTO lightning_zaps (report_id, recipient_pubkey, amount_sats, bolt11_invoice, payment_hash)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [reportId, report.nostr_pubkey, amountSats, invoice.payment_request, invoice.payment_hash]
  )

  const zapRow = insertResult.rows[0]
  if (!zapRow) {
    throw new Error('failed to insert zap record')
  }

  return {
    zap_id: zapRow.id,
    payment_request: invoice.payment_request,
    amount_sats: amountSats,
  }
}

interface ZapRow {
  id: string
  status: string
  recipient_pubkey: string
  bolt11_invoice: string
}

/**
 * Handles a webhook callback from LND confirming a payment was settled.
 * Marks the zap as paid and publishes a Nostr Kind 9735 receipt to nos.lol.
 */
export async function handlePaymentWebhook(paymentHash: string): Promise<void> {
  const pool = getPool()

  const zapResult = await pool.query<ZapRow>(
    'SELECT id, status, recipient_pubkey, bolt11_invoice FROM lightning_zaps WHERE payment_hash = $1',
    [paymentHash]
  )

  const zap = zapResult.rows[0]
  if (!zap) {
    // Not our invoice — ignore silently.
    return
  }

  if (zap.status !== 'pending') {
    // Already processed — idempotent skip.
    return
  }

  await pool.query(
    `UPDATE lightning_zaps SET status = 'paid', paid_at = NOW() WHERE id = $1`,
    [zap.id]
  )

  const privateKeyHex = process.env['NOSTR_PRIVATE_KEY']
  if (!privateKeyHex) {
    console.warn('NOSTR_PRIVATE_KEY not set — skipping Kind 9735 zap receipt publish')
    return
  }

  const privateKeyBytes = Uint8Array.from(Buffer.from(privateKeyHex, 'hex'))

  const eventTemplate = {
    kind: 9735,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['p', zap.recipient_pubkey],
      ['bolt11', zap.bolt11_invoice],
      ['preimage', paymentHash],
    ],
    content: '',
  }

  const signedEvent = finalizeEvent(eventTemplate, privateKeyBytes)

  try {
    const relay = await Relay.connect('wss://nos.lol')
    await relay.publish(signedEvent)
    relay.close()
  } catch (err) {
    console.warn('Failed to publish zap receipt to relay:', err)
    return
  }

  await pool.query(
    `UPDATE lightning_zaps SET zap_receipt_id = $1, zap_receipt_json = $2 WHERE id = $3`,
    [signedEvent.id, JSON.stringify(signedEvent), zap.id]
  )
}
