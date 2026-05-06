import { render, screen } from '@testing-library/react'
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
})
