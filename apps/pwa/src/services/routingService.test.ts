import { vi, describe, test, expect, beforeEach } from 'vitest'
import { fetchSafeRoutes, fetchRouteToHome } from './routingService'

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

beforeEach(() => { mockFetch.mockReset() })

function mockRouteResponse(coordinates: [number, number][], distance = 3200, duration = 800) {
  return {
    ok: true,
    json: async () => ({ coordinates, distance, duration }),
  }
}

const userLocation  = { lat: -1.2921, lng: 36.8219 }
const eventLocation = { lat: -1.3200, lng: 36.8219 }
const eventRadiusKm = 0.5

const safeCoords:   [number, number][] = [[36.8219, -1.2921], [36.8219, -1.2800], [36.8219, -1.2600]]
const unsafeCoords: [number, number][] = [[36.8219, -1.2921], [36.8219, -1.3200], [36.8219, -1.3500]]

describe('fetchSafeRoutes', () => {
  test('returns an array of SafeRoute objects', async () => {
    mockFetch.mockResolvedValue(mockRouteResponse(safeCoords))
    const routes = await fetchSafeRoutes(userLocation, eventLocation, eventRadiusKm)
    expect(Array.isArray(routes)).toBe(true)
    routes.forEach((r) => {
      expect(r).toHaveProperty('coordinates')
      expect(r).toHaveProperty('distanceKm')
      expect(r).toHaveProperty('durationMin')
      expect(r).toHaveProperty('label')
    })
  })
  test('returns at most 3 routes', async () => {
    mockFetch.mockResolvedValue(mockRouteResponse(safeCoords))
    const routes = await fetchSafeRoutes(userLocation, eventLocation, eventRadiusKm)
    expect(routes.length).toBeLessThanOrEqual(3)
  })
  test('filters routes that pass through event zone', async () => {
    mockFetch.mockResolvedValue(mockRouteResponse(unsafeCoords))
    const routes = await fetchSafeRoutes(userLocation, eventLocation, eventRadiusKm)
    expect(routes.length).toBe(0)
  })
  test('resolves to empty array when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('network error'))
    const routes = await fetchSafeRoutes(userLocation, eventLocation, eventRadiusKm)
    expect(routes).toEqual([])
  })
})

describe('fetchRouteToHome', () => {
  test('returns HomeRoute with distance and duration', async () => {
    mockFetch.mockResolvedValue(mockRouteResponse([[36.82, -1.29], [36.83, -1.28]], 1500, 900))
    const routes = await fetchRouteToHome(
      { lat: -1.29, lng: 36.82 },
      { lat: -1.28, lng: 36.83 },
      [],
    )
    expect(routes).toHaveLength(1)
    expect(routes[0].distanceKm).toBe(1.5)
    expect(routes[0].durationMin).toBe(15)
    expect(routes[0].warnings).toEqual([])
  })
  test('returns empty array when fetch returns non-ok', async () => {
    mockFetch.mockResolvedValue({ ok: false })
    const routes = await fetchRouteToHome({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, [])
    expect(routes).toEqual([])
  })
  test('adds warning when route passes through danger zone', async () => {
    const coords: [number, number][] = [[36.8219, -1.3200]]
    mockFetch.mockResolvedValue(mockRouteResponse(coords))
    const dangerZones = [{ lat: -1.32, lng: 36.8219, radiusKm: 0.5 }]
    const routes = await fetchRouteToHome(userLocation, eventLocation, dangerZones)
    expect(routes[0].warnings.length).toBeGreaterThan(0)
  })
})
