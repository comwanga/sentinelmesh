import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { Provider } from 'react-redux'
import { store } from '../../store'

vi.mock('../../hooks/useSafetyDataSync', () => ({ useSafetyDataSync: vi.fn() }))

import { AppShell } from './AppShell'

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <Provider store={store}>
      <MemoryRouter initialEntries={['/map']}>{children}</MemoryRouter>
    </Provider>
  )
}

describe('AppShell', () => {
  it('renders outlet content', () => {
    render(
      <Wrapper>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/map" element={<div>map page</div>} />
          </Route>
        </Routes>
      </Wrapper>
    )
    expect(screen.getByText('map page')).toBeInTheDocument()
  })
})
