import { useState, useCallback } from 'react'
import { MemberChip } from './MemberChip'
import { chatEnabled } from '../config/features'
import type { Circle, CircleMember, MemberStatus } from '../../../../shared/types'

interface CircleSidebarProps {
  circle: Circle
  members: CircleMember[]
  memberStatuses: Record<string, MemberStatus>
  onInvite: () => void
  onLeave: () => void
  onAddMember: (npubOrHex: string) => Promise<string | null>
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

export function CircleSidebar({ circle, members, memberStatuses, onInvite, onLeave, onAddMember }: CircleSidebarProps) {
  const [addInput, setAddInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [addSuccess, setAddSuccess] = useState(false)

  const handleAdd = useCallback(async () => {
    if (!addInput.trim()) return
    setAdding(true)
    setAddError(null)
    const err = await onAddMember(addInput.trim())
    setAdding(false)
    if (err) {
      setAddError(err)
    } else {
      setAddInput('')
      setAddSuccess(true)
      setTimeout(() => setAddSuccess(false), 2000)
    }
  }, [addInput, onAddMember])

  return (
    <aside style={{
      width: 256, flexShrink: 0, background: '#0d1118',
      borderRight: '1px solid #1a2035', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Circle header */}
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #1a2035' }}>
        <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#BB86FC', marginBottom: 4 }}>
          Circle
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>{circle.name}</div>
        <div style={{ fontSize: 11, color: '#4a5568', marginTop: 2, fontFamily: "'Courier New', monospace" }}>
          {members.length} members · {circle.circle_id.slice(0, 8)}…
        </div>
      </div>

      {/* Member chips */}
      <div style={{ padding: '10px 16px 6px', display: 'flex', flexWrap: 'wrap', gap: 6, borderBottom: '1px solid #1a2035' }}>
        {members.map((m, i) => (
          <MemberChip key={m.member_token ?? m.pubkey ?? i} pubkey={m.pubkey ?? m.member_token ?? 'member'} status={memberStatuses[m.pubkey ?? ''] ?? 'OFFLINE'} />
        ))}
      </div>

      {/* Member list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        <div style={{ fontFamily: "'Courier New', monospace", fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#4a5568', padding: '6px 16px 4px' }}>
          Members
        </div>
        {members.length === 0 && (
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4a5568', padding: '8px 16px', fontStyle: 'italic' }}>
            No members yet — use Invite to add people.
          </div>
        )}
        {members.map((m, i) => {
          const status = memberStatuses[m.pubkey ?? ''] ?? 'OFFLINE'
          const displayName = m.label ?? m.pubkey ?? 'unknown member'
          const initial = displayName.slice(0, 1).toUpperCase()
          const avatarColor = AVATAR_COLOR[status]
          return (
            <div key={m.member_token ?? m.pubkey ?? i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 16px' }}>
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
                  {displayName}
                </div>
                <div style={{ fontSize: 10, color: STATUS_COLOR[status], marginTop: 1 }}>
                  {STATUS_LABEL[status]}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Add member by pubkey */}
      <div style={{ padding: '10px 16px', borderTop: '1px solid #1a2035' }}>
        <div style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#4a5568', marginBottom: 5, letterSpacing: '0.06em' }}>
          ADD MEMBER BY KEY
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={addInput}
            onChange={e => { setAddInput(e.target.value); setAddError(null) }}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
            placeholder="npub1… or hex pubkey"
            style={{
              flex: 1, background: '#0B0E14', border: '1px solid ' + (addError ? '#FF2D2D' : '#1a2035'),
              borderRadius: 4, color: '#e2e8f0', fontFamily: "'Courier New', monospace", fontSize: 10,
              padding: '5px 7px', outline: 'none', minWidth: 0,
            }}
          />
          <button
            onClick={handleAdd}
            disabled={adding || !addInput.trim()}
            style={{
              background: addSuccess ? '#1B5E20' : '#1a2035',
              border: '1px solid ' + (addSuccess ? '#4CAF50' : '#1a2035'),
              borderRadius: 4, color: addSuccess ? '#4CAF50' : '#94a3b8',
              fontFamily: "'Courier New', monospace", fontSize: 10,
              padding: '5px 8px', cursor: adding ? 'default' : 'pointer', flexShrink: 0,
            }}
          >
            {adding ? '…' : addSuccess ? '✓' : 'Add'}
          </button>
        </div>
        {addError && (
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#FF2D2D', marginTop: 3 }}>
            {addError}
          </div>
        )}
      </div>

      {/* E2EE widget */}
      <div style={{
        margin: '0 16px 8px', background: '#050e14',
        border: '1px solid rgba(0,229,255,0.15)', borderRadius: 6, padding: '8px 10px',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#00E5FF', flexShrink: 0 }} />
        <div>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#00E5FF' }}>
            NIP-44 Keys · AES-256-GCM Content
          </div>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#2d4a5a', marginTop: 1 }}>
            Server sees 0 coordinates
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ padding: '8px 16px 12px', borderTop: '1px solid #1a2035', display: 'flex', flexDirection: 'column', gap: 6 }}>
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
          <span>Generate Invite</span>
        </button>
        {chatEnabled && (
          <a
            href={`/circles/${circle.circle_id}/chat`}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              background: 'rgba(187,134,252,0.07)', border: '1px solid rgba(187,134,252,0.2)',
              borderRadius: 6, padding: '7px 0', color: '#BB86FC', textDecoration: 'none',
              fontFamily: "'Courier New', monospace", fontSize: 11, cursor: 'pointer', width: '100%',
            }}
          >
            ◐ Circle chat
          </a>
        )}
        <button
          onClick={onLeave}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            background: 'transparent', border: '1px solid #1a2035', borderRadius: 6, padding: '7px 0',
            color: '#4a5568', fontFamily: "'Courier New', monospace", fontSize: 11, cursor: 'pointer', width: '100%',
          }}
        >
          Leave Circle
        </button>
      </div>
    </aside>
  )
}
