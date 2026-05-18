export const MAP_COLORS = {
  bg:                   '#0B0E14',
  water:                '#0c1828',
  park:                 '#0b1c10',
  landuseResidential:   '#0c1320',
  landuseCommercial:    '#0d1525',
  roadCasing:           '#111827',
  roadMotorway:         '#2c3a52',
  roadTrunk:            '#253347',
  roadPrimary:          '#1f2c3e',
  roadSecondary:        '#182030',
  roadTertiary:         '#131820',
  roadMinor:            '#10131a',
  buildingFill:         '#101520',
  buildingOutline:      '#1a2030',
  labelDistrict:        '#a8b8cc',
  labelSuburb:          '#7a9ab5',
  labelMinor:           '#607a90',
  labelRoad:            '#4e6a85',
  labelPoi:             '#527a9e',
} as const

export const SEVERITY_COLORS = {
  CRITICAL: '#FF2D2D',
  HIGH:     '#FF9800',
  MEDIUM:   '#FFD500',
  LOW:      '#9C27B0',
} as const

export const OVERLAY_COLORS = {
  route:  '#00E5FF',
  family: '#00E6B4',
} as const

export const RADIUS_FILL = {
  CRITICAL: 'rgba(255,45,45,0.14)',
  HIGH:     'rgba(255,152,0,0.11)',
  MEDIUM:   'rgba(255,213,0,0.09)',
} as const

export const RADIUS_STROKE = {
  CRITICAL: 'rgba(255,45,45,0.52)',
  HIGH:     'rgba(255,152,0,0.45)',
  MEDIUM:   'rgba(255,213,0,0.35)',
} as const

export const RADIUS_STROKE_WIDTH = {
  CRITICAL: 1.5,
  HIGH:     1.3,
  MEDIUM:   1.2,
} as const
