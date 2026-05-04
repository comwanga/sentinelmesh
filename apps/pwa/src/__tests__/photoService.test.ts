// apps/pwa/src/__tests__/photoService.test.ts
import { vi, describe, test, expect, beforeAll, beforeEach } from 'vitest'

// Mock blazeface before importing photoService
vi.mock('@tensorflow-models/blazeface', () => ({
  load: vi.fn().mockResolvedValue({
    estimateFaces: vi.fn().mockResolvedValue([
      { topLeft: [10, 10], bottomRight: [50, 50] },
    ]),
  }),
}))

const mockCtx = {
  drawImage: vi.fn(),
  getImageData: vi.fn(),
  putImageData: vi.fn(),
  filter: '',
  fillRect: vi.fn(),
  imageSmoothingEnabled: true,
}

// Patch the jsdom prototype so document.createElement('canvas') works
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () => mockCtx as unknown as CanvasRenderingContext2D
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob(['img'], { type: 'image/jpeg' }))
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  mockCtx.imageSmoothingEnabled = true
})

// Mock createImageBitmap
vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 100, height: 80 }))

// Mock fetch (for IPFS upload)
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { compressAndStrip, blurFaces, uploadToIPFS } from '../services/photoService'

describe('compressAndStrip', () => {
  test('returns a Blob', async () => {
    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' })
    const result = await compressAndStrip(file)
    expect(result).toBeInstanceOf(Blob)
    expect(mockCtx.drawImage).toHaveBeenCalledOnce()
  })
})

describe('blurFaces', () => {
  test('returns the canvas and pixelates face regions', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 200
    canvas.height = 200
    const result = await blurFaces(canvas)
    expect(result).toBe(canvas)
    // Two drawImage calls: one to scale region down, one to scale back up
    expect(mockCtx.drawImage).toHaveBeenCalledTimes(2)
  })
})

describe('uploadToIPFS', () => {
  test('returns CID from Pinata on success', async () => {
    vi.stubEnv('VITE_PINATA_JWT', 'test-jwt')
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ IpfsHash: 'QmTestCID' }),
    })
    const blob = new Blob(['data'], { type: 'image/jpeg' })
    const cid = await uploadToIPFS(blob)
    expect(cid).toBe('QmTestCID')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.pinata.cloud/pinning/pinFileToIPFS',
      expect.objectContaining({ headers: { Authorization: 'Bearer test-jwt' } }),
    )
  })

  test('returns null when VITE_PINATA_JWT not set', async () => {
    vi.stubEnv('VITE_PINATA_JWT', '')
    const blob = new Blob(['data'], { type: 'image/jpeg' })
    const cid = await uploadToIPFS(blob)
    expect(cid).toBeNull()
  })

  test('returns null when fetch returns non-ok response', async () => {
    vi.stubEnv('VITE_PINATA_JWT', 'test-jwt')
    mockFetch.mockResolvedValueOnce({ ok: false })
    const blob = new Blob(['data'], { type: 'image/jpeg' })
    const cid = await uploadToIPFS(blob)
    expect(cid).toBeNull()
  })

  test('returns null when fetch throws', async () => {
    vi.stubEnv('VITE_PINATA_JWT', 'test-jwt')
    mockFetch.mockRejectedValueOnce(new Error('network error'))
    const blob = new Blob(['data'], { type: 'image/jpeg' })
    const cid = await uploadToIPFS(blob)
    expect(cid).toBeNull()
  })
})
