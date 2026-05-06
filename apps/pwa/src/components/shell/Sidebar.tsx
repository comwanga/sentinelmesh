import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAppDispatch } from '../../store'
import { setOverlayIntent } from '../../store/uiSlice'

type OverlayName = 'routes' | 'acoustic'

const routeItems = [
  { path: '/map',      label: 'Live Map',       icon: '◉' },
  { path: '/alerts',   label: 'Alerts',         icon: '🔔' },
  { path: '/reports',  label: 'Reports',        icon: '📋' },
  { path: '/circles',  label: 'Family Circles', icon: '👥' },
  { path: '/zaps',     label: 'Zaps',           icon: '⚡' },
  { path: '/insights', label: 'Insights',       icon: '📊', badge: 'NEW' },
  { path: '/settings', label: 'Settings',       icon: '⚙️' },
] as const

const overlayItems: { overlay: OverlayName; label: string; icon: string }[] = [
  { overlay: 'routes',   label: 'Routes',         icon: '🛣' },
  { overlay: 'acoustic', label: 'Acoustic Detect', icon: '🎙' },
]

const itemBase: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px',
  fontFamily: "'Courier New', monospace", fontSize: 11, letterSpacing: '0.08em',
  color: '#4a5568', textDecoration: 'none', whiteSpace: 'nowrap',
  border: 'none', background: 'none', width: '100%', cursor: 'pointer',
  boxSizing: 'border-box',
}

export function Sidebar() {
  const [expanded, setExpanded] = useState(false)
  const dispatch = useAppDispatch()
  const navigate = useNavigate()

  function handleOverlay(name: OverlayName) {
    dispatch(setOverlayIntent({ name }))
    navigate('/map')
  }

  return (
    <div
      style={{
        width: expanded ? 220 : 64, flexShrink: 0, transition: 'width 200ms ease',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: '#0B0E14', borderRight: '1px solid #1a2035',
      }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {routeItems.map(item => (
        <NavLink
          key={item.path}
          to={item.path}
          style={({ isActive }) => ({
            ...itemBase,
            color: isActive ? '#00E5FF' : '#4a5568',
            borderLeft: isActive ? '2px solid #00E5FF' : '2px solid transparent',
          })}
        >
          <span style={{ fontSize: 16, flexShrink: 0, width: 24, textAlign: 'center' as const }}>{item.icon}</span>
          <span style={{ opacity: expanded ? 1 : 0, transition: 'opacity 150ms', pointerEvents: 'none' }}>
            {item.label}
          </span>
          {'badge' in item && item.badge && (
            <span style={{
              opacity: expanded ? 1 : 0, marginLeft: 4,
              background: '#BB86FC', color: '#0B0E14', borderRadius: 4,
              padding: '1px 4px', fontSize: 9, fontFamily: "'Courier New', monospace",
            }}>{item.badge}</span>
          )}
        </NavLink>
      ))}

      {overlayItems.map(item => (
        <button key={item.overlay} style={itemBase} onClick={() => handleOverlay(item.overlay)}>
          <span style={{ fontSize: 16, flexShrink: 0, width: 24, textAlign: 'center' as const }}>{item.icon}</span>
          <span style={{ opacity: expanded ? 1 : 0, transition: 'opacity 150ms', pointerEvents: 'none' }}>
            {item.label}
          </span>
        </button>
      ))}

      <div style={{ marginTop: 'auto', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#4CAF50', flexShrink: 0 }} />
        <span style={{
          opacity: expanded ? 1 : 0, transition: 'opacity 150ms',
          fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4CAF50',
          letterSpacing: '0.05em', whiteSpace: 'nowrap',
        }}>All systems operational</span>
      </div>
    </div>
  )
}
