import { vi, describe, test, expect } from 'vitest'
import React from 'react'
import { render } from '@testing-library/react'
import { SafeRouteOverlay } from './SafeRouteOverlay'
import type { SafeRoute } from '../services/routingService'

vi.mock('react-map-gl/mapbox', () => ({
  Source: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Layer: () => null,
}))

const mockRoutes: SafeRoute[] = [
  { coordinates: [[36.82, -1.29], [36.83, -1.28]], distanceKm: 1.4, durationMin: 18, label: 'Route 1 — 1.4 km' },
  { coordinates: [[36.82, -1.29], [36.84, -1.30]], distanceKm: 1.9, durationMin: 24, label: 'Route 2 — 1.9 km' },
]

describe('SafeRouteOverlay', () => {
  test('renders without throwing when given routes', () => {
    expect(() => render(<SafeRouteOverlay routes={mockRoutes} />)).not.toThrow()
  })
  test('renders nothing when routes array is empty', () => {
    const { container } = render(<SafeRouteOverlay routes={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
