import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CircleSidebar } from '../CircleSidebar'
import type { Circle, CircleMember, MemberStatus } from '../../../../../shared/types'

const circle: Circle = { circle_id: 'c1', name: 'Wanga Family', created_at: '' }

const members: CircleMember[] = [
  { circle_id: 'c1', member_token: 'v1:tok_aaabbb', alert_radius_km: 1, alert_severity: 'HIGH', joined_at: '' },
  { circle_id: 'c1', member_token: 'v1:tok_cccdd', alert_radius_km: 2, alert_severity: 'MEDIUM', joined_at: '' },
]

const statuses: Record<string, MemberStatus> = { 'v1:tok_aaabbb': 'ONLINE', 'v1:tok_cccdd': 'GHOST' }

const noopAddMember = vi.fn().mockResolvedValue(null)

describe('CircleSidebar', () => {
  it('renders circle name', () => {
    render(<CircleSidebar circle={circle} members={members} memberStatuses={statuses} onInvite={vi.fn()} onLeave={vi.fn()} onAddMember={noopAddMember} />)
    expect(screen.getByText('Wanga Family')).toBeInTheDocument()
  })

  it('renders a MemberChip for each member', () => {
    render(<CircleSidebar circle={circle} members={members} memberStatuses={statuses} onInvite={vi.fn()} onLeave={vi.fn()} onAddMember={noopAddMember} />)
    // Each full token appears once in the member list (the chip truncates it)
    expect(screen.getAllByText('v1:tok_aaabbb')).toHaveLength(1)
    expect(screen.getAllByText('v1:tok_cccdd')).toHaveLength(1)
    // The chip renders a truncated version (first 8 chars + ellipsis)
    expect(screen.getAllByText('v1:tok_a…')).toHaveLength(1)
    expect(screen.getAllByText('v1:tok_c…')).toHaveLength(1)
  })

  it('calls onInvite when invite button is clicked', () => {
    const onInvite = vi.fn()
    render(<CircleSidebar circle={circle} members={members} memberStatuses={statuses} onInvite={onInvite} onLeave={vi.fn()} onAddMember={noopAddMember} />)
    fireEvent.click(screen.getByText(/Generate Invite/i))
    expect(onInvite).toHaveBeenCalled()
  })

  it('calls onLeave when Leave Circle button is clicked', () => {
    const onLeave = vi.fn()
    render(<CircleSidebar circle={circle} members={members} memberStatuses={statuses} onInvite={vi.fn()} onLeave={onLeave} onAddMember={noopAddMember} />)
    fireEvent.click(screen.getByText(/Leave Circle/i))
    expect(onLeave).toHaveBeenCalled()
  })

  it('shows E2EE indicator text', () => {
    render(<CircleSidebar circle={circle} members={members} memberStatuses={statuses} onInvite={vi.fn()} onLeave={vi.fn()} onAddMember={noopAddMember} />)
    expect(screen.getByText(/X25519 Encryption Active/i)).toBeInTheDocument()
  })
})
