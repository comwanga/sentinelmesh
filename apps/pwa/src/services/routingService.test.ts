import { vi, describe, test, expect, beforeEach } from 'vitest'
import { fetchSafeRoutes } from './routingService'

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

beforeEach(() => { mockFetch.mockReset() })

function mockDirectionsResponse(coordinates: [number, number][], distance = 3200, duration = 800) {
  return {
    ok: true,
    json: async () => ({
      routes: [{ geometry: { type: 'LineString', coordinates }, distance, duration }],
    }),
  }
}

const userLocation  = { lat: -1.2921, lng: 36.8219 }
const eventLocation = { lat: -1.3200, lng: 36.8219 }
const eventRadiusKm = 0.5
const token = 'pk.test'

const safeCoords:   [number, number][] = [[36.8219, -1.2921], [36.8219, -1.2800], [36.8219, -1.2600]]
const unsafeCoords: [number, number][] = [[36.8219, -1.2921], [36.8219, -1.3200], [36.8219, -1.3500]]

describe('fetchSafeRoutes', () => {
  test('returns an array of SafeRoute objects', async () => {
    mockFetch.mockResolvedValue(mockDirectionsResponse(safeCoords))
    const routes = await fetchSafeRoutes(userLocation, eventLocation, eventRadiusKm, token)
    expect(Array.isArray(routes)).toBe(true)
    routes.forEach((r) => {
      expect(r).toHaveProperty('coordinates')
      expect(r).toHaveProperty('distanceKm')
      expect(r).toHaveProperty('durationMin')
      expect(r).toHaveProperty('label')
    })
  })
  test('returns at most 3 routes', async () => {
    mockFetch.mockResolvedValue(mockDirectionsResponse(safeCoords))
    const routes = await fetchSafeRoutes(userLocation, eventLocation, eventRadiusKm, token)
    expect(routes.length).toBeLessThanOrEqual(3)
  })
  test('filters routes that pass through event zone', async () => {
    mockFetch.mockResolvedValue(mockDirectionsResponse(unsafeCoords))
    const routes = await fetchSafeRoutes(userLocation, eventLocation, eventRadiusKm, token)
    expect(routes.length).toBe(0)
  })
  test('resolves to empty array when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('network error'))
    const routes = await fetchSafeRoutes(userLocation, eventLocation, eventRadiusKm, token)
    expect(routes).toEqual([])
  })
})
