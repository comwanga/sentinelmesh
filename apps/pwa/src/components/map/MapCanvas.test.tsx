import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MapCanvas } from './MapCanvas'

vi.mock('react-map-gl', () => ({
  default: ({ children, longitude, latitude, zoom, onMove }: {
    children?: React.ReactNode
    longitude: number
    latitude: number
    zoom: number
    onMove: (evt: { viewState: { longitude: number; latitude: number; zoom: number } }) => void
  }) => (
    <div
      data-testid="mapbox"
      data-longitude={String(longitude)}
      data-latitude={String(latitude)}
      data-zoom={String(zoom)}
      onClick={() => onMove({ viewState: { longitude: 10, latitude: 10, zoom: 5 } })}
    >
      {children}
    </div>
  ),
}))

describe('MapCanvas', () => {
  it('renders with default Nairobi view state', () => {
    render(<MapCanvas />)
    const map = screen.getByTestId('mapbox')
    expect(map.getAttribute('data-longitude')).toBe('36.8219')
    expect(map.getAttribute('data-latitude')).toBe('-1.2921')
    expect(map.getAttribute('data-zoom')).toBe('11')
  })

  it('renders children inside the map', () => {
    render(<MapCanvas><div data-testid="child">marker</div></MapCanvas>)
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('accepts custom initial view state', () => {
    render(<MapCanvas initialViewState={{ longitude: 1.0, latitude: 2.0, zoom: 8 }} />)
    const map = screen.getByTestId('mapbox')
    expect(map.getAttribute('data-longitude')).toBe('1')
    expect(map.getAttribute('data-latitude')).toBe('2')
    expect(map.getAttribute('data-zoom')).toBe('8')
  })
})
