# Phase 3: Family Location Circles — Design Spec

**Date:** 2026-05-03  
**Branch:** feat/family-location-circles  
**Status:** Approved for implementation

---

## Overview

Phase 3 adds real-time, end-to-end encrypted family location sharing to the SentinelMesh PWA. Family members form named "circles." Each member encrypts their coordinates on-device before sending; the gateway stores and relays opaque blobs it cannot read. Proximity alerts fire client-side when a decrypted member location falls within a configurable radius of an active safety event (Phase 1) or a verified Community Report (Phase 2).

---

## Layout — Three-Panel Command (B + C hybrid)

```
┌─────────────────────────────────────────────────────────────────┐
│  ALERT BANNER  (conditional, top — triggers on proximity alert) │
├───────────────────┬─────────────────────────────────────────────┤
│                   │                                             │
│  SIDEBAR          │  SAFETY MAP (flex-1)                        │
│  w-64 / fixed     │  · family member nodes (animated rings)     │
│                   │  · Phase 1 event markers                    │
│  · circle name    │  · crisis zone overlays (Phase 2 CRs)       │
│  · member chips   │                                             │
│  · member list    │  X25519 ACTIVE badge (bottom-right, pinned) │
│  · E2EE widget    ├─────────────────────────────────────────────┤
│  · invite btn     │  PROXIMITY ALERT LOG (h-25%, scrollable)    │
│  · CRUD buttons   │  · timestamp · member · zone · severity     │
└───────────────────┴─────────────────────────────────────────────┘
```

Main container is `flex-row`. The center column is `flex-col` with the map taking all remaining height and the log at `h-1/4`.

---

## Design Aesthetic

| Token | Value |
|---|---|
| Background | `#0B0E14` |
| Surface | `#0D1118` |
| Border | `#1A2035` |
| Accent Cyan | `#00E5FF` |
| Accent Purple | `#BB86FC` |
| Text Primary | `#E2E8F0` |
| Text Muted | `#718096` |
| Danger | `#FC8686` |
| Font (pubkeys) | `'Courier New', monospace` |
| Font (UI) | `system-ui, sans-serif` |

---

## E2EE Architecture

The server is architecturally excluded from reading coordinates. This is enforced by design, not policy.

**Key exchange (on circle join):**
1. Circle owner holds a random 32-byte AES-256 circle key generated at circle creation and stored only in `localStorage`.
2. To invite a member, owner generates a fresh ephemeral X25519 keypair and derives a key-wrapping secret: `ECDH(owner_ephemeral_privkey, member_nostr_pubkey)`.
3. Owner encrypts the circle key with this wrapping secret (AES-256-GCM) and includes the ciphertext + ephemeral pubkey in a Nostr Kind 4 DM to the invitee.
4. Recipient derives the same wrapping secret: `ECDH(member_nostr_privkey, owner_ephemeral_pubkey)`, decrypts the circle key, and stores it in `localStorage` keyed by `circle_id`.
5. All location blobs in the circle are encrypted with this single shared circle key. The server stores the circle key nowhere.

**Location publish cycle (every 30 seconds while active):**
1. Browser reads GPS: `{lat, lng, timestamp}`.
2. Encrypts with AES-256-GCM using the circle key. IV is random 12 bytes, prepended to ciphertext.
3. `POST /api/circles/:id/location` with body `{sender_pubkey, encrypted_payload}`.
4. Gateway writes to `location_blobs` table (`encrypted_payload` is opaque bytes, `expires_at = now + 10 min`).
5. Gateway broadcasts the raw blob over circle WebSocket to all subscribers.

**Location receive cycle:**
1. WebSocket message arrives with `{sender_pubkey, encrypted_payload, sent_at}`.
2. Browser decrypts with circle key → `{lat, lng, timestamp}`.
3. Redux `decryptedLocations[sender_pubkey]` updated → map node re-renders.

**Ghost mode:** Member posts a presence signal (WebSocket ping) without posting a location blob. Other clients see the chip/ring as GHOST (purple) in the sidebar. No map node is rendered for ghost members — their position is not disclosed even approximately.

