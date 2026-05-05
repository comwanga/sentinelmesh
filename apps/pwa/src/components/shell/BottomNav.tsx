import { NavLink } from 'react-router-dom'

const tabs = [
  { path: '/map',      label: 'Map',     icon: '◉' },
  { path: '/alerts',   label: 'Alerts',  icon: '🔔' },
  { path: '/reports',  label: 'Report',  icon: '📋' },
  { path: '/circles',  label: 'Family',  icon: '👥' },
  { path: '/settings', label: 'Profile', icon: '⚙️' },
] as const

export function BottomNav() {
  return (
    <nav style={{
      height: 56, flexShrink: 0, display: 'flex', alignItems: 'stretch',
      background: '#0B0E14', borderTop: '1px solid #1a2035',
    }}>
      {tabs.map(tab => (
        <NavLink
          key={tab.path}
          to={tab.path}
          style={({ isActive }) => ({
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 2,
            textDecoration: 'none',
            color: isActive ? '#00E5FF' : '#4a5568',
            fontFamily: "'Courier New', monospace", fontSize: 9, letterSpacing: '0.08em',
            borderTop: isActive ? '2px solid #00E5FF' : '2px solid transparent',
          })}
        >
          <span style={{ fontSize: 18 }}>{tab.icon}</span>
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
