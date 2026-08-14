# Chat Deferred Items Implementation Plan — Notifications, Relay Conformance, Moderation, and Rollout

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the deferred chat work left out of the gated draft PRs #86 (foundation), #87 (NIP-29 public channels), and #88 (NIP-17 encrypted DMs + Circle rooms). This plan covers the remaining delivery, notification, moderation, and operational hardening needed before chat can graduate from the `VITE_ENABLE_CHAT=false` experiment.

**Status of prior work (do not re-implement):**
- Capability signer, relay transport, NIP-17/29/59 modules, and durable chat store are done (#86).
- Public NIP-29 channels (sync, state load, pages) are done (#87).
- NIP-17 direct + Circle chat (send/inbox/pages) are done (#88).
- Content-Security-Policy hardening is done (`infra/nginx/nginx.conf`).
- Defaults remain off: `VITE_ENABLE_CHAT`, `VITE_CHAT_*`, `CHAT_PUSH_ENABLED`.

**Architecture:** The gateway stays a modular monolith that never decrypts DMs. A managed inbox relay emits HMAC-signed webhooks containing only the outer gift-wrap id, recipient `p` pubkey, kind, and relay timestamp; the gateway turns those into generic "New encrypted message" pushes. Public-channel webhooks additionally carry a public group id + event id for channel-scoped subscriptions. Delivery uses a new notification-specific outbox (it must NOT reuse the `safety_events`-foreign-keyed push outbox). Moderation is split: the NIP-29 relay is authoritative for public channels; local block/mute and an unknown-sender quarantine protect DMs.

**Tech Stack:** Rust (axum/sqlx) gateway, PostgreSQL 16 migrations, PWA (React + Redux + IndexedDB + nostr-tools), web-push, a disposable NIP-29/NIP-42 relay profile for integration tests.

---

## File Map

**Create (gateway):**
- `services/gateway/src/routes/relay_hooks.rs` — authenticated relay webhook ingestion
- `services/gateway/src/routes/chat_notifications.rs` — chat notification preferences + trigger API
- `services/gateway/src/subscribers/chat_push_worker.rs` — claims + sends generic chat pushes
- `infra/postgres/migrations-v2/011_add_chat_notifications.sql` — notification prefs, webhook receipts, chat push outbox

**Create (PWA):**
- `apps/pwa/src/services/chat/dmRelayDiscovery.ts` — kind-10050 recipient relay resolution
- `apps/pwa/src/services/chat/outbox.ts` — durable outbox enqueue/retry/ack
- `apps/pwa/src/services/chat/__tests__/outbox.test.ts`
- `apps/pwa/src/services/chat/__tests__/dmRelayDiscovery.test.ts`
- `apps/pwa/src/services/chat/moderation.ts` — block/mute/quarantine local policy
- `apps/pwa/src/services/chat/__tests__/moderation.test.ts`
- `apps/pwa/src/components/chat/ModerationMenu.tsx` — public-channel moderation actions
- `apps/pwa/src/components/chat/__tests__/ModerationMenu.test.tsx`
- `ops/relay-integration-smoke.sh` — disposable relay profile + E2E conformance

**Modify:**
- `services/gateway/src/config.rs` — add `RELAY_WEBHOOK_SECRET`, `RELAY_WEBHOOK_ALLOWED_SOURCE`, `CHAT_PUSH_ENABLED`
- `services/gateway/src/main.rs` — spawn `chat_push_worker`, mount webhook + notification routes
- `services/gateway/src/routes/mod.rs` — nest `/api/relay-hooks` and `/api/chat-notifications`
- `services/gateway/src/db/mod.rs` — bump `assert_schema_version` to 11 with full history/checksum
- `services/gateway/src/error.rs` — add webhook-auth/idempotency error variants if needed
- `infra/postgres/schema-v2.sql` — baseline note only (migrations remain the source of truth)
- `apps/pwa/src/services/signerService.ts` — promote NIP-07 to an active signer mode
- `apps/pwa/src/services/__tests__/signerService.test.ts` — NIP-07 capability tests
- `apps/pwa/src/config/features.ts` / `apps/pwa/src/config/chat.ts` — `VITE_CHAT_*` relay + notification flags
- `apps/pwa/src/hooks/useInboxSync.ts` — route wraps via outbox + quarantine policy
- `apps/pwa/src/pages/PublicChannelPage.tsx` — moderation menu wiring
- `apps/pwa/src/pages/ChatPage.tsx` / `apps/pwa/src/pages/DirectConversationPage.tsx` — block/mute/quarantine surfacing
- `apps/pwa/public/push-sw.js` — route chat notification clicks to `/chat` without participant leakage
- `apps/pwa/src/vite-env.d.ts` — new `VITE_CHAT_*` keys
- `.env.example` — document new `RELAY_WEBHOOK_*` / `CHAT_PUSH_ENABLED` / `VITE_CHAT_*`
- `tests/operations-smoke.sh`, `ops/postgres-restore-verify.sh`, `.github/workflows/ci.yml` — migration 11 assertions

---

## Task 1: Relay conformance spike and pinning

Pin a concrete relay implementation and lock the NIP surface the client assumes.

- [ ] **Step 1: Choose and pin community + inbox relay versions.** Select a NIP-29/NIP-42 relay (e.g. nostr-rs-relay or a managed provider) and record the exact version + config in `docs/operations/relay-conformance.md`. Do not ship chat against "any relay."
- [ ] **Step 2: Verify NIP-11 `self`.** Confirm the relay advertises `supported_nips` and a stable `pubkey`; the PWA already fetches it via `fetchRelayInfo`.
- [ ] **Step 3: NIP-29 state enforcement.** Confirm `39000`–`39003` are signed by the relay `self` key, `previous` references are enforced, and late publication rules exist. Reject relay output that fails `validateGroupStateEvent`.
- [ ] **Step 4: NIP-42 challenge/reconnect.** Confirm `AUTH` challenge + `22242` response and reconnect behavior match the `RelayPool` `automaticallyAuth` path.
- [ ] **Step 5: Recipient-isolated kind-1059 reads.** Prove recipient A cannot query recipient B's gift wraps; document the relay policy that enforces this.
- [ ] **Step 6: Retention + webhook capability.** Decide and record gift-wrap retention (e.g. 90 days) and community history policy, and confirm the inbox relay can emit webhooks (or that the gateway must poll). If polling is required, add a `relay_hook_poller` instead of a webhook endpoint.
- [ ] **Step 7: Document + freeze.** Write findings to `docs/operations/relay-conformance.md` and pin the tested version(s).

---

## Task 2: Gateway relay webhooks (`relay_hooks.rs`)

Accept HMAC-signed inbox notifications and deduplicate them.

- [ ] **Step 1: Migration 011.** `011_add_chat_notifications.sql`:
  - `relay_webhook_receipts (delivery_id TEXT PK, relay_event_id TEXT, recipient_pubkey TEXT, kind INTEGER, received_at, processed_at, status)` with a unique index on `relay_event_id`.
  - `chat_notification_preferences (nostr_pubkey TEXT PK, dm_enabled BOOLEAN DEFAULT true, quiet_hours JSONB, public_channels JSONB)`.
  - `chat_push_deliveries (id UUID PK, subscription_id UUID, dedupe_key TEXT UNIQUE, payload JSONB, attempts INT, next_retry_at, leased_until, status)`.
  - Update migration history checksums in `db/mod.rs` (version 11), `tests/operations-smoke.sh`, `ops/postgres-restore-verify.sh`, and `.github/workflows/ci.yml`.
- [ ] **Step 2: Config.** Add `RELAY_WEBHOOK_SECRET` (fail-closed in production), `RELAY_WEBHOOK_ALLOWED_SOURCE`, and `CHAT_PUSH_ENABLED` to `config.rs` + `.env.example`.
- [ ] **Step 3: Webhook handler.** `POST /api/relay-hooks/inbox` with:
  - HMAC signature verification (constant-time), timestamp tolerance, source allowlist.
  - Payload limited to `{ outer_event_id, recipient_p, kind, relay_ts }` — reject any payload carrying sender, content, ciphertext, or participant lists.
  - Idempotency via `relay_webhook_receipts` (unique `relay_event_id`).
  - Kind must be `1059` (gift wrap) — reject others.
- [ ] **Step 4: Webhook → push enqueue.** On a valid receipt, look up subscriptions by `recipient_pubkey` with `dm_enabled` true, enqueue a generic `{ "title": "New encrypted message" }` into `chat_push_deliveries`.
- [ ] **Step 5: Tests.** Rust tests: HMAC verify/expiry/replay, source allowlist, idempotency, non-1059 rejection, and no plaintext/participant leakage into the push payload.

---

## Task 3: Chat notifications and generic push (`chat_notifications.rs` + worker)

- [ ] **Step 1: Preferences API.** `GET`/`PUT /api/chat-notifications/preferences` under NIP-98 auth, storing `dm_enabled`, `quiet_hours`, and `public_channels` in `chat_notification_preferences`.
- [ ] **Step 2: Public-channel subscriptions.** `POST`/`DELETE /api/chat-notifications/channels` to subscribe to a public group (channel id + event id scoping).
- [ ] **Step 3: Worker.** `chat_push_worker.rs` claims `chat_push_deliveries` (lease + retries + dead-letter), fetches the push subscription, and sends via web-push. Reuse the existing VAPID plumbing but keep the outbox separate from the `safety_events`-foreign-keyed push outbox.
- [ ] **Step 4: push-sw routing.** In `public/push-sw.js`, route chat notification clicks to `/chat` (public) or `/chat` with no participant/pubkey in the URL; never embed sender/recipient/ciphertext in the notification body.
- [ ] **Step 5: Tests.** Worker claim/retry/dead-letter/duplicate-suppression tests; preference binding to NIP-98 identity; push payload never contains message content or sender.

---

## Task 4: kind-10050 recipient relay discovery + durable outbox (PWA)

- [ ] **Step 1: `dmRelayDiscovery.ts`.** Resolve a recipient's DM inbox relays from their kind-10050 event (`parseRelayUrls` already exists). Fall back to the configured `VITE_CHAT_INBOX_RELAY_URL` when the recipient has no published list; never send when neither exists (record as undelivered).
- [ ] **Step 2: `outbox.ts`.** Persist each recipient wrap in `chatStore`'s `outbox` store with `{ recipient, relays, wrap, attempts, next_retry_at, delivered }`. Publish per-recipient to that recipient's relays; mark delivered on at least one `OK`/`duplicate` ack; retry transient failures with capped exponential backoff; never retry `restricted`/malformed/unsupported without user action.
- [ ] **Step 3: Wire `useInboxSync` + send paths.** Replace ad-hoc publish in `DirectConversationPage`/`CircleChatPage` with the outbox. Show per-recipient partial-delivery state.
- [ ] **Step 4: Self-copy.** Publish the sender's self-copy to the sender's own relays; a failed self-copy warns but does not mark the whole message undelivered.
- [ ] **Step 5: Tests.** Outbox retry/ack/backoff, recipient-relay resolution fallback, partial delivery across multi-recipient rooms.

---

## Task 5: NIP-07 active signer mode (signerService)

- [ ] **Step 1: Full capability.** Promote `getNip07NostrSigner()` into an active identity mode: `initializeActiveSigner()` detects `window.nostr` and exposes `pubkey/signEvent/nip44Encrypt/nip44Decrypt`. Keep `nip07EncryptionAvailable()` as the encryption-capability gate so public NIP-29 works even without `nip44`.
- [ ] **Step 2: No-fallback.** Never fall back to the local key when the NIP-07 extension is selected; surface an "encryption unsupported" state for NIP-17 when `nip44` is absent.
- [ ] **Step 3: Circle identity.** Keep Circles on the local key (as today) — do NOT mix NIP-07 and Circle location identity.
- [ ] **Step 4: Tests.** NIP-07 capability negotiation, no-fallback, and encryption-unavailable behavior.

---

## Task 6: Moderation and abuse controls

- [ ] **Step 1: Local block/mute + quarantine (`moderation.ts`).** Unknown senders land in a request inbox (quarantine) rather than the main list; existing contacts and current Circle members bypass quarantine. Blocked senders are still minimally decrypted to identify the sender, then discarded without notification. Persist blocks/mutes locally (`chatStore` preferences); optionally sync mute list via NIP-51 kind `10000`.
- [ ] **Step 2: Public-channel moderation UI (`ModerationMenu.tsx`).** Admin/role UI derived from `39001`/`39003`; actions map to NIP-29 `9000`/`9001`/`9002`/`9005`/`9010`. Show accepted moderation history and relay rejection reasons.
- [ ] **Step 3: Abuse reporting (opt-in).** Support NIP-56 kind `1984` only with explicit user consent that discloses the signed seal/plaintext/wrapper to operators; never upload private evidence automatically.
- [ ] **Step 4: Surfaces.** Wire block/mute into `DirectConversationPage`/`ChatPage`; wire moderation menu into `PublicChannelPage`.
- [ ] **Step 5: Tests.** Quarantine bypass rules, blocked-sender suppression, moderation action mapping, consent-gated abuse report.

---

## Task 7: Operations and rollout

- [ ] **Step 1: Relay backup/restore + key recovery.** Document community + inbox relay DB backup and relay private-key recovery in `docs/operations/production-runbook.md`.
- [ ] **Step 2: Metrics.** Track accepted/rejected writes, AUTH failures, subscription counts, webhook lag, storage growth, and push dead letters.
- [ ] **Step 3: Retention.** Enforce the decided gift-wrap retention (e.g. 90 days) and community history policy at the relay; document expiry behavior for the PWA.
- [ ] **Step 4: Abuse staffing + appeals.** Define moderator roles, response targets, appeals, and legal-notice handling in the runbook.
- [ ] **Step 5: Limited feature flag rollout.** Keep `VITE_ENABLE_CHAT`/`CHAT_PUSH_ENABLED` off, then dark-launch with the flags before any public announcement; keep the privacy/protocol claims (NIP-44 has no forward secrecy / post-compromise security) in `README.md`.

---

## Task 8: Relay integration test harness

- [ ] **Step 1: `ops/relay-integration-smoke.sh`.** Spin up a disposable relay profile and assert: NIP-42 challenge/reconnect, NIP-29 create/join/post/delete/remove/pin, relay `self` signature verification, unauthorized moderation rejection, recipient A cannot query recipient B's gift wraps, offline DM delivery, relay restart + history recovery, and webhook redelivery idempotency.
- [ ] **Step 2: CI.** Add an optional `relay` job to `.github/workflows/ci.yml` (or run the smoke script in the migrations job).
- [ ] **Step 3: E2E security cases.** Tampered outer/seal/rumor layers, oversized-event DoS, cross-relay replay, malicious non-`self` relay state, and identity-reset-while-subscribed teardown.

---

## Self-Review Checklist

Spec requirement → task coverage:

| Deferred item | Task |
|---|---|
| Relay conformance + version pinning | Task 1 |
| Gateway relay webhooks (HMAC, idempotency, no-leak) | Task 2 |
| Generic encrypted-message push + preferences | Task 3 |
| kind-10050 recipient discovery + durable outbox | Task 4 |
| NIP-07 active signer mode | Task 5 |
| Block/mute/quarantine + public moderation + NIP-56 | Task 6 |
| Backup/restore, metrics, retention, rollout | Task 7 |
| Disposable relay E2E conformance tests | Task 8 |

## Product & operations decisions (resolve before "done")

- Public channel write policy: open, restricted, closed, or invite-only.
- Relay implementation + who controls the relay master key.
- Gift-wrap and public-history retention periods.
- Whether users may configure third-party inbox/community relays.
- Whether the app auto-publishes a managed inbox kind-10050 after explicit consent.
- Per-relay wrapper replication (same wrap vs per-relay wrap to reduce cross-relay event-id correlation).
- Unknown-DM request policy and anti-spam threshold.
- Abuse-evidence disclosure window and retention.
- Whether chat graduates from experimental independently of Family Circle location sharing.
- Maximum Circle chat size confirmed at ten (already enforced client-side).
