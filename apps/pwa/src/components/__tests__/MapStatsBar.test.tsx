import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MapStatsBar } from '../MapStatsBar'
import type { SafetyEvent } from '../../../../../shared/types'

function makeEvent(severity: SafetyEvent['severity'], id: string): SafetyEvent {
  return {
    id, event_type: 'FLOOD', severity, title: 't', summary: null,
    lat: 0, lng: 0, place_name: null, county: null,
    is_active: true, started_at: '', created_at: '',
    nostr_event_id: null, bitcoin_txid: null,
  }
}

describe('MapStatsBar', () => {
  it('shows total event count', () => {
    const events = [makeEvent('CRITICAL', '1'), makeEvent('HIGH', '2')]
    render(<MapStatsBar events={events} />)
    expect(screen.getByText('2 active')).toBeInTheDocument()
  })

  it('shows severity counts for present severities', () => {
    const events = [makeEvent('CRITICAL', '1'), makeEvent('CRITICAL', '2'), makeEvent('HIGH', '3')]
    render(<MapStatsBar events={events} />)
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('CRITICAL')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('HIGH')).toBeInTheDocument()
  })

  it('shows zero active when no events', () => {
    render(<MapStatsBar events={[]} />)
    expect(screen.getByText('0 active')).toBeInTheDocument()
  })

  it('does not render severity pill when count is zero', () => {
    render(<MapStatsBar events={[makeEvent('CRITICAL', '1')]} />)
    expect(screen.queryByText('HIGH')).not.toBeInTheDocument()
    expect(screen.queryByText('MEDIUM')).not.toBeInTheDocument()
    expect(screen.queryByText('LOW')).not.toBeInTheDocument()
  })
})
