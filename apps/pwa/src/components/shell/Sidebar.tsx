import { Bell, FileText, Map, Settings, ShieldPlus, Users } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { experimentalFeatures } from '../../config/features'
import { useActiveIdentity } from '../../hooks/useActiveIdentity'

const items = [
  { path: '/map', label: 'Safety map', Icon: Map }, { path: '/alerts', label: 'Alerts', Icon: Bell },
  { path: '/reports', label: 'Community reports', Icon: FileText },
  ...(experimentalFeatures.circles ? [{ path: '/circles', label: 'Family circles', Icon: Users }] : []),
  { path: '/settings', label: 'Identity + settings', Icon: Settings },
]

export function Sidebar() {
  const identity = useActiveIdentity()
  return <nav className="atlas-rail" aria-label="Primary navigation">
    <div className="rail-index">SM<br /><span>LIVE</span></div>
    <div className="rail-links">{items.filter(item => item.path !== '/circles' || identity.mode === 'local').map(({ path, label, Icon }) => <NavLink key={path} to={path} aria-label={label} title={label} className={({ isActive }) => isActive ? 'active' : ''}><Icon /><span>{label}</span></NavLink>)}</div>
    <NavLink to="/reports" className="rail-report" aria-label="Create field report"><ShieldPlus /></NavLink>
    <div className="rail-coordinate">OPEN MAP<br />OPEN PROTOCOLS</div>
  </nav>
}
