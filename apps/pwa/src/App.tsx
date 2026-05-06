import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppShell } from './components/shell/AppShell'
import { LiveMapPage } from './pages/LiveMapPage'
import { AlertsPage } from './pages/AlertsPage'
import { ReportsPage } from './pages/ReportsPage'
import { CirclesPage } from './pages/CirclesPage'
import { ZapsPage } from './pages/ZapsPage'
import { InsightsPage } from './pages/InsightsPage'
import { SettingsPage } from './pages/SettingsPage'
import { useWsConnection } from './services/websocket'
import { useAcousticEngine } from './hooks/useAcousticEngine'

function AppRoot() {
  useWsConnection()
  useAcousticEngine()

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/map" replace />} />
          <Route path="/map"      element={<LiveMapPage />} />
          <Route path="/alerts"   element={<AlertsPage />} />
          <Route path="/reports"  element={<ReportsPage />} />
          <Route path="/circles"  element={<CirclesPage />} />
          <Route path="/zaps"     element={<ZapsPage />} />
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default AppRoot
