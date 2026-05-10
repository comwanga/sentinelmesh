use axum::{
    async_trait,
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
    response::{IntoResponse, Response},
    Json,
};

pub struct NostrAuth {
    pub pubkey: String,
}

#[derive(Debug)]
pub enum NostrAuthRejection {
    MissingHeader,
    InvalidJson,
    WrongKind,
    Expired,
    InvalidSignature,
}

impl IntoResponse for NostrAuthRejection {
    fn into_response(self) -> Response {
        let msg = match &self {
            Self::MissingHeader    => "missing X-Nostr-Auth header",
            Self::InvalidJson      => "X-Nostr-Auth is not valid JSON",
            Self::WrongKind        => "event kind must be 27235",
            Self::Expired          => "event created_at is outside ±60s window",
            Self::InvalidSignature => "invalid Nostr signature",
        };
        (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "code": "UNAUTHORIZED", "message": msg, "retryable": false })),
        )
            .into_response()
    }
}

#[async_trait]
impl<S: Send + Sync> FromRequestParts<S> for NostrAuth {
    type Rejection = NostrAuthRejection;

    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        let header = parts
            .headers
            .get("x-nostr-auth")
            .ok_or(NostrAuthRejection::MissingHeader)?;

        let raw = header.to_str().map_err(|_| NostrAuthRejection::InvalidJson)?;
        let event: nostr_sdk::Event =
            serde_json::from_str(raw).map_err(|_| NostrAuthRejection::InvalidJson)?;

        if event.kind != nostr_sdk::Kind::Custom(27235) {
            return Err(NostrAuthRejection::WrongKind);
        }

        let now = chrono::Utc::now().timestamp();
        let event_ts = event.created_at.as_u64() as i64;
        if (now - event_ts).abs() > 60 {
            return Err(NostrAuthRejection::Expired);
        }

        event.verify().map_err(|_| NostrAuthRejection::InvalidSignature)?;

        Ok(NostrAuth { pubkey: event.pubkey.to_hex() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request, routing::get, Router};
    use nostr_sdk::{EventBuilder, Keys, Kind, Timestamp};
    use tower::ServiceExt;

    fn make_auth_event(keys: &Keys, kind: u16, offset_secs: i64) -> String {
        let ts = Timestamp::from(
            (chrono::Utc::now().timestamp() + offset_secs) as u64
        );
        let event = EventBuilder::new(Kind::Custom(kind), "")
            .custom_created_at(ts)
            .sign_with_keys(keys)
            .unwrap();
        serde_json::to_string(&event).unwrap()
    }

    async fn test_app() -> Router {
        Router::new().route("/protected", get(|_auth: NostrAuth| async { "ok" }))
    }

    #[tokio::test]
    async fn missing_header_returns_401() {
        let app = test_app().await;
        let resp = app
            .oneshot(Request::get("/protected").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn wrong_kind_returns_401() {
        let keys = Keys::generate();
        let header = make_auth_event(&keys, 1, 0);
        let app = test_app().await;
        let resp = app
            .oneshot(
                Request::get("/protected")
                    .header("x-nostr-auth", header)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn expired_event_returns_401() {
        let keys = Keys::generate();
        let header = make_auth_event(&keys, 27235, -120);
        let app = test_app().await;
        let resp = app
            .oneshot(
                Request::get("/protected")
                    .header("x-nostr-auth", header)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn valid_event_passes() {
        let keys = Keys::generate();
        let header = make_auth_event(&keys, 27235, 0);
        let app = test_app().await;
        let resp = app
            .oneshot(
                Request::get("/protected")
                    .header("x-nostr-auth", header)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }
}
