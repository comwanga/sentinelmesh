import { useBreakpoint } from '../hooks/useBreakpoint'
import { useNearestThreat } from '../hooks/useNearestThreat'
import { useAppSelector, useAppDispatch } from '../store'
import { setOverlayIntent } from '../store/uiSlice'
import { MapCanvas } from '../components/map/MapCanvas'
import { MapStatsBar } from '../components/map/MapStatsBar'
import { MapFeatureStrip } from '../components/map/MapFeatureStrip'
import { AlertsDock } from '../components/map/AlertsDock'
import { AlertsSheet } from '../components/map/AlertsSheet'
import { MapOverlayHost } from '../components/map/MapOverlayHost'

export function LiveMapPage() {
  const { layout } = useBreakpoint()
  const nearestThreat = useNearestThreat()
  const dispatch = useAppDispatch()
  const events = useAppSelector(s => s.events.items)

  const activeAlerts = events.filter(e => e.is_active).length
  const verified = events.filter(e => e.confidence >= 0.7).length
  const verifiedPct = events.length > 0 ? Math.round((verified / events.length) * 100) : 0
  const communityScore = Math.round(
    events.reduce((sum, e) => sum + e.confidence, 0) / Math.max(events.length, 1) * 100
  )
  const sources = events.reduce((sum, e) => sum + e.source_count, 0)

  // Desktop layout:
  // - MapStatsBar pinned above map
  // - MapCanvas fills remaining space
  // - AlertsDock fixed right 320px
  // - MapFeatureStrip pinned below map
  // - MapOverlayHost renders over map

  // Mobile layout:
  // - MapCanvas fills full height
  // - MapStatsBar collapses (layout passed to it)
  // - AlertsSheet slides up from bottom
  // - MapFeatureStrip hidden
  // - MapOverlayHost renders over map

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <MapStatsBar
        activeAlerts={activeAlerts}
        verified={verified}
        verifiedPct={verifiedPct}
        communityScore={communityScore}
        sources={sources}
      />
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <MapCanvas />
        {layout === 'desktop' && <AlertsDock />}
        {layout === 'mobile' && <AlertsSheet />}
        <MapOverlayHost />
        {nearestThreat && (
          <div style={{
            position: 'absolute',
            top: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#FF2D2D',
            color: '#fff',
            fontFamily: "'Courier New', monospace",
            fontSize: 11,
            padding: '4px 12px',
            borderRadius: 4,
            zIndex: 10,
          }}>
            NEAR YOU: {nearestThreat.title}
          </div>
        )}
      </div>
      {layout === 'desktop' && (
        <MapFeatureStrip
          onReport={() => {}}
          onAcoustic={() => dispatch(setOverlayIntent({ name: 'acoustic' }))}
          onCircles={() => {}}
          onRoutes={() => dispatch(setOverlayIntent({ name: 'routes' }))}
          onZaps={() => {}}
        />
      )}
    </div>
  )
}
