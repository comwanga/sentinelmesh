import { Outlet } from 'react-router-dom'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { Header } from './Header'

function SidebarStub() {
  return <div style={{ width: 64, background: '#0B0E14', borderRight: '1px solid #1a2035', flexShrink: 0 }} />
}

function BottomNavStub() {
  return <div style={{ height: 56, background: '#0B0E14', borderTop: '1px solid #1a2035', flexShrink: 0 }} />
}

export function AppShell() {
  const { layout } = useBreakpoint()
  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', background: '#0B0E14' }}>
      <Header />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {layout === 'desktop' && <SidebarStub />}
        <main style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          <Outlet />
        </main>
      </div>
      {layout === 'mobile' && <BottomNavStub />}
    </div>
  )
}
