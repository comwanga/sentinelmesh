import { signNip98AuthEvent } from './nostrService'

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
  const event = await signNip98AuthEvent(signalsUrl, 'POST')
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
  const response = await fetch(signalsUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Nostr-Auth': JSON.stringify(event),
    },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify(payload),
  })
  if (!response.ok && response.status !== 200) {
    throw new Error(`acoustic signal submission failed: ${response.status}`)
  }
}
