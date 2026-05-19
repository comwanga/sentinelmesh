import { describe, it, expect, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MapCanvas } from './MapCanvas'
import type { ViewportBounds } from '../../hooks/useViewportWs'

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

// Mutable mock map used by ViewportReporter tests
const mockMap = vi.hoisted(() => {
  const handlers = new Map<string, () => void>()
  return {
    getBounds: vi.fn(() => ({
      getNorth: () => 1,
      getSouth: () => -1,
      getEast: () => 38,
      getWest: () => 36,
    })),
    getZoom: vi.fn(() => 10),
    on: vi.fn((event: string, fn: () => void) => { handlers.set(event, fn) }),
    off: vi.fn((event: string) => { handlers.delete(event) }),
    _fire: (event: string) => handlers.get(event)?.(),
  }
})

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
  useMap: () => ({ current: mockMap }),
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

  it('calls onBoundsChange with initial bounds immediately after map mounts', async () => {
    const onBoundsChange = vi.fn()
    await act(async () => {
      render(<MapCanvas onBoundsChange={onBoundsChange} />)
    })
    expect(onBoundsChange).toHaveBeenCalledOnce()
    const [bounds, zoom] = onBoundsChange.mock.calls[0] as [ViewportBounds, number]
    expect(bounds.north).toBe(1)
    expect(bounds.south).toBe(-1)
    expect(bounds.east).toBe(38)
    expect(bounds.west).toBe(36)
    expect(zoom).toBe(10)
  })

  it('calls onBoundsChange again when moveend fires', async () => {
    const onBoundsChange = vi.fn()
    await act(async () => {
      render(<MapCanvas onBoundsChange={onBoundsChange} />)
    })
    onBoundsChange.mockClear()
    act(() => mockMap._fire('moveend'))
    expect(onBoundsChange).toHaveBeenCalledOnce()
  })

  it('does not mount ViewportReporter when onBoundsChange is not provided', async () => {
    mockMap.on.mockClear()
    await act(async () => { render(<MapCanvas />) })
    const moveendCalls = (mockMap.on.mock.calls as Array<[string, () => void]>).filter(c => c[0] === 'moveend')
    expect(moveendCalls).toHaveLength(0)
  })
})
