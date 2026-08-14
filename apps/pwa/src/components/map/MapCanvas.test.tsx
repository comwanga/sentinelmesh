import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MapCanvas } from './MapCanvas'
import { persistViewport } from '../../hooks/useInitialViewport'
import type { ViewportBounds } from '../../hooks/useViewportWs'

const mockStyle = vi.hoisted(() => ({ version: 8, name: 'SentinelMesh Light', layers: [] }))

vi.mock('../../config/mapConfig', () => ({
  MAP_STYLE: mockStyle,
  WORLD_CENTER: { longitude: 0, latitude: 20, zoom: 2 },
}))

vi.mock('../../hooks/useInitialViewport', () => ({
  persistViewport: vi.fn(),
}))

const mapProps = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
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
  Map: (props: {
    children?: React.ReactNode
    initialViewState: { longitude: number; latitude: number; zoom: number }
    onMoveEnd: (evt: { viewState: { longitude: number; latitude: number; zoom: number } }) => void
    mapStyle?: unknown
  }) => {
    mapProps.current = props
    return (
      <div
        data-testid="mapbox"
        data-longitude={String(props.initialViewState.longitude)}
        data-latitude={String(props.initialViewState.latitude)}
        data-zoom={String(props.initialViewState.zoom)}
        data-style-type={typeof props.mapStyle === 'object' && props.mapStyle !== null ? 'object' : 'string'}
        onClick={() => props.onMoveEnd({ viewState: { longitude: 10, latitude: 10, zoom: 5 } })}
      >
        {props.children}
      </div>
    )
  },
  useMap: () => ({ current: mockMap }),
}))

describe('MapCanvas', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders Map with the synchronous canonical style on the first pass', () => {
    render(<MapCanvas />)
    const map = screen.getByTestId('mapbox')
    expect(map.dataset.styleType).toBe('object')
    expect(mapProps.current.mapStyle).toBe(mockStyle)
  })

  it('uses an uncontrolled world-center initial view state', () => {
    render(<MapCanvas />)
    expect(mapProps.current.initialViewState).toEqual({ longitude: 0, latitude: 20, zoom: 2 })
    expect(mapProps.current).not.toHaveProperty('longitude')
    expect(mapProps.current).not.toHaveProperty('latitude')
    expect(mapProps.current).not.toHaveProperty('zoom')
    expect(mapProps.current).not.toHaveProperty('onMove')
  })

  it('accepts a custom initial view and does not turn it into controlled camera props', () => {
    render(<MapCanvas initialViewState={{ longitude: 1, latitude: 2, zoom: 8 }} />)
    expect(mapProps.current.initialViewState).toEqual({ longitude: 1, latitude: 2, zoom: 8 })
    expect(mapProps.current).not.toHaveProperty('longitude')
  })

  it('keeps the camera uncontrolled across unrelated parent renders', () => {
    const initialViewState = { longitude: 1, latitude: 2, zoom: 8 }
    const { rerender } = render(<MapCanvas initialViewState={initialViewState}><span>first</span></MapCanvas>)
    rerender(<MapCanvas initialViewState={initialViewState}><span>second</span></MapCanvas>)
    expect(mapProps.current.initialViewState).toBe(initialViewState)
    expect(mapProps.current).not.toHaveProperty('longitude')
    expect(mapProps.current).not.toHaveProperty('onMove')
  })

  it('persists viewport only when movement ends', () => {
    render(<MapCanvas />)
    expect(persistViewport).not.toHaveBeenCalled()
    screen.getByTestId('mapbox').click()
    expect(persistViewport).toHaveBeenCalledOnce()
    expect(persistViewport).toHaveBeenCalledWith({ longitude: 10, latitude: 10, zoom: 5 })
  })

  it('renders children inside the map', () => {
    render(<MapCanvas><div data-testid="child">marker</div></MapCanvas>)
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('calls onBoundsChange initially and on moveend', () => {
    const onBoundsChange = vi.fn()
    render(<MapCanvas onBoundsChange={onBoundsChange} />)
    expect(onBoundsChange).toHaveBeenCalledOnce()
    const [bounds, zoom] = onBoundsChange.mock.calls[0] as [ViewportBounds, number]
    expect(bounds).toEqual({ north: 1, south: -1, east: 38, west: 36 })
    expect(zoom).toBe(10)

    onBoundsChange.mockClear()
    act(() => mockMap._fire('moveend'))
    expect(onBoundsChange).toHaveBeenCalledOnce()
  })

  it('does not subscribe to bounds changes without a callback', () => {
    render(<MapCanvas />)
    expect(mockMap.on).not.toHaveBeenCalled()
  })
})
