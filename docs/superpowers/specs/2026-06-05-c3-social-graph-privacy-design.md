# C-3 — Social Graph Privacy (Design)

Date: 2026-06-05
Audit ref: C-3 ("Full social graph stored in plaintext") + H-1 ("`recipient_pubkey_hash`
provides no anonymity"), FINAL-audit-report.md
Branch goal: close the C-3 / H-1 findings for the **family-circles subsystem** only. No key-rotation
work (H-2/H-3 — primitives already exist), no fresh-device circle discovery (H-3), no operator-blind
membership. Forward-compatible with a later unified privacy/identity model.

## Problem

`circles` (`owner_pubkey`, `name`) and `circle_members` (`member_pubkey`, `display_name`) store the
family social graph in plaintext, tied to stable Nostr pubkeys. `location_blobs.recipient_pubkey_hash`
is `SHA256(pubkey)` — reversible by precomputation (H-1). A DB dump (or read access to the public
API) therefore reveals **who is connected to whom**: household composition, activist/journalist
networks, neighborhood and volunteer groups, plus — via `location_blobs` (`recipient_pubkey_hash`,
`sender_ephemeral_pubkey`, `circle_id`, timing) — the location-sharing communication graph.

The server must still **authorize** every circle operation by matching the NIP-98-authenticated
requester to circle membership, so membership cannot simply be deleted; it must be stored in a form
the server can match but a breach cannot mine into a graph.

## Threat model (chosen)

Defend against **DB-at-rest compromise and API leakage** — a stolen dump or read-only DB/API access
**without the application secret**. The live operator (who holds the secret) is *not* defended
against for the social graph; that would require private-set-intersection / anonymous credentials /
ZK membership, which is the wrong complexity for this phase. This is the same line C-2 drew.

## Goals

1. Replace every stored circle identifier (`owner_pubkey`, `member_pubkey`,
   `recipient_pubkey_hash`) with a **per-circle keyed token** that a secret-less breach can neither
   reverse to a pubkey nor link across circles.
2. Remove the server-side `user → circles` index entirely (client-driven listing), so a breach
   cannot enumerate a person's circles at all.
3. Encrypt the circle **name** under the circle key so a breach cannot read circle labels.
4. Drop the vestigial `display_name`.
5. Keep all authorization, blob routing, and behaviour working.

## Non-goals (explicitly deferred)

- Key rotation on member removal (H-2/H-3 — `rotateCircleKey` already exists client-side).
- Fresh-device circle discovery / recovery (H-3) — a direct consequence of removing the
  `user → circles` index.
- Operator-blind membership (PSI/anonymous credentials/ZK).
- `safety_events` / `community_reports` (C-2, done).

## Part A — The token primitive

A dedicated secret **`CIRCLE_TOKEN_SECRET`**, separate from `INTERNAL_SERVICE_SECRET` (different
cryptographic purpose, rotation lifecycle, and blast radius — a leak of one must not compromise the
other). Resolved like the existing secrets: required and non-default in production (fail closed),
with a clearly-labelled insecure dev fallback in non-production.

> **Stability constraint:** `CIRCLE_TOKEN_SECRET` is long-lived. Rotating it invalidates every
> stored token (all HMAC outputs change) and requires a re-tokenization migration. It must not be
> rotated casually. This is documented at the config site.

The token for a (circle, pubkey) pair is **version-tagged**:

```
circle_token(secret, circle_id, pubkey) = "v1:" || lowerhex(HMAC_SHA256(secret, circle_id_bytes || pubkey_bytes))
```

- The `v1:` prefix lives *inside* the stored string — no separate version column. A future `v2`
  (e.g. BLAKE3, HKDF-derived per-circle subkeys, or a rotated secret) coexists row-by-row; migration
  is "recompute rows whose token does not start with the current prefix". Matching is exact-string,
  so indexes are unaffected.
- `circle_id` is included so the **same pubkey yields a different token in every circle** — a breach
  cannot link a person across circles. (`circle_id` is the canonical lowercase UUID string;
  `pubkey` is the lowercase hex Nostr pubkey — both are byte-fed exactly as received so the gateway
  and any re-tokenization agree.)

Implemented once in a `circles::token` module in the gateway (`hmac` + `sha2` crates), pure and
unit-tested. **No token is ever computed in SQL** (no secret in migrations, no `pgcrypto`
dependency).

## Part B — Schema (migration 013 add; migration 014 deferred drop)

`013_circle_tokenization.sql`:
- `circles`: ADD `owner_token TEXT`, `name_ciphertext TEXT`, `name_version SMALLINT NOT NULL DEFAULT
  0`. (Keep `owner_pubkey`, `name` for now.)
  - `name_version`: `0` = legacy plaintext still in `name`; `1` = AES-GCM(circle key) in
    `name_ciphertext`. Doubles as the name-encryption scheme version and disambiguates
    not-yet-migrated / intentionally-blank / new-circle.
- `circle_members`: ADD `member_token TEXT`, `member_label_ciphertext TEXT` (AES-GCM under the
  circle key — typically `{pubkey, name}` — supplied by the owner at add-time so clients can render
  the roster and keep pubkey-keyed presence/status working after decrypting). (Keep `member_pubkey`;
  DROP the never-written `display_name` immediately — it is vestigial, never read or written.) Add
  `UNIQUE (circle_id, member_token)` (the new analogue of `UNIQUE(circle_id, member_pubkey)`).
- `location_blobs`: ADD `recipient_token TEXT`. (Keep `recipient_pubkey_hash` for now.)
- Indexes: `circle_members (circle_id, member_token)`; `location_blobs (circle_id, recipient_token,
  expires_at)` (mirrors the existing recipient/expiry index).

`014_circle_drop_plaintext.sql` (applied after the gateway backfill is confirmed; collapses into one
step on a fresh deploy with no rows): DROP `circles.owner_pubkey`, `circles.name`,
`circle_members.member_pubkey`, `location_blobs.recipient_pubkey_hash`, and the old plaintext
indexes/uniques. Circles still at `name_version = 0` at 014 lose the server-stored plaintext name
(owner re-enters it) — acceptable, and `name_version` makes that state explicit.

## Part C — Gateway

### `circles::token` module
`circle_token(secret: &str, circle_id: Uuid, pubkey: &str) -> String` as in Part A. Unit tests:
determinism; the `v1:` prefix; **per-circle divergence** (same pubkey → different token for two
circle_ids); distinct pubkeys → distinct tokens.

### Endpoint changes (`routes/circles.rs`, `routes/location_blobs.rs`)
All circle-scoped endpoints already carry a `circle_id` (path) and an authenticated `auth.pubkey`,
so each recomputes the token and matches/inserts by it. No endpoint stores or returns a raw pubkey.
- `create_circle`: generate the circle UUID app-side, compute `owner_token`, store it +
  client-supplied `name_ciphertext` with `name_version = 1`.
- `add_member`: body carries the raw `member_pubkey` (server tokenizes it, never stores it) plus the
  owner-supplied `member_label_ciphertext`. Compute `member_token` from `(circle_id, member_pubkey)`;
  upsert by `(circle_id, member_token)` storing the token + label ciphertext.
- `remove_member` (`/:id/members/:pubkey`): compute the member's token from the path pubkey; delete
  by token. The `MEMBER_REMOVED` WS payload stops echoing a raw pubkey (emits the token; clients
  match it against the membership rows they already hold, or it is omitted).
- `get_circle` / `is_circle_member`: authorize by `owner_token` OR `member_token` match for
  `auth.pubkey`; return member rows as `member_token` + `member_label_ciphertext` (no pubkeys) so the
  client decrypts labels to render the roster.
- `push_blob`: authorize the sender via membership token; compute `recipient_token` from the
  request's **raw recipient pubkey** (transient — the operator already knows circle members; only
  the non-reversible token is stored) and store it.
