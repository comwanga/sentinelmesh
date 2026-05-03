import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProximityAlertLog } from '../ProximityAlertLog'
import type { ProximityAlert } from '../../../../../shared/types'

const alerts: ProximityAlert[] = [
  { id: 'a1', member_pubkey: 'npub1abc123', zone_name: 'Crisis Zone B', event_id: 'e1', severity: 'HIGH', triggered_at: '2026-05-03T02:14:00Z' },
  { id: 'a2', member_pubkey: 'npub1xyz789', zone_name: 'Flood Zone', event_id: 'e2', severity: 'CRITICAL', triggered_at: '2026-05-03T01:58:00Z' },
]

describe('ProximityAlertLog', () => {
  it('renders all alert entries', () => {
    render(<ProximityAlertLog alerts={alerts} />)
    expect(screen.getByText(/Crisis Zone B/)).toBeInTheDocument()
    expect(screen.getByText(/Flood Zone/)).toBeInTheDocument()
  })

  it('shows event count badge', () => {
    render(<ProximityAlertLog alerts={alerts} />)
    expect(screen.getByText('2 events')).toBeInTheDocument()
  })

  it('renders empty state when no alerts', () => {
    render(<ProximityAlertLog alerts={[]} />)
    expect(screen.getByText('No proximity alerts')).toBeInTheDocument()
  })

  it('renders --:-- for invalid triggered_at', () => {
    const badAlert: ProximityAlert[] = [
      { id: 'a3', member_pubkey: 'npub1bad', zone_name: 'Zone X', event_id: null, severity: 'LOW', triggered_at: 'not-a-date' },
    ]
    render(<ProximityAlertLog alerts={badAlert} />)
    expect(screen.getByText('--:--')).toBeInTheDocument()
  })
})
