# NIP-98 Strict Validation Design

## Goal

Upgrade the SentinelMesh NIP-98 HTTP auth middleware from a signature-only check to a fully spec-compliant validator: requiring `u` and `method` tags, exact canonical URL and HTTP method matching, timestamp skew enforcement, and Redis-backed replay protection. All validation logic centralised in one testable function.

## Architecture

Three files change. No new files are created.

### `services/gateway/src/middleware/nostr_auth.rs`

The existing `NostrAuth` Axum extractor becomes a 5-line orchestrator. All validation logic moves into a new public async function `validate_nip98_request`. A new `AuthError` enum replaces the current inline rejection type. A `ValidatedNostrAuth` struct carries verified metadata back to the extractor and into handlers.

Internal sections (comments only, single file):
- Extractor
- Validation (`validate_nip98_request`)
- Canonical URL reconstruction
- Replay guard
- Error types and `IntoResponse` impls
- Tests

### `services/gateway/src/config.rs`

Add one optional field:

```rust
pub public_base_url: Option<String>,
```

Loaded from `PUBLIC_BASE_URL` env var. Validated at startup: must parse as an absolute URL with scheme and host. Trailing slash stripped, scheme and host lowercased. Gateway panics with a clear message if the value is present but malformed. `None` is valid — the fallback path is used instead.

### `services/gateway/src/main.rs`

Add one field to `AppState`:

```rust
pub redis: redis::aio::ConnectionManager,
```

Initialised from `config.redis_url` at startup using `ConnectionManager::new`. This type handles reconnection automatically; no retry logic is needed in the auth path. Cloned per request (cheap — shares the underlying connection).

---

## Extractor

```rust
impl<S> FromRequestParts<S> for NostrAuth
where
    S: Send + Sync,
    AppState: FromRef<S>,
{
    type Rejection = AuthError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, AuthError> {
        let state = AppState::from_ref(state);
        let event  = extract_auth_event(parts)?;
        let auth   = validate_nip98_request(parts, &state, &event).await?;
        Ok(NostrAuth { pubkey: auth.pubkey })
    }
}
```

`NostrAuth` keeps its existing shape (`pubkey: String`) for handler compatibility. `ValidatedNostrAuth` (the richer internal type) is consumed here; `event_id` and `created_at` are available for future handlers that need them by changing the extractor's return type.

---

## `ValidatedNostrAuth`

```rust
pub struct ValidatedNostrAuth {
    pub pubkey:     String,
    pub event_id:   String,
    pub created_at: i64,   // Unix timestamp from the verified event
}
```

Preserves verified metadata for audit logs, abuse tracing, replay diagnostics, and future middleware without re-parsing the event.

---

## `AuthError` variants

| Variant | HTTP status | Meaning |
|---|---|---|
| `MissingHeader` | 401 | `X-Nostr-Auth` header absent |
| `InvalidBase64` | 401 | Header value is not valid JSON |
| `InvalidEventJson` | 401 | JSON does not deserialise to a Nostr event |
| `InvalidKind` | 401 | Event kind ≠ 27235 |
| `InvalidCreatedAt` | 401 | `created_at` missing, non-integer, or unparseable |
| `TimestampExpired` | 401 | `created_at` outside ±60s of server time |
| `InvalidSignature` | 401 | Nostr event signature fails verification |
| `MissingUrlTag` | 401 | No `u` tag present |
| `DuplicateUrlTag` | 401 | More than one `u` tag present |
| `MissingMethodTag` | 401 | No `method` tag present |
| `DuplicateMethodTag` | 401 | More than one `method` tag present |
| `UrlMismatch` | 401 | `u` tag value ≠ canonical request URL |
| `MethodMismatch` | 401 | `method` tag value ≠ request HTTP method |
| `ReplayDetected` | 401 | Event ID already seen within the replay window |
| `RedisUnavailable` | 503 | Redis timeout or connection error during replay check |

`RedisUnavailable` returns 503 (not 401) because it is an infrastructure failure, not an authentication failure. Clients should retry; they should not re-sign.

All 401 responses include a JSON body `{ "code": "AUTH_<VARIANT>", "retryable": false }`. The 503 response includes `{ "code": "SERVICE_UNAVAILABLE", "retryable": true }`.

---

## `validate_nip98_request` — execution order

```rust
pub async fn validate_nip98_request(
    parts: &Parts,
    state: &AppState,
    event: &Event,
) -> Result<ValidatedNostrAuth, AuthError>
```

Steps execute in this exact order:

1. **Kind** — `event.kind != Kind::from(27235)` → `InvalidKind`
2. **Timestamp parse** — extract `event.created_at` as `i64` → `InvalidCreatedAt` if absent or non-integer
3. **Timestamp window** — `|Utc::now().timestamp() - created_at| > 60` → `TimestampExpired`
4. **Pre-verify log** — `tracing::debug!(kind = event.kind.as_u16(), "NIP-98 pre-verify")`. No pubkey, no event ID — both are attacker-controlled before step 5.
5. **Signature** — `event.verify()` → `InvalidSignature`
6. **Post-verify log** — `tracing::debug!(pubkey = %event.pubkey, event_id = %event.id, "NIP-98 signature verified")`. Safe to log now.
7. **`u` tag** — collect all `u` tags. Zero → `MissingUrlTag`. More than one → `DuplicateUrlTag`.
8. **`method` tag** — collect all `method` tags. Zero → `MissingMethodTag`. More than one → `DuplicateMethodTag`.
9. **Canonical URL** — reconstruct from request (see below). Compare with `u` tag value. Mismatch → `UrlMismatch { expected: canonical, got: u_tag }`.
10. **Method** — `method_tag.to_uppercase() != parts.method.as_str()` → `MethodMismatch { expected: parts.method, got: method_tag }`.
11. **Replay guard** — Redis `SET nip98:v1:jti:{event_id} 1 NX EX 120` with 250ms timeout. Already-set key → `ReplayDetected`. Timeout or error → `RedisUnavailable`.

