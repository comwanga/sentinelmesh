# Strategic Simplification Review — Lightning Zaps

Date: 2026-06-03 · Independent architectural review · Evidence-based (measured against the actual tree).
Question: should the Lightning Zap subsystem be removed entirely from SentinelMesh?

## Measured footprint (what exists today)

| Area | Components | ~LOC |
|---|---|---|
| Rust — `gateway/src/lightning/` | `lnd_client.rs`, `zap_service.rs`, `receipt_retry.rs`, `invoice_expiry.rs`, `mod.rs` | 559 |
| Rust — route | `routes/zap.rs` (request + webhook) | 202 |
| Rust — wiring | `AppState.zap_limiter`, 8 `Config` fields (`zap_webhook_secret`, `lnd_*`, `nostr_private_key`, `nostr_relays`, `zap_rate_limit_per_minute`), 2 spawned workers in `main.rs`, route mount | ~80 |
| Frontend | `ZapButton.tsx`, `ZapsPage.tsx`, `store/zapsSlice.ts` (+ their tests), router/sidebar/map/settings wiring | 755 |
| Database | `lightning_zaps` table + indexes (init.sql), migrations `006_zap_hardening.sql`, `009_zap_preimage.sql` | ~51 |
| **Total directly removable** | | **~1,650 LOC** |

External operational dependencies it pulls in: a **running LND node holding real funds**, an **admin macaroon** (bearer credential to that node), a **webhook HMAC secret**, a **hot Nostr signing key in the gateway**, and **testnet→mainnet money movement**.

---

## 1. Benefits of removing Lightning Zaps

