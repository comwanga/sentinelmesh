import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from './shell/AppShell'
import { LiveMapPage } from './pages/LiveMapPage'
import { CirclesPage } from './pages/CirclesPage'
import { AlertsPage } from './pages/AlertsPage'
import { InsightsPage } from './pages/InsightsPage'

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <LiveMapPage /> },
      { path: '/alerts', element: <AlertsPage /> },
      { path: '/circles', element: <CirclesPage /> },
      { path: '/insights', element: <InsightsPage /> },
    ],
  },
])
