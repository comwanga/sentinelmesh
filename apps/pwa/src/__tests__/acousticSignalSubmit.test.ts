import { vi, describe, test, expect, beforeEach } from 'vitest'

// 1. Mock nostrService before importing the module under test
vi.mock('../services/nostrService', () => ({
  signNip98AuthEvent: vi.fn().mockResolvedValue({
    id: 'abc', pubkey: 'xyz', created_at: 1, kind: 27235,
    tags: [['u', 'x'], ['method', 'POST']], content: '', sig: 'sig',
  }),
}))

// 2. Mock fetch globally
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

// 3. Stub window.location.origin
vi.stubGlobal('location', { origin: 'https://app.sentinelmesh.io' })

// 4. Stub AbortSignal.timeout in case jsdom doesn't support it
vi.stubGlobal('AbortSignal', { timeout: vi.fn().mockReturnValue(undefined) })

import { submitAcousticSignal } from '../services/acousticSignalSubmit'
import { signNip98AuthEvent } from '../services/nostrService'

const detection = { label: 'gunshot', confidence: 0.95 }
const location  = { lat: -1.2921, lng: 36.8219 }

beforeEach(() => {
  fetchMock.mockReset()
  vi.mocked(signNip98AuthEvent).mockClear()
})

describe('submitAcousticSignal', () => {
  test('calls signNip98AuthEvent with absolute signals URL and POST', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201 })
    await submitAcousticSignal(detection, location)
    expect(signNip98AuthEvent).toHaveBeenCalledWith(
      'https://app.sentinelmesh.io/api/acoustic/signals',
      'POST',
    )
  })

  test('fetch is called with correct URL and method', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201 })
    await submitAcousticSignal(detection, location)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://app.sentinelmesh.io/api/acoustic/signals')
    expect(init.method).toBe('POST')
  })

  test('request body contains threat_class, confidence, lat, lng', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201 })
    await submitAcousticSignal(detection, location)
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.threat_class).toBe('gunshot')
    expect(body.confidence).toBe(0.95)
    expect(body.lat).toBe(-1.2921)
    expect(body.lng).toBe(36.8219)
  })

  test('X-Nostr-Auth header is set to JSON-stringified auth event', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201 })
    await submitAcousticSignal(detection, location)
    const [, init] = fetchMock.mock.calls[0]
    const authHeader = init.headers['X-Nostr-Auth']
    const parsed = JSON.parse(authHeader)
    expect(parsed.kind).toBe(27235)
  })

  test('200 response (deduplicated) does not throw', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 })
    await expect(submitAcousticSignal(detection, location)).resolves.toBeUndefined()
  })

  test('non-ok response (e.g. 429) throws an error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429 })
    await expect(submitAcousticSignal(detection, location)).rejects.toThrow('429')
  })
})
