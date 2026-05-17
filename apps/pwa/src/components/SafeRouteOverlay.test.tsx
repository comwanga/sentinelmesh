import { vi, describe, test, expect } from 'vitest'
import React from 'react'
import { render } from '@testing-library/react'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import uiReducer, { safeRoutesSet } from '../store/uiSlice'
import { SafeRouteOverlay } from './SafeRouteOverlay'

vi.mock('react-map-gl/mapbox', () => ({
  Source: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Layer: () => null,
}))

function makeStore(routes: { id: string; coordinates: [number, number][] }[] = []) {
  const store = configureStore({ reducer: { ui: uiReducer } })
  if (routes.length) store.dispatch(safeRoutesSet(routes))
  return store
}

describe('SafeRouteOverlay', () => {
  test('renders without throwing when store has routes', () => {
    const routes = [
      { id: 'r0', coordinates: [[36.82, -1.29], [36.83, -1.28]] as [number, number][] },
    ]
    expect(() =>
      render(<Provider store={makeStore(routes)}><SafeRouteOverlay /></Provider>)
    ).not.toThrow()
  })
  test('renders nothing when no routes in store', () => {
    const { container } = render(<Provider store={makeStore()}><SafeRouteOverlay /></Provider>)
    expect(container.firstChild).toBeNull()
  })
})
