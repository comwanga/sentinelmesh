import { describe, it, expect } from 'vitest'
import zapsReducer, {
  zapSent,
  zapsCleared,
  ZapRecord,
  selectZapTotalForReport,
} from './zapsSlice'
import type { RootState } from '.'

function makeRecord(overrides: Partial<ZapRecord> & { id: string }): ZapRecord {
  return {
    amount: 21,
    recipientPubkey: 'npub1abc',
    reportId: 'report-1',
    timestamp: Date.now(),
    status: 'pending',
    ...overrides,
  }
}

describe('zapsSlice', () => {
  it('initial state is empty array', () => {
    const state = zapsReducer(undefined, { type: '' })
    expect(state.records).toEqual([])
  })

  it('zapSent adds a record (newest first — prepend)', () => {
    const record = makeRecord({ id: 'z1', amount: 100, recipientPubkey: 'npub1abc', reportId: 'r1', timestamp: 1000 })
    const state = zapsReducer(undefined, zapSent(record))
    expect(state.records).toHaveLength(1)
    expect(state.records[0]).toEqual(record)
  })

  it('multiple zapSent calls keep records in newest-first order', () => {
    const first = makeRecord({ id: 'z1', timestamp: 1000 })
    const second = makeRecord({ id: 'z2', timestamp: 2000 })
    const third = makeRecord({ id: 'z3', timestamp: 3000 })

    let state = zapsReducer(undefined, zapSent(first))
    state = zapsReducer(state, zapSent(second))
    state = zapsReducer(state, zapSent(third))

    expect(state.records[0]!.id).toBe('z3')
    expect(state.records[1]!.id).toBe('z2')
    expect(state.records[2]!.id).toBe('z1')
  })

  it('zapsCleared resets to empty array', () => {
    const record = makeRecord({ id: 'z1' })
    let state = zapsReducer(undefined, zapSent(record))
    expect(state.records).toHaveLength(1)
    state = zapsReducer(state, zapsCleared())
    expect(state.records).toEqual([])
  })
})

describe('selectZapTotalForReport', () => {
  it('returns 0 for an unknown report', () => {
    const rootState = { zaps: { records: [] } } as unknown as RootState
    expect(selectZapTotalForReport('report-x')(rootState)).toBe(0)
  })

  it('sums paid zaps only for the given reportId', () => {
    const records: ZapRecord[] = [
      makeRecord({ id: 'z1', reportId: 'r1', amount: 21, status: 'paid' }),
      makeRecord({ id: 'z2', reportId: 'r1', amount: 100, status: 'pending' }),
      makeRecord({ id: 'z3', reportId: 'r1', amount: 50, status: 'paid' }),
      makeRecord({ id: 'z4', reportId: 'r2', amount: 999, status: 'paid' }),
    ]
    const rootState = { zaps: { records } } as unknown as RootState
    expect(selectZapTotalForReport('r1')(rootState)).toBe(71)
    expect(selectZapTotalForReport('r2')(rootState)).toBe(999)
  })
})
