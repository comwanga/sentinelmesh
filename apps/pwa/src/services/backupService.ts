// Self-custodial, passphrase-encrypted backup of the whole device vault (identity
// + circle keys + circle ids). The server never sees the file, the plaintext, or
// the passphrase. AES-GCM under a PBKDF2-derived key; a versioned file envelope.
// (H-3 Layer 2.)
import {
  loadVault, encodeVaultPayload, decodeVaultPayload, type VaultPayload,
  fingerprintPayload, formatVaultId, vaultFingerprint, saveVaultMeta,
} from './identityStore'
import { saveCircleKeyWithBackup } from './e2eeService'
import { restoreIdentityFromSecretKey } from './nostrService'
import { addCircleId } from './circleIdStore'

const FORMAT = 'sentinelmesh-vault-backup'
const FORMAT_VERSION = 1
const PBKDF2_ITERATIONS = 600_000

interface BackupFile {
  format: string
  version: number
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string }
  iv: string
  ciphertext: string
}

export interface RestoreResult {
  identityRestored: boolean
  circlesRestored: number
  circlesFailed: string[]
}

function b64e(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)) }
function b64d(s: string): Uint8Array { return Uint8Array.from(atob(s), c => c.charCodeAt(0)) }

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}

/** Encrypt the current vault under `passphrase` into a downloadable backup Blob.
 *  Also records the export fingerprint in vault meta. */
export async function exportBackup(passphrase: string): Promise<Blob> {
  const payload = await loadVault()
  if (!payload) throw new Error('No identity to back up')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const aesKey = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS)
  const plaintext = new TextEncoder().encode(encodeVaultPayload(payload))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plaintext as unknown as BufferSource))
  const file: BackupFile = {
    format: FORMAT, version: FORMAT_VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: b64e(salt) },
    iv: b64e(iv), ciphertext: b64e(ciphertext),
  }
  await saveVaultMeta({ lastExportedFingerprint: await vaultFingerprint() })
  return new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
}

/** The Vault ID of the currently-stored vault (for the export screen). */
export async function currentVaultId(): Promise<string> {
  return formatVaultId(await vaultFingerprint())
}

/** Parse + decrypt a backup file WITHOUT writing anything. Returns the payload
 *  and its Vault ID so the UI can show it before a destructive restore. */
export async function decryptBackup(fileText: string, passphrase: string): Promise<{ payload: VaultPayload; vaultId: string }> {
  let file: BackupFile
  try { file = JSON.parse(fileText) as BackupFile } catch { throw new Error('Not a valid backup file') }
  if (file?.format !== FORMAT || file?.version !== FORMAT_VERSION) throw new Error('Unrecognized or unsupported backup file format')
  try {
    const aesKey = await deriveKey(passphrase, b64d(file.kdf.salt), file.kdf.iterations)
    const plain = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64d(file.iv) as unknown as BufferSource }, aesKey, b64d(file.ciphertext) as unknown as BufferSource,
    ))
    const payload = decodeVaultPayload(new TextDecoder().decode(plain))
    return { payload, vaultId: formatVaultId(await fingerprintPayload(payload)) }
  } catch {
    throw new Error('Incorrect passphrase or corrupted backup file')
  }
}

/** Fan a decrypted payload into the device: identity first (atomic), then each
 *  circle best-effort. Replaces the current device identity. */
export async function applyRestore(payload: VaultPayload): Promise<RestoreResult> {
  await restoreIdentityFromSecretKey(payload.identitySk)
  const circlesFailed: string[] = []
  let circlesRestored = 0
  for (const c of payload.circles) {
    try {
      await saveCircleKeyWithBackup(c.id, new Uint8Array(c.key), c.epoch ?? 1)
      addCircleId(c.id)
      circlesRestored++
    } catch {
      circlesFailed.push(c.id)
    }
  }
  return { identityRestored: true, circlesRestored, circlesFailed }
}
