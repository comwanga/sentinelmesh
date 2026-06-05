import { useCallback, useState } from 'react'
import { useAppSelector, useAppDispatch } from '../store'
import { activeAlertDismissed, circleLeft, circleLoaded } from '../store/circlesSlice'
import { loadOrCreateKeypair, signAuthEvent, toNpub, hexFromNpubOrHex } from '../services/nostrService'
import { addCircleId } from '../services/circleIdStore'
import { CircleSidebar } from './CircleSidebar'
import { CircleMapLayer } from './CircleMapLayer'
import { AlertBanner } from './AlertBanner'
import { ProximityAlertLog } from './ProximityAlertLog'
import { InviteModal } from './InviteModal'
import { X25519Badge } from './X25519Badge'
import { MapCanvas } from './map/MapCanvas'
import { useCircleWsConnection } from '../services/circleWebSocket'
import { useProximityAlerts } from '../hooks/useProximityAlerts'
import { useBreakpoint } from '../hooks/useBreakpoint'
import type { Circle, CircleMember } from '../../../../shared/types'

const API_BASE = import.meta.env['VITE_API_BASE_URL'] ?? ''

const EMPTY_MEMBERS: never[] = []

interface RawCircle { id: string; name: string; created_at: string; is_owner?: boolean }
interface RawMember { circle_id: string; member_token: string; alert_radius_km: number | null; alert_severity: string | null; joined_at: string }

function toCircle(raw: RawCircle): Circle {
  return { circle_id: raw.id, name: raw.name, created_at: raw.created_at, is_owner: raw.is_owner ?? false }
}

function toMember(raw: RawMember): CircleMember {
  return {
    circle_id: raw.circle_id,
    member_token: raw.member_token,
    alert_radius_km: raw.alert_radius_km ?? 5,
    alert_severity: (raw.alert_severity ?? 'MEDIUM') as CircleMember['alert_severity'],
    joined_at: raw.joined_at,
  }
}

async function makeAuthHeaders() {
  const authEvent = await signAuthEvent()
  return {
    'Content-Type': 'application/json',
    'X-Nostr-Auth': JSON.stringify(authEvent),
  }
}

// ─── Circle type presets ─────────────────────────────────────────────────────
const CIRCLE_PRESETS = [
  { emoji: '👨‍👩‍👧‍👦', label: 'Family',          name: 'Family'           },
  { emoji: '👥',       label: 'Friends',         name: 'Friends'          },
  { emoji: '🏘',       label: 'Neighborhood',    name: 'Neighborhood Watch' },
  { emoji: '🏫',       label: 'School',          name: 'School Circle'    },
  { emoji: '💼',       label: 'Work',            name: 'Work Team'        },
]

// ─── Invite string helpers ────────────────────────────────────────────────────
function buildInviteString(circleId: string, ownerPubkey: string, circleName: string): string {
  return `sm:circle:${circleId}:${ownerPubkey}:${encodeURIComponent(circleName)}`
}

interface ParsedInvite { circleId: string; ownerPubkey: string; circleName: string }

function parseInviteString(raw: string): ParsedInvite | null {
  const trimmed = raw.trim()
  // new format: sm:circle:{id}:{ownerPubkey}:{name}
  const newMatch = trimmed.match(/^sm:circle:([0-9a-f-]{36}):([0-9a-f]{64}):(.+)$/)
  if (newMatch) {
    return { circleId: newMatch[1]!, ownerPubkey: newMatch[2]!, circleName: decodeURIComponent(newMatch[3]!) }
  }
  // legacy format: sentinelmesh:invite:{id}:{timestamp}
  const legacyMatch = trimmed.match(/^sentinelmesh:invite:([0-9a-f-]{36}):/)
  if (legacyMatch) {
    return { circleId: legacyMatch[1]!, ownerPubkey: '', circleName: 'Shared Circle' }
  }
  return null
}

