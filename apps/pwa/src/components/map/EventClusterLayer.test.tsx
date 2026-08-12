import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EventClusterLayer } from './EventClusterLayer'
import type { SafetyEvent } from '../../../../../shared/types'

const mockMarker = vi.hoisted(() =>
  vi.fn(({ children, longitude, latitude }: {
    children?: React.ReactNode; longitude: number; latitude: number
  }) => <div data-testid="marker" data-lng={longitude} data-lat={latitude}>{children}</div>)
)

vi.mock('react-map-gl/maplibre', () => ({
  Marker: mockMarker,
  useMap: () => ({ current: null }),
}))

vi.mock('../EventMarker', () => ({
  default: ({ event }: { event: SafetyEvent }) => <div data-testid="event-marker" data-id={event.id} />,
}))

vi.mock('./ClusterMarker', () => ({
  ClusterMarker: ({ totalCount }: { totalCount: number }) => (
    <div data-testid="cluster-marker" data-count={totalCount} />
  ),
}))

vi.mock('../../store', () => ({
  useAppSelector: vi.fn(),
}))

vi.mock('../../store/eventsSlice', () => ({
  selectViewportEventItems: vi.fn(),
}))

import { useAppSelector } from '../../store'

const event1: SafetyEvent = {
  id: 'e1', event_type: 'SECURITY_INCIDENT', severity: 'CRITICAL',
  title: 'Event 1', summary: null, lat: -1.28, lng: 36.82,
  place_name: null, county: null, is_active: true, state: 'ACTIVE',
  started_at: '2026-05-18T00:00:00Z', created_at: '2026-05-18T00:00:00Z',
  nostr_event_id: null, bitcoin_txid: null,
}
const event2: SafetyEvent = {
  ...event1, id: 'e2', severity: 'HIGH', lat: -1.29, lng: 36.83,
}
const farEvent: SafetyEvent = {
  ...event1, id: 'e3', severity: 'LOW', lat: 1.0, lng: 30.0,
}

describe('EventClusterLayer', () => {
  beforeEach(() => {
    vi.mocked(useAppSelector).mockReturnValue([event1, event2, farEvent])
    mockMarker.mockClear()
  })

  it('renders individual EventMarkers at high zoom (>= 13.2)', async () => {
    render(<EventClusterLayer zoom={14} />)
    const eventMarkers = screen.getAllByTestId('event-marker')
    expect(eventMarkers).toHaveLength(3)
  })

  it('renders cluster marker at low zoom (< 12.8) for nearby events', async () => {
    render(<EventClusterLayer zoom={10} />)
    const clusterMarkers = screen.queryAllByTestId('cluster-marker')
    const clusterWith2 = clusterMarkers.find(el => el.getAttribute('data-count') === '2')
    expect(clusterWith2).toBeDefined()
  })

  it('does not render inactive events', () => {
    const inactive: SafetyEvent = { ...event1, id: 'inactive', is_active: false }
    vi.mocked(useAppSelector).mockReturnValue([inactive])
    render(<EventClusterLayer zoom={14} />)
    expect(screen.queryAllByTestId('event-marker')).toHaveLength(0)
  })

  it('renders null when no events', () => {
    vi.mocked(useAppSelector).mockReturnValue([])
    const { container } = render(<EventClusterLayer zoom={14} />)
    expect(container.firstChild).toBeNull()
  })
})
