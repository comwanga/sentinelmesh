import { MemberChip } from './MemberChip'
import type { Circle, CircleMember, MemberStatus } from '../../../../shared/types'

interface CircleSidebarProps {
  circle: Circle
  members: CircleMember[]
  memberStatuses: Record<string, MemberStatus>
  onInvite: () => void
  onLeave: () => void
}

const STATUS_LABEL: Record<MemberStatus, string> = {
  ONLINE:  '● Sharing location',
  GHOST:   '◐ Ghost mode',
  OFFLINE: '○ Offline',
}

const STATUS_COLOR: Record<MemberStatus, string> = {
  ONLINE:  'rgba(0,229,255,0.55)',
  GHOST:   'rgba(187,134,252,0.55)',
  OFFLINE: '#4a5568',
}

const AVATAR_COLOR: Record<MemberStatus, string> = {
  ONLINE:  '#00E5FF',
  GHOST:   '#BB86FC',
  OFFLINE: '#2D3748',
}

export function CircleSidebar({ circle, members, memberStatuses, onInvite, onLeave }: CircleSidebarProps) {
  return (
    <aside style={{
      width: 256, flexShrink: 0, background: '#0d1118',
      borderRight: '1px solid #1a2035', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Circle header */}
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #1a2035' }}>
        <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#BB86FC', marginBottom: 4 }}>
          Family Circle
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>{circle.name}</div>
        <div style={{ fontSize: 11, color: '#4a5568', marginTop: 2, fontFamily: "'Courier New', monospace" }}>
          {members.length} members · {circle.circle_id.slice(0, 8)}…
        </div>
      </div>

      {/* Member chips */}
      <div style={{ padding: '10px 16px 6px', display: 'flex', flexWrap: 'wrap', gap: 6, borderBottom: '1px solid #1a2035' }}>
        {members.map(m => (
          <MemberChip key={m.member_pubkey} pubkey={m.member_pubkey} status={memberStatuses[m.member_pubkey] ?? 'OFFLINE'} />
        ))}
      </div>

      {/* Member list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        <div style={{ fontFamily: "'Courier New', monospace", fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#4a5568', padding: '6px 16px 4px' }}>
          Members
        </div>
        {members.map(m => {
          const status = memberStatuses[m.member_pubkey] ?? 'OFFLINE'
          const initial = m.member_pubkey.slice(-1).toUpperCase()
          const avatarColor = AVATAR_COLOR[status]
          return (
            <div key={m.member_pubkey} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 16px' }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                border: `2px solid ${avatarColor}`, color: avatarColor,
                background: `${avatarColor}0d`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700, flexShrink: 0,
              }}>
                {initial}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#cbd5e0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {m.member_pubkey}
                </div>
                <div style={{ fontSize: 10, color: STATUS_COLOR[status], marginTop: 1 }}>
                  {STATUS_LABEL[status]}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* E2EE widget */}
      <div style={{
        margin: '8px 16px', background: '#050e14',
        border: '1px solid rgba(0,229,255,0.15)', borderRadius: 6, padding: '8px 10px',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%', background: '#00E5FF', flexShrink: 0,
          animation: 'e2ee-pulse 2s ease-in-out infinite',
        }} />
        <style>{`
          @keyframes e2ee-pulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(0,229,255,0.4); }
            50% { box-shadow: 0 0 0 5px rgba(0,229,255,0); }
          }
        `}</style>
        <div>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#00E5FF' }}>
            Active X25519 Encryption
          </div>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#2d4a5a', marginTop: 1 }}>
            AES-256-GCM · server sees 0 coordinates
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ padding: '10px 16px', borderTop: '1px solid #1a2035', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button
          onClick={onInvite}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'rgba(0,229,255,0.07)', border: '1px solid rgba(0,229,255,0.2)',
            borderRadius: 6, padding: '8px 12px', color: '#00E5FF',
            fontFamily: "'Courier New', monospace", fontSize: 11, letterSpacing: '0.05em',
            cursor: 'pointer', width: '100%',
          }}
        >
          <span>⚡</span>
          <span>Invite via Nostr</span>
        </button>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            background: 'transparent', border: '1px solid #1a2035', borderRadius: 6, padding: 6,
            color: '#4a5568', fontSize: 11, cursor: 'pointer',
          }}>
            🔑 Manage Keys
          </button>
          <button
            onClick={onLeave}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              background: 'transparent', border: '1px solid #1a2035', borderRadius: 6, padding: 6,
              color: '#4a5568', fontSize: 11, cursor: 'pointer',
            }}
          >
            ⬡ Leave Circle
          </button>
        </div>
      </div>
    </aside>
  )
}
