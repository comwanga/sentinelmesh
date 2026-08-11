import { render, screen, fireEvent } from '@testing-library/react'
import { MapFeatureStrip } from './MapFeatureStrip'
import { vi } from 'vitest'

describe('MapFeatureStrip', () => {
  it('renders only the core report action by default', () => {
    const noop = vi.fn()
    render(<MapFeatureStrip onReport={noop} onAcoustic={noop} onCircles={noop} onRoutes={noop} onHomeRoute={noop} />)
    expect(screen.getByText('Report Incident')).toBeInTheDocument()
    expect(screen.queryByText('Acoustic Detect')).not.toBeInTheDocument()
    expect(screen.queryByText('Family Circles')).not.toBeInTheDocument()
    expect(screen.queryByText('Route Preview')).not.toBeInTheDocument()
    expect(screen.queryByText('Navigate Home')).not.toBeInTheDocument()
  })
  it('calls onReport when Report Incident is clicked', () => {
    const onReport = vi.fn()
    const noop = vi.fn()
    render(<MapFeatureStrip onReport={onReport} onAcoustic={noop} onCircles={noop} onRoutes={noop} onHomeRoute={noop} />)
    fireEvent.click(screen.getByText('Report Incident'))
    expect(onReport).toHaveBeenCalledOnce()
  })
})
