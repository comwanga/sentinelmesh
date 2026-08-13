import { describe, it, expect, vi, beforeEach } from 'vitest'
import { issueVouch, revokeVouch } from '../vouchService'

vi.mock('../nostrService', () => ({
  vouchBindingContent: (v: string) => `sentinelmesh:vouch:v1:${v}`,
  vouchRevokeBindingContent: (v: string) => `sentinelmesh:vouch-revoke:v1:${v}`,
  signBoundEvent: (content: string) => Promise.resolve({ id: 'ev1', pubkey: 'voucherpk', created_at: 1, kind: 30078, tags: [], content, sig: 's' }),
}))

describe('vouchService', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('issueVouch POSTs the signed attestation', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({}) })
    vi.stubGlobal('fetch', fetchMock)
    const ok = await issueVouch('voucheepk')
    expect(ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/api\/vouches$/)
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body.voucher_pubkey).toBe('voucherpk')
    expect(body.vouchee_pubkey).toBe('voucheepk')
    expect(body.nostr_event.content).toBe('sentinelmesh:vouch:v1:voucheepk')
  })

  it('revokeVouch DELETEs', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchMock)
    const ok = await revokeVouch('voucheepk')
    expect(ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/api\/vouches\/voucheepk$/)
    expect(init.method).toBe('DELETE')
  })
})