- **Removes the largest financial/security attack surface in the app.** No hot LND node, no macaroon, no payment webhook, no invoice/settlement state machine. This is the only subsystem that moves money.
- **Eliminates the gateway's hot Nostr private key.** Confirmed by inspection: `NOSTR_PRIVATE_KEY` in the gateway is used *only* to sign NIP-57 zap receipts. Remove zaps and the gateway no longer needs to hold any signing key — a clean, real security reduction. (The blockchain service keeps its own separate key for anchoring.)
- **Deletes a whole class of the audit's findings.** H-9 (settlement forgery / preimage), the `LND_TLS_SKIP_VERIFY` MITM footgun, webhook-secret management, and invoice/payment abuse vectors all disappear. The H-9 hardening I just shipped becomes unnecessary — better to delete the subsystem than maintain it.
- **Removes a perverse safety incentive.** Paying sats per report directly rewards *volume and fabrication* — exactly the Sybil/abuse problem the project has **not** yet solved (C-1). Zaps make the unsolved trust problem worse: they fund the attacker. In a safety-critical app with no Sybil resistance, monetary tips are actively counterproductive.
- **Removes regulatory/legal exposure.** Facilitating payments invites money-transmission / AML / tax questions across jurisdictions (the audit's legal section already flags GDPR/DSA load). Zaps add a financial-services dimension nobody has scoped.
- **~1,650 LOC and 2 background workers gone**, plus 8 config knobs, a DB table, and 2 migrations — less to test, deploy, monitor, and secure.

## 2. Drawbacks of removing Lightning Zaps

- **Loses the headline "Bitcoin-native" differentiator.** Zaps are the most visible Bitcoin-ecosystem feature; removing them makes the project look less novel to the Nostr/Bitcoin crowd.
- **Loses a reporter-incentive mechanism.** No built-in way to reward good reporters with money. (Reputation/tier remains as a non-monetary incentive.)
- **Sunk cost.** ~1,650 LOC of working, tested code (incl. the just-shipped H-9 fix) is discarded.
- **Reversibility cost.** Re-adding later means rebuilding LND integration and the receipt pipeline.

None of these are public-safety drawbacks. They are positioning/feature drawbacks.

## 3. Security impact — strongly positive
Removes: hot LND node + macaroon, payment webhook endpoint, HMAC secret, gateway hot Nostr key, TLS-skip footgun, and the entire invoice/settlement/abuse surface. Net: the gateway's trusted-secret inventory shrinks from {internal secret, zap webhook secret, Nostr key, LND macaroon, VAPID} to {internal secret, VAPID}. This is the single biggest attack-surface reduction available short of dropping a core feature.

## 4. Operational impact — strongly positive
No LND node to run, fund, back up, monitor, or keep in sync; no testnet→mainnet wallet ceremony; no webhook delivery/retry to operate; two fewer background workers (`receipt_retry`, `invoice_expiry`). Fewer secrets to rotate. The fail-closed secret checks I added for `ZAP_WEBHOOK_SECRET` also go away.

## 5. Maintenance impact — positive
~1,650 LOC, ~30 tests, a DB table + 2 migrations, and 8 config fields leave the maintenance surface. LND has a moving API/macaroon model; NIP-57 is still evolving. This is recurring upkeep for a non-core feature.

## 6. Adoption impact — net positive for the actual audience
- Families, NGOs, journalists, responders, communities: zaps are irrelevant to whether they trust or use a safety app. None of them adopt SentinelMesh *because* it can tip in sats.
- Bitcoin/Nostr enthusiasts: mild negative — they like zaps. But they are not the public-safety user base.
- Removing zaps also removes a **trust liability**: a safety app that pays for reports invites "is this pay-to-post?" skepticism from exactly the institutional users (NGOs/responders) whose trust matters most.

## 7. Estimated codebase simplification
~**1,650 LOC** deleted directly (761 Rust + 755 TS + ~51 SQL + ~80 wiring), **2 background workers**, **8 config fields**, **1 DB table + 2 migrations**, **1 API namespace** (`/api/zaps`), **1 frontend page + 1 component + 1 store slice**, and **~5 operational secrets/dependencies**. Roughly a **7% reduction** of total app source (~22.7k LOC), concentrated in the highest-risk area.

## 8. Components that can be deleted
**Rust:** `gateway/src/lightning/` (whole dir), `routes/zap.rs`; in `main.rs` the `receipt_retry` + `invoice_expiry` spawns and `zap_limiter`; in `config.rs` the fields `zap_webhook_secret`, `lnd_rest_url`, `lnd_macaroon_hex`, `lnd_tls_skip_verify`, `lnd_tls_cert_pem`, `nostr_private_key`, `nostr_relays`, `zap_rate_limit_per_minute` (and the Phase-0 `reject_weak_secret` call for the zap secret); the `zap::router()` mount in `routes/mod.rs`.
**Frontend:** `components/ZapButton.tsx` (+tests), `pages/ZapsPage.tsx` (+tests), `store/zapsSlice.ts` (+tests); zap wiring in `router.tsx`, `store/index.ts`, `Sidebar.tsx`, `MapFeatureStrip.tsx`, `LiveMapPage.tsx`, `SettingsPage.tsx`.
**DB:** drop `lightning_zaps` (+ indexes); retire migrations `006_zap_hardening.sql`, `009_zap_preimage.sql` (or add a `010_drop_lightning_zaps.sql`).
**Env/ops:** `ZAP_WEBHOOK_SECRET`, `LND_REST_URL`, `LND_MACAROON_HEX`, `LND_TLS_SKIP_VERIFY`, `LND_TLS_CERT_PATH`, `ZAP_RATE_LIMIT_PER_MINUTE`, and `NOSTR_PRIVATE_KEY`/`NOSTR_PRIVATE_KEY_FILE` + `NOSTR_RELAYS` *for the gateway* (confirm not reused elsewhere in gateway — inspection says zap-only); LND container/monitoring.

## 9. Components that should remain (unaffected)
Nostr identity, NIP-98 auth, community reporting, family circles, E2EE location, push, threat map, signal ingestion, acoustic detection, **Bitcoin anchoring** (separate service, separate key — independent of zaps), crypto verification, reputation/trust, safety-event workflows. Removing zaps touches none of these except deleting the now-unused gateway Nostr key plumbing.

## 10. Recommended final decision

**REMOVE Lightning Zaps entirely.**

Rationale, in priority order:
1. **It is not core to the mission.** SentinelMesh's job is to warn people about danger accurately. Tipping reporters in sats does not improve detection, verification, targeting, or trust — the things lives depend on.
2. **It actively harms the unsolved trust problem.** Monetizing reports incentivizes fabrication and volume while C-1 (Sybil resistance) is still open. You'd be paying the attacker.
3. **It is the highest-risk subsystem for the least mission value** — the only money-moving, hot-wallet, hot-key, webhook-bearing component, plus regulatory exposure.
4. **The recovered complexity maps directly onto what matters:** reinvest into Priority 1 (Sybil resistance, reputation, anti-spam — the C-1 work in flight), Priority 2 (kill plaintext location, social-graph minimization, key rotation/recovery), Priority 3 (event validation, acoustic anti-spoof, alert targeting, dispute/expiry, moderation), Priority 4 (batched Merkle anchoring, distributed rate limiting, worker leader election, push fanout, geo infra).

Reconsider Lightning only **after** the safety core is production-grade, and even then as an **optional, isolated, out-of-band** integration — never on the safety-critical request path, and never as a per-report reward while Sybil resistance is imperfect.

### Suggested execution (if approved)
One PR, stacked on the current hardening branch: delete the components in §8, add `010_drop_lightning_zaps.sql`, strip the gateway Nostr-key plumbing, update README (remove the "Lightning tips" row and the zap receipt claim), and remove the LND service from `docker-compose`. Net: ~1,650 LOC and ~5 secrets/deps gone, build + tests green. Then resume C-1.
