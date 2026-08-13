import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BottomNav } from './BottomNav'

describe('BottomNav', () => {
  it('renders only core navigation tabs by default', () => {
    render(<MemoryRouter><BottomNav /></MemoryRouter>)
    expect(screen.getByText('Atlas')).toBeInTheDocument()
    expect(screen.getByText('Signals')).toBeInTheDocument()
    expect(screen.getByText('Report')).toBeInTheDocument()
    expect(screen.queryByText('Family')).not.toBeInTheDocument()
    expect(screen.getByText('Identity')).toBeInTheDocument()
  })

  it('all tabs are links', () => {
    render(<MemoryRouter><BottomNav /></MemoryRouter>)
    expect(screen.getAllByRole('link')).toHaveLength(4)
  })
})
