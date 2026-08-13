import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CircleSidebar } from '../CircleSidebar'
import type { Circle, CircleMember, MemberStatus } from '../../../../../shared/types'

const circle: Circle = { circle_id: 'c1', name: 'Wanga Family', created_at: '' }

const members: CircleMember[] = [
  {
    circle_id: 'c1',
    member_token: 'v1:tok_aaabbb',
    alert_radius_km: 1,
    alert_severity: 'HIGH',
    joined_at: '',
    pubkey: 'pubkey_alice',
    label: 'Alice',
  },
  {
    circle_id: 'c1',
    member_token: 'v1:tok_cccdd',
    alert_radius_km: 2,
    alert_severity: 'MEDIUM',
    joined_at: '',
    // no pubkey or label — unlabeled member
  },
]

const statuses: Record<string, MemberStatus> = { 'pubkey_alice': 'ONLINE' }

const noopAddMember = vi.fn().mockResolvedValue(null)

describe('CircleSidebar', () => {
  it('renders circle name', () => {
    render(<CircleSidebar circle={circle} members={members} memberStatuses={statuses} onInvite={vi.fn()} onLeave={vi.fn()} onAddMember={noopAddMember} />)
    expect(screen.getByText('Wanga Family')).toBeInTheDocument()
  })

  it('renders the decrypted label for a labeled member', () => {
    render(<CircleSidebar circle={circle} members={members} memberStatuses={statuses} onInvite={vi.fn()} onLeave={vi.fn()} onAddMember={noopAddMember} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('renders "unknown member" for a member with no pubkey or label', () => {
    render(<CircleSidebar circle={circle} members={members} memberStatuses={statuses} onInvite={vi.fn()} onLeave={vi.fn()} onAddMember={noopAddMember} />)
    expect(screen.getByText('unknown member')).toBeInTheDocument()
  })

  it('looks up status by pubkey for labeled members', () => {
    render(<CircleSidebar circle={circle} members={members} memberStatuses={statuses} onInvite={vi.fn()} onLeave={vi.fn()} onAddMember={noopAddMember} />)
    // Alice is ONLINE; the status label should appear
    expect(screen.getByText('● Sharing location')).toBeInTheDocument()
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
    expect(screen.getByText(/NIP-44 Keys · AES-256-GCM Content/i)).toBeInTheDocument()
  })
})
