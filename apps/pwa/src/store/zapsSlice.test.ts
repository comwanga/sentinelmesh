import { describe, it, expect } from 'vitest'
import zapsReducer, { zapSent, zapsCleared, ZapRecord } from './zapsSlice'

function makeRecord(overrides: Partial<ZapRecord> & { id: string }): ZapRecord {
  return {
    id: overrides.id,
    amount: overrides.amount ?? 21,
    recipientPubkey: overrides.recipientPubkey ?? 'npub1abc',
    reportId: overrides.reportId ?? 'report-1',
    timestamp: overrides.timestamp ?? Date.now(),
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

    // Each new record is prepended, so latest dispatch is at index 0
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
