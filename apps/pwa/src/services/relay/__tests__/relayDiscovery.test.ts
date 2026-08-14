// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import { parseRelayUrls, parseGroupList } from '../relayDiscovery'

function signed(kind: number, tags: string[][]) {
  const sk = generateSecretKey()
  return finalizeEvent({ kind, created_at: 1, tags, content: '' }, sk)
}

describe('relayDiscovery', () => {
  test('extracts relay URLs from r tags', () => {
    const event = signed(10002, [['r', 'wss://relay-a.example.com'], ['r', 'wss://relay-b.example.com']])
    expect(parseRelayUrls(event)).toEqual(['wss://relay-a.example.com', 'wss://relay-b.example.com'])
  })

  test('extracts NIP-29 group references with their relay', () => {
    const event = signed(10009, [['g', 'group-1', 'wss://relay-a.example.com']])
    expect(parseGroupList(event)).toEqual([{ groupId: 'group-1', relayUrl: 'wss://relay-a.example.com' }])
  })
})
