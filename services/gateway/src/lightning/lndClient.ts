// LND REST API client for creating and looking up Lightning invoices.
// Config is read on first use so tests can stub env vars before calling.

function require_env(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required env var: ${key}`)
  return val
}

// Lazy config — resolved on first call so tests can set env vars first.
let _cfg: { url: string; macaroon: string } | null = null

function cfg(): { url: string; macaroon: string } {
  if (_cfg) return _cfg
  const url = require_env('LND_REST_URL')
  const macaroon = require_env('LND_MACAROON_HEX')
  // Skip TLS verification for local dev with self-signed certs.
  if (process.env['LND_TLS_SKIP_VERIFY'] === 'true') {
    process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'
  }
  _cfg = { url, macaroon }
  return _cfg
}

// Converts a base64 string to a lowercase hex string.
function base64ToHex(b64: string): string {
  return Buffer.from(b64, 'base64').toString('hex')
}

// Encodes a hex payment hash as base64url so it can be used in a URL path.
function hexToBase64Url(hex: string): string {
  return Buffer.from(hex, 'hex').toString('base64url')
}

export interface CreateInvoiceParams {
  amountSats: number
  memo: string
}

export interface CreateInvoiceResult {
  payment_request: string
  payment_hash: string
}

/**
 * Creates a Lightning invoice via the LND REST API.
 * Returns the payment request (BOLT11) and payment hash as hex.
 */
export async function createInvoice({ amountSats, memo }: CreateInvoiceParams): Promise<CreateInvoiceResult> {
  const { url: baseUrl, macaroon } = cfg()
  const url = `${baseUrl}/v1/invoices`
  const body = { value: amountSats, memo, expiry: 3600 }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Grpc-Metadata-macaroon': macaroon,
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.error('createInvoice fetch failed:', err)
    throw err
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`LND createInvoice failed with status ${res.status}: ${text}`)
  }

  const data = await res.json() as { payment_request: string; r_hash: string }
  return {
    payment_request: data.payment_request,
    payment_hash: base64ToHex(data.r_hash),
  }
}

/**
 * Looks up a Lightning invoice by payment hash (hex).
 * Returns the raw LND invoice object which includes settled, amt_paid_sat, etc.
 */
export async function getInvoice(paymentHashHex: string): Promise<Record<string, unknown>> {
  const { url: baseUrl, macaroon } = cfg()
  const hashBase64Url = hexToBase64Url(paymentHashHex)
  const url = `${baseUrl}/v1/invoice/${hashBase64Url}`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        'Grpc-Metadata-macaroon': macaroon,
      },
    })
  } catch (err) {
    console.error('getInvoice fetch failed:', err)
    throw err
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`LND getInvoice failed with status ${res.status}: ${text}`)
  }

  return res.json() as Promise<Record<string, unknown>>
}
