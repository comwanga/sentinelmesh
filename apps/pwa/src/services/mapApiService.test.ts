import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { searchAddress, getRoute, MapSearchError, reverseGeocode } from './mapApiService'

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

beforeEach(() => mockFetch.mockReset())
afterEach(() => { mockFetch.mockReset(); mockFetch.mockClear() })

describe('searchAddress', () => {
  test('returns features on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { id: 'place-1', label: 'Nairobi, Kenya', kind: 'locality', lat: -1.2921, lng: 36.8219 },
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
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) })
    await searchAddress('park', { lat: -1.28, lng: 36.82 })
    expect(mockFetch.mock.calls[0][0]).toContain('lat=-1.28')
  })

  test('distinguishes a non-ok response from no results', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 })
    await expect(searchAddress('xyz')).rejects.toBeInstanceOf(MapSearchError)
  })

  test('distinguishes a network error from no results', async () => {
    const error = new Error('network')
    mockFetch.mockRejectedValue(error)
    await expect(searchAddress('xyz')).rejects.toBeInstanceOf(MapSearchError)
  })
})

describe('getRoute', () => {
  test('returns route alternatives on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        routes: [{
          id: 'route-1',
          coordinates: [[36.82, -1.29], [36.83, -1.28]],
          distance_m: 2100,
          duration_s: 1500,
          warnings: [],
          degraded: false,
        }],
      }),
    })
    const routes = await getRoute({ lat: -1.29, lng: 36.82 }, { lat: -1.28, lng: 36.83 })
    expect(routes).toHaveLength(1)
    expect(routes[0].distance).toBe(2100)
    expect(routes[0].coordinates).toHaveLength(2)
    expect(mockFetch).toHaveBeenCalledWith('/api/maps/route', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        from: { lat: -1.29, lng: 36.82 },
        to: { lat: -1.28, lng: 36.83 },
        mode: 'walking',
        alternatives: true,
      }),
    }))
    expect(mockFetch.mock.calls[0][0]).not.toContain('36.82')
  })

  test('returns empty array on failure', async () => {
    mockFetch.mockResolvedValue({ ok: false })
    expect(await getRoute({ lat: 0, lng: 0 }, { lat: 1, lng: 1 })).toEqual([])
  })
})

describe('reverseGeocode', () => {
  test('returns label on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        result: { id: 'place-1', label: 'Westlands, Nairobi', kind: 'locality', lat: -1.28, lng: 36.82 },
      }),
    })
    expect(await reverseGeocode(-1.28, 36.82)).toBe('Westlands, Nairobi')
  })

  test('returns null on failure', async () => {
    mockFetch.mockResolvedValue({ ok: false })
    expect(await reverseGeocode(0, 0)).toBeNull()
  })
})
