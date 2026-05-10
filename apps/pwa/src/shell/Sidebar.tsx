import { NavLink } from 'react-router-dom'

const NAV_ITEMS = [
  { to: '/', label: 'Map', end: true },
  { to: '/alerts', label: 'Alerts', end: false },
  { to: '/circles', label: 'Circles', end: false },
  { to: '/insights', label: 'Insights', end: false },
]

export function Sidebar() {
  return (
    <nav style={{
      width: 180, background: '#0B0E14', borderRight: '1px solid #1a2035',
      display: 'flex', flexDirection: 'column', padding: '16px 0', flexShrink: 0,
    }}>
      {NAV_ITEMS.map(({ to, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          style={({ isActive }) => ({
            padding: '10px 20px', color: isActive ? '#00E5FF' : '#4a5568',
            textDecoration: 'none', fontFamily: "'Courier New', monospace",
            fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' as const,
            borderLeft: isActive ? '2px solid #00E5FF' : '2px solid transparent',
          })}
        >
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
