import { AlertCard } from './AlertCard'
import type { SafetyEvent } from '../../../../shared/types'

interface Props {
  events: SafetyEvent[]
  onSelect: (event: SafetyEvent) => void
}

export function AlertsDock({ events, onSelect }: Props) {
  const recent = events.slice(0, 5)
  if (recent.length === 0) return null

  return (
    <div style={{
      position: 'absolute', top: 60, right: 12, zIndex: 10,
      width: 280, display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      {recent.map(event => (
        <AlertCard key={event.id} event={event} onClick={onSelect} />
      ))}
    </div>
  )
}
