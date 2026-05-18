import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import { MapOverlayHost } from './MapOverlayHost'

// Create portal target before tests
beforeEach(() => {
  let portal = document.getElementById('map-overlay-portal')
  if (!portal) {
    portal = document.createElement('div')
    portal.id = 'map-overlay-portal'
    document.body.appendChild(portal)
  }
})

vi.mock('../../store', () => ({ useAppSelector: vi.fn(), useAppDispatch: vi.fn() }))
vi.mock('../../store/uiSlice', () => ({
  consumeOverlayIntent: vi.fn(() => ({ type: 'ui/consumeOverlayIntent' })),
  safeRoutesSet:        vi.fn(() => ({ type: 'ui/safeRoutesSet' })),
  safeRoutesCleared:    vi.fn(() => ({ type: 'ui/safeRoutesCleared' })),
}))
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => ({ layout: 'mobile' }) }))
vi.mock('../AcousticAlert', () => ({ AcousticAlert: () => <div data-testid="acoustic" /> }))
vi.mock('../HomeRoutePanel', () => ({ HomeRoutePanel: () => <div data-testid="home-route" /> }))
vi.mock('../../services/routingService', () => ({ fetchSafeRoutes: vi.fn() }))

import { useAppSelector, useAppDispatch } from '../../store'

describe('MapOverlayHost', () => {
  beforeEach(() => {
    vi.mocked(useAppDispatch).mockReturnValue(vi.fn())
    vi.mocked(useAppSelector).mockImplementation((selector: unknown) => {
      const fn = selector as (s: unknown) => unknown
      return fn({
        ui: { uiIntent: { name: 'none' } },
        events: { items: [] },
      })
    })
  })

  it('renders null when no active overlay', () => {
    const { container } = render(<MapOverlayHost />)
    expect(container.firstChild).toBeNull()
  })

  it('portal target exists in document', () => {
    render(<MapOverlayHost />)
    expect(document.getElementById('map-overlay-portal')).not.toBeNull()
  })

  it('renders acoustic overlay into portal when intent is acoustic', () => {
    vi.mocked(useAppSelector).mockImplementation((selector: unknown) => {
      const fn = selector as (s: unknown) => unknown
      return fn({
        ui: { uiIntent: { name: 'acoustic' } },
        events: { items: [] },
      })
    })
    render(<MapOverlayHost />)
    const portal = document.getElementById('map-overlay-portal')!
    expect(within(portal).getByTestId('acoustic')).toBeInTheDocument()
  })
})
