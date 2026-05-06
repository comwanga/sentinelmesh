// MapCanvas: thin wrapper over SafetyMap, passes activeFilters
import type { EventType } from '../../../../../shared/types'
import SafetyMap from '../SafetyMap'

interface MapCanvasProps {
  activeFilters?: EventType[]
}

export function MapCanvas({ activeFilters }: MapCanvasProps) {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <SafetyMap activeFilters={activeFilters} />
    </div>
  )
}
