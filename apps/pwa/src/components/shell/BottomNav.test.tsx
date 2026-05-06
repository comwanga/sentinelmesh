import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BottomNav } from './BottomNav'

describe('BottomNav', () => {
  it('renders 5 navigation tabs', () => {
    render(<MemoryRouter><BottomNav /></MemoryRouter>)
    expect(screen.getByText('Map')).toBeInTheDocument()
    expect(screen.getByText('Alerts')).toBeInTheDocument()
    expect(screen.getByText('Report')).toBeInTheDocument()
    expect(screen.getByText('Family')).toBeInTheDocument()
    expect(screen.getByText('Profile')).toBeInTheDocument()
  })

  it('all tabs are links', () => {
    render(<MemoryRouter><BottomNav /></MemoryRouter>)
    expect(screen.getAllByRole('link')).toHaveLength(5)
  })
})
