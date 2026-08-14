import { safeCircleLocationEnabled } from '../config/features'
import { encryptCircleLocationV1, loadCircleKey, type LocationPrecision } from './e2eeService'
import { sha256Hex, signNip98AuthEvent } from './nostrService'

export interface LocationPublisherOptions {
  circleId: string
  keyEpoch: number
  precision: LocationPrecision
  endpoint?: string
  enabled?: boolean
  fetchImpl?: typeof fetch
  getPosition?: () => Promise<GeolocationPosition>
}

export interface LocationPublisher {
  publish: () => Promise<void>
  stop: () => void
}

function browserPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 15_000,
  }))
}

export function buildLocationEnvelopeBody(keyEpoch: number, ciphertext: string, expiresAt: number): string {
  return JSON.stringify({
    version: 1,
    key_epoch: keyEpoch,
    ciphertext,
    expires_at: new Date(expiresAt * 1000).toISOString(),
  })
}

export function createLocationPublisher(options: LocationPublisherOptions): LocationPublisher {
  let stopped = false
  let inFlight = false
  const enabled = options.enabled ?? safeCircleLocationEnabled
  const fetchImpl = options.fetchImpl ?? fetch
  const getPosition = options.getPosition ?? browserPosition

  return {
    async publish(): Promise<void> {
      if (stopped) throw new Error('Location publisher is stopped')
      if (!enabled) { stopped = true; throw new Error('Safe circle location is disabled') }
      if (inFlight) throw new Error('Location publish already in progress')
      if (!Number.isSafeInteger(options.keyEpoch) || options.keyEpoch < 1) {
        stopped = true
        throw new Error('Circle epoch is unavailable')
      }
      inFlight = true
      try {
        const key = await loadCircleKey(options.circleId)
        if (!key) { stopped = true; throw new Error('Circle key is unavailable') }
        let position: GeolocationPosition
        try { position = await getPosition() } catch {
          stopped = true
          throw new Error('Location permission or acquisition failed')
        }
        const now = Math.floor(Date.now() / 1000)
        const expiresAt = now + 5 * 60
        const ciphertext = await encryptCircleLocationV1(key, options.circleId, options.keyEpoch, {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy_m: position.coords.accuracy,
          captured_at: now,
        }, options.precision, expiresAt)
        const body = buildLocationEnvelopeBody(options.keyEpoch, ciphertext, expiresAt)
        const relativeUrl = options.endpoint ?? `/api/circles/${options.circleId}/location`
        const authUrl = new URL(relativeUrl, window.location.origin).toString()
        // Sign after the exact bytes are finalized. This event is never cached or reused.
        const auth = await signNip98AuthEvent(authUrl, 'POST', await sha256Hex(body))
        const response = await fetchImpl(relativeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Nostr-Auth': JSON.stringify(auth) },
          signal: AbortSignal.timeout(15_000),
          body,
        })
        if (response.status === 409 || response.status === 422 || response.status === 503) {
          stopped = true
          throw new Error('Circle epoch or location protocol is not ready')
        }
        if (!response.ok) throw new Error(`Location publish failed (${response.status})`)
      } finally {
        inFlight = false
      }
    },
    stop(): void { stopped = true },
  }
}

/**
 * Compatibility entry point. It intentionally does not start timers or publish;
 * callers must migrate to createLocationPublisher and explicit user-driven sends.
 */
export function startLocationPublisher(): LocationPublisher {
  return { publish: async () => { throw new Error('Continuous location sharing is disabled') }, stop: () => undefined }
}