**Offline:** No signal received for > 2 minutes → status flips to OFFLINE. Chip ring goes dark.

---

## Components

### `FamilyCircleDashboard.tsx`
Top-level page component. Orchestrates sidebar, map, and log. Reads from `circlesSlice`. On mount: connects circle WebSocket, starts 30-second location publish loop. On unmount: stops publishing, closes socket.

### `CircleSidebar.tsx`
Fixed `w-64` left panel. Sections in order:
1. **Circle header** — name, truncated `circle_id`.
2. **Member chips** — compact row of `MemberChip` components showing status rings.
3. **Member list** — full rows with pubkey, status label, hover actions (view on map, remove).
4. **E2EE widget** — pulsing cyan dot + two-line label (`Active X25519 Encryption` / `AES-256-GCM · server sees 0 coordinates`).
5. **Action row** — `Invite via Nostr` button (full-width), then `Manage Keys` + `Leave Circle` side by side.

### `MemberChip.tsx`
Small pill: status ring + truncated pubkey. Ring colours: ONLINE = `#00E5FF`, GHOST = `#BB86FC`, OFFLINE = `#2D3748`. Used in both the chips row and could appear in future notifications.

### `CircleMapLayer.tsx`
A Mapbox GL layer component rendered inside the existing `SafetyMap`. Receives `decryptedLocations` from Redux. Renders an animated ring node per member. ONLINE nodes have a CSS `ping` animation (expanding ring). GHOST and OFFLINE members render no map node — only a sidebar chip. Crisis zone overlays are derived from Phase 2 Community Reports with status `VERIFIED` or `AUTHORITATIVE`.

### `X25519Badge.tsx`
Absolutely positioned `bottom-12 right-12` inside the map container. Pulsing cyan dot + `X25519 ACTIVE` monospace label. Backdrop blur. Always visible while on the dashboard.

### `ProximityAlertLog.tsx`
`h-1/4` panel below map. Header shows title + event count badge. Scrollable body renders `ProximityAlert[]` from Redux in reverse-chronological order. Each entry: timestamp, icon, message (`Member [pubkey] entered [Zone] (CR-NNNN [STATUS])`), severity badge. Entries persist in Redux for the session; not stored server-side.

### `AlertBanner.tsx`
Conditional top bar (already partially exists as `AcousticAlert`). Shown when `circlesSlice.activeAlert !== null`. Cyan left-dot pulse + alert text with member pubkey and zone name. Dismiss button clears `activeAlert` but does not remove from log.

### `InviteModal.tsx`
Triggered by "Invite via Nostr" button. Generates invite payload, signs with user's Nostr key (via `nostr-tools`), displays as a copyable string + QR code. Invite expires in 24 hours.

---

## Redux State — `circlesSlice`

```typescript
interface ProximityAlert {
  id: string
  member_pubkey: string
  zone_name: string
  report_id: string | null        // Phase 2 CR reference
  severity: Severity
  triggered_at: string            // ISO timestamp
}

interface CirclesState {
  circles: Circle[]
  activeCircleId: string | null
  members: Record<string, CircleMember[]>     // circleId → members
  memberStatuses: Record<string, 'ONLINE' | 'GHOST' | 'OFFLINE'>   // pubkey → status
  decryptedLocations: Record<string, { lat: number; lng: number; ts: string }>
  proximityAlerts: ProximityAlert[]
  activeAlert: ProximityAlert | null          // drives alert banner
}
```

---

## Proximity Alert Logic (client-side only)

Runs inside a Redux middleware or a `useEffect` in `FamilyCircleDashboard` whenever `decryptedLocations` changes.

```
for each member with ONLINE status:
  location = decryptedLocations[pubkey]
  for each active safety_event OR verified community_report:
    if distance(location, event.location) <= member.alert_radius_km * 1000:
      if event.severity >= member.alert_severity:
        dispatch(addProximityAlert({...}))
        dispatch(setActiveAlert({...}))
```

