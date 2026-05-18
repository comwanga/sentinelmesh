import { describe, it, expect, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MapCanvas } from './MapCanvas'

const mockStyle = vi.hoisted(() => ({ version: 8, name: 'test', layers: [] }))

vi.mock('../../config/mapConfig', () => ({
  MAP_STYLE_URL: 'https://demotiles.maplibre.org/style.json',
  WORLD_CENTER: { longitude: 0, latitude: 20, zoom: 2 },
  MAPTILES_URL: '',
  loadMapStyle: vi.fn().mockResolvedValue(mockStyle),
}))

vi.mock('../../hooks/useInitialViewport', () => ({
  persistViewport: vi.fn(),
}))

vi.mock('react-map-gl/maplibre', () => ({
  Map: ({ children, longitude, latitude, zoom, onMove, mapStyle }: {
    children?: React.ReactNode
    longitude: number
    latitude: number
    zoom: number
    onMove: (evt: { viewState: { longitude: number; latitude: number; zoom: number } }) => void
    mapStyle?: unknown
  }) => (
    <div
      data-testid="mapbox"
      data-longitude={String(longitude)}
      data-latitude={String(latitude)}
      data-zoom={String(zoom)}
      data-style-type={typeof mapStyle === 'object' && mapStyle !== null ? 'object' : 'string'}
      onClick={() => onMove({ viewState: { longitude: 10, latitude: 10, zoom: 5 } })}
    >
      {children}
    </div>
  ),
}))

describe('MapCanvas', () => {
  it('renders with world-center default view state', async () => {
    await act(async () => { render(<MapCanvas />) })
    const map = screen.getByTestId('mapbox')
    expect(map.getAttribute('data-longitude')).toBe('0')
    expect(map.getAttribute('data-latitude')).toBe('20')
    expect(map.getAttribute('data-zoom')).toBe('2')
  })

  it('renders children inside the map', async () => {
    await act(async () => {
      render(<MapCanvas><div data-testid="child">marker</div></MapCanvas>)
    })
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('accepts custom initial view state', async () => {
    await act(async () => {
      render(<MapCanvas initialViewState={{ longitude: 1.0, latitude: 2.0, zoom: 8 }} />)
    })
    const map = screen.getByTestId('mapbox')
    expect(map.getAttribute('data-longitude')).toBe('1')
    expect(map.getAttribute('data-latitude')).toBe('2')
    expect(map.getAttribute('data-zoom')).toBe('8')
  })

  it('passes resolved style object to Map after loadMapStyle resolves', async () => {
    await act(async () => { render(<MapCanvas />) })
    const map = screen.getByTestId('mapbox')
    expect(map.getAttribute('data-style-type')).toBe('object')
  })

  it('renders container div wrapping the Map', async () => {
    const { container } = await act(async () => render(<MapCanvas />))
    const wrapper = container.firstElementChild
    expect(wrapper?.tagName).toBe('DIV')
  })
})
