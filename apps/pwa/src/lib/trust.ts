import type { TrustState, SafetyEvent } from '../../../../shared/types'

// Presentation rules for the H-5 NLP trust ladder. A machine detection surfaces
// on the map immediately as `heuristic` (clearly labeled "Automated Detection"),
// becomes `corroborating` once a second independent source agrees, and only
// reaches `confirmed` — standard verified styling — after cross-channel
// agreement. Missing trust data fails safe as heuristic rather than implying
// that an event has been confirmed.

export function trustStateOf(e: Pick<SafetyEvent, 'trust_state'>): TrustState {
  return e.trust_state ?? 'heuristic'
}

/** True while a detection has not yet earned CONFIRMED — i.e. it is automated and unverified. */
export function isUnverified(e: Pick<SafetyEvent, 'trust_state'>): boolean {
  return trustStateOf(e) !== 'confirmed'
}

export interface TrustStyle {
  /** Short badge text, empty for confirmed (no badge needed). */
  badge: string
  /** Marker opacity — unverified detections are muted. */
  opacity: number
  /** Accent/badge colour. */
  color: string
}

const STYLES: Record<TrustState, TrustStyle> = {
  heuristic: {
    badge: 'Automated Detection',
    opacity: 0.45,
    color: '#94a3b8', // muted gray
  },
  corroborating: {
    badge: 'Corroborating',
    opacity: 0.75,
    color: '#FFB300', // amber — gaining support but still automated
  },
  confirmed: {
    badge: '',
    opacity: 1,
    color: '#4CAF50', // standard verified
  },
}

export function trustStyle(e: Pick<SafetyEvent, 'trust_state'>): TrustStyle {
  return STYLES[trustStateOf(e)]
}
