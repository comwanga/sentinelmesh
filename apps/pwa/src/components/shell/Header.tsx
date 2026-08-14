import { Bell, Command, Search } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAppSelector } from '../../store'
import { useBreakpoint } from '../../hooks/useBreakpoint'

export function Header() {
  const navigate = useNavigate()
  const { layout } = useBreakpoint()
  const connected = useAppSelector(state => state.events.connected)
  const activeCount = useAppSelector(state => state.events.items.filter(event => event.is_active).length)
  return <header className="atlas-header">
    <button className="atlas-wordmark" onClick={() => navigate('/map')} aria-label="SentinelMesh live map">
      <span className="wordmark-sigil"><img src="/icon.svg" alt="" /></span><span><strong>Sentinel</strong>Mesh<small>COMMUNITY SAFETY NETWORK</small></span>
    </button>
    {layout === 'desktop' && <div className="atlas-search"><Search size={16} /><input aria-label="Search the safety map" placeholder="Search an area or review the live map" onKeyDown={event => { if (event.key === 'Enter') navigate('/map') }} /><kbd><Command size={12} /> K</kbd></div>}
    <div className={`network-state ${connected ? 'live' : ''}`}><i /><span>{connected ? 'Network live' : 'Reconnecting'}</span></div>
    <button className="header-alerts" onClick={() => navigate('/alerts')} aria-label={`${activeCount} active alerts`}><Bell />{activeCount > 0 && <b>{activeCount > 99 ? '99+' : activeCount}</b>}</button>
  </header>
}
