# C-1a — Sybil Resistance: Web-of-Trust Vouching (Design)

Date: 2026-06-08
Audit ref: C-1 ("Sybil resistance — a single actor can cheaply mint many identities to manipulate
community-report consensus"), FINAL-audit-report.md
Branch goal: give the consensus engine a real **personhood** signal — rooted in operator-designated
genesis trust and propagated by explicit signed vouches — so the established-voter gate can be turned
**ON**, and a swarm of free newcomer keys can no longer escalate a report to VERIFIED/AUTHORITATIVE.

This is **C-1a** (the foundational vouching layer). Coordinated-voting detection, reputation decay,
per-cluster influence caps, automated voucher penalties, and re-enabling on-chain anchoring are **C-1b**
(a separate later cycle).

## Problem

The community-report consensus already has meaningful Sybil defenses: reputation-weighted votes
(NEWCOMER=1, TRUSTED=3, VETERAN=6, SENTINEL=10), distinct-voter minimums per status step, a self-vote
ban, replay/signature binding, one-vote-per-pubkey, and an **`established_confirmations` gate**
(`require_established`) that requires VERIFIED/AUTHORITATIVE to have ≥2/≥3 distinct non-NEWCOMER
confirmers.

But minting identities is **free** (H-3 made them persistent and recoverable; it did not make them
scarce), and the gate **defaults OFF** because of a bootstrap paradox: a key only becomes "established"
(`reputation_tier ≥ TRUSTED`) by authoring a report that reaches VERIFIED — which, with the gate on,
requires established confirmers. At cold start nobody is established, so nothing reaches VERIFIED, so
nobody becomes established. With the gate off, a farm of ~7 newcomer keys (weight 1 each) can manufacture
a VERIFIED report, and the author then climbs the reputation ladder. On-chain anchoring is consequently
disabled (`ANCHORING_ENABLED=false`), explicitly tagged "reachable by 3 Sybil keys (audit H-8 / C-1)".

The missing piece is a trustworthy way to **seed and grow an established cohort** without a central
authority, KYC, or breaking anonymity — so the gate can be turned on safely.

## Goal

1. A pubkey can become **personhood-established** by being an operator **genesis root**, by **earning**
   `reputation_tier ≥ TRUSTED`, or by holding an **active vouch** from a currently-eligible voucher.
2. Vouching grants **personhood only** — it lets a real distinct person *count* toward the established-
   confirmer gate; it never confers vote weight (weight stays earned).
3. The consensus gate is turned **ON**: pure unvouched-newcomer swarms can raise score but can never
   satisfy the established-confirmer minimum, so they cannot push a report to VERIFIED/AUTHORITATIVE.
4. The vouch graph is an append-only audit trail usable by C-1b for coordinated-abuse detection.

## Non-goals (C-1b / later)

- Coordinated-voting detection (timing/geo/graph clustering), reputation decay, per-cluster influence
  caps.
- Automated voucher penalties / auto-revocation when a vouchee misbehaves (C-1a keeps revocation manual +
  the live eligibility cascade; C-1a only *retains the data* C-1b will need).
- Re-enabling on-chain anchoring — stays **off** until C-1b exists. Anchoring before a detection layer
  would let a patient attacker mint *permanent* "credible" records.
- Vouch expiry / re-attestation enforcement (a dormant `expires_at` seam is added now; nothing sets it).
- Mining the E2EE circle graph for trust (would undo C-3; vouches are explicit public edges instead).

## Trust model: personhood vs. reputation

Two strictly separate signals:

- **Reputation** (`users.reputation_tier`, unchanged): earned only via VERIFIED reports; governs vote
  **weight** via `vote_weight()`. C-1a does not change how reputation or weight is computed.
- **Personhood** (new): "is this a real distinct person eligible to participate in escalation?" A pubkey
  is **established** for the gate iff **any** of:
  - **ROOT** — it is in the operator-configured genesis-root set, or
  - **REPUTATION** — its `reputation_tier ≥ TRUSTED` (the existing earned path), or
  - **VOUCH** — it is the vouchee of ≥1 vouch that is currently **active** (see below).

A vouch confers personhood only; the vouchee's `vote_weight` stays NEWCOMER (1) until earned. Weight and
personhood never mix — a vouch can never inject voting power, only eligibility.

**Who may vouch (anti-collusion):** only **ROOT** and **REPUTATION**-established keys may issue vouches. A
key that is established *only* by VOUCH **cannot** vouch — this bounds the trust graph to depth 1 from an
earnable/operator anchor, so a single vouched Sybil cannot spawn a sub-farm.

**A vouch is "active" iff** `revoked_at IS NULL` **and** `(expires_at IS NULL OR expires_at > now())`
**and the voucher is *currently* eligible** (still a genesis root, or still `reputation_tier ≥ TRUSTED`).
Eligibility is re-checked live at read time, so if a voucher decays below TRUSTED or a root is rotated
out, every vouch they issued goes dormant automatically with no stored-state rewrite. The vouchee simply
stops being VOUCH-established until the voucher recovers or another eligible voucher vouches.

## Part A — Vouch attestation

A vouch is an explicit, opt-in, **Nostr-signed** attestation, mirroring the report/vote pattern
(`verify_nostr_event` + content binding + replay guard already in `routes/reports.rs`).

- **Binding string (domain-separated):** `sentinelmesh:vouch:v1:<vouchee_pubkey_hex>`. The signed event's
  `content` must byte-equal this; domain separation prevents a captured signature from one context being
  replayed as a vouch.
- **Issue:** `POST /api/vouches` with `{ voucher_pubkey, vouchee_pubkey, nostr_event }`. The server:
  verifies the event signature + pubkey match + freshness (≤300 s) + replay guard (Redis SET NX on the
  event id, as reports do); checks `voucher_pubkey != vouchee_pubkey`; resolves the voucher's eligibility
  + issuance basis (ROOT or EARNED) and rejects if ineligible; checks the voucher's active-vouch budget;
  then inserts the vouch row. Returns the created vouch.
- **Revoke:** `DELETE /api/vouches/:vouchee_pubkey` with a signed event binding
  `sentinelmesh:vouch-revoke:v1:<vouchee_pubkey_hex>` from the original voucher. Sets `revoked_at = now()`
  on the active row (never physically deletes). Frees a budget slot.
- Rate-limited per voucher pubkey + per IP, reusing the existing `RateLimiter` pattern.

## Part B — Schema (migration 017)

A new append-only `vouches` table, co-located with the reputation data (`users`) so the personhood
predicate can join them in one query, in the same pool that already reads `users.reputation_tier` in
`cast_vote`.

```sql
CREATE TABLE IF NOT EXISTS vouches (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    voucher_pubkey  TEXT         NOT NULL,
    vouchee_pubkey  TEXT         NOT NULL,
    issuance_basis  TEXT         NOT NULL CHECK (issuance_basis IN ('ROOT', 'EARNED')),
    nostr_event_id  TEXT         NOT NULL,            -- audit + replay correlation
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    revoked_at      TIMESTAMPTZ,                       -- soft delete; NULL = active
    expires_at      TIMESTAMPTZ                        -- DORMANT seam (always NULL in C-1a)
);

-- At most ONE active edge per (voucher, vouchee); unlimited historical (revoked) rows.
CREATE UNIQUE INDEX IF NOT EXISTS vouches_active_unique
    ON vouches (voucher_pubkey, vouchee_pubkey) WHERE revoked_at IS NULL;

-- Personhood lookup: who vouches for this vouchee (active rows)?
CREATE INDEX IF NOT EXISTS vouches_vouchee_active_idx
    ON vouches (vouchee_pubkey) WHERE revoked_at IS NULL;

-- Budget lookup: how many active vouches does this voucher hold?
CREATE INDEX IF NOT EXISTS vouches_voucher_active_idx
    ON vouches (voucher_pubkey) WHERE revoked_at IS NULL;
```

- Rows are **append-only**: revocation sets `revoked_at`; rows are never physically deleted, preserving a
  full audit trail for C-1b.
- `issuance_basis` records whether the voucher was a genesis ROOT or EARNED-established **at issuance**
  (`EARNED` is the voucher-side label for the reputation-based path that Part C calls the `REPUTATION`
  personhood source — same concept, named from the voucher's perspective). It is informational/audit.
  (Active-vouch validity always re-checks *current* eligibility — see Part C — so a stale basis never
  grants personhood on its own.)
- `expires_at` is a dormant forward seam: present in the schema and honored by the active-vouch predicate
  (`expires_at IS NULL OR expires_at > now()`), but nothing in C-1a ever sets it. Future re-attestation
  activates by simply beginning to set it — no migration, no predicate change.

**Genesis roots:** an operator-configured list of pubkeys, `VOUCH_GENESIS_ROOTS` (comma-separated hex),
parsed into `config.vouch_genesis_roots: Vec<String>` (rotatable like `trust_proxy`). Not user KYC — it
designates the trust anchors, like PGP web-of-trust roots. Empty by default (dev); operators seed it
before enabling the gate in production.

## Part C — Personhood predicate

A single resolver computes, for a pubkey, whether it is established and *why*:

```
PersonhoodSource = ROOT | REPUTATION | VOUCH | MULTIPLE | NONE
```

- **ROOT** if the pubkey is in `config.vouch_genesis_roots`.
- **REPUTATION** if `users.reputation_tier` is one of TRUSTED / VETERAN / SENTINEL.
- **VOUCH** if there exists an **active** vouch for it: a row with `vouchee_pubkey = $1`,
  `revoked_at IS NULL`, `(expires_at IS NULL OR expires_at > now())`, **and** the `voucher_pubkey` is
  *currently* eligible — i.e. the voucher is itself a current genesis root **or** has
  `reputation_tier ≥ TRUSTED`. (The voucher's eligibility is re-derived live; the stored `issuance_basis`
  is not trusted for this.)
- If more than one source applies → **MULTIPLE**; if none → **NONE**.

`is_established(pubkey)` returns true for any source other than NONE. The `personhood_source` enum is
**computed, not stored** (it changes as tiers/vouches/roots change); it is returned by the resolver and
logged for debugging/analytics and for C-1b. No user-facing behavior depends on which source qualified.

**Eligible-to-vouch** is a narrower predicate: ROOT or REPUTATION only (never VOUCH).

## Part D — Consensus gate integration

- `cast_vote` currently computes `established_confirmations` as `COUNT(DISTINCT voter)` where
  `reputation_tier <> 'NEWCOMER'`. C-1a redefines it to count distinct CONFIRM voters who are
  **personhood-established** (ROOT ∨ REPUTATION ∨ active VOUCH) — a superset that now includes vouched
  real-people who have not yet earned reputation. The query joins `users` + `vouches` + the configured
  roots (roots passed in from config, or matched in SQL via an array bind).
- The gate is turned **ON**: `consensus_require_established` defaults to **true**
  (`CONSENSUS_REQUIRE_ESTABLISHED` env still overrides). `compute_new_status` is unchanged — it already
  takes `established_confirmations` + `require_established`; only the *input* count and the default flag
  change.
- Vote **weight** and `vote_weight()` are untouched. A vouched newcomer contributes weight 1 but now
  counts toward the established-confirmer minimum.

Net effect: a report still needs both enough weighted score AND enough **distinct established
confirmers**. An unvouched-newcomer-only swarm satisfies neither the weight economics nor the established
gate, so it cannot reach VERIFIED/AUTHORITATIVE.

## Part E — Budget, revocation, eligibility cascade

- **Active-vouch budget:** a voucher may hold at most `VOUCH_BUDGET` active (non-revoked) vouches
  (`config.vouch_budget`, default 5). `POST /api/vouches` rejects with 409 when the budget is full;
  revoking frees a slot. (A single flat budget in C-1a; per-root higher budgets are a trivial future
  config addition, not built now.)
- **Revocation:** voucher-signed `DELETE /api/vouches/:vouchee` sets `revoked_at`; personhood from that
  vouch stops immediately. Append-only — the row remains for audit.
- **Eligibility cascade:** because the active-vouch predicate re-checks voucher eligibility live, losing
  eligibility (tier decay, root rotation) needs no stored-state rewrite — affected vouchees simply stop
  being VOUCH-established at read time. Always consistent.
- **Skin-in-the-game (data only in C-1a):** the append-only edge + `issuance_basis` + the existing
  reputation tables (`users.accurate_reports`, REJECTED reports) already retain everything C-1b needs to
  compute voucher-responsibility metrics (which vouchees a voucher backed, how those vouchees performed,
  revocation history). C-1a builds **no** metrics table or penalty pipeline — that is C-1b's to shape.

## Part F — PWA surface (minimal)

- A `vouchBindingContent(voucheePubkey)` / `vouchRevokeBindingContent(voucheePubkey)` helper in
  `nostrService` (mirrors `reportBindingContent`/`voteBindingContent`), and a small `vouchService` that
  signs the binding and calls `POST`/`DELETE /api/vouches`.
- A minimal UI affordance to vouch for / revoke a pubkey (e.g. in Settings or a circle member view):
  paste/scan a npub or pick a circle member, confirm, sign, submit; show success/error. The UI **may
  suggest** circle members to vouch but the vouch is an explicit, separate public act — it does not read
  or expose the E2EE circle graph to the server.
- Keep this surface small; the substance of C-1a is server-side trust.

## Part G — Privacy

- A vouch edge (voucher↔vouchee) is **public** and **opt-in** — the single piece of social information
  the voucher deliberately chooses to disclose. It is the intended minimal exposure for Sybil resistance.
- It is **independent of the E2EE circle graph**: C-3 tokenization is untouched; the server never learns
  circle membership from vouches.
- Personhood/reputation reads stay within the existing access-controlled reputation surface. The spec
  documents the new public-edge exposure so it is a conscious, reviewed trade-off.

## Part H — Error handling

- Ineligible voucher (NONE or VOUCH-only) → 403.
- Over budget → 409. Duplicate active vouch (same voucher→vouchee) → 409 (the partial unique index).
- Self-vouch (`voucher == vouchee`) → 400.
- Bad signature / pubkey mismatch / wrong binding / stale / replayed event → 400 (same guards as
  reports/votes; replay via Redis SET NX, fail-closed if Redis is down).
- Revoke of a non-existent / already-revoked / not-yours vouch → 404 (no-op on already-revoked).

## Part I — Testing

Rust (gateway), pure unit tests where possible plus handler/integration where a DB is involved:

- **Personhood predicate:** ROOT-only, REPUTATION-only, VOUCH-only, and MULTIPLE classify correctly;
  NONE for an unknown newcomer; a VOUCH from a voucher who is **not currently eligible** does NOT confer
  personhood (live cascade); a revoked vouch does not confer; the dormant `expires_at` clause excludes a
  (hypothetically) past-dated row.
- **Eligible-to-vouch:** ROOT and REPUTATION can vouch; a VOUCH-only key cannot (403).
- **Budget:** issuing up to `VOUCH_BUDGET` succeeds, the next is 409; revoking frees a slot; the partial
  unique index blocks a duplicate active edge while allowing a revoke-then-re-vouch.
- **Binding strings:** `sentinelmesh:vouch:v1:<pk>` and the revoke binding are exact and domain-separated.
- **`established_confirmations` redefinition:** a cohort of vouched newcomers counts as established
  confirmers; an unvouched-newcomer cohort does not.
- **Consensus (existing `compute_new_status` tests stay green):** with the gate ON by default, a vouched
  cohort can reach VERIFIED/AUTHORITATIVE while an unvouched-newcomer cohort cannot. Add cases asserting
  the new default flips the gate on.
- **Config:** `VOUCH_GENESIS_ROOTS` parses a comma-separated list; empty default; `VOUCH_BUDGET` default;
  `CONSENSUS_REQUIRE_ESTABLISHED` now defaults true and is still overridable.

## Part J — Rollout / config

- New config: `VOUCH_GENESIS_ROOTS` (comma-separated hex pubkeys, default empty), `VOUCH_BUDGET`
  (default 5). Changed default: `CONSENSUS_REQUIRE_ESTABLISHED` now **true**.
- Migration 017 adds `vouches` + indexes (fresh-DB apply verified in CI as a non-superuser role, per the
  established migration-parity check).
- **Operator runbook:** seed `VOUCH_GENESIS_ROOTS` with the pilot organizers' pubkeys *before* deploy.
  With the gate on and roots seeded, organizers vouch for known community members, who become established
  confirmers immediately; earned promotion then grows the cohort organically. If roots are left empty in
  production with the gate on, escalation to VERIFIED stalls until an earned-established cohort exists —
  documented so operators don't enable the gate without seeding roots.
- On-chain anchoring remains disabled (`ANCHORING_ENABLED=false`) until C-1b.

## Data retained for C-1b (no C-1a structure)

C-1b's detection/penalty work will need historical inputs; C-1a already preserves them without any
dedicated table: the append-only `vouches` graph (voucher, vouchee, basis, created/revoked timestamps),
plus the existing reputation tables (`users.accurate_reports`, report statuses incl. REJECTED, votes).
C-1b can compute voucher-responsibility metrics and coordinated-voting clusters from this substrate.
