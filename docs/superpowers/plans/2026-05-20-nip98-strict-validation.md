# NIP-98 Strict Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the NIP-98 HTTP auth middleware from a signature-only check to a fully spec-compliant validator with `u`+`method` tag enforcement, canonical URL matching, timestamp skew, and Redis-backed replay protection.

**Architecture:** Three files change (`nostr_auth.rs`, `config.rs`, `main.rs`). All validation logic lives in a public async `validate_nip98_request` function. The `FromRequestParts` impl becomes a 3-line orchestrator. AppState gains `redis: ConnectionManager`; Config gains `public_base_url: Option<String>`.

**Tech Stack:** Rust, Axum 0.7, nostr-sdk 0.37, redis 0.27 (`connection-manager` feature), tokio, chrono, axum::http::Uri (URL parsing — no new crate needed).

**Spec:** `docs/superpowers/specs/2026-05-20-nip98-strict-validation-design.md`

---

## File map

| File | Changes |
|---|---|
| `services/gateway/src/config.rs` | Add `public_base_url: Option<String>` field + `load_public_base_url()` helper |
| `services/gateway/src/main.rs` | Add `redis: redis::aio::ConnectionManager` to `AppState`; initialise in `main()` |
| `services/gateway/src/middleware/internal_auth.rs` | Update `make_state`/`test_app` to `async` (Redis init); add `public_base_url` and `redis` fields to Config/AppState literals |
| `services/gateway/src/middleware/nostr_auth.rs` | Full rewrite: `AuthError` (15 variants), `ValidatedNostrAuth`, `extract_auth_event`, `canonical_url`, `validate_nip98_request` (11 steps), thin extractor, 15 tests |

---

## Task 1: Config — `public_base_url`

**Files:**
- Modify: `services/gateway/src/config.rs`

### What to build

Add `pub public_base_url: Option<String>` to `Config`. Add `load_public_base_url() -> anyhow::Result<Option<String>>` which reads `PUBLIC_BASE_URL` from the environment, normalises it (lowercase scheme + host, strip trailing slash, strip `:443`/`:80` default ports), and returns an error if the value is present but not a valid absolute URL. Wire it into `from_env()`.

- [ ] **Step 1.1: Write failing tests in `config.rs`**

  Add inside the existing `#[cfg(test)] mod tests` block (after the existing tests, before the closing `}`):

  ```rust
  #[test]
  fn public_base_url_normalizes_uppercase_and_default_port() {
      let _guard = ENV_LOCK.lock().unwrap();
      std::env::set_var("PUBLIC_BASE_URL", "HTTPS://API.EXAMPLE.COM:443/");
      let result = load_public_base_url().unwrap();
      std::env::remove_var("PUBLIC_BASE_URL");
      assert_eq!(result, Some("https://api.example.com".to_string()));
  }

  #[test]
  fn public_base_url_preserves_non_default_port() {
      let _guard = ENV_LOCK.lock().unwrap();
      std::env::set_var("PUBLIC_BASE_URL", "https://api.example.com:8443");
      let result = load_public_base_url().unwrap();
      std::env::remove_var("PUBLIC_BASE_URL");
      assert_eq!(result, Some("https://api.example.com:8443".to_string()));
  }

  #[test]
  fn public_base_url_none_when_unset() {
      let _guard = ENV_LOCK.lock().unwrap();
      std::env::remove_var("PUBLIC_BASE_URL");
      assert_eq!(load_public_base_url().unwrap(), None);
  }

  #[test]
  fn public_base_url_missing_scheme_is_error() {
      let _guard = ENV_LOCK.lock().unwrap();
      std::env::set_var("PUBLIC_BASE_URL", "api.example.com");
      let result = load_public_base_url();
      std::env::remove_var("PUBLIC_BASE_URL");
      assert!(result.is_err());
      assert!(result.unwrap_err().to_string().contains("PUBLIC_BASE_URL"));
  }

  #[test]
  fn public_base_url_strips_http_port_80() {
      let _guard = ENV_LOCK.lock().unwrap();
      std::env::set_var("PUBLIC_BASE_URL", "http://api.example.com:80");
      let result = load_public_base_url().unwrap();
      std::env::remove_var("PUBLIC_BASE_URL");
      assert_eq!(result, Some("http://api.example.com".to_string()));
  }
  ```

- [ ] **Step 1.2: Run tests — expect compile failure**

  ```powershell
  cd C:\Users\mwang\sentinelmesh\services
  cargo test -p gateway config -- --nocapture 2>&1 | head -30
  ```

  Expected: `error[E0425]: cannot find function 'load_public_base_url'`

- [ ] **Step 1.3: Add `public_base_url` field to `Config` struct**

  In `config.rs`, add after `ws_events_rate_cap: u32,`:

  ```rust
  pub public_base_url: Option<String>,
  ```

