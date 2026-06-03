import { signNip98AuthEvent, sha256Hex } from './nostrService'

export interface ThreatDetection {
  label: string
  confidence: number
}

export interface Location {
  lat: number
  lng: number
}

export async function submitAcousticSignal(
  detection: ThreatDetection,
  location: Location,
): Promise<void> {
  const signalsUrl = new URL('/api/acoustic/signals', window.location.origin).toString()
  const payload = {
    client_id: crypto.randomUUID(),
    threat_class: detection.label,
    confidence: detection.confidence,
    lat: location.lat,
    lng: location.lng,
    model_version: 'yamnet-tfjs-1',
    threshold_profile: 'default-v1',
    inference_backend: 'webgl',
    dropped_frames: 0,
  }
  // Serialise once, then bind the signature to the exact bytes we send (AC-6).
  const bodyStr = JSON.stringify(payload)
  const payloadHash = await sha256Hex(bodyStr)
  const event = await signNip98AuthEvent(signalsUrl, 'POST', payloadHash)
  const response = await fetch(signalsUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Nostr-Auth': JSON.stringify(event),
    },
    signal: AbortSignal.timeout(10_000),
    body: bodyStr,
  })
  if (!response.ok) {
    throw new Error(`acoustic signal submission failed: ${response.status}`)
  }
}
