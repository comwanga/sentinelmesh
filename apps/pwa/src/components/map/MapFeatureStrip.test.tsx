import { render, screen, fireEvent } from '@testing-library/react'
import { MapFeatureStrip } from './MapFeatureStrip'
import { vi } from 'vitest'

describe('MapFeatureStrip', () => {
  it('renders 5 feature cards', () => {
    const noop = vi.fn()
    render(<MapFeatureStrip onReport={noop} onAcoustic={noop} onCircles={noop} onRoutes={noop} onZaps={noop} />)
    expect(screen.getByText('Report Incident')).toBeInTheDocument()
    expect(screen.getByText('Acoustic Detect')).toBeInTheDocument()
    expect(screen.getByText('Family Circles')).toBeInTheDocument()
    expect(screen.getByText('Escape Routes')).toBeInTheDocument()
    expect(screen.getByText('Zap Reporter')).toBeInTheDocument()
  })
  it('calls onAcoustic when Acoustic Detect clicked', () => {
    const onAcoustic = vi.fn()
    const noop = vi.fn()
    render(<MapFeatureStrip onReport={noop} onAcoustic={onAcoustic} onCircles={noop} onRoutes={noop} onZaps={noop} />)
    fireEvent.click(screen.getByText('Acoustic Detect'))
    expect(onAcoustic).toHaveBeenCalledOnce()
  })
})
