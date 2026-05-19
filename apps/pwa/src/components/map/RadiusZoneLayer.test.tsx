import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { RadiusZoneLayer } from './RadiusZoneLayer'
import type { SafetyEvent } from '../../../../../shared/types'

const { mockSource, mockLayer } = vi.hoisted(() => {
  const mockSource = vi.fn(({ children }: { children?: React.ReactNode }) => <div data-testid="source">{children}</div>)
  const mockLayer  = vi.fn(() => <div data-testid="layer" />)
  return { mockSource, mockLayer }
})

vi.mock('react-map-gl/maplibre', () => ({
  Source: mockSource,
  Layer:  mockLayer,
}))

const critical: SafetyEvent = {
  id: 'c1', event_type: 'SECURITY_INCIDENT', severity: 'CRITICAL',
  title: 'Critical event', summary: null, lat: -1.28, lng: 36.82,
  place_name: null, county: null, is_active: true, state: 'ACTIVE',
  started_at: '2026-05-18T00:00:00Z', created_at: '2026-05-18T00:00:00Z',
  nostr_event_id: null, bitcoin_txid: null,
}
const low: SafetyEvent = { ...critical, id: 'l1', severity: 'LOW' }
const inactive: SafetyEvent = { ...critical, id: 'i1', severity: 'HIGH', is_active: false }

describe('RadiusZoneLayer', () => {
  it('renders Source + Layer for active non-LOW events', () => {
    const { getByTestId } = render(<RadiusZoneLayer events={[critical]} />)
    expect(getByTestId('source')).toBeInTheDocument()
    expect(getByTestId('layer')).toBeInTheDocument()
  })

  it('renders null when all events are LOW severity', () => {
    const { container } = render(<RadiusZoneLayer events={[low]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders null when all events are inactive', () => {
    const { container } = render(<RadiusZoneLayer events={[inactive]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders null for empty events array', () => {
    const { container } = render(<RadiusZoneLayer events={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('passes correct GeoJSON feature count to Source', () => {
    const high: SafetyEvent = { ...critical, id: 'h1', severity: 'HIGH' }
    mockSource.mockClear()
    render(<RadiusZoneLayer events={[critical, high, low]} />)
    const call = mockSource.mock.calls[mockSource.mock.calls.length - 1][0] as Record<string, unknown>
    const data = call['data'] as { features: unknown[] }
    expect(data.features).toHaveLength(2) // CRITICAL + HIGH, not LOW
  })

  it('sets circle-pitch-alignment to map on Layer', () => {
    mockLayer.mockClear()
    render(<RadiusZoneLayer events={[critical]} />)
    const call = (mockLayer.mock.calls as unknown as Array<[Record<string, unknown>]>)[mockLayer.mock.calls.length - 1]?.[0]
    expect((call?.['paint'] as Record<string, unknown>)['circle-pitch-alignment']).toBe('map')
  })
})