- `list_blobs`: filter by `recipient_token = circle_token(secret, circle_id, auth.pubkey)` (replaces
  the server-side `SHA256(auth.pubkey)`), fixing H-1.

### Startup backfill
One-shot, idempotent (C-2 pattern): for legacy rows whose token column is null, compute the token
from the still-present plaintext pubkey + secret and `UPDATE`. No-op on a fresh DB. Runs against the
main pool. (Name ciphertext is **not** backfilled here — the server has no circle key; names migrate
client-side, Part E.)

## Part D — `list_circles` becomes client-driven

`GET /circles?ids=c1,c2,c3`: for each supplied id the server checks `owner_token`/`member_token`
membership for `auth.pubkey` and returns metadata (`id`, `name_ciphertext`, `name_version`,
`created_at`) only for circles the caller belongs to. Unknown/non-member ids are silently omitted
(no existence oracle). There is **no** server-side `user → circles` index — a breach cannot
enumerate a person's circles. The PWA tracks its own circle ids locally (it created/joined them);
fresh-device discovery is deferred to H-3.

## Part E — Client-side encryption (name + roster) and lazy migration

Both the circle **name** and each member **label** are encrypted under the circle key (AES-GCM, via
the existing `encryptLocation`-style helper). The server only ever stores ciphertext for these; it
never holds the circle key.

