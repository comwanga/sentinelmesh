import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAppDispatch } from '../../store'
import { setOverlayIntent } from '../../store/uiSlice'
import { experimentalFeatures } from '../../config/features'
import { useActiveIdentity } from '../../hooks/useActiveIdentity'

type OverlayName = 'routes' | 'acoustic'

const routeItems = [
  { path: '/map',      label: 'Live Map',       icon: '◉' },
  { path: '/alerts',   label: 'Alerts',         icon: '🔔' },
  { path: '/reports',  label: 'Reports',        icon: '📋' },
  ...(experimentalFeatures.circles ? [{ path: '/circles', label: 'Family Circles', icon: '👥' }] : []),
  ...(experimentalFeatures.insights ? [{ path: '/insights', label: 'Insights', icon: '📊' }] : []),
  { path: '/settings', label: 'Settings',       icon: '⚙️' },
]

const overlayItems: { overlay: OverlayName; label: string; icon: string }[] = [
  ...(experimentalFeatures.routing ? [{ overlay: 'routes' as const, label: 'Routes', icon: '🛣' }] : []),
  ...(experimentalFeatures.acoustic ? [{ overlay: 'acoustic' as const, label: 'Acoustic Detect', icon: '🎙' }] : []),
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
  const activeIdentity = useActiveIdentity()

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
      {/* Nav items */}
      {routeItems.filter(item => item.path !== '/circles' || activeIdentity.mode === 'local').map(item => (
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
        </NavLink>
      ))}

      {/* Overlay buttons */}
      {overlayItems.map(item => (
        <button key={item.overlay} style={itemBase} onClick={() => handleOverlay(item.overlay)}>
          <span style={{ fontSize: 16, flexShrink: 0, width: 24, textAlign: 'center' as const }}>{item.icon}</span>
          <span style={{ opacity: expanded ? 1 : 0, transition: 'opacity 150ms', pointerEvents: 'none' }}>
            {item.label}
          </span>
        </button>
      ))}

      {/* Current release guarantees */}
      <div style={{
        marginTop: 'auto',
        opacity: expanded ? 1 : 0, transition: 'opacity 150ms',
        padding: '12px 20px',
        borderTop: '1px solid #1a2035',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <span style={{ fontSize: 13 }}>🔒</span>
          <span style={{
            fontFamily: "'Courier New', monospace", fontSize: 10,
            fontWeight: 700, color: '#00E5FF', letterSpacing: '0.06em',
          }}>
            Current release
          </span>
        </div>
        {['No account required.', 'Reports are signed.', 'Trust state is explicit.'].map(line => (
          <div key={line} style={{
            fontFamily: "'Courier New', monospace", fontSize: 9,
            color: '#4a5568', lineHeight: 1.6, paddingLeft: 4,
          }}>
            {line}
          </div>
        ))}
      </div>

      {/* Active open protocol */}
      <div style={{
        opacity: expanded ? 1 : 0, transition: 'opacity 150ms',
        padding: '10px 20px 14px',
        borderTop: '1px solid #1a2035',
      }}>
        <div style={{
          fontFamily: "'Courier New', monospace", fontSize: 9,
          color: '#4a5568', letterSpacing: '0.06em', marginBottom: 6,
        }}>
          Identity protocol
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
          {[
            { label: 'Nostr', color: '#9C27B0' },
          ].map(p => (
            <span key={p.label} style={{
              fontFamily: "'Courier New', monospace", fontSize: 9,
              padding: '2px 6px', borderRadius: 4,
              background: `${p.color}22`, border: `1px solid ${p.color}55`,
              color: p.color,
            }}>{p.label}</span>
          ))}
        </div>
      </div>

    </div>
  )
}
