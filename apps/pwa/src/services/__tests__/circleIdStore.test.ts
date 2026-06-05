import { describe, it, expect, beforeEach } from 'vitest'
import { getCircleIds, addCircleId, removeCircleId } from '../circleIdStore'

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
})