Distance uses the existing `geo.ts` haversine utilities. No server call is made. The server never learns which member was near which zone.

---

## Gateway Routes

All circle routes require a valid Nostr signature in the `X-Nostr-Sig` header (same pattern as Community Reports in Phase 2).

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/circles` | Create circle. Body: `{name}`. Returns `circle_id`. |
| `GET` | `/api/circles/:id` | Get circle metadata + member list (pubkeys only). |
| `POST` | `/api/circles/:id/members` | Add member. Body: `{member_pubkey, alert_radius_km, alert_severity}`. Owner only. |
| `DELETE` | `/api/circles/:id/members/:pubkey` | Remove member. Owner or self. |
| `POST` | `/api/circles/:id/location` | Post encrypted blob. Body: `{sender_pubkey, encrypted_payload}`. |
| `GET` | `/api/circles/:id/location` | Get all non-expired blobs. Returns array of `{sender_pubkey, encrypted_payload, sent_at}`. |
| `DELETE` | `/api/circles/:id` | Delete circle. Owner only. |

**WebSocket:** Clients join a circle room by sending `{type: "join_circle", circle_id, pubkey}` after authentication. Gateway pushes `{type: "location_blob", sender_pubkey, encrypted_payload, sent_at}` on each new POST. Also pushes `{type: "presence", sender_pubkey, mode: "GHOST" | "OFFLINE"}` for ghost/offline transitions.

---

## New Database Objects

Schema already exists in `infra/postgres/init.sql`. No migrations needed for Phase 3 launch:

- `circles (circle_id, owner_pubkey, name, created_at)`
- `circle_members (circle_id, member_pubkey, alert_radius_km, alert_severity, joined_at)`
- `location_blobs (blob_id, circle_id, sender_pubkey, encrypted_payload, sent_at, expires_at)`

A scheduled cleanup deletes blobs where `expires_at < now()`. The existing APScheduler in `signal/main.py` can host this job, or a `setInterval` in the gateway.

---

## Service — `e2eeService.ts`

Thin wrapper over the Web Crypto API. No third-party crypto library.

```typescript
generateX25519Keypair(): Promise<{publicKey: Uint8Array, privateKey: Uint8Array}>
deriveCircleKey(myPrivateKey: Uint8Array, theirPublicKey: Uint8Array): Promise<CryptoKey>
encryptLocation(circleKey: CryptoKey, payload: {lat: number, lng: number, ts: string}): Promise<string>  // base64
decryptLocation(circleKey: CryptoKey, ciphertext: string): Promise<{lat: number, lng: number, ts: string}>
```

Circle keys are stored in `localStorage` keyed by `circle_id`. They are never serialised into Redux state (no key material in devtools).

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Decryption failure (wrong key / corrupted blob) | Log warning, skip member node — no crash |
| GPS permission denied | Ghost mode auto-activated; user informed via toast |
| WebSocket disconnect | Exponential backoff reconnect (same pattern as Phase 1 `websocket.ts`) |
| Invite expired | InviteModal shows error; prompt to generate new invite |
| Leave Circle confirmation | Confirm dialog required; local circle key is zeroed from `localStorage` |

---

## Testing Strategy

- **Unit:** `e2eeService.ts` encrypt/decrypt round-trip (Vitest, Web Crypto polyfill)
- **Unit:** Proximity alert logic with mocked locations and event fixtures
- **Unit:** `circlesSlice` reducers for all status transitions
- **Integration:** `POST /api/circles/:id/location` → WebSocket push → client decrypts (Vitest + Supertest + ws client)
- **Integration:** Nostr signature verification on all protected circle routes
- **E2E smoke:** Member A encrypts location → Gateway relays → Member B decrypts → node appears on map

---

## Out of Scope for Phase 3

- Multi-circle support (UI supports one active circle; data model supports many — selector to switch circles is Phase 4 backlog)
- Circle key rotation (designed for but not implemented; `Manage Keys` button is a stub)
- Server-side proximity computation (by design — server cannot decrypt)
- Push notifications for proximity alerts (browser tab must be open)
