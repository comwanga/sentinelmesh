import { useState, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useWsConnection } from '../../services/websocket'
import { useCircles } from '../../hooks/useCircles'
import { usePushSubscription } from '../../hooks/usePushSubscription'
import { useAppSelector } from '../../store'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'

export function AppShell() {
  useWsConnection()
  // Acoustic detection is opt-in — started only when user activates the overlay
  useCircles()
  usePushSubscription()
  const { layout } = useBreakpoint()
  const proximityAlerts = useAppSelector(s => s.circles.proximityAlerts)
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    if (proximityAlerts.length === 0) return
    const latest = proximityAlerts[0]
    setAnnouncement(`${latest.severity} alert: ${latest.zone_name}`)
  }, [proximityAlerts])

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', background: '#0B0E14' }}>
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <Header />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {layout === 'desktop' && <Sidebar />}
        <main id="main-content" style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          <Outlet />
        </main>
      </div>
      {layout === 'mobile' && <BottomNav />}
      <div
        role="status"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </div>
    </div>
  )
}
