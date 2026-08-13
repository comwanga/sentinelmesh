import { sha256Hex, signNip98AuthEvent } from './nostrService'

export interface Nip05Status {
  identifier: string
  verified: boolean
  verified_at: string
  valid_until: string
}

interface IdentityResponse {
  nip05: Nip05Status | null
}

function endpoint(): string {
  const base = import.meta.env['VITE_API_BASE_URL'] || window.location.origin
  return new URL('/api/identity/nip05', base).toString()
}

function parseResponse(value: unknown): Nip05Status | null {
  if (!value || typeof value !== 'object') throw new Error('Invalid identity response')
  const nip05 = (value as IdentityResponse).nip05
  if (nip05 === null) return null
  if (!nip05 || typeof nip05.identifier !== 'string' || typeof nip05.verified !== 'boolean'
    || typeof nip05.verified_at !== 'string' || typeof nip05.valid_until !== 'string') {
    throw new Error('Invalid identity response')
  }
  return nip05
}

async function request(method: string, body?: string): Promise<Response> {
  const url = endpoint()
  const hash = body === undefined ? undefined : await sha256Hex(body)
  const auth = await signNip98AuthEvent(url, method, hash)
  return fetch(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      'X-Nostr-Auth': JSON.stringify(auth),
    },
    body,
    signal: AbortSignal.timeout(10_000),
  })
}

async function errorMessage(response: Response): Promise<string> {
  const fallback = `Identity request failed (${response.status})`
  try {
    const value = await response.json() as { message?: unknown }
    return typeof value.message === 'string' ? value.message : fallback
  } catch {
    return fallback
  }
}

export async function getNip05Identity(): Promise<Nip05Status | null> {
  const response = await request('GET')
  if (!response.ok) throw new Error(await errorMessage(response))
  return parseResponse(await response.json())
}

export async function verifyNip05Identity(identifier: string): Promise<Nip05Status> {
  const body = JSON.stringify({ identifier })
  const response = await request('PUT', body)
  if (!response.ok) throw new Error(await errorMessage(response))
  const status = parseResponse(await response.json())
  if (!status) throw new Error('Invalid identity response')
  return status
}

export async function removeNip05Identity(): Promise<void> {
  const response = await request('DELETE')
  if (!response.ok) throw new Error(await errorMessage(response))
}
