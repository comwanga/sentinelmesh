import { render, screen } from '@testing-library/react'
import { MapStatsBar } from './MapStatsBar'

describe('MapStatsBar', () => {
  it('renders active alert count', () => {
    render(<MapStatsBar activeAlerts={27} verified={18} verifiedPct={87} communityScore={4.6} sources={12} />)
    expect(screen.getByText('27')).toBeInTheDocument()
  })
  it('renders verified count', () => {
    render(<MapStatsBar activeAlerts={27} verified={18} verifiedPct={87} communityScore={4.6} sources={12} />)
    expect(screen.getByText('18')).toBeInTheDocument()
  })
  it('renders community score', () => {
    render(<MapStatsBar activeAlerts={27} verified={18} verifiedPct={87} communityScore={4.6} sources={12} />)
    expect(screen.getByText('4.6')).toBeInTheDocument()
  })
  it('renders source count', () => {
    render(<MapStatsBar activeAlerts={27} verified={18} verifiedPct={87} communityScore={4.6} sources={12} />)
    expect(screen.getByText('12')).toBeInTheDocument()
  })
})
