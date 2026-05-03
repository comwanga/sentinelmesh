import { loadCircleKey, encryptLocation } from './e2eeService'

const PUBLISH_INTERVAL_MS = 30_000

export interface LocationPublisher {
  stop: () => void
}

export function startLocationPublisher(
  circleId: string,
  nostrPubkey: string,
  authEventJson: string,
): LocationPublisher {
  let active = true

  async function publish(): Promise<void> {
    if (!active) return
    const key = await loadCircleKey(circleId)
    if (!key) return

    navigator.geolocation.getCurrentPosition(async (pos) => {
      if (!active) return
      const encrypted = await encryptLocation(key, pos.coords.latitude, pos.coords.longitude)
      try {
        await fetch(`/api/circles/${circleId}/location`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Nostr-Auth': authEventJson,
          },
          body: JSON.stringify({ sender_pubkey: nostrPubkey, encrypted_payload: encrypted }),
        })
      } catch {
        console.warn('[location-publisher] publish failed')
      }
    })
  }

  publish()
  const timer = setInterval(publish, PUBLISH_INTERVAL_MS)

  return {
    stop: () => {
      active = false
      clearInterval(timer)
    },
  }
}
