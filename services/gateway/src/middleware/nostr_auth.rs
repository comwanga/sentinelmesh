use crate::AppState;
use axum::{
    extract::{FromRef, FromRequestParts},
    http::{request::Parts, StatusCode},
    response::{IntoResponse, Response},
    Json,
};

// ── Public extractor ────────────────────────────────────────────────────────

pub struct NostrAuth {
    pub pubkey: String,
    /// Value of the NIP-98 `payload` tag (sha256 hex of the request body), if the
    /// client included one. Handlers that need body binding compare this to the
    /// hash of the received body (see AC-6 in the acoustic route).
    pub payload: Option<String>,
}

// ── Internal validated result ────────────────────────────────────────────────

#[derive(Debug)]
#[allow(dead_code)]
pub struct ValidatedNostrAuth {
    pub pubkey: String,
    pub event_id: String,
    pub created_at: i64,
    pub payload: Option<String>,
}

// ── Error types ──────────────────────────────────────────────────────────────

#[derive(Debug)]
#[allow(dead_code)]
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
    DuplicatePayloadTag,
    UrlMismatch { expected: String, got: String },
    MethodMismatch { expected: String, got: String },
    ReplayDetected,
    RedisUnavailable,
}

impl AuthError {
    fn code(&self) -> &'static str {
        match self {
            Self::MissingHeader => "AUTH_MISSING_HEADER",
            Self::InvalidBase64 => "AUTH_INVALID_BASE64",
            Self::InvalidEventJson => "AUTH_INVALID_EVENT_JSON",
            Self::InvalidKind => "AUTH_INVALID_KIND",
            Self::InvalidCreatedAt => "AUTH_INVALID_CREATED_AT",
            Self::TimestampExpired => "AUTH_TIMESTAMP_EXPIRED",
            Self::InvalidSignature => "AUTH_INVALID_SIGNATURE",
            Self::MissingUrlTag => "AUTH_MISSING_URL_TAG",
            Self::DuplicateUrlTag => "AUTH_DUPLICATE_URL_TAG",
            Self::MissingMethodTag => "AUTH_MISSING_METHOD_TAG",
            Self::DuplicateMethodTag => "AUTH_DUPLICATE_METHOD_TAG",
            Self::DuplicatePayloadTag => "AUTH_DUPLICATE_PAYLOAD_TAG",
            Self::UrlMismatch { .. } => "AUTH_URL_MISMATCH",
            Self::MethodMismatch { .. } => "AUTH_METHOD_MISMATCH",
            Self::ReplayDetected => "AUTH_REPLAY_DETECTED",
            Self::RedisUnavailable => "SERVICE_UNAVAILABLE",
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

// ── Extractor ────────────────────────────────────────────────────────────────

#[async_trait::async_trait]
impl<S> FromRequestParts<S> for NostrAuth
where
    S: Send + Sync,
    AppState: FromRef<S>,
{
    type Rejection = AuthError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, AuthError> {
        let state = AppState::from_ref(state);
        let event = extract_auth_event(parts)?;
        let auth = validate_nip98_request(parts, &state, &event).await?;
        Ok(NostrAuth {
            pubkey: auth.pubkey,
            payload: auth.payload,
        })
    }
}

// ── Validation helpers ────────────────────────────────────────────────────────

fn extract_auth_event(parts: &Parts) -> Result<nostr_sdk::Event, AuthError> {
    let header = parts
        .headers
        .get("x-nostr-auth")
        .ok_or(AuthError::MissingHeader)?;
    let raw = header.to_str().map_err(|_| AuthError::InvalidBase64)?;
    // Validate created_at is an integer before full deserialisation
    let value: serde_json::Value =
        serde_json::from_str(raw).map_err(|_| AuthError::InvalidBase64)?;
    match value.get("created_at") {
        Some(v) if v.is_u64() || v.is_i64() => {}
        _ => return Err(AuthError::InvalidCreatedAt),
    }
    let event: nostr_sdk::Event =
        serde_json::from_str(raw).map_err(|_| AuthError::InvalidEventJson)?;
    Ok(event)
}

fn tag_values(event: &nostr_sdk::Event, name: &str) -> Vec<String> {
    event
        .tags
        .iter()
        .filter_map(|t| {
            let v = t.as_slice();
            if v.first().map(String::as_str) == Some(name) {
                v.get(1).cloned()
            } else {
                None
            }
        })
        .collect()
}

fn canonical_url(parts: &Parts, config: &crate::config::Config) -> String {
    let path_and_query = parts
        .uri
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("/");

    if let Some(base) = &config.public_base_url {
        return format!("{base}{path_and_query}");
    }

    let (scheme, host) = if config.trust_proxy {
        let scheme = parts
            .headers
            .get("x-forwarded-proto")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("https")
            .to_lowercase();
        let host_raw = parts
            .headers
            .get("x-forwarded-host")
            .or_else(|| parts.headers.get("host"))
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if host_raw.is_empty() {
            tracing::warn!(
                "NIP-98 canonical URL: no X-Forwarded-Host or Host header — auth will fail"
            );
        }
        let host = host_raw.to_lowercase();
        (scheme, host)
    } else {
        let host_raw = parts
            .headers
            .get("host")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if host_raw.is_empty() {
            tracing::warn!(
                "NIP-98 canonical URL: no Host header and PUBLIC_BASE_URL not set — auth will fail"
            );
        }
        let host = host_raw.to_lowercase();
        ("https".to_string(), host)
    };

    let host = match (scheme.as_str(), host.rsplit_once(':')) {
        ("https", Some((h, "443"))) | ("http", Some((h, "80"))) => h.to_string(),
        _ => host,
    };

    format!("{scheme}://{host}{path_and_query}")
}

pub async fn validate_nip98_request(
    parts: &Parts,
    state: &AppState,
    event: &nostr_sdk::Event,
) -> Result<ValidatedNostrAuth, AuthError> {
    // Step 1: Kind
    if event.kind != nostr_sdk::Kind::Custom(27235) {
        return Err(AuthError::InvalidKind);
    }

    // Step 2: Timestamp parse — guard against u64 overflow into i64
    let created_at =
        i64::try_from(event.created_at.as_u64()).map_err(|_| AuthError::InvalidCreatedAt)?;

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
        1 => u_tags.into_iter().next().unwrap(),
        _ => return Err(AuthError::DuplicateUrlTag),
    };

    // Step 8: method tag
    let method_tags = tag_values(event, "method");
    let method_tag = match method_tags.len() {
        0 => return Err(AuthError::MissingMethodTag),
        1 => method_tags.into_iter().next().unwrap(),
        _ => return Err(AuthError::DuplicateMethodTag),
    };

    // Step 8b: optional NIP-98 payload tag (sha256 hex of the request body).
    let payload_tags = tag_values(event, "payload");
    let payload = match payload_tags.len() {
        0 => None,
        1 => payload_tags.into_iter().next(),
        _ => return Err(AuthError::DuplicatePayloadTag),
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
            got: u_tag,
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
            got: method_tag,
        });
    }

    // Step 11: Replay guard — SET nip98:v1:jti:{event_id} 1 NX EX 120
    let event_id = event.id.to_hex();
    let key = format!("nip98:v1:jti:{event_id}");
    let mut conn = state.redis.clone();
    let set_result: Option<String> = tokio::time::timeout(
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
    .map_err(|_| {
        tracing::warn!(pubkey = %event.pubkey, event_id = %event_id, "NIP-98 auth rejected: Redis timeout");
        AuthError::RedisUnavailable
    })?
    .map_err(|e| {
        tracing::warn!(pubkey = %event.pubkey, event_id = %event_id, error = %e, "NIP-98 auth rejected: Redis error");
        AuthError::RedisUnavailable
    })?;

    if set_result.is_none() {
        // SET NX failed — key already existed, replay detected
        tracing::warn!(pubkey = %event.pubkey, event_id = %event_id, "NIP-98 auth rejected: replay detected");
        return Err(AuthError::ReplayDetected);
    }

    Ok(ValidatedNostrAuth {
        pubkey: event.pubkey.to_hex(),
        event_id,
        created_at,
        payload,
    })
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use axum::http::{Request, StatusCode};
    use nostr_sdk::{EventBuilder, Keys, Kind, Tag, Timestamp};

    const BASE: &str = "https://api.sentinelmesh.io";
    const ROUTE: &str = "/api/acoustic/signals";

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
        use crate::{
            config::Config,
            maps::{DisabledMapProvider, MapProvider},
            ws::{circle_hub::CircleHub, hub::WsHub},
        };
        use governor::{Quota, RateLimiter};
        use std::{
            num::NonZeroU32,
            sync::{atomic::AtomicBool, Arc},
        };
        let http_client = reqwest::Client::new();
        let map_provider: std::sync::Arc<dyn MapProvider> =
            std::sync::Arc::new(DisabledMapProvider);
        let acoustic_limiter = Arc::new(RateLimiter::keyed(Quota::per_minute(
            NonZeroU32::new(5).unwrap(),
        )));
        let (event_tx_inner, _) = tokio::sync::broadcast::channel::<crate::ws::ViewportEvent>(1);
        let redis_client = redis::Client::open("redis://localhost").unwrap();
        let redis = redis::aio::ConnectionManager::new(redis_client)
            .await
            .expect("Redis required — ensure Redis is running on localhost:6379");
        AppState {
            db: sqlx::PgPool::connect_lazy("postgres://localhost/test").unwrap(),
            reputation_db: sqlx::PgPool::connect_lazy("postgres://localhost/test").unwrap(),
            config: Arc::new(Config {
                database_url: "postgres://localhost/test".into(),
                redis_url: "redis://localhost".into(),
                port: 3000,
                internal_service_secret: "secret".into(),
                circle_token_secret: "test-circle-secret".into(),
                trust_proxy: false,
                max_db_connections: 5,
                map_api_enabled: false,
                stadia_api_key: None,
                mapbox_token: None,
                vapid_private_key: None,
                vapid_public_key: None,
                vapid_subject: None,
                ws_events_rate_cap: 30,
                public_base_url: Some(BASE.to_string()),
                synthesis_enabled: false,
                nlp_synthesis_enabled: false,
                soft_visibility_enabled: false,
                emergency_mode_enabled: false,
                acoustic_confirm_enabled: false,
                consensus_require_established: false,
                vouch_genesis_roots: vec![],
                vouch_budget: 5,
                trust_worker_tick_secs: 3600,
                reputation_decay_enabled: false,
                reputation_decay_grace_days: 90,
                reputation_decay_horizon_days: 180,
                reputation_decay_floor: 0,
                quality_min_sample: 5,
                observatory_snapshot_retention_days: 180,
                safe_circle_location_enabled: false,
            }),
            http_client,
            hub: Arc::new(WsHub::new()),
            circle_hub: Arc::new(CircleHub::new()),
            redis_healthy: Arc::new(AtomicBool::new(false)),
            workers_healthy: Arc::new(AtomicBool::new(true)),
            map_provider,
            acoustic_limiter,
            event_tx: Arc::new(event_tx_inner),
            redis,
        }
    }

    // ── AuthError IntoResponse tests ──────────────────────────────────────────

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
            AuthError::DuplicatePayloadTag,
            AuthError::UrlMismatch {
                expected: "a".into(),
                got: "b".into(),
            },
            AuthError::MethodMismatch {
                expected: "POST".into(),
                got: "GET".into(),
            },
            AuthError::ReplayDetected,
        ] {
            let resp = err.into_response();
            assert_eq!(
                resp.status(),
                StatusCode::UNAUTHORIZED,
                "expected 401 for {resp:?}"
            );
        }
    }

    #[tokio::test]
    async fn auth_error_body_has_code_and_retryable_false() {
        let cases = [
            (AuthError::MissingHeader, "AUTH_MISSING_HEADER"),
            (AuthError::InvalidBase64, "AUTH_INVALID_BASE64"),
            (AuthError::InvalidEventJson, "AUTH_INVALID_EVENT_JSON"),
            (AuthError::InvalidKind, "AUTH_INVALID_KIND"),
            (AuthError::InvalidCreatedAt, "AUTH_INVALID_CREATED_AT"),
            (AuthError::TimestampExpired, "AUTH_TIMESTAMP_EXPIRED"),
            (AuthError::InvalidSignature, "AUTH_INVALID_SIGNATURE"),
            (AuthError::MissingUrlTag, "AUTH_MISSING_URL_TAG"),
            (AuthError::DuplicateUrlTag, "AUTH_DUPLICATE_URL_TAG"),
            (AuthError::MissingMethodTag, "AUTH_MISSING_METHOD_TAG"),
            (AuthError::DuplicateMethodTag, "AUTH_DUPLICATE_METHOD_TAG"),
            (AuthError::DuplicatePayloadTag, "AUTH_DUPLICATE_PAYLOAD_TAG"),
            (
                AuthError::UrlMismatch {
                    expected: "a".into(),
                    got: "b".into(),
                },
                "AUTH_URL_MISMATCH",
            ),
            (
                AuthError::MethodMismatch {
                    expected: "POST".into(),
                    got: "GET".into(),
                },
                "AUTH_METHOD_MISMATCH",
            ),
            (AuthError::ReplayDetected, "AUTH_REPLAY_DETECTED"),
        ];
        for (err, expected_code) in cases {
            let resp = err.into_response();
            let body = to_bytes(resp.into_body(), 1024).await.unwrap();
            let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(
                json["code"], expected_code,
                "wrong code for {expected_code}"
            );
            assert_eq!(
                json["retryable"], false,
                "wrong retryable for {expected_code}"
            );
        }
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

    // ── validate_nip98_request tests ──────────────────────────────────────────

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
        let err = validate_nip98_request(&parts, &state, &event)
            .await
            .unwrap_err();
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
        let err = validate_nip98_request(&parts, &state, &event)
            .await
            .unwrap_err();
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
        let err = validate_nip98_request(&parts, &state, &event)
            .await
            .unwrap_err();
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
        let err = validate_nip98_request(&parts, &state, &event)
            .await
            .unwrap_err();
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
        let err = validate_nip98_request(&parts, &state, &event)
            .await
            .unwrap_err();
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
        let err = validate_nip98_request(&parts, &state, &event)
            .await
            .unwrap_err();
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
        let err = validate_nip98_request(&parts, &state, &event)
            .await
            .unwrap_err();
        assert!(matches!(err, AuthError::DuplicateMethodTag), "got {err:?}");
    }

    #[tokio::test]
    async fn duplicate_payload_tag_rejected() {
        let state = make_state().await;
        let keys = Keys::generate();
        let ts = Timestamp::from(chrono::Utc::now().timestamp() as u64);
        let event = EventBuilder::new(Kind::Custom(27235), "")
            .tags(vec![
                Tag::parse(["u", &format!("{BASE}{ROUTE}")]).unwrap(),
                Tag::parse(["method", "POST"]).unwrap(),
                Tag::parse(["payload", "a"]).unwrap(),
                Tag::parse(["payload", "b"]).unwrap(),
            ])
            .custom_created_at(ts)
            .sign_with_keys(&keys)
            .unwrap();
        let parts = make_parts("POST", ROUTE);
        let err = validate_nip98_request(&parts, &state, &event)
            .await
            .unwrap_err();
        assert!(matches!(err, AuthError::DuplicatePayloadTag), "got {err:?}");
    }

    #[tokio::test]
    async fn url_mismatch_rejected() {
        let state = make_state().await;
        let keys = Keys::generate();
        let event = make_nip98_event(&keys, 0, &format!("{BASE}/api/other"), "POST");
        let parts = make_parts("POST", ROUTE);
        let err = validate_nip98_request(&parts, &state, &event)
            .await
            .unwrap_err();
        assert!(matches!(err, AuthError::UrlMismatch { .. }), "got {err:?}");
    }

    #[tokio::test]
    async fn method_mismatch_rejected() {
        let state = make_state().await;
        let keys = Keys::generate();
        let event = make_nip98_event(&keys, 0, &format!("{BASE}{ROUTE}"), "GET");
        let parts = make_parts("POST", ROUTE);
        let err = validate_nip98_request(&parts, &state, &event)
            .await
            .unwrap_err();
        assert!(
            matches!(err, AuthError::MethodMismatch { .. }),
            "got {err:?}"
        );
    }

    #[tokio::test]
    async fn replay_attack_rejected() {
        let state = make_state().await;
        let keys = Keys::generate();
        let event = make_nip98_event(&keys, 0, &format!("{BASE}{ROUTE}"), "POST");
        let parts = make_parts("POST", ROUTE);
        validate_nip98_request(&parts, &state, &event)
            .await
            .expect("first request must pass");
        let err = validate_nip98_request(&parts, &state, &event)
            .await
            .unwrap_err();
        assert!(matches!(err, AuthError::ReplayDetected), "got {err:?}");
    }

    #[tokio::test]
    async fn cross_route_replay_rejected() {
        let state = make_state().await;
        let keys = Keys::generate();
        // Signed for /api/other, submitted to ROUTE — caught by URL check before replay guard
        let event = make_nip98_event(&keys, 0, &format!("{BASE}/api/other"), "POST");
        let parts = make_parts("POST", ROUTE);
        let err = validate_nip98_request(&parts, &state, &event)
            .await
            .unwrap_err();
        assert!(matches!(err, AuthError::UrlMismatch { .. }), "got {err:?}");
    }

    #[tokio::test]
    async fn redis_unavailable_returns_503() {
        use crate::{
            config::Config,
            maps::{DisabledMapProvider, MapProvider},
            ws::{circle_hub::CircleHub, hub::WsHub},
        };
        use governor::{Quota, RateLimiter};
        use std::{
            num::NonZeroU32,
            sync::{atomic::AtomicBool, Arc},
        };

        // TCP listener that accepts then immediately drops connections
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((conn, _)) = listener.accept().await {
                drop(conn);
            }
        });

        let bad_url = format!("redis://127.0.0.1:{port}");
        let redis_client = redis::Client::open(bad_url.as_str()).unwrap();
        let redis = match redis::aio::ConnectionManager::new(redis_client).await {
            Ok(r) => r,
            Err(_) => return, // ConnectionManager couldn't connect at all — skip
        };

        let http_client = reqwest::Client::new();
        let map_provider: std::sync::Arc<dyn MapProvider> =
            std::sync::Arc::new(DisabledMapProvider);
        let acoustic_limiter = Arc::new(RateLimiter::keyed(Quota::per_minute(
            NonZeroU32::new(5).unwrap(),
        )));
        let (event_tx_inner, _) = tokio::sync::broadcast::channel::<crate::ws::ViewportEvent>(1);
        let state = AppState {
            db: sqlx::PgPool::connect_lazy("postgres://localhost/test").unwrap(),
            reputation_db: sqlx::PgPool::connect_lazy("postgres://localhost/test").unwrap(),
            config: Arc::new(Config {
                database_url: "postgres://localhost/test".into(),
                redis_url: bad_url,
                port: 3000,
                internal_service_secret: "secret".into(),
                circle_token_secret: "test-circle-secret".into(),
                trust_proxy: false,
                max_db_connections: 5,
                map_api_enabled: false,
                stadia_api_key: None,
                mapbox_token: None,
                vapid_private_key: None,
                vapid_public_key: None,
                vapid_subject: None,
                ws_events_rate_cap: 30,
                public_base_url: Some(BASE.to_string()),
                synthesis_enabled: false,
                nlp_synthesis_enabled: false,
                soft_visibility_enabled: false,
                emergency_mode_enabled: false,
                acoustic_confirm_enabled: false,
                consensus_require_established: false,
                vouch_genesis_roots: vec![],
                vouch_budget: 5,
                trust_worker_tick_secs: 3600,
                reputation_decay_enabled: false,
                reputation_decay_grace_days: 90,
                reputation_decay_horizon_days: 180,
                reputation_decay_floor: 0,
                quality_min_sample: 5,
                observatory_snapshot_retention_days: 180,
                safe_circle_location_enabled: false,
            }),
            http_client,
            hub: Arc::new(WsHub::new()),
            circle_hub: Arc::new(CircleHub::new()),
            redis_healthy: Arc::new(AtomicBool::new(false)),
            workers_healthy: Arc::new(AtomicBool::new(true)),
            map_provider,
            acoustic_limiter,
            event_tx: Arc::new(event_tx_inner),
            redis,
        };

        let keys = Keys::generate();
        let event = make_nip98_event(&keys, 0, &format!("{BASE}{ROUTE}"), "POST");
        let parts = make_parts("POST", ROUTE);
        let err = validate_nip98_request(&parts, &state, &event)
            .await
            .unwrap_err();
        assert!(matches!(err, AuthError::RedisUnavailable), "got {err:?}");
    }

    #[tokio::test]
    async fn canonical_url_normalization_passes() {
        // Verifies that public_base_url (already normalised at startup) + request path
        // with query string is assembled correctly.
        let state = make_state().await; // uses public_base_url: Some("https://api.sentinelmesh.io")
        let keys = Keys::generate();
        let canonical = "https://api.sentinelmesh.io/api/acoustic/signals?foo=bar";
        let event = make_nip98_event(&keys, 0, canonical, "POST");
        let parts = make_parts("POST", "/api/acoustic/signals?foo=bar");
        let result = validate_nip98_request(&parts, &state, &event).await;
        assert!(result.is_ok(), "normalised URL must match: {result:?}");
    }

    #[tokio::test]
    async fn canonical_url_host_header_port_stripping() {
        use crate::{
            config::Config,
            maps::{DisabledMapProvider, MapProvider},
            ws::{circle_hub::CircleHub, hub::WsHub},
        };
        use governor::{Quota, RateLimiter};
        use std::{
            num::NonZeroU32,
            sync::{atomic::AtomicBool, Arc},
        };

        let redis_client = redis::Client::open("redis://localhost").unwrap();
        let redis = redis::aio::ConnectionManager::new(redis_client)
            .await
            .expect("Redis required");
        let http_client = reqwest::Client::new();
        let map_provider: std::sync::Arc<dyn MapProvider> =
            std::sync::Arc::new(DisabledMapProvider);
        let acoustic_limiter = Arc::new(RateLimiter::keyed(Quota::per_minute(
            NonZeroU32::new(5).unwrap(),
        )));
        let (event_tx_inner, _) = tokio::sync::broadcast::channel::<crate::ws::ViewportEvent>(1);
        // No public_base_url — exercises the Host-header fallback
        let state = AppState {
            db: sqlx::PgPool::connect_lazy("postgres://localhost/test").unwrap(),
            reputation_db: sqlx::PgPool::connect_lazy("postgres://localhost/test").unwrap(),
            config: Arc::new(Config {
                database_url: "postgres://localhost/test".into(),
                redis_url: "redis://localhost".into(),
                port: 3000,
                internal_service_secret: "secret".into(),
                circle_token_secret: "test-circle-secret".into(),
                trust_proxy: false,
                max_db_connections: 5,
                map_api_enabled: false,
                stadia_api_key: None,
                mapbox_token: None,
                vapid_private_key: None,
                vapid_public_key: None,
                vapid_subject: None,
                ws_events_rate_cap: 30,
                public_base_url: None,
                synthesis_enabled: false,
                nlp_synthesis_enabled: false,
                soft_visibility_enabled: false,
                emergency_mode_enabled: false,
                acoustic_confirm_enabled: false,
                consensus_require_established: false,
                vouch_genesis_roots: vec![],
                vouch_budget: 5,
                trust_worker_tick_secs: 3600,
                reputation_decay_enabled: false,
                reputation_decay_grace_days: 90,
                reputation_decay_horizon_days: 180,
                reputation_decay_floor: 0,
                quality_min_sample: 5,
                observatory_snapshot_retention_days: 180,
                safe_circle_location_enabled: false,
            }),
            http_client,
            hub: Arc::new(WsHub::new()),
            circle_hub: Arc::new(CircleHub::new()),
            redis_healthy: Arc::new(AtomicBool::new(false)),
            workers_healthy: Arc::new(AtomicBool::new(true)),
            map_provider,
            acoustic_limiter,
            event_tx: Arc::new(event_tx_inner),
            redis,
        };

        let keys = Keys::generate();
        // Host header has :443 — canonical_url should strip it
        // The u tag matches the normalised form (no :443)
        let (mut parts, _) = Request::builder()
            .method("POST")
            .uri(ROUTE)
            .header("host", "api.sentinelmesh.io:443")
            .body(())
            .unwrap()
            .into_parts();
        let _ = &mut parts; // suppress unused warning
        let canonical = "https://api.sentinelmesh.io/api/acoustic/signals";
        let event = make_nip98_event(&keys, 0, canonical, "POST");
        let result = validate_nip98_request(&parts, &state, &event).await;
        assert!(
            result.is_ok(),
            "port :443 must be stripped from Host header: {result:?}"
        );
    }

    #[tokio::test]
    async fn different_event_ids_are_independently_accepted() {
        // Simulates TTL expiry by using a fresh event id (different keys → different id).
        // Each unique event id gets its own replay-guard slot; different signers → different ids.
        let state = make_state().await;
        let keys = Keys::generate();
        let event = make_nip98_event(&keys, 0, &format!("{BASE}{ROUTE}"), "POST");
        let parts = make_parts("POST", ROUTE);
        validate_nip98_request(&parts, &state, &event)
            .await
            .expect("first ok");

        // Different keys → different event id → accepted (simulates post-TTL acceptance)
        let keys2 = Keys::generate();
        let event2 = make_nip98_event(&keys2, 0, &format!("{BASE}{ROUTE}"), "POST");
        validate_nip98_request(&parts, &state, &event2)
            .await
            .expect("different event id must be accepted");
    }
}
