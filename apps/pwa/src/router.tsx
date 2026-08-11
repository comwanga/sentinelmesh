import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from './components/shell/AppShell'
import { LiveMapPage } from './pages/LiveMapPage'
import { CirclesPage } from './pages/CirclesPage'
import { AlertsPage } from './pages/AlertsPage'
import { InsightsPage } from './pages/InsightsPage'
import { ReportsPage } from './pages/ReportsPage'
import { SettingsPage } from './pages/SettingsPage'
import { experimentalFeatures } from './config/features'

function RouteError() {
  return (
    <div style={{ padding: 32, color: '#ccc', fontFamily: 'sans-serif', textAlign: 'center' }}>
      <h2 style={{ color: '#FF2D2D' }}>Something went wrong</h2>
      <p>Reload the page or navigate home.</p>
      <a href="/" style={{ color: '#00E5FF' }}>Back to map</a>
    </div>
  )
}

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <LiveMapPage /> },
      { path: '/map', element: <LiveMapPage /> },
      { path: '/alerts', element: <AlertsPage /> },
      { path: '/reports', element: <ReportsPage /> },
      { path: '/settings', element: <SettingsPage /> },
      ...(experimentalFeatures.circles ? [{ path: '/circles', element: <CirclesPage /> }] : []),
      ...(experimentalFeatures.insights ? [{ path: '/insights', element: <InsightsPage /> }] : []),
      { path: '*', element: <Navigate to="/map" replace /> },
    ],
  },
])
