import type { MemberStatus } from '../../../../shared/types'

const RING_COLORS: Record<MemberStatus, string> = {
  ONLINE:  '#00E5FF',
  GHOST:   '#BB86FC',
  OFFLINE: '#2D3748',
}

interface MemberChipProps {
  pubkey: string
  status: MemberStatus
}

export function MemberChip({ pubkey, status }: MemberChipProps) {
  const truncated = pubkey.length > 10 ? `${pubkey.slice(0, 8)}…` : pubkey
  const ringColor = RING_COLORS[status]

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      background: '#111827', border: '1px solid #1e2a3a', borderRadius: 20,
      padding: '3px 8px 3px 4px', cursor: 'pointer',
    }}>
      <div
        data-status={status}
        style={{
          width: 16, height: 16, borderRadius: '50%',
          border: `2px solid ${ringColor}`,
          boxShadow: status !== 'OFFLINE' ? `0 0 6px ${ringColor}66` : 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: ringColor }} />
      </div>
      <span style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#a0aec0' }}>
        {truncated}
      </span>
    </div>
  )
}
