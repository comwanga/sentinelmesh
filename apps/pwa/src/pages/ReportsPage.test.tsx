import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ReportsPage } from './ReportsPage'

// Mock useBreakpoint so we can control layout per test
const mockUseBreakpoint = vi.fn(() => ({ layout: 'desktop' as 'desktop' | 'mobile' }))
vi.mock('../hooks/useBreakpoint', () => ({
  useBreakpoint: () => mockUseBreakpoint(),
}))

// Mock ReportSubmit to a simple stub
vi.mock('../components/ReportSubmit', () => ({
  ReportSubmit: () => <div data-testid="report-submit" />,
}))

// Mock ReportList to a simple stub
vi.mock('../components/ReportList', () => ({
  ReportList: () => <div data-testid="report-list" />,
}))

describe('ReportsPage', () => {
  it('renders in desktop layout — both components visible side by side', () => {
    mockUseBreakpoint.mockReturnValue({ layout: 'desktop' })
    render(<ReportsPage />)

    expect(screen.getByTestId('report-submit')).toBeInTheDocument()
    expect(screen.getByTestId('report-list')).toBeInTheDocument()

    const container = screen.getByTestId('reports-container')
    expect(container).toHaveStyle({ flexDirection: 'row' })
  })

  it('renders in mobile layout — list visible, form opens on submit button click', () => {
    mockUseBreakpoint.mockReturnValue({ layout: 'mobile' })
    render(<ReportsPage />)

    // Form is hidden behind modal on mobile initially
    expect(screen.queryByTestId('report-submit')).not.toBeInTheDocument()
    expect(screen.getByTestId('report-list')).toBeInTheDocument()

    // Clicking submit button opens the modal
    fireEvent.click(screen.getByText('+ SUBMIT'))
    expect(screen.getByTestId('report-submit')).toBeInTheDocument()

    const container = screen.getByTestId('reports-container')
    expect(container).toHaveStyle({ flexDirection: 'column' })
  })
})
