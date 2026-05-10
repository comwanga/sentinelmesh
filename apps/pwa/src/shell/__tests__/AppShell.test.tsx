import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import eventsReducer from '../../store/eventsSlice'
import acousticReducer from '../../store/acousticSlice'
import circlesReducer from '../../store/circlesSlice'
import { router } from '../../router'

vi.mock('react-map-gl', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="mapbox">{children}</div>,
  Marker: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Popup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('../../services/websocket', () => ({ useWsConnection: () => {} }))
vi.mock('../../hooks/useAcousticDetection', () => ({ useAcousticDetection: () => {} }))
vi.mock('../../services/circleWebSocket', () => ({ useCircleWsConnection: () => {} }))
vi.mock('../../hooks/useProximityAlerts', () => ({ useProximityAlerts: () => {} }))

function makeStore() {
  return configureStore({ reducer: { events: eventsReducer, acoustic: acousticReducer, circles: circlesReducer } })
}

function renderRoute(path: string) {
  const testRouter = createMemoryRouter(router.routes, { initialEntries: [path] })
  render(
    <Provider store={makeStore()}>
      <RouterProvider router={testRouter} />
    </Provider>
  )
}

describe('AppShell routing', () => {
  it('renders header on every route', () => {
    renderRoute('/')
    expect(screen.getByText('SENTINELMESH')).toBeInTheDocument()
  })

  it('renders map page at /', () => {
    renderRoute('/')
    expect(screen.getByTestId('live-map-page')).toBeInTheDocument()
  })

  it('renders circles page at /circles', () => {
    renderRoute('/circles')
    expect(screen.getByTestId('circles-page')).toBeInTheDocument()
  })

  it('renders alerts page at /alerts', () => {
    renderRoute('/alerts')
    expect(screen.getByTestId('alerts-page')).toBeInTheDocument()
  })

  it('renders insights page at /insights', () => {
    renderRoute('/insights')
    expect(screen.getByTestId('insights-page')).toBeInTheDocument()
  })
})
