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
