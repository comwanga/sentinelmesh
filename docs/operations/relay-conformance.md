# Relay Conformance and Pinning

Chat (NIP-29 public channels + NIP-17/NIP-59 encrypted DMs and Circle rooms) must
never be enabled against "any relay". Pin concrete relay versions and verify the
NIP surface below before turning on `VITE_ENABLE_CHAT` or `CHAT_PUSH_ENABLED`.

## Pinned relays

Record the exact image/version, configuration, and database for each relay. Keep
the community and inbox relays on separate databases and separate signing keys.

| Role | Suggested URL | NIPs required | Retention |
|---|---|---|---|
| Community (NIP-29) | `wss://<domain>/relay/community` | 1, 11, 42, 9 | public history, retained unless moderated |
| Inbox (gift wraps) | `wss://<domain>/relay/inbox` | 1, 11, 42 | 1059, 10050, 10002, 10009 | 90 days |

## Conformance checklist

- [ ] NIP-11 `supported_nips` advertises every required NIP and a stable `pubkey`.
- [ ] NIP-29 `39000`–`39003` state events are signed by the relay `self` key.
- [ ] NIP-29 `previous` references are enforced; late publication policy is documented.
- [ ] NIP-42 `AUTH` challenge + kind-22242 response and reconnect behave as the PWA expects.
- [ ] Kind-1059 reads are recipient-isolated: A cannot query B's gift wraps.
- [ ] Signed-event verification and maximum event/subscription sizes are enforced.
- [ ] `OK`, `NOTICE`, `CLOSED`, `auth-required:`, `restricted:` responses are standard.
- [ ] Webhook emission (or gateway polling) is confirmed; webhooks are HMAC-signed.
- [ ] Backup/restore and relay private-key recovery are drilled.
- [ ] Accepted/rejected writes, AUTH failures, subscription counts, webhook lag, and
      storage growth are monitored.

## Webhook contract

The inbox relay POSTs `{ outer_event_id, recipient_p, kind }` (kind `1059`) with:

- `X-Relay-Signature: sha256=<hmac-sha256-hex(RELAY_WEBHOOK_SECRET, raw_body)>`
- `X-Relay-Delivery: <unique delivery id>`
- `X-Relay-Timestamp: <unix seconds>`
- `X-Relay-Source: <value>` (optional, must equal `RELAY_WEBHOOK_ALLOWED_SOURCE`)

The gateway never receives sender pubkeys, participant lists, ciphertext, or
message content from the relay.

## Never do

- Never log event content, decrypted material, NIP-44 payloads, or participant sets.
- Never put the community relay key on the inbox relay host or vice versa.
- Never enable `CHAT_PUSH_ENABLED` before the VAPID configuration is verified.