All failures emit `tracing::warn!(error = %e, "NIP-98 auth rejected")` before returning. Failures at or after step 6 include `pubkey` and `event_id` in the log.

---

## Canonical URL reconstruction

Evaluated once at startup for `PUBLIC_BASE_URL` (stored as a normalised `String` on `Config`). Per-request for the fallback paths.

```
if config.public_base_url.is_some():
    canonical = config.public_base_url + parts.uri     // uri() includes path + query

else if config.trust_proxy:
    scheme = X-Forwarded-Proto header value (default: "https")
    host   = X-Forwarded-Host header ?? Host header
    canonical = "{scheme}://{host}{parts.uri}"

else:
    scheme = "https"   // TLS is terminated before the gateway in all deployments
    host   = Host header
    canonical = "{scheme}://{host}{parts.uri}"
```

**Normalisation applied to the reconstructed URL before comparison:**
- Lowercase scheme and host
- Strip `:443` suffix from `https://` URLs
- Strip `:80` suffix from `http://` URLs
- Preserve path casing, query parameters, and trailing slash exactly as received

**`PUBLIC_BASE_URL` startup validation:**
- Must parse as an absolute URL (scheme + host required)
- Trailing slash stripped
- Scheme and host lowercased
- Port normalisation applied (`:443`/`:80` stripped)
- Gateway panics on startup with a descriptive message if the value is present but fails any of these checks

---

## Redis replay guard

**Key format:** `nip98:v1:jti:{event_id}`

The `v1` namespace segment allows future cache migrations without key collisions against an existing replay store.

**Command:** `SET nip98:v1:jti:{event_id} 1 NX EX 120`

- `NX` — set only if the key does not exist. Atomic — no race between check and write.
- `EX 120` — TTL is 120 seconds, twice the 60-second validity window. An event older than 60 seconds is rejected by the timestamp check before reaching the replay guard, so no valid event can arrive after its replay-window key has expired.

**Execution:** `ConnectionManager::clone()` per request (cheap, shares the underlying multiplexed connection). Wrapped in `tokio::time::timeout(Duration::from_millis(250), ...)`.

**On timeout or connection error:** return `RedisUnavailable` → HTTP 503. The auth path fails closed. Payment routes cannot safely fail open during infrastructure degradation.

---

## Testing strategy

All tests in `nostr_auth.rs` `#[cfg(test)]` module. `validate_nip98_request` takes plain Rust arguments, so tests construct `Parts`, a mock `AppState`, and a `nostr_sdk::Event` directly — no Axum test harness required.

Tests that mutate environment variables acquire a `static Mutex<()>` before the mutation (same pattern as `config.rs` tests).

| Test | Asserts |
|---|---|
| `valid_request_passes` | Happy path returns `ValidatedNostrAuth` with correct pubkey, event_id, created_at |
| `expired_timestamp_rejected` | `created_at` set to `now - 120s` → `TimestampExpired` |
| `invalid_created_at_rejected` | Event with missing or non-integer `created_at` → `InvalidCreatedAt` |
| `invalid_kind_rejected` | Kind ≠ 27235 → `InvalidKind` |
| `missing_u_tag_rejected` | No `u` tag → `MissingUrlTag` |
| `missing_method_tag_rejected` | No `method` tag → `MissingMethodTag` |
| `duplicate_u_tag_rejected` | Two `u` tags → `DuplicateUrlTag` |
| `duplicate_method_tag_rejected` | Two `method` tags → `DuplicateMethodTag` |
| `url_mismatch_rejected` | `u` tag set to different path → `UrlMismatch` |
| `method_mismatch_rejected` | `method` tag `"GET"` on a `POST` request → `MethodMismatch` |
| `replay_attack_rejected` | Same valid event submitted twice → second call returns `ReplayDetected` |
| `cross_route_replay_rejected` | Event signed for `/api/other`, submitted to `/api/zaps/request` → `UrlMismatch` (caught before replay check) |
| `redis_unavailable_returns_503` | `ConnectionManager` pointed at bad URL → `RedisUnavailable` → response status 503 |
| `canonical_url_normalization_passes` | `HTTPS://API.EXAMPLE.COM:443/api/zaps/request?foo=bar` normalises to `https://api.example.com/api/zaps/request?foo=bar`; query param preserved; trailing-slash-free path preserved |
| `replay_ttl_expires` | Event accepted, TTL advanced past 120s via mocked time, same event accepted again |

---

## Environment variables — new and changed

| Variable | Required | Default | Notes |
|---|---|---|---|
| `PUBLIC_BASE_URL` | No | — | Canonical base for URL reconstruction. Strongly recommended for production. Example: `https://api.sentinelmesh.io` |

---

## What this does not change

- The `NostrAuth` extractor's public API (`pubkey: String`) remains unchanged — no handler updates required.
- The `POST /api/zaps/request` route registration is unchanged.
- No database migrations.
- The per-pubkey rate limiter (`zap_limiter`) continues to run after auth passes.
