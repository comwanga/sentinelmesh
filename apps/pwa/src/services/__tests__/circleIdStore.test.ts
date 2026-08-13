import { describe, it, expect, beforeEach } from 'vitest'
import { getCircleIds, addCircleId, removeCircleId, saveCircleOwnerKey, getCircleOwnerKey } from '../circleIdStore'

describe('circleIdStore', () => {
  beforeEach(() => localStorage.clear())

  it('starts empty', () => {
    expect(getCircleIds()).toEqual([])
  })

  it('adds and dedupes ids', () => {
    addCircleId('a'); addCircleId('b'); addCircleId('a')
    expect(getCircleIds().sort()).toEqual(['a', 'b'])
  })

  it('removes an id', () => {
    addCircleId('a'); addCircleId('b'); removeCircleId('a')
    expect(getCircleIds()).toEqual(['b'])
  })

  it('stores the invite owner key locally by circle', () => {
    const owner = 'a'.repeat(64)
    saveCircleOwnerKey('circle-a', owner.toUpperCase())
    expect(getCircleOwnerKey('circle-a')).toBe(owner)
    expect(getCircleOwnerKey('circle-b')).toBeNull()
  })
})
