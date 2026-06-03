// apps/pwa/src/constants/acousticThreats.ts

export type ThreatCategory = 'SECURITY_INCIDENT' | 'FIRE' | 'CIVIL_UNREST' | 'ACCIDENT'

export const DETECTION_THRESHOLD = 0.80

export const YAMNET_THREAT_MAP: ReadonlyArray<{
  classIndex: number
  label: string
  category: ThreatCategory
}> = [
  { classIndex: 427, label: 'Gunshot',        category: 'SECURITY_INCIDENT' },
  { classIndex: 429, label: 'Explosion',       category: 'SECURITY_INCIDENT' },
  { classIndex: 25,  label: 'Screaming',       category: 'SECURITY_INCIDENT' },
  { classIndex: 26,  label: 'Yell',            category: 'SECURITY_INCIDENT' },
  { classIndex: 60,  label: 'Glass breaking',  category: 'SECURITY_INCIDENT' },
  { classIndex: 345, label: 'Crowd',           category: 'CIVIL_UNREST'      },
  { classIndex: 401, label: 'Fire alarm',      category: 'FIRE'              },
  { classIndex: 402, label: 'Smoke detector',  category: 'FIRE'              },
  { classIndex: 504, label: 'Crash',           category: 'ACCIDENT'          },
  { classIndex: 505, label: 'Car crash',       category: 'ACCIDENT'          },
] as const

export interface ThreatDetection {
  classIndex: number
  label: string
  category: ThreatCategory
  confidence: number
  /** sha256 of the quantized YAMNet score vector — a content fingerprint of the
   * audio window. Identical audio → identical fingerprint (catches digital replay);
   * live audio varies, so independent observations get distinct fingerprints (AC-4). */
  fingerprint?: string
}

/** Compute the acoustic fingerprint from a YAMNet score vector. */
export async function acousticFingerprint(scores: Float32Array): Promise<string> {
  // Quantize to 2 decimals (robust to float noise) and hash the joined vector.
  let summary = ''
  for (let i = 0; i < scores.length; i++) {
    summary += Math.round((scores[i] ?? 0) * 100) + ','
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(summary))
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function getThreatFromScores(scores: Float32Array): ThreatDetection | null {
  let best: ThreatDetection | null = null

  for (const entry of YAMNET_THREAT_MAP) {
    const confidence = scores[entry.classIndex]
    if (confidence !== undefined && confidence >= DETECTION_THRESHOLD) {
      if (best === null || confidence > best.confidence) {
        best = { ...entry, confidence }
      }
    }
  }

  return best
}
