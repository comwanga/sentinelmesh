import { render, screen } from '@testing-library/react'
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
  it('renders core navigation only by default', () => {
    const s = makeStore()
    render(<Sidebar />, { wrapper: makeWrapper(s) })
    ;['Safety map', 'Alerts', 'Community reports', 'Family circles', 'Identity + settings'].forEach(label => {
      expect(screen.getByText(label)).toBeInTheDocument()
    })
    ;['Routes', 'Acoustic Detect', 'Insights', 'Community chat'].forEach(label => {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    })
    expect(screen.queryByText('All systems operational')).not.toBeInTheDocument()
  })
})
