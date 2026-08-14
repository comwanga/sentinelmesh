// Local record of joined public channel group ids for the configured community
// relay. Lightweight (localStorage) — durable relay-list sync (NIP-51 kind 10009)
// is a later unit.
const KEY = 'sentinelmesh:joined_channels'

export function getJoinedChannels(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY)
    const ids = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function addJoinedChannel(groupId: string): void {
  if (typeof localStorage === 'undefined') return
  const ids = new Set(getJoinedChannels())
  ids.add(groupId)
  localStorage.setItem(KEY, JSON.stringify([...ids]))
}
