import { render, screen } from '@testing-library/react'
import type { AlertCardProps } from './AlertCard'
import { AlertCard } from './AlertCard'

const base: AlertCardProps = {
  eventType: 'SECURITY_INCIDENT',
  title: 'Gunshots reported',
  location: 'Pangani, Nairobi',
  timestamp: Date.now() - 120_000,
  status: 'CONFIRMED',
  trustState: 'confirmed',
}

describe('AlertCard', () => {
  it('renders title and location', () => {
    render(<AlertCard {...base} />)
    expect(screen.getByText('Gunshots reported')).toBeInTheDocument()
    expect(screen.getByText('Pangani, Nairobi')).toBeInTheDocument()
  })

  it('renders CONFIRMED status badge', () => {
    render(<AlertCard {...base} status="CONFIRMED" />)
    expect(screen.getByText('CONFIRMED')).toBeInTheDocument()
  })

  it('does not invent confidence, ratings, or sources', () => {
    render(<AlertCard {...base} />)
    expect(screen.queryByText(/confidence/)).not.toBeInTheDocument()
    expect(screen.queryByText('NLP')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('bookmark')).not.toBeInTheDocument()
  })

  it('shows the Automated Detection badge for heuristic events instead of a status', () => {
    render(<AlertCard {...base} status="UNVERIFIED" trustState="heuristic" />)
    expect(screen.getByText('Automated Detection')).toBeInTheDocument()
    // the heuristic badge replaces the trust status pill
    expect(screen.queryByText('CONFIRMED')).not.toBeInTheDocument()
  })

  it('flags corroborating events as still automated', () => {
    render(<AlertCard {...base} trustState="corroborating" />)
    expect(screen.getByText('Corroborating')).toBeInTheDocument()
  })

  it('shows the normal status badge for confirmed events', () => {
    render(<AlertCard {...base} status="CONFIRMED" trustState="confirmed" />)
    expect(screen.getByText('CONFIRMED')).toBeInTheDocument()
    expect(screen.queryByText('Automated Detection')).not.toBeInTheDocument()
  })
})
