// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearHomeLocation, loadHomeLocation, saveHomeLocation } from './homeLocationStore'
import { saveScopedDeviceRecord } from './identityStore'

describe('homeLocationStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('indexedDB', new IDBFactory())
  })

  it('roundtrips encrypted home without plaintext in IndexedDB', async () => {
    const home = { lat: -1.29, lng: 36.82, label: 'Private exact home address' }
    await saveHomeLocation(home)
    expect(await loadHomeLocation()).toEqual(home)
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sentinelmesh-identity', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const record = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction('keys').objectStore('keys').get('scoped:home-location')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    expect(JSON.stringify(record)).not.toContain(home.label)
    db.close()
  })

  it('clears home and treats corrupt ciphertext as absent', async () => {
    await saveHomeLocation({ lat: 1, lng: 2, label: 'Home' })
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('sentinelmesh-identity', 1); request.onsuccess = () => resolve(request.result) })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('keys', 'readwrite')
      tx.objectStore('keys').put({ version: 1, blob: new Uint8Array(40) }, 'scoped:home-location')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
    expect(await loadHomeLocation()).toBeNull()
    await clearHomeLocation()
    expect(await loadHomeLocation()).toBeNull()
  })

  it('rejects and clears a decrypted record with an invalid version or coordinates', async () => {
    await saveScopedDeviceRecord('home-location', new TextEncoder().encode(JSON.stringify({ version: 2, lat: 200, lng: 2, label: 'Invalid' })))
    expect(await loadHomeLocation()).toBeNull()
    expect(await loadHomeLocation()).toBeNull()
  })

  it('does not delete home after a transient crypto read failure', async () => {
    const home = { lat: 1, lng: 2, label: 'Preserved home' }
    await saveHomeLocation(home)
    vi.spyOn(crypto.subtle, 'decrypt').mockRejectedValueOnce(new Error('temporary crypto failure'))
    expect(await loadHomeLocation()).toBeNull()
    expect(await loadHomeLocation()).toEqual(home)
  })

  it('handles unavailable storage without leaking the home', async () => {
    vi.stubGlobal('indexedDB', undefined)
    await expect(saveHomeLocation({ lat: 1, lng: 2, label: 'Home' })).rejects.toThrow()
    await expect(loadHomeLocation()).resolves.toBeNull()
  })
})
