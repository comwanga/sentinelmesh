import { NavLink } from 'react-router-dom'

const NAV_ITEMS = [
  { to: '/', label: 'Map', end: true },
  { to: '/alerts', label: 'Alerts', end: false },
  { to: '/circles', label: 'Circles', end: false },
  { to: '/insights', label: 'Insights', end: false },
]

export function BottomNav() {
  return (
    <nav style={{
      display: 'flex', background: '#0B0E14', borderTop: '1px solid #1a2035', flexShrink: 0,
    }}>
      {NAV_ITEMS.map(({ to, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          style={({ isActive }) => ({
            flex: 1, padding: '10px 0', textAlign: 'center' as const,
            color: isActive ? '#00E5FF' : '#4a5568',
            textDecoration: 'none', fontFamily: "'Courier New', monospace",
            fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' as const,
            borderTop: isActive ? '2px solid #00E5FF' : '2px solid transparent',
          })}
        >
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
