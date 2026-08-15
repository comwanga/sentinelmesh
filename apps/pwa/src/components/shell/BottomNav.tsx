import { Bell, FilePlus2, Map, MessageSquare, Users } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { chatEnabled } from '../../config/features'

const linkClass = ({ isActive }: { isActive: boolean }) => isActive ? 'active' : ''

export function BottomNav() {
  const count = chatEnabled ? 5 : 4

  return <nav className="field-nav" aria-label="Main navigation" style={{ gridTemplateColumns: `repeat(${count}, 1fr)` }}>
    <NavLink to="/map" aria-label="Map" className={linkClass}><Map /><span>Map</span></NavLink>
    <NavLink to="/alerts" aria-label="Alerts" className={linkClass}><Bell /><span>Alerts</span></NavLink>
    <NavLink to="/reports" aria-label="Report" className="field-report"><FilePlus2 /><span>Report</span></NavLink>
    <NavLink to="/circles" aria-label="Family circles" className={linkClass}><Users /><span>Circles</span></NavLink>
    {chatEnabled && <NavLink to="/chat" aria-label="Community chat" className={linkClass}><MessageSquare /><span>Chat</span></NavLink>}
  </nav>
}
