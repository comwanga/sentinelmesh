// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadCircleKey: vi.fn(),
  encrypt: vi.fn(),
  sign: vi.fn(),
  hash: vi.fn(),
}))

vi.mock('../e2eeService', () => ({
  loadCircleKey: mocks.loadCircleKey,
  encryptCircleLocationV1: mocks.encrypt,
}))
vi.mock('../nostrService', () => ({
  signNip98AuthEvent: mocks.sign,
  sha256Hex: mocks.hash,
}))

import { buildLocationEnvelopeBody, createLocationPublisher } from '../locationPublisher'

const position = { coords: { latitude: 1, longitude: 2, accuracy: 3 } } as GeolocationPosition

beforeEach(() => {
  vi.clearAllMocks()
  mocks.loadCircleKey.mockResolvedValue({})
  mocks.encrypt.mockResolvedValue('AQ==')
  mocks.hash.mockResolvedValue('body-hash')
  mocks.sign.mockResolvedValue({ id: crypto.randomUUID() })
})

describe('safe location publisher foundation', () => {
  it('is disabled by default and performs no work', async () => {
    const publisher = createLocationPublisher({ circleId: 'c', keyEpoch: 1, precision: 'exact' })
    await expect(publisher.publish()).rejects.toThrow('disabled')
    expect(mocks.loadCircleKey).not.toHaveBeenCalled()
  })

  it('hashes exact body bytes and creates fresh auth for every POST', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 201 })
    const publisher = createLocationPublisher({
      circleId: 'circle-1', keyEpoch: 7, precision: 'exact', enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch, getPosition: async () => position,
    })
    await publisher.publish(); await publisher.publish()
    expect(mocks.sign).toHaveBeenCalledTimes(2)
    expect(mocks.hash).toHaveBeenCalledTimes(2)
    for (let index = 0; index < 2; index += 1) {
      const body = fetchImpl.mock.calls[index][1].body as string
      expect(mocks.hash.mock.calls[index][0]).toBe(body)
      expect(JSON.parse(body)).toMatchObject({ version: 1, key_epoch: 7, ciphertext: 'AQ==' })
    }
  })

  it('does not allow overlapping sends and stops on protocol mismatch', async () => {
    let resolvePosition!: (value: GeolocationPosition) => void
    const pendingPosition = new Promise<GeolocationPosition>(resolve => { resolvePosition = resolve })
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 409 })
    const publisher = createLocationPublisher({
      circleId: 'c', keyEpoch: 1, precision: 'exact', enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch, getPosition: () => pendingPosition,
    })
    const first = publisher.publish()
    await expect(publisher.publish()).rejects.toThrow('already in progress')
    resolvePosition(position)
    await expect(first).rejects.toThrow('not ready')
    await expect(publisher.publish()).rejects.toThrow('stopped')
  })

  it('serializes the exact opaque request contract', () => {
    expect(Object.keys(JSON.parse(buildLocationEnvelopeBody(2, 'AQ==', 1_800_000_000))).sort())
      .toEqual(['ciphertext', 'expires_at', 'key_epoch', 'version'])
  })
})
