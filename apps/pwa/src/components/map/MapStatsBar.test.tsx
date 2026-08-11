import { render, screen } from '@testing-library/react'
import { MapStatsBar } from './MapStatsBar'

describe('MapStatsBar', () => {
  it('renders active alert count', () => {
    render(<MapStatsBar activeAlerts={27} />)
    expect(screen.getByText('27')).toBeInTheDocument()
    expect(screen.getByText('Loaded active alerts')).toBeInTheDocument()
    expect(screen.queryByText('Community Score')).not.toBeInTheDocument()
  })
})
