import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import insightsEventsReducer from '../store/insightsEventsSlice'
import communityStatsReducer from '../store/communityStatsSlice'
import safetyLogReducer from '../store/safetyLogSlice'
import { InsightsPage } from './InsightsPage'

function makeStore() {
  return configureStore({
    reducer: {
      insightsEvents: insightsEventsReducer,
      communityStats: communityStatsReducer,
      safetyLog: safetyLogReducer,
    },
  })
}

describe('InsightsPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders Overview tab by default', () => {
    render(<Provider store={makeStore()}><InsightsPage /></Provider>)
    expect(screen.getByText('Overview')).toBeInTheDocument()
  })

  it('renders Heatmap tab', () => {
    render(<Provider store={makeStore()}><InsightsPage /></Provider>)
    expect(screen.getByText('Heatmap')).toBeInTheDocument()
  })

  it('renders Personal Safety tab', () => {
    render(<Provider store={makeStore()}><InsightsPage /></Provider>)
    expect(screen.getByText('Personal Safety')).toBeInTheDocument()
  })

  it('shows heatmap placeholder on Heatmap tab click', async () => {
    render(<Provider store={makeStore()}><InsightsPage /></Provider>)
    await userEvent.click(screen.getByText('Heatmap'))
    expect(screen.getByText(/Heatmap requires the/)).toBeInTheDocument()
  })
})
