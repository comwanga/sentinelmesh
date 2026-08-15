import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { CirclesPage } from './CirclesPage'

// Mock useBreakpoint so we can control layout per test
const mockUseBreakpoint = vi.fn(() => ({ layout: 'desktop' as 'desktop' | 'mobile' }))
vi.mock('../hooks/useBreakpoint', () => ({
  useBreakpoint: () => mockUseBreakpoint(),
}))

// Mock FamilyCircleDashboard to avoid complex dependencies
vi.mock('../components/FamilyCircleDashboard', () => ({
  FamilyCircleDashboard: () => <div data-testid="family-circle-dashboard" />,
}))

// Mock useNavigate from react-router-dom
const mockNavigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

describe('CirclesPage', () => {
  it('renders the encrypted family circles notice', () => {
    mockUseBreakpoint.mockReturnValue({ layout: 'desktop' })
    render(<CirclesPage />)
    expect(screen.getByText('Encrypted family circles')).toBeInTheDocument()
  })

  it('mobile: renders the safety map button', () => {
    mockUseBreakpoint.mockReturnValue({ layout: 'mobile' })
    render(<CirclesPage />)
    expect(screen.getByText('View safety map')).toBeInTheDocument()
  })

  it('desktop: does not render the safety map button', () => {
    mockUseBreakpoint.mockReturnValue({ layout: 'desktop' })
    render(<CirclesPage />)
    expect(screen.queryByText('View safety map')).not.toBeInTheDocument()
  })

  it('the safety map button navigates to /map', () => {
    mockUseBreakpoint.mockReturnValue({ layout: 'mobile' })
    render(<CirclesPage />)

    fireEvent.click(screen.getByText('View safety map'))

    expect(mockNavigate).toHaveBeenCalledWith('/map')
  })
})
