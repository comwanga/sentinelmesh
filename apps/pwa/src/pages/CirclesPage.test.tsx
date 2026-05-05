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
  it('renders E2EE notice "END-TO-END ENCRYPTED — ZERO KNOWLEDGE"', () => {
    mockUseBreakpoint.mockReturnValue({ layout: 'desktop' })
    render(<CirclesPage />)
    expect(screen.getByText('END-TO-END ENCRYPTED — ZERO KNOWLEDGE')).toBeInTheDocument()
  })

  it('mobile: renders "VIEW ON MAP" button', () => {
    mockUseBreakpoint.mockReturnValue({ layout: 'mobile' })
    render(<CirclesPage />)
    expect(screen.getByText('VIEW ON MAP')).toBeInTheDocument()
  })

  it('desktop: does not render "VIEW ON MAP" button', () => {
    mockUseBreakpoint.mockReturnValue({ layout: 'desktop' })
    render(<CirclesPage />)
    expect(screen.queryByText('VIEW ON MAP')).not.toBeInTheDocument()
  })

  it('"VIEW ON MAP" button navigates to /map', () => {
    mockUseBreakpoint.mockReturnValue({ layout: 'mobile' })
    render(<CirclesPage />)

    fireEvent.click(screen.getByText('VIEW ON MAP'))

    expect(mockNavigate).toHaveBeenCalledWith('/map')
  })
})
