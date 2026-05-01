import type { CommunityReport } from '../../../../shared/types'

export function computeNewStatus(report: CommunityReport): string | null {
  const { status, consensus_score, confirmation_count, denial_count } = report

  // Rejection — highest priority check
  if (['PENDING', 'DISPUTED'].includes(status) && consensus_score <= -5) return 'REJECTED'

  // Dispute — before positive transitions
  if (
    ['UNVERIFIED', 'VERIFIED', 'AUTHORITATIVE'].includes(status) &&
    denial_count >= 3 &&
    denial_count > confirmation_count
  ) return 'DISPUTED'

  // Positive progression
  if (status === 'VERIFIED'    && consensus_score >= 15) return 'AUTHORITATIVE'
  if (status === 'UNVERIFIED'  && consensus_score >= 7)  return 'VERIFIED'
  if (status === 'PENDING'     && consensus_score >= 3)  return 'UNVERIFIED'

  return null
}
