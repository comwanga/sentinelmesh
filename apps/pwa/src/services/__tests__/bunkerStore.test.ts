import { beforeEach, describe, expect, test } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { clearBunkerConnection, loadBunkerConnection, saveBunkerConnection } from '../bunkerStore'

beforeEach(() => { globalThis.indexedDB = new IDBFactory() })

describe('bunkerStore', () => {
  test('round-trips encrypted connection state', async () => {
    const connection = {
      clientSecretKey: new Uint8Array(32).fill(7),
      bunkerPubkey: 'a'.repeat(64),
      relays: ['wss://relay.example.com/'],
      secret: 'approval-secret',
      expectedPubkey: 'b'.repeat(64),
    }
    await saveBunkerConnection(connection)
    await expect(loadBunkerConnection()).resolves.toEqual(connection)
    await clearBunkerConnection()
    await expect(loadBunkerConnection()).resolves.toBeNull()
  })
})
