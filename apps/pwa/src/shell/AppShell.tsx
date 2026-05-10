import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { BottomNav } from './BottomNav'
import { AcousticAlert } from '../components/AcousticAlert'
import { useWsConnection } from '../services/websocket'
import { useAcousticDetection } from '../hooks/useAcousticDetection'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useAppSelector, useAppDispatch } from '../store'
import { alertDismissed } from '../store/acousticSlice'

export function AppShell() {
  useWsConnection()
  useAcousticDetection()
  const dispatch = useAppDispatch()
  const currentAlert = useAppSelector(s => s.acoustic.currentAlert)
  const isDesktop = useMediaQuery('(min-width: 768px)')

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', background: '#0B0E14' }}>
      {isDesktop && <Sidebar />}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Header />
        <AcousticAlert detection={currentAlert} onDismiss={() => dispatch(alertDismissed())} />
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <Outlet />
        </div>
        {!isDesktop && <BottomNav />}
      </div>
    </div>
  )
}
