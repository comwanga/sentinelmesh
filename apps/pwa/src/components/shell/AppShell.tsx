import { useState, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useSafetyDataSync } from '../../hooks/useSafetyDataSync'
import { useCircles } from '../../hooks/useCircles'
import { useAppSelector } from '../../store'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'

export function AppShell() {
  useSafetyDataSync()
  // Acoustic detection is opt-in — started only when user activates the overlay
  useCircles()
  const { layout } = useBreakpoint()
  const proximityAlerts = useAppSelector(s => s.circles.proximityAlerts)
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    if (proximityAlerts.length === 0) return
    const latest = proximityAlerts[0]
    setAnnouncement(`${latest.severity} alert: ${latest.zone_name}`)
  }, [proximityAlerts])

  return (
    <div className="atlas-shell">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <Header />
      <div className="atlas-shell-body">
        {layout === 'desktop' && <Sidebar />}
        <main id="main-content" className="atlas-main">
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
