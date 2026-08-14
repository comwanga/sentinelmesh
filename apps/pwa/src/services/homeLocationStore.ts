import type { HomeLocation } from '../store/uiSlice'
import { clearScopedDeviceRecord, loadScopedDeviceRecord, saveScopedDeviceRecord } from './identityStore'

const VERSION = 1

function isHomeLocation(value: unknown): value is HomeLocation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Object.keys(record).length === 4 && record.version === VERSION &&
    typeof record.lat === 'number' && Number.isFinite(record.lat) && record.lat >= -90 && record.lat <= 90 &&
    typeof record.lng === 'number' && Number.isFinite(record.lng) && record.lng >= -180 && record.lng <= 180 &&
    typeof record.label === 'string' && record.label.trim().length > 0 && record.label.length <= 500
}

export async function saveHomeLocation(home: HomeLocation): Promise<void> {
  if (!isHomeLocation({ version: VERSION, ...home })) throw new Error('Invalid home location')
  const plaintext = new TextEncoder().encode(JSON.stringify({ version: VERSION, ...home }))
  await saveScopedDeviceRecord('home-location', plaintext)
}

export async function loadHomeLocation(): Promise<HomeLocation | null> {
  let plaintext: Uint8Array | null
  try {
    plaintext = await loadScopedDeviceRecord('home-location')
  } catch {
    return null
  }
  if (!plaintext) return null
  let decoded: unknown
  try {
    decoded = JSON.parse(new TextDecoder().decode(plaintext))
  } catch {
    await clearHomeLocation().catch(() => undefined)
    return null
  }
  if (!isHomeLocation(decoded)) {
    await clearHomeLocation().catch(() => undefined)
    return null
  }
  return { lat: decoded.lat, lng: decoded.lng, label: decoded.label }
}

export async function clearHomeLocation(): Promise<void> {
  await clearScopedDeviceRecord('home-location')
}
