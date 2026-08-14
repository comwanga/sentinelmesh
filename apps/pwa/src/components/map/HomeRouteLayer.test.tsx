import { configureStore } from '@reduxjs/toolkit'
import { render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { describe, expect, it, vi } from 'vitest'
import uiReducer, { homeRouteSelect, homeRoutesSet, type HomeRoute } from '../../store/uiSlice'
import { HomeRouteLayer } from './HomeRouteLayer'

vi.mock('react-map-gl/maplibre', () => ({
  Source: ({ id, children }: { id: string; children: React.ReactNode }) => <div data-testid={id}>{children}</div>,
  Layer: ({ id }: { id: string }) => <span data-testid={id} />,
}))

const routes: HomeRoute[] = [0, 1].map(index => ({
  id: `provider-${index}`,
  coordinates: [[36.82, -1.29], [36.83 + index, -1.28]],
  distanceKm: index + 1,
  durationMin: 10,
  warnings: [],
  label: `Route ${index + 1}`,
  mode: 'walking',
  alertIntersections: 0,
}))

describe('HomeRouteLayer', () => {
  it('draws alternatives before the selected route and follows selection', () => {
    const store = configureStore({ reducer: { ui: uiReducer } })
    store.dispatch(homeRoutesSet(routes))
    const { rerender } = render(<Provider store={store}><HomeRouteLayer /></Provider>)
    expect(screen.getByTestId('home-route-alt-0')).toBeInTheDocument()
    expect(screen.getByTestId('home-route')).toBeInTheDocument()
    store.dispatch(homeRouteSelect(1))
    rerender(<Provider store={store}><HomeRouteLayer /></Provider>)
    expect(screen.getByTestId('home-route-alt-0')).toBeInTheDocument()
  })

  it('filters the selected route by provider ID even when coordinates are cloned', () => {
    const store = configureStore({ reducer: { ui: uiReducer } })
    store.dispatch(homeRoutesSet(routes.map(route => ({ ...route, coordinates: route.coordinates.map(point => [...point] as [number, number]) }))))
    store.dispatch(homeRouteSelect(1))
    render(<Provider store={store}><HomeRouteLayer /></Provider>)
    expect(screen.getByTestId('home-route-alt-0')).toBeInTheDocument()
    expect(screen.queryByTestId('home-route-alt-1')).not.toBeInTheDocument()
  })
})
