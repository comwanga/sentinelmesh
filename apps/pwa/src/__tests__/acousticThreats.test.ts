// apps/pwa/src/__tests__/acousticThreats.test.ts
import { describe, test, expect } from 'vitest'
import { getThreatFromScores, DETECTION_THRESHOLD } from '../constants/acousticThreats'

describe('getThreatFromScores', () => {
  test('returns null when all scores are below threshold', () => {
    const scores = new Float32Array(521).fill(0.1)
    expect(getThreatFromScores(scores)).toBeNull()
  })

  test('detects SECURITY_INCIDENT when gunshot class 427 is high', () => {
    const scores = new Float32Array(521).fill(0.0)
    scores[427] = 0.85
    const result = getThreatFromScores(scores)
    expect(result).not.toBeNull()
    expect(result!.category).toBe('SECURITY_INCIDENT')
    expect(result!.label).toBe('Gunshot')
    expect(result!.confidence).toBeCloseTo(0.85)
  })

  test('detects SECURITY_INCIDENT when screaming class 25 is high', () => {
    const scores = new Float32Array(521).fill(0.0)
    scores[25] = 0.82
    const result = getThreatFromScores(scores)
    expect(result).not.toBeNull()
    expect(result!.label).toBe('Screaming')
  })

  test('returns highest-confidence detection when multiple classes exceed threshold', () => {
    const scores = new Float32Array(521).fill(0.0)
    scores[427] = 0.75  // gunshot — below threshold
    scores[25]  = 0.91  // screaming — above
    scores[429] = 0.84  // explosion — above
    const result = getThreatFromScores(scores)
    expect(result!.confidence).toBeCloseTo(0.91)
    expect(result!.label).toBe('Screaming')
  })

  test('DETECTION_THRESHOLD is 0.80', () => {
    expect(DETECTION_THRESHOLD).toBe(0.80)
  })
})
