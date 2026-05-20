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

#[async_trait::async_trait]
impl<S> FromRequestParts<S> for NostrAuth
where
    S: Send + Sync,
    AppState: FromRef<S>,
{
    type Rejection = AuthError;

    async fn from_request_parts(
        parts: &mut Parts,
        _state: &S,
    ) -> Result<Self, AuthError> {
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
            assert_eq!(resp.status(), StatusCode::UNAUTHORIZED, "expected 401 for {resp:?}");
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
