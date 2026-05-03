import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import circlesReducer, { circleLoaded } from '../../store/circlesSlice'
import eventsReducer from '../../store/eventsSlice'
import acousticReducer from '../../store/acousticSlice'
import { FamilyCircleDashboard } from '../FamilyCircleDashboard'
import type { Circle, CircleMember } from '../../../../../shared/types'

vi.mock('../CircleMapLayer', () => ({
  CircleMapLayer: () => <div data-testid="circle-map-layer" />,
}))
vi.mock('react-map-gl', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="mapbox">{children}</div>,
  Marker: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('../../services/circleWebSocket', () => ({
  useCircleWsConnection: () => {},
}))
vi.mock('../../hooks/useProximityAlerts', () => ({
  useProximityAlerts: () => {},
}))

const circle: Circle = { circle_id: 'c1', owner_pubkey: 'aaa', name: 'Wanga Family', created_at: '' }
const members: CircleMember[] = [
  { circle_id: 'c1', member_pubkey: 'npub1aaa', alert_radius_km: 1, alert_severity: 'HIGH', joined_at: '' },
]

function makeStore() {
  const store = configureStore({ reducer: { circles: circlesReducer, events: eventsReducer, acoustic: acousticReducer } })
  store.dispatch(circleLoaded({ circle, members }))
  return store
}

describe('FamilyCircleDashboard', () => {
  it('renders circle name in sidebar', () => {
    render(<Provider store={makeStore()}><FamilyCircleDashboard /></Provider>)
    expect(screen.getByText('Wanga Family')).toBeInTheDocument()
  })

  it('renders the map area', () => {
    render(<Provider store={makeStore()}><FamilyCircleDashboard /></Provider>)
    expect(screen.getByTestId('mapbox')).toBeInTheDocument()
  })

  it('renders ProximityAlertLog', () => {
    render(<Provider store={makeStore()}><FamilyCircleDashboard /></Provider>)
    expect(screen.getByText(/Proximity Alert Log/i)).toBeInTheDocument()
  })
})
