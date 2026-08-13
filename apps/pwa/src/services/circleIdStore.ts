// Local record of the circle ids this device belongs to. The server no longer
// enumerates a user's circles (C-3 privacy), so the client tracks its own ids
// (learned on create, and from the invite string on join) and supplies them to
// GET /api/circles?ids=. Fresh-device discovery is a separate (H-3) concern.
const KEY = 'sentinelmesh:circle_ids'
const OWNER_KEYS_KEY = 'sentinelmesh:circle_owner_keys'

export function getCircleIds(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY)
    const ids = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function addCircleId(id: string): void {
  if (typeof localStorage === 'undefined') return
  const ids = new Set(getCircleIds())
  ids.add(id)
  localStorage.setItem(KEY, JSON.stringify([...ids]))
}

export function removeCircleId(id: string): void {
  if (typeof localStorage === 'undefined') return
  const ids = getCircleIds().filter(x => x !== id)
  localStorage.setItem(KEY, JSON.stringify(ids))
}

export function saveCircleOwnerKey(id: string, ownerPubkey: string): void {
  if (typeof localStorage === 'undefined') return
  let values: Record<string, string> = {}
  try { values = JSON.parse(localStorage.getItem(OWNER_KEYS_KEY) ?? '{}') as Record<string, string> } catch { /* reset malformed state */ }
  values[id] = ownerPubkey.toLowerCase()
  localStorage.setItem(OWNER_KEYS_KEY, JSON.stringify(values))
}

export function getCircleOwnerKey(id: string): string | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const values = JSON.parse(localStorage.getItem(OWNER_KEYS_KEY) ?? '{}') as Record<string, unknown>
    const value = values[id]
    return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : null
  } catch {
    return null
  }
}
