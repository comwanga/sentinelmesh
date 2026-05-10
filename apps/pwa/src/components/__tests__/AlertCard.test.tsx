import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AlertCard } from '../AlertCard'
import type { SafetyEvent } from '../../../../../shared/types'

const event: SafetyEvent = {
  id: 'evt-1', event_type: 'FLOOD', severity: 'CRITICAL',
  title: 'Flooding in CBD', summary: 'Roads impassable',
  lat: -1.29, lng: 36.82, place_name: 'CBD', county: 'Nairobi',
  is_active: true, started_at: '2026-05-11T10:00:00Z', created_at: '2026-05-11T10:00:00Z',
  nostr_event_id: null, bitcoin_txid: null,
}

describe('AlertCard', () => {
  it('renders event title', () => {
    render(<AlertCard event={event} />)
    expect(screen.getByText('Flooding in CBD')).toBeInTheDocument()
  })

  it('renders severity label', () => {
    render(<AlertCard event={event} />)
    expect(screen.getByText('CRITICAL')).toBeInTheDocument()
  })

  it('renders place_name when present', () => {
    render(<AlertCard event={event} />)
    expect(screen.getByText('CBD')).toBeInTheDocument()
  })

  it('calls onClick with the event when clicked', () => {
    const onClick = vi.fn()
    render(<AlertCard event={event} onClick={onClick} />)
    fireEvent.click(screen.getByText('Flooding in CBD'))
    expect(onClick).toHaveBeenCalledWith(event)
  })

  it('renders without onClick prop without throwing', () => {
    expect(() => render(<AlertCard event={event} />)).not.toThrow()
  })
})
