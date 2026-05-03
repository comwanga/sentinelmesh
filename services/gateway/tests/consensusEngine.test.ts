import { describe, test, expect } from 'vitest'
import { computeNewStatus } from '../src/reports/consensusEngine'
import type { CommunityReport } from '../../../shared/types'

function report(overrides: Partial<CommunityReport> = {}): CommunityReport {
  return {
    report_id: 'r1', report_type: 'FLOODING', description: null,
    lat: 0, lng: 0, place_name: null, nostr_pubkey: 'pk1',
    nostr_signature: 'sig', nostr_event_id: 'ev1',
    reporter_tier: 'NEWCOMER', consensus_score: 1, status: 'PENDING',
    confirmation_count: 0, denial_count: 0, photo_ipfs_cid: null,
    linked_event_id: null, created_at: '', updated_at: '',
    ...overrides,
  }
}

describe('computeNewStatus', () => {
  test('PENDING score >= 3 -> UNVERIFIED', () =>
    expect(computeNewStatus(report({ consensus_score: 3 }))).toBe('UNVERIFIED'))

  test('PENDING score < 3 -> null', () =>
    expect(computeNewStatus(report({ consensus_score: 2 }))).toBeNull())

  test('UNVERIFIED score >= 7 -> VERIFIED', () =>
    expect(computeNewStatus(report({ status: 'UNVERIFIED', consensus_score: 7 }))).toBe('VERIFIED'))

  test('VERIFIED score >= 15 -> AUTHORITATIVE', () =>
    expect(computeNewStatus(report({ status: 'VERIFIED', consensus_score: 15 }))).toBe('AUTHORITATIVE'))

  test('VERIFIED denial_count >= 3 and > confirmations -> DISPUTED', () =>
    expect(computeNewStatus(report({
      status: 'VERIFIED', denial_count: 3, confirmation_count: 1,
    }))).toBe('DISPUTED'))

  test('AUTHORITATIVE same dispute rule -> DISPUTED', () =>
    expect(computeNewStatus(report({
      status: 'AUTHORITATIVE', denial_count: 4, confirmation_count: 2,
    }))).toBe('DISPUTED'))

  test('PENDING score <= -5 -> REJECTED', () =>
    expect(computeNewStatus(report({ consensus_score: -5 }))).toBe('REJECTED'))

  test('DISPUTED score <= -5 -> REJECTED', () =>
    expect(computeNewStatus(report({ status: 'DISPUTED', consensus_score: -5 }))).toBe('REJECTED'))

  test('no transition -> null', () =>
    expect(computeNewStatus(report({ status: 'AUTHORITATIVE', consensus_score: 10 }))).toBeNull())
})
