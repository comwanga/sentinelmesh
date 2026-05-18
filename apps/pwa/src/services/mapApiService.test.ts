import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { searchAddress, getRoute, reverseGeocode } from './mapApiService'

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

beforeEach(() => mockFetch.mockReset())
afterEach(() => { mockFetch.mockReset(); mockFetch.mockClear() })

describe('searchAddress', () => {
  test('returns features on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          { label: 'Nairobi, Kenya', lat: -1.2921, lng: 36.8219 },
        ],
      }),
    })
    const results = await searchAddress('Nairobi')
    expect(results).toHaveLength(1)
    expect(results[0].label).toBe('Nairobi, Kenya')
    const [call] = mockFetch.mock.calls
    expect((call[0] as string)).toContain('/api/maps/search')
    expect((call[0] as string)).toContain('q=Nairobi')
  })

  test('includes proximity params when provided', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ features: [] }) })
    await searchAddress('park', { lat: -1.28, lng: 36.82 })
    expect(mockFetch.mock.calls[0][0]).toContain('lat=-1.28')
  })

  test('returns empty array on non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false })
    expect(await searchAddress('xyz')).toEqual([])
  })

  test('returns empty array on network error', async () => {
    const error = new Error('network')
    mockFetch.mockRejectedValue(error)
    expect(await searchAddress('xyz')).toEqual([])
  })
})

describe('getRoute', () => {
  test('returns route on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        coordinates: [[36.82, -1.29], [36.83, -1.28]],
        distance: 2100,
        duration: 1500,
      }),
    })
    const route = await getRoute({ lat: -1.29, lng: 36.82 }, { lat: -1.28, lng: 36.83 })
    expect(route).not.toBeNull()
    expect(route!.distance).toBe(2100)
    expect(route!.coordinates).toHaveLength(2)
  })

  test('returns null on failure', async () => {
    mockFetch.mockResolvedValue({ ok: false })
    expect(await getRoute({ lat: 0, lng: 0 }, { lat: 1, lng: 1 })).toBeNull()
  })
})

describe('reverseGeocode', () => {
  test('returns label on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ label: 'Westlands, Nairobi' }),
    })
    expect(await reverseGeocode(-1.28, 36.82)).toBe('Westlands, Nairobi')
  })

  test('returns null on failure', async () => {
    mockFetch.mockResolvedValue({ ok: false })
    expect(await reverseGeocode(0, 0)).toBeNull()
  })
})
