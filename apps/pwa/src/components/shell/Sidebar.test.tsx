import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import eventsReducer from '../../store/eventsSlice'
import uiReducer from '../../store/uiSlice'
import { Sidebar } from './Sidebar'

function makeStore() {
  return configureStore({ reducer: { events: eventsReducer, ui: uiReducer } })
}
function makeWrapper(store: ReturnType<typeof makeStore>) {
  return ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}><MemoryRouter initialEntries={['/map']}>{children}</MemoryRouter></Provider>
  )
}

describe('Sidebar', () => {
  it('renders all 8 nav item labels', () => {
    const s = makeStore()
    render(<Sidebar />, { wrapper: makeWrapper(s) })
    ;['Live Map', 'Alerts', 'Reports', 'Family Circles', 'Routes',
      'Acoustic Detect', 'Insights', 'Settings'].forEach(label => {
      expect(screen.getByText(label)).toBeInTheDocument()
    })
  })

  it('shows NEW badge on Insights', () => {
    const s = makeStore()
    render(<Sidebar />, { wrapper: makeWrapper(s) })
    expect(screen.getByText('NEW')).toBeInTheDocument()
  })

  it('dispatches routes overlay intent when Routes clicked', () => {
    const s = makeStore()
    render(<Sidebar />, { wrapper: makeWrapper(s) })
    fireEvent.click(screen.getByText('Routes'))
    expect(s.getState().ui.uiIntent).toEqual({ type: 'overlay', name: 'routes' })
  })

  it('dispatches acoustic overlay intent when Acoustic Detect clicked', () => {
    const s = makeStore()
    render(<Sidebar />, { wrapper: makeWrapper(s) })
    fireEvent.click(screen.getByText('Acoustic Detect'))
    expect(s.getState().ui.uiIntent).toEqual({ type: 'overlay', name: 'acoustic' })
  })

  it('shows operational status indicator', () => {
    const s = makeStore()
    render(<Sidebar />, { wrapper: makeWrapper(s) })
    expect(screen.getByText('All systems operational')).toBeInTheDocument()
  })
})
