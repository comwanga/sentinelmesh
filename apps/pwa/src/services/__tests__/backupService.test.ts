// @vitest-environment node
import 'fake-indexeddb/auto'

import { describe, it, expect, beforeEach } from 'vitest'
import { exportBackup, decryptBackup, applyRestore } from '../backupService'
import { saveSecretKey, loadVault, upsertCircleKey, clearSecretKey, loadVaultMeta, formatVaultId, fingerprintPayload } from '../identityStore'
import { generateSecretKey } from 'nostr-tools'

function key(n: number): Uint8Array { const k = new Uint8Array(32); for (let i = 0; i < 32; i++) k[i] = (i * 3 + n) & 0xff; return k }
const PASS = 'correct horse battery staple'

async function seedVault(): Promise<void> {
  await clearSecretKey()
  await saveSecretKey(generateSecretKey())
  await upsertCircleKey('circle-1', key(1))
  await upsertCircleKey('circle-2', key(2))
}

describe('backupService', () => {
  beforeEach(seedVault)

  it('export then decrypt restores the exact identity + circles', async () => {
    const before = await loadVault()
    const blob = await exportBackup(PASS)
    const text = await blob.text()
    const { payload, vaultId } = await decryptBackup(text, PASS)
    expect(Array.from(payload.identitySk)).toEqual(Array.from(before!.identitySk))
    expect(payload.circles.map(c => c.id).sort()).toEqual(['circle-1', 'circle-2'])
    expect(vaultId).toBe(formatVaultId(await fingerprintPayload(before!)))
  })

  it('wrong passphrase throws a generic error', async () => {
    const text = await (await exportBackup(PASS)).text()
    await expect(decryptBackup(text, 'wrong passphrase here')).rejects.toThrow(/passphrase or corrupted/i)
  })

  it('tampered ciphertext throws', async () => {
    const file = JSON.parse(await (await exportBackup(PASS)).text())
    file.ciphertext = file.ciphertext.slice(0, -4) + (file.ciphertext.endsWith('A') ? 'B' : 'A') + file.ciphertext.slice(-3)
    await expect(decryptBackup(JSON.stringify(file), PASS)).rejects.toThrow()
  })

  it('rejects an unknown format/version', async () => {
    await expect(decryptBackup(JSON.stringify({ format: 'nope', version: 1 }), PASS)).rejects.toThrow(/unrecognized|unsupported|format/i)
  })

  it('exported envelope contains no plaintext identity bytes', async () => {
    const before = await loadVault()
    const text = await (await exportBackup(PASS)).text()
    const skB64 = btoa(String.fromCharCode(...before!.identitySk))
    expect(text).not.toContain(skB64)
  })

  it('exportBackup records lastExportedFingerprint in meta', async () => {
    await exportBackup(PASS)
    expect((await loadVaultMeta())?.lastExportedFingerprint).toBeTruthy()
  })

  it('applyRestore fans the payload into a wiped device', async () => {
    const before = await loadVault()
    const text = await (await exportBackup(PASS)).text()
    await clearSecretKey()
    const { payload } = await decryptBackup(text, PASS)
    const result = await applyRestore(payload)
    expect(result.identityRestored).toBe(true)
    expect(result.circlesRestored).toBe(2)
    const after = await loadVault()
    expect(Array.from(after!.identitySk)).toEqual(Array.from(before!.identitySk))
    expect(after!.circles.map(c => c.id).sort()).toEqual(['circle-1', 'circle-2'])
  })
})
