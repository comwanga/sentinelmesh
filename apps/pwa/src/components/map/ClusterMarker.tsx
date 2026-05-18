import { memo } from 'react'
import { SEVERITY_COLORS } from '../../styles/map-tokens'

interface Props {
  clusterId: string
  criticalCount: number
  highCount: number
  mediumCount: number
  lowCount: number
  totalCount: number
  onClick?: () => void
}

function outerRadius(total: number): number {
  if (total <= 4)   return 14
  if (total <= 14)  return 18
  if (total <= 49)  return 22
  if (total <= 199) return 26
  return 30
}

function ClusterMarkerBase({
  criticalCount, highCount, mediumCount, lowCount, totalCount, onClick,
}: Props) {
  const outerR = outerRadius(totalCount)
  const strokeR = outerR - 1.5
  const circumference = 2 * Math.PI * strokeR
  const minArc = circumference * 0.08
  const strokeWidth = 3
  const fontSize = Math.max(7, outerR * 0.45)

  const total = Math.max(totalCount, 1)

  function arc(count: number): number {
    return count > 0 ? Math.max((count / total) * circumference, minArc) : 0
  }

  const critArc   = arc(criticalCount)
  const highArc   = arc(highCount)
  const medLowArc = arc(mediumCount + lowCount)

  // dashoffset to start each arc clockwise from top (12 o'clock).
  // SVG circle paths start at 3 o'clock; C * 0.25 rotates back to 12 o'clock.
  const critOffset   = circumference * 0.25
  const highOffset   = circumference * 0.25 - critArc
  const medLowOffset = circumference * 0.25 - critArc - highArc

  const cx = outerR
  const cy = outerR

  return (
    <div onClick={onClick} style={{ cursor: 'pointer', width: outerR * 2, height: outerR * 2, position: 'relative' }}>
      <svg width={outerR * 2} height={outerR * 2} viewBox={`0 0 ${outerR * 2} ${outerR * 2}`}>
        {/* Dark donut hole */}
        <circle cx={cx} cy={cy} r={outerR - 4} fill="#0B0E14" />

        {/* CRITICAL arc — red */}
        {criticalCount > 0 && (
          <circle
            cx={cx} cy={cy} r={strokeR}
            fill="none"
            stroke={SEVERITY_COLORS.CRITICAL}
            strokeWidth={strokeWidth}
            strokeDasharray={`${critArc} ${circumference - critArc}`}
            strokeDashoffset={critOffset}
          />
        )}

        {/* HIGH arc — orange */}
        {highCount > 0 && (
          <circle
            cx={cx} cy={cy} r={strokeR}
            fill="none"
            stroke={SEVERITY_COLORS.HIGH}
            strokeWidth={strokeWidth}
            strokeDasharray={`${highArc} ${circumference - highArc}`}
            strokeDashoffset={highOffset}
          />
        )}

        {/* MEDIUM + LOW arc — yellow */}
        {(mediumCount + lowCount) > 0 && (
          <circle
            cx={cx} cy={cy} r={strokeR}
            fill="none"
            stroke={SEVERITY_COLORS.MEDIUM}
            strokeWidth={strokeWidth}
            strokeDasharray={`${medLowArc} ${circumference - medLowArc}`}
            strokeDashoffset={medLowOffset}
          />
        )}

        {/* Count label */}
        <text
          x={cx} y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fill="white"
          fontFamily="monospace"
          fontSize={fontSize}
          fontWeight="bold"
        >
          {totalCount > 99 ? '99+' : totalCount}
        </text>
      </svg>
    </div>
  )
}

export const ClusterMarker = memo(ClusterMarkerBase, (prev, next) =>
  prev.clusterId     === next.clusterId &&
  prev.criticalCount === next.criticalCount &&
  prev.highCount     === next.highCount &&
  prev.mediumCount   === next.mediumCount &&
  prev.lowCount      === next.lowCount &&
  prev.totalCount    === next.totalCount
)
