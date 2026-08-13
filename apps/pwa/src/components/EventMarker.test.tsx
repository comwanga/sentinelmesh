import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import EventMarker from './EventMarker'
import type { SafetyEvent } from '../../../../shared/types'

const base: SafetyEvent = {
  id: '1', event_type: 'SECURITY_INCIDENT', severity: 'CRITICAL',
  title: 'Test', summary: null, lat: -1.28, lng: 36.82,
  place_name: null, county: null, is_active: true, state: 'ACTIVE',
  started_at: '2026-05-18T00:00:00Z', created_at: '2026-05-18T00:00:00Z',
  nostr_event_id: null,
  trust_state: 'confirmed',
}

describe('EventMarker', () => {
  afterEach(() => {
    document.querySelectorAll('style[data-sm-pulse]').forEach(el => el.remove())
  })
  it('renders a keyboard-operable incident button', () => {
    render(<EventMarker event={base} onClick={vi.fn()} />)
    expect(screen.getByRole('button', { name: /critical alert/i })).toBeInTheDocument()
  })

  it('CRITICAL dot has correct background color', () => {
    const { container } = render(<EventMarker event={base} onClick={vi.fn()} />)
    const wrapper = container.firstElementChild as HTMLElement
    const dot = wrapper.firstElementChild as HTMLElement
    expect(dot.style.background).toBe('rgb(255, 45, 45)')
  })

  it('CRITICAL dot has correct desktop size (24px diameter)', () => {
    const { container } = render(<EventMarker event={base} onClick={vi.fn()} />)
    const wrapper = container.firstElementChild as HTMLElement
    const dot = wrapper.firstElementChild as HTMLElement
    expect(dot.style.width).toBe('24px')
    expect(dot.style.height).toBe('24px')
  })

  it('CRITICAL shows exclamation mark', () => {
    render(<EventMarker event={base} onClick={vi.fn()} />)
    expect(screen.getByText('!')).toBeInTheDocument()
  })

  it('HIGH shows exclamation mark', () => {
    render(<EventMarker event={{ ...base, severity: 'HIGH' }} onClick={vi.fn()} />)
    expect(screen.getByText('!')).toBeInTheDocument()
  })

  it('MEDIUM does not show exclamation mark', () => {
    render(<EventMarker event={{ ...base, severity: 'MEDIUM' }} onClick={vi.fn()} />)
    expect(screen.queryByText('!')).not.toBeInTheDocument()
  })

  it('LOW does not show exclamation mark', () => {
    render(<EventMarker event={{ ...base, severity: 'LOW' }} onClick={vi.fn()} />)
    expect(screen.queryByText('!')).not.toBeInTheDocument()
  })

  it('calls onClick with the event when wrapper is clicked', () => {
    const onClick = vi.fn()
    const { container } = render(<EventMarker event={base} onClick={onClick} />)
    const wrapper = container.firstElementChild as HTMLElement
    wrapper.click()
    expect(onClick).toHaveBeenCalledWith(base)
  })

  it('CRITICAL marker injects CSS animation keyframes', () => {
    render(<EventMarker event={base} onClick={vi.fn()} />)
    const styleEls = document.querySelectorAll('style[data-sm-pulse]')
    expect(styleEls.length).toBeGreaterThan(0)
  })

  it('non-CRITICAL marker does not inject animation', () => {
    render(<EventMarker event={{ ...base, severity: 'HIGH' }} onClick={vi.fn()} />)
    const styleEls = document.querySelectorAll('style[data-sm-pulse]')
    expect(styleEls.length).toBe(0)
  })
})
