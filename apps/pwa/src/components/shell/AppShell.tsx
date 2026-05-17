import { Outlet } from 'react-router-dom'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useWsConnection } from '../../services/websocket'
import { useAcousticDetection } from '../../hooks/useAcousticDetection'
import { useCircles } from '../../hooks/useCircles'
import { usePushSubscription } from '../../hooks/usePushSubscription'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'

export function AppShell() {
  useWsConnection()
  useAcousticDetection()
  useCircles()
  usePushSubscription()
  const { layout } = useBreakpoint()
  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', background: '#0B0E14' }}>
      <Header />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {layout === 'desktop' && <Sidebar />}
        <main style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          <Outlet />
        </main>
      </div>
      {layout === 'mobile' && <BottomNav />}
    </div>
  )
}
