import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AlertBanner } from '../AlertBanner'
import type { ProximityAlert } from '../../../../../shared/types'

const alert: ProximityAlert = {
  id: 'a1', member_pubkey: 'npub1abc123def', zone_name: 'Crisis Zone B',
  event_id: 'e1', severity: 'HIGH', triggered_at: '',
}

describe('AlertBanner', () => {
  it('renders nothing when alert is null', () => {
    const { container } = render(<AlertBanner alert={null} onDismiss={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders alert text when alert is present', () => {
    render(<AlertBanner alert={alert} onDismiss={vi.fn()} />)
    expect(screen.getByText(/Crisis Zone B/)).toBeInTheDocument()
    expect(screen.getByText(/npub1abc…/)).toBeInTheDocument()
  })

  it('calls onDismiss when close button is clicked', () => {
    const onDismiss = vi.fn()
    render(<AlertBanner alert={alert} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onDismiss).toHaveBeenCalled()
  })
})
