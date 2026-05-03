import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CircleMapLayer } from '../CircleMapLayer'
import type { MemberStatus } from '../../../../../shared/types'

vi.mock('react-map-gl', () => ({
  Marker: ({ children, latitude, longitude }: { children: React.ReactNode; latitude: number; longitude: number }) => (
    <div data-testid="marker" data-lat={latitude} data-lng={longitude}>{children}</div>
  ),
}))

const locations = { aaa: { lat: -1.29, lng: 36.82, ts: '' } }
const statuses: Record<string, MemberStatus> = { aaa: 'ONLINE', bbb: 'GHOST' }

describe('CircleMapLayer', () => {
  it('renders a Marker for each ONLINE member', () => {
    render(<CircleMapLayer decryptedLocations={locations} memberStatuses={statuses} />)
    expect(screen.getAllByTestId('marker')).toHaveLength(1)
  })

  it('does not render Markers for GHOST or OFFLINE members', () => {
    const ghostLocations = { bbb: { lat: -1.3, lng: 36.9, ts: '' } }
    render(<CircleMapLayer decryptedLocations={ghostLocations} memberStatuses={statuses} />)
    expect(screen.queryAllByTestId('marker')).toHaveLength(0)
  })

  it('passes correct coordinates to Marker', () => {
    render(<CircleMapLayer decryptedLocations={locations} memberStatuses={statuses} />)
    const marker = screen.getByTestId('marker')
    expect(marker.getAttribute('data-lat')).toBe('-1.29')
    expect(marker.getAttribute('data-lng')).toBe('36.82')
  })
})