- `create_circle` accepts `name_ciphertext` and stores `name_version = 1`.
- `add_member` accepts `member_label_ciphertext` (the owner encrypts `{pubkey, name}` with the
  circle key) alongside the raw pubkey it tokenizes.
- `get_circle` / listing return `name_ciphertext` + `name_version` and, per member, `member_token` +
  `member_label_ciphertext`; members decrypt locally once they hold the circle key (distributed via
  the existing `wrapCircleKey`). Decrypting a label yields the member's pubkey, so pubkey-keyed
  presence/status (`memberStatuses`) keeps working entirely client-side.
- **Lazy migration:** when an owner's client loads a circle still at `name_version = 0`, it reads the
  legacy plaintext `name` (and, for legacy members it still knows locally, their identities),
  encrypts them, and `PUT`s `name_ciphertext` + any `member_label_ciphertext`s via a new
  `PUT /circles/:id/encryption` endpoint, which sets `name_version = 1` and clears the legacy `name`.
  This never exposes the circle key to the server. Migration 014's plaintext-column drop is deferred
  until this has had time to converge; members whose label the owner cannot reconstruct surface as
  "unknown" until re-added (acceptable, and rare on a prototype).

## Part F — Shared types / PWA

- `sentinel_core::{Circle, CircleMember, LocationBlob}`: drop raw-pubkey fields; `Circle` gains
  `name_ciphertext` + `name_version`; `CircleMember` gains `member_token` + `member_label_ciphertext`
  (no `member_pubkey`/`display_name`); `LocationBlob.recipient_pubkey_hash` → `recipient_token`.
- TS `Circle`/`CircleMember`/`LocationBlob`: mirror the above.
- PWA: send `name_ciphertext` on create and `member_label_ciphertext` on add-member; send the **raw
  recipient pubkey** on blob push; call listing with `ids`; decrypt names + labels to render the
  roster (and recover member pubkeys for presence/status); run the lazy name/label migration; stop
  reading raw pubkeys from circle/member responses.

## Part G — Testing

- **Unit (Rust):** `circle_token` determinism, `v1:` prefix, per-circle divergence, distinct-pubkey
  distinctness.
- **Invariant (Rust):** no `circles`/`location_blobs` route serialises a raw pubkey; the structs
  carry no pubkey fields (compile-time guard).
- **Migration (compose Postgres):** 013 adds columns; backfill (simulated by computing a token for a
  seeded legacy row) populates tokens; `(circle_id, member_token)` is unique; recipient filtering by
  token returns the right blob; 014 drops the plaintext columns.
- **PWA (vitest/tsc):** name + member-label encrypt/decrypt round-trip; roster rendered from
  decrypted labels; pubkey recovered from a label for presence; `ids`-driven listing;
  raw-recipient-pubkey push; `tsc --noEmit` clean.

## Rollout / compatibility

- Adds `CIRCLE_TOKEN_SECRET` (fail-closed prod, dev fallback). Stable — see Part A.
- Two-migration rollout (013 add + gateway backfill, then deferred 014 drop) so legacy rows are
  tokenized before plaintext is removed; collapses to effectively one step on a fresh deploy.
- The circles/blobs API response shapes change (raw pubkeys removed; `name_ciphertext`/`name_version`
  added; listing takes `ids`) — a deliberate, breaking privacy change; the PWA ships in the same
  branch.
- Forward-compatible seams: the `v1:` token version (algorithm/secret evolution without a schema
  change), `name_version` (name-encryption evolution), and the absent `user → circles` index (the
  template a future capability/recovery model builds on).
