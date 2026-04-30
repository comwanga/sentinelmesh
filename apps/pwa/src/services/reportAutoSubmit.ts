// apps/pwa/src/services/reportAutoSubmit.ts
import { ThreatDetection } from '../constants/acousticThreats'

const API_BASE = (typeof import.meta !== 'undefined' && (import.meta as any).env?.['VITE_API_BASE_URL']) || ''

interface Location { lat: number; lng: number }

export async function autoSubmitAcousticReport(
  detection: ThreatDetection,
  location: Location,
): Promise<void> {
  const description =
    `[acoustic detection] ${detection.label} detected in browser ` +
    `(confidence: ${Math.round(detection.confidence * 100)}%). ` +
    `Auto-submitted for community verification — please confirm if you are nearby.`

  try {
    const response = await fetch(`${API_BASE}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: detection.category,
        description,
        lat: location.lat,
        lng: location.lng,
        timestamp: Date.now(),
      }),
    })
    if (!response.ok) {
      console.warn('[autoSubmit] server rejected acoustic report:', response.status)
    }
  } catch (err) {
    console.warn('[autoSubmit] acoustic report failed (offline?):', err)
  }
}
