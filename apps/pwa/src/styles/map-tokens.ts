export const MAP_COLORS = {
  bg:                   '#F4F3EC',
  water:                '#BDE3EE',
  park:                 '#DCEAD5',
  landuseResidential:   '#ECEBE4',
  landuseCommercial:    '#EEE4D7',
  roadCasing:           '#D4D2C8',
  roadMotorway:         '#F2C975',
  roadTrunk:            '#F5D994',
  roadPrimary:          '#FFFFFF',
  roadSecondary:        '#FFFFFF',
  roadTertiary:         '#F9F8F3',
  roadMinor:            '#F7F6F1',
  buildingFill:         '#DDDCD4',
  buildingOutline:      '#CBC9BE',
  labelDistrict:        '#173D3A',
  labelSuburb:          '#3D5D59',
  labelMinor:           '#617572',
  labelRoad:            '#526864',
  labelPoi:             '#0B6B61',
} as const

export const SEVERITY_COLORS = {
  CRITICAL: '#FF2D2D',
  HIGH:     '#FF9800',
  MEDIUM:   '#FFD500',
  LOW:      '#9C27B0',
} as const

export const OVERLAY_COLORS = {
  route:  '#2E87A7',
  family: '#0B6B61',
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
