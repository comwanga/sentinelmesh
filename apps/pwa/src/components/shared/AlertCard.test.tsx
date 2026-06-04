import { render, screen, fireEvent } from '@testing-library/react'
import type { AlertCardProps } from './AlertCard'
import { AlertCard } from './AlertCard'

const base: AlertCardProps = {
  eventId: 'e1',
  eventType: 'SECURITY_INCIDENT',
  title: 'Gunshots reported',
  location: 'Pangani, Nairobi',
  timestamp: Date.now() - 120_000,
  confidence: 0.86,
  rating: 4.0,
  status: 'VERIFIED',
  trustState: 'confirmed',
  sources: ['NLP', 'Community'],
  voteCount: 12,
  onBookmark: vi.fn(),
}

describe('AlertCard', () => {
  it('renders title and location', () => {
    render(<AlertCard {...base} />)
    expect(screen.getByText('Gunshots reported')).toBeInTheDocument()
    expect(screen.getByText('Pangani, Nairobi')).toBeInTheDocument()
  })

  it('renders VERIFIED status badge', () => {
    render(<AlertCard {...base} status="VERIFIED" />)
    expect(screen.getByText('VERIFIED')).toBeInTheDocument()
  })

  it('renders PENDING status badge', () => {
    render(<AlertCard {...base} status="PENDING" />)
    expect(screen.getByText('PENDING')).toBeInTheDocument()
  })

  it('renders confidence percentage', () => {
    render(<AlertCard {...base} confidence={0.86} />)
    expect(screen.getByText(/86% confidence/)).toBeInTheDocument()
  })

  it('renders all source tags', () => {
    render(<AlertCard {...base} sources={['NLP', 'Radio', 'Community']} />)
    expect(screen.getByText('NLP')).toBeInTheDocument()
    expect(screen.getByText('Radio')).toBeInTheDocument()
    expect(screen.getByText('Community')).toBeInTheDocument()
  })

  it('calls onBookmark with eventId when bookmark clicked', () => {
    const onBookmark = vi.fn()
    render(<AlertCard {...base} onBookmark={onBookmark} />)
    fireEvent.click(screen.getByLabelText('bookmark'))
    expect(onBookmark).toHaveBeenCalledWith('e1')
  })

  it('shows the Automated Detection badge for heuristic events instead of a status', () => {
    render(<AlertCard {...base} status="VERIFIED" trustState="heuristic" />)
    expect(screen.getByText('Automated Detection')).toBeInTheDocument()
    // the heuristic badge replaces the trust status pill
    expect(screen.queryByText('VERIFIED')).not.toBeInTheDocument()
  })

  it('flags corroborating events as still automated', () => {
    render(<AlertCard {...base} trustState="corroborating" />)
    expect(screen.getByText('Corroborating')).toBeInTheDocument()
  })

  it('shows the normal status badge for confirmed events', () => {
    render(<AlertCard {...base} status="VERIFIED" trustState="confirmed" />)
    expect(screen.getByText('VERIFIED')).toBeInTheDocument()
    expect(screen.queryByText('Automated Detection')).not.toBeInTheDocument()
  })
})
