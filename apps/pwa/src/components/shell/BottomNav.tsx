import { Bell, FilePlus2, Map, Settings } from 'lucide-react'
import { NavLink } from 'react-router-dom'

export function BottomNav() {
  return <nav className="field-nav" aria-label="Main navigation">
    <NavLink to="/map" aria-label="Map" className={({ isActive }) => isActive ? 'active' : ''}><Map /><span>Atlas</span></NavLink>
    <NavLink to="/alerts" aria-label="Alerts" className={({ isActive }) => isActive ? 'active' : ''}><Bell /><span>Signals</span></NavLink>
    <NavLink to="/reports" aria-label="Report" className="field-report"><FilePlus2 /><span>Report</span></NavLink>
    <NavLink to="/settings" aria-label="Profile" className={({ isActive }) => isActive ? 'active' : ''}><Settings /><span>Identity</span></NavLink>
  </nav>
}
