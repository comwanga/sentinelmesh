import { NavLink } from 'react-router-dom'
import { Map, Bell, FileText, Users, Settings, type LucideIcon } from 'lucide-react'
import { experimentalFeatures } from '../../config/features'
import { useActiveIdentity } from '../../hooks/useActiveIdentity'

const tabs: Array<{ path: string; label: string; Icon: LucideIcon }> = [
  { path: '/map',      label: 'Map',     Icon: Map },
  { path: '/alerts',   label: 'Alerts',  Icon: Bell },
  { path: '/reports',  label: 'Report',  Icon: FileText },
  ...(experimentalFeatures.circles ? [{ path: '/circles', label: 'Family', Icon: Users }] : []),
  { path: '/settings', label: 'Profile', Icon: Settings },
]

export function BottomNav() {
  const activeIdentity = useActiveIdentity()
  return (
    <nav
      role="navigation"
      aria-label="Main navigation"
      style={{
        height: 56, flexShrink: 0, display: 'flex', alignItems: 'stretch',
        background: '#0B0E14', borderTop: '1px solid #1a2035',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {tabs.filter(tab => tab.path !== '/circles' || activeIdentity.mode === 'local').map(tab => (
        <NavLink
          key={tab.path}
          to={tab.path}
          aria-label={tab.label}
          style={({ isActive }) => ({
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 2,
            textDecoration: 'none',
            color: isActive ? '#00E5FF' : '#4a5568',
            fontFamily: "'Courier New', monospace", fontSize: 11, letterSpacing: '0.08em',
            borderTop: isActive ? '2px solid #00E5FF' : '2px solid transparent',
          })}
        >
          <tab.Icon size={20} aria-hidden="true" />
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