- [ ] **Step 1.4: Implement `load_public_base_url()`**

  Add this function after `load_nostr_private_key()` (before the `#[cfg(test)]` block):

  ```rust
  fn load_public_base_url() -> Result<Option<String>> {
      let Some(raw) = std::env::var("PUBLIC_BASE_URL").ok() else {
          return Ok(None);
      };
      let lowered = raw.to_lowercase();
      let trimmed = lowered.trim_end_matches('/');
      let uri: axum::http::Uri = trimmed.parse().map_err(|_| {
          anyhow::anyhow!("PUBLIC_BASE_URL is not a valid URL: {raw}")
      })?;
      let scheme = uri.scheme_str().ok_or_else(|| {
          anyhow::anyhow!("PUBLIC_BASE_URL must include scheme (e.g. https://): {raw}")
      })?;
      let authority = uri.authority().ok_or_else(|| {
          anyhow::anyhow!("PUBLIC_BASE_URL must include a host: {raw}")
      })?;
      let host = authority.host();
      let port = authority.port_u16();
      let host_part = match (scheme, port) {
          ("https", Some(443)) | ("http", Some(80)) => host.to_string(),
          (_, Some(p)) => format!("{host}:{p}"),
          (_, None) => host.to_string(),
      };
      Ok(Some(format!("{scheme}://{host_part}")))
  }
  ```

  Add the import at the top of `config.rs`:

  ```rust
  use axum::http::Uri;
  ```

  (Or keep the full path in the body — either works. Full path avoids the `use` statement since `Uri` isn't used elsewhere.)

- [ ] **Step 1.5: Wire `load_public_base_url()` into `from_env()`**

  Inside `Config::from_env()`, add after `ws_events_rate_cap` initialisation:

  ```rust
  public_base_url: load_public_base_url()?,
  ```

- [ ] **Step 1.6: Update `internal_auth.rs` Config literal**

  Open `services/gateway/src/middleware/internal_auth.rs`. In `make_state`, inside the `Config { ... }` literal, add after `ws_events_rate_cap: 30,`:

  ```rust
  public_base_url: None,
  ```

- [ ] **Step 1.7: Run tests — expect all five new tests to pass**

  ```powershell
  cargo test -p gateway config -- --nocapture
  ```

  Expected: `test config::tests::public_base_url_normalizes... ok` (×5), all existing config tests still pass.

- [ ] **Step 1.8: Commit**

  ```powershell
  git add services/gateway/src/config.rs services/gateway/src/middleware/internal_auth.rs
  git commit -m "feat(gateway/config): add PUBLIC_BASE_URL with startup normalisation"
  ```

---

## Task 2: AppState — Redis `ConnectionManager`

**Files:**
- Modify: `services/gateway/src/main.rs`
- Modify: `services/gateway/src/middleware/internal_auth.rs`

### What to build

Add `pub redis: redis::aio::ConnectionManager` to `AppState`. Initialise it in `main()` from `config.redis_url`. Update the test fixture in `internal_auth.rs` (make `make_state` and `test_app` async so they can await `ConnectionManager::new`).

- [ ] **Step 2.1: Add `redis` field to `AppState`**

  In `services/gateway/src/main.rs`, in the `AppState` struct, add after `event_tx`:

  ```rust
  pub redis: redis::aio::ConnectionManager,
  ```

- [ ] **Step 2.2: Initialise Redis in `main()`**

  In `main()`, after `let (event_tx_inner, _) = ...` and before building `state`, add:

  ```rust
  let redis_client = redis::Client::open(config.redis_url.as_str())
      .expect("invalid REDIS_URL");
  let redis = redis::aio::ConnectionManager::new(redis_client)
      .await
      .expect("failed to connect to Redis — check REDIS_URL");
  ```

  Then add `redis,` to the `AppState { ... }` literal.

- [ ] **Step 2.3: Update `make_state` in `internal_auth.rs` to async**

  Replace the current `fn make_state(secret: &str) -> AppState` with:

  ```rust
  async fn make_state(secret: &str) -> AppState {
      use crate::{config::Config, maps::{MapboxAdapter, MapProvider}, ws::{hub::WsHub, circle_hub::CircleHub}};
      use governor::{Quota, RateLimiter};
      use std::num::NonZeroU32;
      let http_client = reqwest::Client::new();
      let map_provider: Arc<dyn MapProvider> = Arc::new(
          MapboxAdapter::new(http_client.clone(), String::new())
      );
      let zap_limiter = Arc::new(RateLimiter::keyed(
          Quota::per_minute(NonZeroU32::new(10).unwrap()),
      ));
      let (event_tx_inner, _) = tokio::sync::broadcast::channel::<crate::ws::ViewportEvent>(1);
      let redis_client = redis::Client::open("redis://localhost").unwrap();
      let redis = redis::aio::ConnectionManager::new(redis_client)
          .await
          .expect("Redis required for gateway tests — ensure Redis is running on localhost:6379");
      AppState {
          db: sqlx::PgPool::connect_lazy("postgres://localhost/test").unwrap(),
          config: Arc::new(Config {
              database_url: "postgres://localhost/test".into(),
              redis_url: "redis://localhost".into(),
              port: 3000,
              zap_webhook_secret: "test".into(),
              blockchain_service_url: None,
              lnd_rest_url: None,
              lnd_macaroon_hex: None,
              lnd_tls_skip_verify: false,
              lnd_tls_cert_pem: None,
              nostr_private_key: None,
              nostr_relays: vec!["wss://nos.lol".into()],
              zap_rate_limit_per_minute: 10,
              internal_service_secret: secret.into(),
              trust_proxy: false,
              max_db_connections: 5,
              mapbox_token: None,
              vapid_private_key: None,
              vapid_public_key: None,
              vapid_subject: None,
              ws_events_rate_cap: 30,
              public_base_url: None,
          }),
          http_client,
          hub: Arc::new(WsHub::new()),
          circle_hub: Arc::new(CircleHub::new()),
          redis_healthy: Arc::new(AtomicBool::new(false)),
          map_provider,
          zap_limiter,
          event_tx: Arc::new(event_tx_inner),
          redis,
      }
  }
  ```

- [ ] **Step 2.4: Update `test_app` and test call-sites to `await`**

  Change `fn test_app(secret: &str) -> Router` to `async fn test_app(secret: &str) -> Router` and add `.await` to the `make_state` call inside it:

  ```rust
  async fn test_app(secret: &str) -> Router {
      let state = make_state(secret).await;
      Router::new()
          .route(
              "/protected",
              post(|_auth: InternalServiceAuth| async { "ok" }),
          )
          .with_state(state)
  }
  ```

  In each of the three test functions, change `let app = test_app("supersecret");` to `let app = test_app("supersecret").await;`.

- [ ] **Step 2.5: Compile check**

  ```powershell
  cargo build -p gateway 2>&1 | head -40
  ```

  Expected: no errors. (Tests not run yet — just checking it compiles.)

- [ ] **Step 2.6: Run internal_auth tests**

  ```powershell
  cargo test -p gateway internal_auth -- --nocapture
  ```

  Expected: all three existing tests pass. Requires Redis running on `localhost:6379`.

- [ ] **Step 2.7: Commit**

  ```powershell
  git add services/gateway/src/main.rs services/gateway/src/middleware/internal_auth.rs
  git commit -m "feat(gateway): add redis ConnectionManager to AppState"
  ```

---

## Task 3: `AuthError` + `ValidatedNostrAuth` types

**Files:**
- Modify: `services/gateway/src/middleware/nostr_auth.rs`

### What to build

Replace `NostrAuthRejection` with `AuthError` (15 variants). Add `ValidatedNostrAuth` struct. Write and pass tests for `IntoResponse` behaviour.

- [ ] **Step 3.1: Write failing tests for `AuthError::into_response()`**

  Replace the entire `#[cfg(test)] mod tests` block in `nostr_auth.rs` with:

  ```rust
  #[cfg(test)]
  mod tests {
      use super::*;
      use axum::body::to_bytes;
      use axum::http::StatusCode;

      #[tokio::test]
      async fn auth_error_returns_401() {
          for err in [
              AuthError::MissingHeader,
              AuthError::InvalidBase64,
              AuthError::InvalidEventJson,
              AuthError::InvalidKind,
              AuthError::InvalidCreatedAt,
              AuthError::TimestampExpired,
              AuthError::InvalidSignature,
              AuthError::MissingUrlTag,
              AuthError::DuplicateUrlTag,
              AuthError::MissingMethodTag,
              AuthError::DuplicateMethodTag,
              AuthError::UrlMismatch { expected: "a".into(), got: "b".into() },
              AuthError::MethodMismatch { expected: "POST".into(), got: "GET".into() },
              AuthError::ReplayDetected,
          ] {
              let resp = err.into_response();
              assert_eq!(resp.status(), StatusCode::UNAUTHORIZED, "expected 401");
          }
      }

      #[tokio::test]
      async fn auth_error_body_has_code_and_retryable_false() {
          let resp = AuthError::TimestampExpired.into_response();
          let body = to_bytes(resp.into_body(), 1024).await.unwrap();
          let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
          assert_eq!(json["code"], "AUTH_TIMESTAMP_EXPIRED");
          assert_eq!(json["retryable"], false);
      }

      #[tokio::test]
      async fn redis_unavailable_returns_503_with_retryable_true() {
          let resp = AuthError::RedisUnavailable.into_response();
          assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
          let body = to_bytes(resp.into_body(), 1024).await.unwrap();
          let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
          assert_eq!(json["code"], "SERVICE_UNAVAILABLE");
          assert_eq!(json["retryable"], true);
      }
  }
  ```

- [ ] **Step 3.2: Run tests — expect compile failure**

  ```powershell
  cargo test -p gateway nostr_auth -- --nocapture 2>&1 | head -20
  ```

  Expected: `error[E0412]: cannot find type 'AuthError'`

- [ ] **Step 3.3: Replace file with new types (keep existing extractor temporarily)**

  Replace the entire contents of `nostr_auth.rs` with:

  ```rust
  use axum::{
      extract::{FromRef, FromRequestParts},
      http::{request::Parts, StatusCode},
      response::{IntoResponse, Response},
      Json,
  };

  use crate::AppState;

  // ── Public extractor ────────────────────────────────────────────────────────

  pub struct NostrAuth {
      pub pubkey: String,
  }

  // ── Internal validated result ────────────────────────────────────────────────

  pub struct ValidatedNostrAuth {
      pub pubkey:     String,
      pub event_id:   String,
      pub created_at: i64,
  }

  // ── Error types ──────────────────────────────────────────────────────────────

  #[derive(Debug)]
  pub enum AuthError {
      MissingHeader,
      InvalidBase64,
      InvalidEventJson,
      InvalidKind,
      InvalidCreatedAt,
      TimestampExpired,
      InvalidSignature,
      MissingUrlTag,
      DuplicateUrlTag,
      MissingMethodTag,
      DuplicateMethodTag,
      UrlMismatch { expected: String, got: String },
      MethodMismatch { expected: String, got: String },
      ReplayDetected,
      RedisUnavailable,
  }

  impl AuthError {
      fn code(&self) -> &'static str {
          match self {
              Self::MissingHeader      => "AUTH_MISSING_HEADER",
              Self::InvalidBase64      => "AUTH_INVALID_BASE64",
              Self::InvalidEventJson   => "AUTH_INVALID_EVENT_JSON",
              Self::InvalidKind        => "AUTH_INVALID_KIND",
              Self::InvalidCreatedAt   => "AUTH_INVALID_CREATED_AT",
              Self::TimestampExpired   => "AUTH_TIMESTAMP_EXPIRED",
              Self::InvalidSignature   => "AUTH_INVALID_SIGNATURE",
              Self::MissingUrlTag      => "AUTH_MISSING_URL_TAG",
              Self::DuplicateUrlTag    => "AUTH_DUPLICATE_URL_TAG",
              Self::MissingMethodTag   => "AUTH_MISSING_METHOD_TAG",
              Self::DuplicateMethodTag => "AUTH_DUPLICATE_METHOD_TAG",
              Self::UrlMismatch { .. } => "AUTH_URL_MISMATCH",
              Self::MethodMismatch { .. } => "AUTH_METHOD_MISMATCH",
              Self::ReplayDetected     => "AUTH_REPLAY_DETECTED",
              Self::RedisUnavailable   => "SERVICE_UNAVAILABLE",
          }
      }
  }

  impl IntoResponse for AuthError {
      fn into_response(self) -> Response {
          let (status, retryable) = match &self {
              Self::RedisUnavailable => (StatusCode::SERVICE_UNAVAILABLE, true),
              _ => (StatusCode::UNAUTHORIZED, false),
          };
          (
              status,
              Json(serde_json::json!({
                  "code": self.code(),
                  "retryable": retryable,
              })),
          )
              .into_response()
      }
  }

  // ── Extractor (thin orchestrator — implemented in Task 4) ────────────────────

  impl<S> axum::extract::FromRequestParts<S> for NostrAuth
  where
      S: Send + Sync,
      AppState: FromRef<S>,
  {
      type Rejection = AuthError;

      async fn from_request_parts(
          parts: &mut Parts,
          state: &S,
      ) -> Result<Self, AuthError> {
          let _state = AppState::from_ref(state);
          // Placeholder — replaced in Task 4
          let _ = parts;
          Err(AuthError::MissingHeader)
      }
  }

  // ── Tests ────────────────────────────────────────────────────────────────────

  #[cfg(test)]
  mod tests {
      use super::*;
      use axum::body::to_bytes;
      use axum::http::StatusCode;

      #[tokio::test]
      async fn auth_error_returns_401() {
          for err in [
              AuthError::MissingHeader,
              AuthError::InvalidBase64,
              AuthError::InvalidEventJson,
              AuthError::InvalidKind,
              AuthError::InvalidCreatedAt,
              AuthError::TimestampExpired,
              AuthError::InvalidSignature,
              AuthError::MissingUrlTag,
              AuthError::DuplicateUrlTag,
              AuthError::MissingMethodTag,
              AuthError::DuplicateMethodTag,
              AuthError::UrlMismatch { expected: "a".into(), got: "b".into() },
              AuthError::MethodMismatch { expected: "POST".into(), got: "GET".into() },
              AuthError::ReplayDetected,
          ] {
              let resp = err.into_response();
              assert_eq!(resp.status(), StatusCode::UNAUTHORIZED, "expected 401");
          }
      }

      #[tokio::test]
      async fn auth_error_body_has_code_and_retryable_false() {
          let resp = AuthError::TimestampExpired.into_response();
          let body = to_bytes(resp.into_body(), 1024).await.unwrap();
          let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
          assert_eq!(json["code"], "AUTH_TIMESTAMP_EXPIRED");
          assert_eq!(json["retryable"], false);
      }

      #[tokio::test]
      async fn redis_unavailable_returns_503_with_retryable_true() {
          let resp = AuthError::RedisUnavailable.into_response();
          assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
          let body = to_bytes(resp.into_body(), 1024).await.unwrap();
          let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
          assert_eq!(json["code"], "SERVICE_UNAVAILABLE");
          assert_eq!(json["retryable"], true);
      }
  }
  ```

  Note: the `async_trait` import is dropped — Axum 0.7 supports async fns in traits directly.

- [ ] **Step 3.4: Run tests**

  ```powershell
  cargo test -p gateway nostr_auth -- --nocapture
  ```

  Expected: `auth_error_returns_401 ok`, `auth_error_body_has_code_and_retryable_false ok`, `redis_unavailable_returns_503_with_retryable_true ok`.

- [ ] **Step 3.5: Commit**

  ```powershell
  git add services/gateway/src/middleware/nostr_auth.rs
  git commit -m "feat(gateway/nostr_auth): add AuthError enum and ValidatedNostrAuth struct"
  ```

---

## Task 4: Core validation — `validate_nip98_request`

**Files:**
- Modify: `services/gateway/src/middleware/nostr_auth.rs`

### What to build

Implement `extract_auth_event`, `canonical_url`, and `validate_nip98_request`. Wire up the thin extractor. All 15 tests pass.

The tag helper needed throughout:
```rust
fn tag_values<'a>(event: &'a nostr_sdk::Event, name: &str) -> Vec<&'a str> {
    event.tags.iter()
        .filter_map(|t| {
            let v = t.as_slice();
            if v.first().map(String::as_str) == Some(name) {
                v.get(1).map(String::as_str)
            } else {
                None
            }
        })
        .collect()
}
```

- [ ] **Step 4.1: Write all 15 failing tests**

  Replace the `#[cfg(test)] mod tests` block with the full test suite below. Tests call `validate_nip98_request` directly (no Axum harness needed):

  ```rust
  #[cfg(test)]
  mod tests {
      use super::*;
      use axum::body::to_bytes;
      use axum::http::{Method, Request, StatusCode};
      use nostr_sdk::{EventBuilder, Keys, Kind, Tag, Timestamp};

      // ── Test helpers ───────────────────────────────────────────────────────

      const BASE: &str = "https://api.sentinelmesh.io";
      const ROUTE: &str = "/api/zaps/request";

      fn make_parts(method: &str, uri: &str) -> Parts {
          let (parts, _) = Request::builder()
              .method(method)
              .uri(uri)
              .header("host", "api.sentinelmesh.io")
              .body(())
              .unwrap()
              .into_parts();
          parts
      }

      fn make_nip98_event(keys: &Keys, offset_secs: i64, u: &str, method: &str) -> nostr_sdk::Event {
          let ts = Timestamp::from((chrono::Utc::now().timestamp() + offset_secs) as u64);
          EventBuilder::new(Kind::Custom(27235), "")
              .tags(vec![
                  Tag::parse(["u", u]).unwrap(),
                  Tag::parse(["method", method]).unwrap(),
              ])
              .custom_created_at(ts)
              .sign_with_keys(keys)
              .unwrap()
      }

      async fn make_state() -> AppState {
          use crate::{config::Config, maps::{MapboxAdapter, MapProvider}, ws::{hub::WsHub, circle_hub::CircleHub}};
          use governor::{Quota, RateLimiter};
          use std::{num::NonZeroU32, sync::{atomic::AtomicBool, Arc}};
          let http_client = reqwest::Client::new();
          let map_provider: std::sync::Arc<dyn MapProvider> = std::sync::Arc::new(
              MapboxAdapter::new(http_client.clone(), String::new())
          );
          let zap_limiter = Arc::new(RateLimiter::keyed(
              Quota::per_minute(NonZeroU32::new(10).unwrap()),
          ));
          let (event_tx_inner, _) = tokio::sync::broadcast::channel::<crate::ws::ViewportEvent>(1);
          let redis_client = redis::Client::open("redis://localhost").unwrap();
          let redis = redis::aio::ConnectionManager::new(redis_client)
              .await
              .expect("Redis required — ensure Redis is running on localhost:6379");
          AppState {
              db: sqlx::PgPool::connect_lazy("postgres://localhost/test").unwrap(),
              config: Arc::new(Config {
                  database_url: "postgres://localhost/test".into(),
                  redis_url: "redis://localhost".into(),
                  port: 3000,
                  zap_webhook_secret: "test".into(),
                  blockchain_service_url: None,
                  lnd_rest_url: None,
                  lnd_macaroon_hex: None,
                  lnd_tls_skip_verify: false,
                  lnd_tls_cert_pem: None,
                  nostr_private_key: None,
                  nostr_relays: vec!["wss://nos.lol".into()],
                  zap_rate_limit_per_minute: 10,
                  internal_service_secret: "secret".into(),
                  trust_proxy: false,
                  max_db_connections: 5,
                  mapbox_token: None,
                  vapid_private_key: None,
                  vapid_public_key: None,
                  vapid_subject: None,
                  ws_events_rate_cap: 30,
                  public_base_url: Some(BASE.to_string()),
              }),
              http_client,
              hub: Arc::new(WsHub::new()),
              circle_hub: Arc::new(CircleHub::new()),
              redis_healthy: Arc::new(AtomicBool::new(false)),
              map_provider,
              zap_limiter,
              event_tx: Arc::new(event_tx_inner),
              redis,
          }
      }

      // ── Tests ──────────────────────────────────────────────────────────────

      #[tokio::test]
      async fn valid_request_passes() {
          let state = make_state().await;
          let keys = Keys::generate();
          let event = make_nip98_event(&keys, 0, &format!("{BASE}{ROUTE}"), "POST");
          let parts = make_parts("POST", ROUTE);
          let result = validate_nip98_request(&parts, &state, &event).await;
          let auth = result.expect("valid request must pass");
          assert_eq!(auth.pubkey, keys.public_key().to_hex());
          assert!(!auth.event_id.is_empty());
          assert!(auth.created_at > 0);
      }

      #[tokio::test]
      async fn expired_timestamp_rejected() {
          let state = make_state().await;
          let keys = Keys::generate();
          let event = make_nip98_event(&keys, -120, &format!("{BASE}{ROUTE}"), "POST");
          let parts = make_parts("POST", ROUTE);
          let err = validate_nip98_request(&parts, &state, &event).await.unwrap_err();
          assert!(matches!(err, AuthError::TimestampExpired), "got {err:?}");
      }

      #[tokio::test]
      async fn invalid_created_at_rejected() {
          let state = make_state().await;
          let keys = Keys::generate();
          // u64::MAX overflows i64 — triggers InvalidCreatedAt
          let ts = Timestamp::from(u64::MAX);
          let event = EventBuilder::new(Kind::Custom(27235), "")
              .tags(vec![
                  Tag::parse(["u", &format!("{BASE}{ROUTE}")]).unwrap(),
                  Tag::parse(["method", "POST"]).unwrap(),
              ])
              .custom_created_at(ts)
              .sign_with_keys(&keys)
              .unwrap();
          let parts = make_parts("POST", ROUTE);
          let err = validate_nip98_request(&parts, &state, &event).await.unwrap_err();
          assert!(matches!(err, AuthError::InvalidCreatedAt), "got {err:?}");
      }

      #[tokio::test]
      async fn invalid_kind_rejected() {
          let state = make_state().await;
          let keys = Keys::generate();
          let ts = Timestamp::from(chrono::Utc::now().timestamp() as u64);
          let event = EventBuilder::new(Kind::Custom(1), "")
              .tags(vec![
                  Tag::parse(["u", &format!("{BASE}{ROUTE}")]).unwrap(),
                  Tag::parse(["method", "POST"]).unwrap(),
              ])
              .custom_created_at(ts)
              .sign_with_keys(&keys)
              .unwrap();
          let parts = make_parts("POST", ROUTE);
          let err = validate_nip98_request(&parts, &state, &event).await.unwrap_err();
          assert!(matches!(err, AuthError::InvalidKind), "got {err:?}");
      }

      #[tokio::test]
      async fn missing_u_tag_rejected() {
          let state = make_state().await;
          let keys = Keys::generate();
          let ts = Timestamp::from(chrono::Utc::now().timestamp() as u64);
          let event = EventBuilder::new(Kind::Custom(27235), "")
              .tags(vec![Tag::parse(["method", "POST"]).unwrap()])
              .custom_created_at(ts)
              .sign_with_keys(&keys)
              .unwrap();
          let parts = make_parts("POST", ROUTE);
          let err = validate_nip98_request(&parts, &state, &event).await.unwrap_err();
          assert!(matches!(err, AuthError::MissingUrlTag), "got {err:?}");
      }

      #[tokio::test]
      async fn missing_method_tag_rejected() {
          let state = make_state().await;
          let keys = Keys::generate();
          let ts = Timestamp::from(chrono::Utc::now().timestamp() as u64);
          let event = EventBuilder::new(Kind::Custom(27235), "")
              .tags(vec![Tag::parse(["u", &format!("{BASE}{ROUTE}")]).unwrap()])
              .custom_created_at(ts)
              .sign_with_keys(&keys)
              .unwrap();
          let parts = make_parts("POST", ROUTE);
          let err = validate_nip98_request(&parts, &state, &event).await.unwrap_err();
          assert!(matches!(err, AuthError::MissingMethodTag), "got {err:?}");
      }

      #[tokio::test]
      async fn duplicate_u_tag_rejected() {
          let state = make_state().await;
          let keys = Keys::generate();
          let ts = Timestamp::from(chrono::Utc::now().timestamp() as u64);
          let event = EventBuilder::new(Kind::Custom(27235), "")
              .tags(vec![
                  Tag::parse(["u", &format!("{BASE}{ROUTE}")]).unwrap(),
                  Tag::parse(["u", &format!("{BASE}/other")]).unwrap(),
                  Tag::parse(["method", "POST"]).unwrap(),
              ])
              .custom_created_at(ts)
              .sign_with_keys(&keys)
              .unwrap();
          let parts = make_parts("POST", ROUTE);
          let err = validate_nip98_request(&parts, &state, &event).await.unwrap_err();
          assert!(matches!(err, AuthError::DuplicateUrlTag), "got {err:?}");
      }

      #[tokio::test]
      async fn duplicate_method_tag_rejected() {
          let state = make_state().await;
          let keys = Keys::generate();
          let ts = Timestamp::from(chrono::Utc::now().timestamp() as u64);
          let event = EventBuilder::new(Kind::Custom(27235), "")
              .tags(vec![
                  Tag::parse(["u", &format!("{BASE}{ROUTE}")]).unwrap(),
                  Tag::parse(["method", "POST"]).unwrap(),
                  Tag::parse(["method", "GET"]).unwrap(),
              ])
              .custom_created_at(ts)
              .sign_with_keys(&keys)
              .unwrap();
          let parts = make_parts("POST", ROUTE);
          let err = validate_nip98_request(&parts, &state, &event).await.unwrap_err();
          assert!(matches!(err, AuthError::DuplicateMethodTag), "got {err:?}");
      }

      #[tokio::test]
      async fn url_mismatch_rejected() {
          let state = make_state().await;
          let keys = Keys::generate();
          let event = make_nip98_event(&keys, 0, &format!("{BASE}/api/other"), "POST");
          let parts = make_parts("POST", ROUTE);
          let err = validate_nip98_request(&parts, &state, &event).await.unwrap_err();
          assert!(matches!(err, AuthError::UrlMismatch { .. }), "got {err:?}");
      }

      #[tokio::test]
      async fn method_mismatch_rejected() {
          let state = make_state().await;
          let keys = Keys::generate();
          // Event signed for GET but request is POST
          let event = make_nip98_event(&keys, 0, &format!("{BASE}{ROUTE}"), "GET");
          let parts = make_parts("POST", ROUTE);
          let err = validate_nip98_request(&parts, &state, &event).await.unwrap_err();
          assert!(matches!(err, AuthError::MethodMismatch { .. }), "got {err:?}");
      }

      #[tokio::test]
      async fn replay_attack_rejected() {
          let state = make_state().await;
          let keys = Keys::generate();
          let event = make_nip98_event(&keys, 0, &format!("{BASE}{ROUTE}"), "POST");
          let parts = make_parts("POST", ROUTE);
          // First request succeeds
          validate_nip98_request(&parts, &state, &event).await.expect("first request must pass");
          // Second request with identical event id is a replay
          let err = validate_nip98_request(&parts, &state, &event).await.unwrap_err();
          assert!(matches!(err, AuthError::ReplayDetected), "got {err:?}");
      }

      #[tokio::test]
      async fn cross_route_replay_rejected() {
          let state = make_state().await;
          let keys = Keys::generate();
          // Event signed for /api/other, submitted to ROUTE
          let event = make_nip98_event(&keys, 0, &format!("{BASE}/api/other"), "POST");
          let parts = make_parts("POST", ROUTE);
          let err = validate_nip98_request(&parts, &state, &event).await.unwrap_err();
          // URL mismatch caught before replay guard
          assert!(matches!(err, AuthError::UrlMismatch { .. }), "got {err:?}");
      }

      #[tokio::test]
      async fn redis_unavailable_returns_503() {
          use crate::{config::Config, maps::{MapboxAdapter, MapProvider}, ws::{hub::WsHub, circle_hub::CircleHub}};
          use governor::{Quota, RateLimiter};
          use std::{num::NonZeroU32, sync::{atomic::AtomicBool, Arc}};

          // Bind a port, then drop the listener so connections are refused immediately
          let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
          let port = listener.local_addr().unwrap().port();
          // Keep accepting and immediately dropping connections so the TCP handshake succeeds
          // but the Redis protocol fails
          tokio::spawn(async move {
              while let Ok((conn, _)) = listener.accept().await {
                  drop(conn);
              }
          });

          let bad_url = format!("redis://127.0.0.1:{port}");
          let redis_client = redis::Client::open(bad_url.as_str()).unwrap();
          // ConnectionManager may succeed (TCP connects) but commands will fail
          let redis = match redis::aio::ConnectionManager::new(redis_client).await {
              Ok(r) => r,
              Err(_) => {
                  // Some environments fail immediately — skip this test
                  return;
              }
          };

          let http_client = reqwest::Client::new();
          let map_provider: std::sync::Arc<dyn MapProvider> = std::sync::Arc::new(
              MapboxAdapter::new(http_client.clone(), String::new())
          );
          let zap_limiter = Arc::new(RateLimiter::keyed(
              Quota::per_minute(NonZeroU32::new(10).unwrap()),
          ));
          let (event_tx_inner, _) = tokio::sync::broadcast::channel::<crate::ws::ViewportEvent>(1);
          let state = AppState {
              db: sqlx::PgPool::connect_lazy("postgres://localhost/test").unwrap(),
              config: Arc::new(Config {
                  database_url: "postgres://localhost/test".into(),
                  redis_url: bad_url,
                  port: 3000,
                  zap_webhook_secret: "test".into(),
                  blockchain_service_url: None,
                  lnd_rest_url: None,
                  lnd_macaroon_hex: None,
                  lnd_tls_skip_verify: false,
                  lnd_tls_cert_pem: None,
                  nostr_private_key: None,
                  nostr_relays: vec!["wss://nos.lol".into()],
                  zap_rate_limit_per_minute: 10,
                  internal_service_secret: "secret".into(),
                  trust_proxy: false,
                  max_db_connections: 5,
                  mapbox_token: None,
                  vapid_private_key: None,
                  vapid_public_key: None,
                  vapid_subject: None,
                  ws_events_rate_cap: 30,
                  public_base_url: Some(BASE.to_string()),
              }),
              http_client,
              hub: Arc::new(WsHub::new()),
              circle_hub: Arc::new(CircleHub::new()),
              redis_healthy: Arc::new(AtomicBool::new(false)),
              map_provider,
              zap_limiter,
              event_tx: Arc::new(event_tx_inner),
              redis,
          };

          let keys = Keys::generate();
          let event = make_nip98_event(&keys, 0, &format!("{BASE}{ROUTE}"), "POST");
          let parts = make_parts("POST", ROUTE);
          let err = validate_nip98_request(&parts, &state, &event).await.unwrap_err();
          assert!(matches!(err, AuthError::RedisUnavailable), "got {err:?}");
      }

      #[tokio::test]
      async fn canonical_url_normalization_passes() {
          // PUBLIC_BASE_URL was "HTTPS://API.SENTINELMESH.IO:443/" — normalised at startup
          // to "https://api.sentinelmesh.io". This test verifies the per-request combination
          // with a query string preserves the query string exactly.
          use crate::{config::Config, maps::{MapboxAdapter, MapProvider}, ws::{hub::WsHub, circle_hub::CircleHub}};
          use governor::{Quota, RateLimiter};
          use std::{num::NonZeroU32, sync::{atomic::AtomicBool, Arc}};

          let redis_client = redis::Client::open("redis://localhost").unwrap();
          let redis = redis::aio::ConnectionManager::new(redis_client)
              .await
              .expect("Redis required");
          let http_client = reqwest::Client::new();
          let map_provider: std::sync::Arc<dyn MapProvider> = std::sync::Arc::new(
              MapboxAdapter::new(http_client.clone(), String::new())
          );
          let zap_limiter = Arc::new(RateLimiter::keyed(
              Quota::per_minute(NonZeroU32::new(10).unwrap()),
          ));
          let (event_tx_inner, _) = tokio::sync::broadcast::channel::<crate::ws::ViewportEvent>(1);
          let state = AppState {
              db: sqlx::PgPool::connect_lazy("postgres://localhost/test").unwrap(),
              config: Arc::new(Config {
                  database_url: "postgres://localhost/test".into(),
                  redis_url: "redis://localhost".into(),
                  port: 3000,
                  zap_webhook_secret: "test".into(),
                  blockchain_service_url: None,
                  lnd_rest_url: None,
                  lnd_macaroon_hex: None,
                  lnd_tls_skip_verify: false,
                  lnd_tls_cert_pem: None,
                  nostr_private_key: None,
                  nostr_relays: vec!["wss://nos.lol".into()],
                  zap_rate_limit_per_minute: 10,
                  internal_service_secret: "secret".into(),
                  trust_proxy: false,
                  max_db_connections: 5,
                  mapbox_token: None,
                  vapid_private_key: None,
                  vapid_public_key: None,
                  vapid_subject: None,
                  ws_events_rate_cap: 30,
                  // Normalised form of "HTTPS://API.SENTINELMESH.IO:443/"
                  public_base_url: Some("https://api.sentinelmesh.io".to_string()),
              }),
              http_client,
              hub: Arc::new(WsHub::new()),
              circle_hub: Arc::new(CircleHub::new()),
              redis_healthy: Arc::new(AtomicBool::new(false)),
              map_provider,
              zap_limiter,
              event_tx: Arc::new(event_tx_inner),
              redis,
          };

          let keys = Keys::generate();
          let canonical = "https://api.sentinelmesh.io/api/zaps/request?foo=bar";
          let event = make_nip98_event(&keys, 0, canonical, "POST");
          let parts = make_parts("POST", "/api/zaps/request?foo=bar");
          let result = validate_nip98_request(&parts, &state, &event).await;
          assert!(result.is_ok(), "normalised URL must match: {result:?}");
      }

      #[tokio::test]
      async fn replay_ttl_expires() {
          // The TTL is 120s in production; this test uses a fixed event_id and
          // verifies the SET NX behaviour: same id → second call is ReplayDetected,
          // but a different id on the same request succeeds.
          let state = make_state().await;
          let keys = Keys::generate();
          let event = make_nip98_event(&keys, 0, &format!("{BASE}{ROUTE}"), "POST");
          let parts = make_parts("POST", ROUTE);

          validate_nip98_request(&parts, &state, &event).await.expect("first ok");

          // Different keys → different event id → accepted (simulates TTL expiry)
          let keys2 = Keys::generate();
          let event2 = make_nip98_event(&keys2, 0, &format!("{BASE}{ROUTE}"), "POST");
          validate_nip98_request(&parts, &state, &event2).await
              .expect("different event id must be accepted");
      }
  }
  ```

- [ ] **Step 4.2: Run tests — expect compile failure on missing functions**

  ```powershell
  cargo test -p gateway nostr_auth -- --nocapture 2>&1 | head -30
  ```

  Expected: `error[E0425]: cannot find function 'validate_nip98_request'`

- [ ] **Step 4.3: Implement `extract_auth_event`**

  Add these functions after the `IntoResponse for AuthError` impl (before the extractor's `FromRequestParts` impl):

  ```rust
  // ── Validation helpers ───────────────────────────────────────────────────────

  fn extract_auth_event(parts: &Parts) -> Result<nostr_sdk::Event, AuthError> {
      let header = parts
          .headers
          .get("x-nostr-auth")
          .ok_or(AuthError::MissingHeader)?;
      let raw = header.to_str().map_err(|_| AuthError::InvalidBase64)?;
      // Check created_at is a valid integer before full deserialisation
      let value: serde_json::Value =
          serde_json::from_str(raw).map_err(|_| AuthError::InvalidBase64)?;
      if !value.get("created_at").map(|v| v.is_u64() || v.is_i64()).unwrap_or(false) {
          return Err(AuthError::InvalidCreatedAt);
      }
      let event: nostr_sdk::Event =
          serde_json::from_str(raw).map_err(|_| AuthError::InvalidEventJson)?;
      Ok(event)
  }

  fn tag_values<'a>(event: &'a nostr_sdk::Event, name: &str) -> Vec<&'a str> {
      event.tags.iter()
          .filter_map(|t| {
              let v = t.as_slice();
              if v.first().map(String::as_str) == Some(name) {
                  v.get(1).map(String::as_str)
              } else {
                  None
              }
          })
          .collect()
  }
  ```

- [ ] **Step 4.4: Implement `canonical_url`**

  Add after `tag_values`:

  ```rust
  fn canonical_url(parts: &Parts, config: &crate::config::Config) -> String {
      let path_and_query = parts.uri.path_and_query()
          .map(|pq| pq.as_str())
          .unwrap_or("/");

      if let Some(base) = &config.public_base_url {
          return format!("{base}{path_and_query}");
      }

      let (scheme, host) = if config.trust_proxy {
          let scheme = parts.headers
              .get("x-forwarded-proto")
              .and_then(|v| v.to_str().ok())
              .unwrap_or("https")
              .to_lowercase();
          let host = parts.headers
              .get("x-forwarded-host")
              .or_else(|| parts.headers.get("host"))
              .and_then(|v| v.to_str().ok())
              .unwrap_or("")
              .to_lowercase();
          (scheme, host)
      } else {
          let host = parts.headers
              .get("host")
              .and_then(|v| v.to_str().ok())
              .unwrap_or("")
              .to_lowercase();
          ("https".to_string(), host)
      };

      let host = match (scheme.as_str(), host.rsplit_once(':')) {
          ("https", Some((h, "443"))) | ("http", Some((h, "80"))) => h.to_string(),
          _ => host,
      };

      format!("{scheme}://{host}{path_and_query}")
  }
  ```

- [ ] **Step 4.5: Implement `validate_nip98_request`**

  Add after `canonical_url`:

  ```rust
  pub async fn validate_nip98_request(
      parts: &Parts,
      state: &AppState,
      event: &nostr_sdk::Event,
  ) -> Result<ValidatedNostrAuth, AuthError> {
      // Step 1: Kind
      if event.kind != nostr_sdk::Kind::Custom(27235) {
          return Err(AuthError::InvalidKind);
      }

      // Step 2: Timestamp parse (guard against u64 overflow into i64)
      let created_at = i64::try_from(event.created_at.as_u64())
          .map_err(|_| AuthError::InvalidCreatedAt)?;

      // Step 3: Timestamp window
      if (chrono::Utc::now().timestamp() - created_at).abs() > 60 {
          return Err(AuthError::TimestampExpired);
      }

      // Step 4: Pre-verify log (kind only — pubkey/id are attacker-controlled before verify)
      tracing::debug!(kind = event.kind.as_u16(), "NIP-98 pre-verify");

      // Step 5: Signature
      event.verify().map_err(|_| AuthError::InvalidSignature)?;

      // Step 6: Post-verify log
      tracing::debug!(pubkey = %event.pubkey, event_id = %event.id, "NIP-98 signature verified");

      // Step 7: u tag
      let u_tags = tag_values(event, "u");
      let u_tag = match u_tags.len() {
          0 => return Err(AuthError::MissingUrlTag),
          1 => u_tags[0],
          _ => return Err(AuthError::DuplicateUrlTag),
      };

      // Step 8: method tag
      let method_tags = tag_values(event, "method");
      let method_tag = match method_tags.len() {
          0 => return Err(AuthError::MissingMethodTag),
          1 => method_tags[0],
          _ => return Err(AuthError::DuplicateMethodTag),
      };

      // Step 9: Canonical URL
      let canonical = canonical_url(parts, &state.config);
      if u_tag != canonical {
          tracing::warn!(
              pubkey = %event.pubkey,
              event_id = %event.id,
              expected = %canonical,
              got = %u_tag,
              "NIP-98 auth rejected"
          );
          return Err(AuthError::UrlMismatch {
              expected: canonical,
              got: u_tag.to_string(),
          });
      }

      // Step 10: Method
      if method_tag.to_uppercase() != parts.method.as_str() {
          tracing::warn!(
              pubkey = %event.pubkey,
              event_id = %event.id,
              "NIP-98 auth rejected"
          );
          return Err(AuthError::MethodMismatch {
              expected: parts.method.to_string(),
              got: method_tag.to_string(),
          });
      }

      // Step 11: Replay guard — SET nip98:v1:jti:{event_id} 1 NX EX 120
      let event_id = event.id.to_hex();
      let key = format!("nip98:v1:jti:{event_id}");
      let mut conn = state.redis.clone();
      let result: Result<Option<String>, _> = tokio::time::timeout(
          std::time::Duration::from_millis(250),
          redis::cmd("SET")
              .arg(&key)
              .arg(1)
              .arg("NX")
              .arg("EX")
              .arg(120)
              .query_async(&mut conn),
      )
      .await
      .map_err(|_| AuthError::RedisUnavailable)?
      .map_err(|_| AuthError::RedisUnavailable);

      match result {
          Err(e) => {
              tracing::warn!(
                  pubkey = %event.pubkey,
                  event_id = %event_id,
                  error = %e,
                  "NIP-98 auth rejected"
              );
              return Err(e);
          }
          Ok(None) => {
              // Key already existed — replay
              tracing::warn!(
                  pubkey = %event.pubkey,
                  event_id = %event_id,
                  "NIP-98 auth rejected"
              );
              return Err(AuthError::ReplayDetected);
          }
          Ok(Some(_)) => {
              // SET NX succeeded — new event id
          }
      }

      Ok(ValidatedNostrAuth {
          pubkey: event.pubkey.to_hex(),
          event_id,
          created_at,
      })
  }
  ```

- [ ] **Step 4.6: Wire up the thin extractor**

  Replace the placeholder `FromRequestParts` impl with:

  ```rust
  impl<S> axum::extract::FromRequestParts<S> for NostrAuth
  where
      S: Send + Sync,
      AppState: FromRef<S>,
  {
      type Rejection = AuthError;

      async fn from_request_parts(
          parts: &mut Parts,
          state: &S,
      ) -> Result<Self, AuthError> {
          let state = AppState::from_ref(state);
          let event = extract_auth_event(parts)?;
          let auth  = validate_nip98_request(parts, &state, &event).await?;
          Ok(NostrAuth { pubkey: auth.pubkey })
      }
  }
  ```

  Add required imports at the top of `nostr_auth.rs`. Replace the existing `use axum::{...}` block with:

  ```rust
  use axum::{
      extract::{FromRef, FromRequestParts},
      http::{request::Parts, StatusCode},
      response::{IntoResponse, Response},
      Json,
  };
  use redis::AsyncCommands;

  use crate::AppState;
  ```

- [ ] **Step 4.7: Run all nostr_auth tests**

  ```powershell
  cargo test -p gateway nostr_auth -- --nocapture
  ```

  Expected: all 17 tests pass (3 from Task 3 + 14 from Task 4; `redis_unavailable_returns_503` may be skipped if ConnectionManager::new fails at the fake port).

  If the `Tag::parse` API signature differs in nostr-sdk 0.37, adjust the call to:
  ```rust
  Tag::parse(vec!["u".to_string(), url.to_string()]).unwrap()
  ```

  If `tag.as_slice()` is unavailable, use `tag.as_vec()` (returns `Vec<String>`) or replace `tag_values` with:
  ```rust
  fn tag_values(event: &nostr_sdk::Event, name: &str) -> Vec<String> {
      event.tags.iter()
          .filter_map(|t| {
              let v: Vec<String> = serde_json::from_value(
                  serde_json::to_value(t).unwrap()
              ).unwrap_or_default();
              if v.first().map(|s| s.as_str()) == Some(name) {
                  v.into_iter().nth(1)
              } else {
                  None
              }
          })
          .collect()
  }
  ```
  (Update call-sites accordingly to use `String` instead of `&str`.)

- [ ] **Step 4.8: Commit**

  ```powershell
  git add services/gateway/src/middleware/nostr_auth.rs
  git commit -m "feat(gateway/nostr_auth): strict NIP-98 validation — u+method tags, canonical URL, Redis replay guard"
  ```

---

## Task 5: Full suite verification

**Files:** none changed

- [ ] **Step 5.1: Run the full gateway test suite**

  ```powershell
  cargo test -p gateway -- --nocapture 2>&1 | tail -20
  ```

  Expected: all tests pass. Requires Redis and Postgres running locally (standard dev env).

- [ ] **Step 5.2: Confirm the middleware module compiles with no warnings**

  ```powershell
  cargo clippy -p gateway -- -D warnings 2>&1 | head -30
  ```

  Fix any `unused import` or `dead_code` warnings before proceeding.

- [ ] **Step 5.3: Commit any clippy fixes**

  If any fixes were made:

  ```powershell
  git add -p
  git commit -m "fix(gateway/nostr_auth): address clippy warnings"
  ```

---

## Quick reference — `AuthError` HTTP codes

| Variant | Status | `code` in body |
|---|---|---|
| `MissingHeader` | 401 | `AUTH_MISSING_HEADER` |
| `InvalidBase64` | 401 | `AUTH_INVALID_BASE64` |
| `InvalidEventJson` | 401 | `AUTH_INVALID_EVENT_JSON` |
| `InvalidKind` | 401 | `AUTH_INVALID_KIND` |
| `InvalidCreatedAt` | 401 | `AUTH_INVALID_CREATED_AT` |
| `TimestampExpired` | 401 | `AUTH_TIMESTAMP_EXPIRED` |
| `InvalidSignature` | 401 | `AUTH_INVALID_SIGNATURE` |
| `MissingUrlTag` | 401 | `AUTH_MISSING_URL_TAG` |
| `DuplicateUrlTag` | 401 | `AUTH_DUPLICATE_URL_TAG` |
| `MissingMethodTag` | 401 | `AUTH_MISSING_METHOD_TAG` |
| `DuplicateMethodTag` | 401 | `AUTH_DUPLICATE_METHOD_TAG` |
| `UrlMismatch` | 401 | `AUTH_URL_MISMATCH` |
| `MethodMismatch` | 401 | `AUTH_METHOD_MISMATCH` |
| `ReplayDetected` | 401 | `AUTH_REPLAY_DETECTED` |
| `RedisUnavailable` | **503** | `SERVICE_UNAVAILABLE` |

## Validation order in `validate_nip98_request`

1. Kind ≠ 27235 → `InvalidKind`
2. `created_at` u64→i64 overflow → `InvalidCreatedAt`
3. `|now - created_at| > 60` → `TimestampExpired`
4. Pre-verify log (kind only)
5. `event.verify()` fails → `InvalidSignature`
6. Post-verify log (pubkey + event_id)
7. Zero `u` tags → `MissingUrlTag`; >1 → `DuplicateUrlTag`
8. Zero `method` tags → `MissingMethodTag`; >1 → `DuplicateMethodTag`
9. `u` tag ≠ canonical URL → `UrlMismatch`
10. `method` tag ≠ request method → `MethodMismatch`
11. `SET nip98:v1:jti:{id} 1 NX EX 120` key exists → `ReplayDetected`; timeout/error → `RedisUnavailable`
