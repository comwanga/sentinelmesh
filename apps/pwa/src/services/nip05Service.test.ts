import { beforeEach, describe, expect, test, vi } from 'vitest'

const { signActive, sha256 } = vi.hoisted(() => ({
  signActive: vi.fn(async () => ({ id: 'event', pubkey: 'active', sig: 'sig' })),
  sha256: vi.fn(async () => 'body-hash'),
}))

vi.mock('./nostrService', () => ({
  signNip98AuthEvent: signActive,
  sha256Hex: sha256,
}))

import { getNip05Identity, removeNip05Identity, verifyNip05Identity } from './nip05Service'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const status = {
  identifier: 'alice@example.com',
  verified: true,
  verified_at: '2026-08-12T00:00:00Z',
  valid_until: '2026-08-13T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ nip05: status }) })
})

describe('nip05Service', () => {
  test('binds PUT authentication to the exact request body', async () => {
    await expect(verifyNip05Identity('alice@example.com')).resolves.toEqual(status)
    const body = JSON.stringify({ identifier: 'alice@example.com' })
    expect(sha256).toHaveBeenCalledWith(body)
    expect(signActive).toHaveBeenCalledWith(
      new URL('/api/identity/nip05', window.location.origin).toString(),
      'PUT',
      'body-hash',
    )
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'PUT', body }))
  })

  test('loads the authenticated local identity', async () => {
    await expect(getNip05Identity()).resolves.toEqual(status)
    expect(signActive).toHaveBeenCalledWith(expect.any(String), 'GET', undefined)
  })

  test('removes the authenticated local identity', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204 })
    await expect(removeNip05Identity()).resolves.toBeUndefined()
    expect(signActive).toHaveBeenCalledWith(expect.any(String), 'DELETE', undefined)
  })

  test('surfaces a safe server verification message', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ message: 'NIP-05 identifier does not map to this local key' }),
    })
    await expect(verifyNip05Identity('alice@example.com')).rejects.toThrow('does not map')
  })
})
