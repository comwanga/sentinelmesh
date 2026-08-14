import { describe, it, expect } from 'vitest'
import { MAP_COLORS, SEVERITY_COLORS, RADIUS_FILL, RADIUS_STROKE } from './map-tokens'

describe('map-tokens', () => {
  it('MAP_COLORS has required base tokens', () => {
    expect(MAP_COLORS.bg).toBe('#F4F3EC')
    expect(MAP_COLORS.roadCasing).toBe('#D4D2C8')
    expect(MAP_COLORS.water).toBe('#BDE3EE')
  })

  it('SEVERITY_COLORS maps all four severities', () => {
    expect(SEVERITY_COLORS.CRITICAL).toBe('#FF2D2D')
    expect(SEVERITY_COLORS.HIGH).toBe('#FF9800')
    expect(SEVERITY_COLORS.MEDIUM).toBe('#FFD500')
    expect(SEVERITY_COLORS.LOW).toBe('#9C27B0')
  })

  it('RADIUS_FILL has CRITICAL HIGH MEDIUM but not LOW', () => {
    expect(RADIUS_FILL.CRITICAL).toMatch(/rgba/)
    expect(RADIUS_FILL.HIGH).toMatch(/rgba/)
    expect(RADIUS_FILL.MEDIUM).toMatch(/rgba/)
    expect('LOW' in RADIUS_FILL).toBe(false)
  })

  it('overlay hue ranges do not appear in base map tokens', () => {
    const baseTokenValues = [
      MAP_COLORS.bg, MAP_COLORS.water, MAP_COLORS.park,
      MAP_COLORS.roadMotorway, MAP_COLORS.roadPrimary, MAP_COLORS.roadSecondary,
    ]
    const reservedHues = ['#FF2D2D', '#FF9800', '#FFD500', '#9C27B0', '#00E5FF', '#00E6B4']
    for (const v of baseTokenValues) {
      expect(reservedHues).not.toContain(v)
    }
  })
})
