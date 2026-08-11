import { describe, it, expect } from 'vitest'
import { trustStateOf, isUnverified, trustStyle } from './trust'

describe('trust presentation helpers', () => {
  it('defaults a missing trust_state to heuristic', () => {
    expect(trustStateOf({ trust_state: undefined })).toBe('heuristic')
    expect(trustStateOf({})).toBe('heuristic')
  })

  it('passes through an explicit trust_state', () => {
    expect(trustStateOf({ trust_state: 'heuristic' })).toBe('heuristic')
    expect(trustStateOf({ trust_state: 'corroborating' })).toBe('corroborating')
  })

  it('treats heuristic and corroborating as unverified, confirmed as verified', () => {
    expect(isUnverified({ trust_state: 'heuristic' })).toBe(true)
    expect(isUnverified({ trust_state: 'corroborating' })).toBe(true)
    expect(isUnverified({ trust_state: 'confirmed' })).toBe(false)
    expect(isUnverified({})).toBe(true)
  })

  it('mutes unverified markers and labels heuristic as an automated detection', () => {
    const h = trustStyle({ trust_state: 'heuristic' })
    expect(h.badge).toBe('Automated Detection')
    expect(h.opacity).toBeLessThan(1)

    const confirmed = trustStyle({ trust_state: 'confirmed' })
    expect(confirmed.badge).toBe('')
    expect(confirmed.opacity).toBe(1)
  })
})