// ─── Empty state (no active circle) ──────────────────────────────────────────
function EmptyState() {
  const dispatch = useAppDispatch()
  const [tab, setTab] = useState<'create' | 'join'>('create')
  const [circleNameInput, setCircleNameInput] = useState('')
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [inviteInput, setInviteInput] = useState('')
  const [parsedInvite, setParsedInvite] = useState<ParsedInvite | null>(null)
  const [joinError, setJoinError] = useState<string | null>(null)

  const myNpub = toNpub(loadOrCreateKeypair().publicKey)

  const effectiveCircleName = selectedPreset !== null
    ? CIRCLE_PRESETS[selectedPreset]!.name
    : circleNameInput.trim()

  const handleCreate = useCallback(async () => {
    if (!effectiveCircleName) return
    setCreating(true)
    setCreateError(null)
    try {
      const headers = await makeAuthHeaders()
      const res = await fetch(`${API_BASE}/api/circles`, {
        method: 'POST', headers,
        body: JSON.stringify({ name: effectiveCircleName }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) { setCreateError(`Server error (${res.status})`); return }
      const raw = await res.json() as RawCircle
      addCircleId(raw.id)
      const circle = toCircle(raw)
      let members: CircleMember[] = []
      try {
        const detailRes = await fetch(`${API_BASE}/api/circles/${raw.id}`, { headers, signal: AbortSignal.timeout(10_000) })
        if (detailRes.ok) {
          const detail = await detailRes.json() as RawCircle & { members: RawMember[] }
          members = detail.members.map(toMember)
        }
      } catch { /* members default to empty */ }
      dispatch(circleLoaded({ circle, members }))
    } catch {
      setCreateError('Network error — check your connection')
    } finally { setCreating(false) }
  }, [effectiveCircleName, dispatch])

  function handleInviteChange(value: string) {
    setInviteInput(value)
    setJoinError(null)
    setParsedInvite(parseInviteString(value))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '28px 20px', overflowY: 'auto', height: '100%' }}>

      {/* ── My identity ── */}
      <div style={{ width: '100%', maxWidth: 400, marginBottom: 24 }}>
        <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4a5568', marginBottom: 4, letterSpacing: '0.06em' }}>
          YOUR NOSTR PUBLIC KEY
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: '#0d1118', border: '1px solid #1a2035', borderRadius: 6, padding: '8px 10px',
        }}>
          <span style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#BB86FC', flex: 1, wordBreak: 'break-all' }}>
            {myNpub}
          </span>
          <button
            onClick={() => navigator.clipboard.writeText(myNpub)}
            style={{
              flexShrink: 0, background: 'none', border: '1px solid #1a2035', borderRadius: 3,
              color: '#4a5568', fontFamily: "'Courier New', monospace", fontSize: 9,
              padding: '3px 7px', cursor: 'pointer',
            }}
          >
            Copy
          </button>
        </div>
        <div style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#4a5568', marginTop: 4 }}>
          Share this key with circle owners to be added as a member.
        </div>
      </div>

      {/* ── Tab selector ── */}
      <div style={{ width: '100%', maxWidth: 400, display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid #1a2035', marginBottom: 20 }}>
        {(['create', 'join'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1, padding: '10px 0', background: tab === t ? '#1a2035' : 'none', border: 'none',
              fontFamily: "'Courier New', monospace", fontSize: 11, letterSpacing: '0.08em',
              color: tab === t ? '#00E5FF' : '#4a5568', cursor: 'pointer',
              borderBottom: tab === t ? '2px solid #00E5FF' : '2px solid transparent',
            }}
          >
            {t === 'create' ? '+ Create Circle' : '⤵ Join Circle'}
          </button>
        ))}
      </div>

      {/* ── Create tab ── */}
      {tab === 'create' && (
        <div style={{ width: '100%', maxWidth: 400 }}>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4a5568', marginBottom: 8, letterSpacing: '0.06em' }}>
            CHOOSE A TYPE
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {CIRCLE_PRESETS.map((p, i) => (
              <button
                key={i}
                onClick={() => { setSelectedPreset(i === selectedPreset ? null : i); setCircleNameInput('') }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: selectedPreset === i ? '#1a2035' : 'none',
                  border: '1px solid ' + (selectedPreset === i ? '#00E5FF' : '#1a2035'),
                  borderRadius: 20, padding: '6px 12px', cursor: 'pointer',
                  fontFamily: "'Courier New', monospace", fontSize: 11,
                  color: selectedPreset === i ? '#00E5FF' : '#4a5568',
                }}
              >
                <span>{p.emoji}</span>
                <span>{p.label}</span>
              </button>
            ))}
          </div>

          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4a5568', marginBottom: 4, letterSpacing: '0.06em' }}>
            {selectedPreset !== null ? 'CIRCLE NAME (pre-filled)' : 'CIRCLE NAME'}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: createError ? 8 : 16 }}>
            <input
              value={selectedPreset !== null ? CIRCLE_PRESETS[selectedPreset]!.name : circleNameInput}
              onChange={e => { setSelectedPreset(null); setCircleNameInput(e.target.value) }}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
              placeholder="e.g. Friends in Westlands"
              style={{
                flex: 1, background: '#0B0E14', border: '1px solid #1a2035', borderRadius: 4,
                color: '#e2e8f0', fontFamily: "'Courier New', monospace", fontSize: 12,
                padding: '8px 10px', outline: 'none',
              }}
            />
            <button
              onClick={handleCreate}
              disabled={creating || !effectiveCircleName}
              style={{
                background: creating || !effectiveCircleName ? '#1a2035' : '#1B5E20',
                border: '1px solid ' + (creating || !effectiveCircleName ? '#1a2035' : '#4CAF50'),
                borderRadius: 4, color: creating || !effectiveCircleName ? '#4a5568' : '#4CAF50',
                fontFamily: "'Courier New', monospace", fontSize: 11,
                padding: '8px 16px', cursor: creating || !effectiveCircleName ? 'default' : 'pointer',
              }}
            >
              {creating ? '…' : 'Create'}
            </button>
          </div>
          {createError && (
            <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#FF2D2D', marginBottom: 12 }}>
              {createError}
            </div>
          )}
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#4a5568', lineHeight: 1.6 }}>
            ✓ End-to-end encrypted · ✓ Location never stored on server · ✓ You control who joins
          </div>
        </div>
      )}

      {/* ── Join tab ── */}
      {tab === 'join' && (
        <div style={{ width: '100%', maxWidth: 400 }}>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4a5568', marginBottom: 4, letterSpacing: '0.06em' }}>
            PASTE INVITE CODE
          </div>
          <textarea
            value={inviteInput}
            onChange={e => handleInviteChange(e.target.value)}
            placeholder="sm:circle:… (paste the invite you received)"
            rows={3}
            style={{
              width: '100%', background: '#0d1118', border: '1px solid ' + (parsedInvite ? '#4CAF50' : '#1a2035'),
              borderRadius: 6, color: '#e2e8f0', fontFamily: "'Courier New', monospace", fontSize: 11,
              padding: '8px 10px', outline: 'none', resize: 'none', boxSizing: 'border-box', marginBottom: 10,
            }}
          />

          {parsedInvite ? (
            <div style={{
              background: '#0d1118', border: '1px solid #4CAF50', borderRadius: 8, padding: '12px 14px', marginBottom: 14,
            }}>
              <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4CAF50', marginBottom: 6, letterSpacing: '0.08em' }}>
                ✓ VALID INVITE
              </div>
              <div style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#e2e8f0', marginBottom: 4 }}>
                Circle: {parsedInvite.circleName}
              </div>
              {parsedInvite.ownerPubkey && (
                <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#94a3b8' }}>
                  Owner: {parsedInvite.ownerPubkey.slice(0, 12)}…
                </div>
              )}
              <div style={{ marginTop: 12, padding: '10px', background: '#050709', borderRadius: 6, border: '1px solid #1B5E20' }}>
                <div style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#4a5568', marginBottom: 4 }}>
                  TO JOIN: share your public key with the circle owner so they can add you.
                </div>
                <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#BB86FC', wordBreak: 'break-all' }}>
                  {myNpub}
                </div>
                <button
                  onClick={() => navigator.clipboard.writeText(myNpub)}
                  style={{
                    marginTop: 6, background: 'none', border: '1px solid #1a2035', borderRadius: 3,
                    color: '#4a5568', fontFamily: "'Courier New', monospace", fontSize: 9,
                    padding: '3px 8px', cursor: 'pointer',
                  }}
                >
                  Copy my key
                </button>
              </div>
              <button
                onClick={() => { addCircleId(parsedInvite.circleId); setJoinError(null) }}
                style={{
                  marginTop: 10, width: '100%', background: '#1B5E20', border: '1px solid #4CAF50',
                  borderRadius: 4, color: '#4CAF50', fontFamily: "'Courier New', monospace",
                  fontSize: 11, padding: '7px 0', cursor: 'pointer',
                }}
              >
                Track this circle
              </button>
            </div>
          ) : inviteInput.trim().length > 0 ? (
            <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#FF2D2D', marginBottom: 12 }}>
              Unrecognised invite format. Ask the circle owner to share a fresh invite.
            </div>
          ) : null}

          {joinError && (
            <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#FF2D2D', marginBottom: 10 }}>
              {joinError}
            </div>
          )}

          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#4a5568', lineHeight: 1.6 }}>
            Ask a circle owner to generate an invite for you, then paste it above. They must add your public key to complete the process.
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main dashboard (active circle) ──────────────────────────────────────────
export function FamilyCircleDashboard() {
  const dispatch = useAppDispatch()
  const { layout } = useBreakpoint()
  const activeCircleId = useAppSelector(s => s.circles.activeCircleId)
  const circles = useAppSelector(s => s.circles.circles)
  const members = useAppSelector(s => { const id = s.circles.activeCircleId; return id ? (s.circles.members[id] ?? EMPTY_MEMBERS) : EMPTY_MEMBERS })
  const memberStatuses = useAppSelector(s => s.circles.memberStatuses)
  const decryptedLocations = useAppSelector(s => s.circles.decryptedLocations)
  const proximityAlerts = useAppSelector(s => s.circles.proximityAlerts)
  const activeAlert = useAppSelector(s => s.circles.activeAlert)
  const decryptErrors = useAppSelector(s => s.circles.decryptErrors)

  const activeCircle = circles.find(c => c.circle_id === activeCircleId) ?? null
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteString, setInviteString] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useCircleWsConnection(activeCircleId)
  useProximityAlerts()

  const handleInvite = useCallback(() => {
    if (!activeCircleId || !activeCircle) return
    const keypair = loadOrCreateKeypair()
    const str = buildInviteString(activeCircleId, keypair.publicKey, activeCircle.name)
    setInviteString(str)
    setInviteOpen(true)
  }, [activeCircleId, activeCircle])

  const handleLeave = useCallback(() => {
    if (window.confirm('Leave this circle? Your local circle key will be removed.')) {
      dispatch(circleLeft())
    }
  }, [dispatch])

  const handleAddMember = useCallback(async (npubOrHex: string) => {
    const hex = hexFromNpubOrHex(npubOrHex)
    if (!hex || !activeCircleId) return 'Invalid key format'
    try {
      const headers = await makeAuthHeaders()
      const res = await fetch(`${API_BASE}/api/circles/${activeCircleId}/members`, {
        method: 'POST', headers,
        body: JSON.stringify({ member_pubkey: hex }),
        signal: AbortSignal.timeout(10_000),
      })
      if (res.status === 403) return 'Only the circle owner can add members'
      if (!res.ok) return `Server error (${res.status})`
      const raw = await res.json() as RawMember
      const updatedMembers = [...members, toMember(raw)]
      dispatch(circleLoaded({ circle: activeCircle!, members: updatedMembers }))
      return null
    } catch { return 'Network error' }
  }, [activeCircleId, activeCircle, members, dispatch])

  const handleDismissAlert = useCallback(() => dispatch(activeAlertDismissed()), [dispatch])

  if (!activeCircle) return <EmptyState />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0B0E14' }}>
      <AlertBanner alert={activeAlert} onDismiss={handleDismissAlert} />
      {decryptErrors.length > 0 && (
        <div style={{ background: '#2d1b00', color: '#FF8C00', fontFamily: "'Courier New', monospace", fontSize: 10, padding: '4px 12px' }}>
          Could not decrypt location for: {decryptErrors.join(' · ')} — check your circle key.
        </div>
      )}

      {layout === 'mobile' && (
        <button
          onClick={() => setSidebarOpen(o => !o)}
          style={{
            margin: '8px 12px', background: 'none', border: '1px solid #1a2035',
            borderRadius: 4, color: '#94a3b8', fontFamily: "'Courier New', monospace",
            fontSize: 11, padding: '6px 12px', cursor: 'pointer', textAlign: 'left',
          }}
        >
          {sidebarOpen ? '▲ Hide members' : `▼ Members · ${members.length}`}
        </button>
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', flexDirection: layout === 'mobile' ? 'column' : 'row' }}>
        {(layout === 'desktop' || sidebarOpen) && (
          <CircleSidebar
            circle={activeCircle}
            members={members}
            memberStatuses={memberStatuses}
            onInvite={handleInvite}
            onLeave={handleLeave}
            onAddMember={handleAddMember}
          />
        )}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: layout === 'mobile' ? 300 : undefined }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <MapCanvas initialViewState={{ longitude: 36.8219, latitude: -1.2921, zoom: 12 }}>
              <CircleMapLayer decryptedLocations={decryptedLocations} memberStatuses={memberStatuses} />
            </MapCanvas>
            <X25519Badge />
          </div>
          <ProximityAlertLog alerts={proximityAlerts} />
        </div>
      </div>

      <InviteModal isOpen={inviteOpen} inviteString={inviteString} onClose={() => setInviteOpen(false)} />
    </div>
  )
}
