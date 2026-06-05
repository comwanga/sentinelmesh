// Local record of the circle ids this device belongs to. The server no longer
// enumerates a user's circles (C-3 privacy), so the client tracks its own ids
// (learned on create, and from the invite string on join) and supplies them to
// GET /api/circles?ids=. Fresh-device discovery is a separate (H-3) concern.
const KEY = 'sentinelmesh:circle_ids'

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
