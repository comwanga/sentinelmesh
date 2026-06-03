use axum::{
    async_trait,
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use subtle::ConstantTimeEq;

use crate::AppState;

pub struct InternalServiceAuth;

#[derive(Debug)]
pub enum InternalAuthRejection {
    MissingHeader,
    InvalidToken,
}

impl IntoResponse for InternalAuthRejection {
    fn into_response(self) -> Response {
        let msg = match &self {
            Self::MissingHeader => "missing Authorization header",
            Self::InvalidToken  => "invalid bearer token",
        };
        (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "code": "UNAUTHORIZED", "message": msg, "retryable": false })),
        )
            .into_response()
    }
}

#[async_trait]
impl FromRequestParts<AppState> for InternalServiceAuth {
    type Rejection = InternalAuthRejection;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let header = parts
            .headers
            .get("authorization")
            .ok_or(InternalAuthRejection::MissingHeader)?;

        let raw = header.to_str().map_err(|_| InternalAuthRejection::InvalidToken)?;
        let token = raw
            .strip_prefix("Bearer ")
            .ok_or(InternalAuthRejection::InvalidToken)?;

        let expected = state.config.internal_service_secret.as_bytes();
        let provided  = token.as_bytes();

        // Constant-time comparison to prevent timing attacks
        let ok: bool = if expected.len() == provided.len() {
            expected.ct_eq(provided).into()
        } else {
            false
        };

        if ok {
            Ok(InternalServiceAuth)
        } else {
            Err(InternalAuthRejection::InvalidToken)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{atomic::AtomicBool, Arc};
    use axum::{body::Body, extract::State, http::Request, routing::post, Router};
    use tower::ServiceExt;

    async fn make_state(secret: &str) -> AppState {
        use crate::{config::Config, maps::{MapboxAdapter, MapProvider}, ws::{hub::WsHub, circle_hub::CircleHub}};
        use governor::{Quota, RateLimiter};
        use std::num::NonZeroU32;
        let http_client = reqwest::Client::new();
        let map_provider: Arc<dyn MapProvider> = Arc::new(
            MapboxAdapter::new(http_client.clone(), String::new())
        );
        let acoustic_limiter = Arc::new(RateLimiter::keyed(
            Quota::per_minute(NonZeroU32::new(5).unwrap()),
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
                blockchain_service_url: None,
                internal_service_secret: secret.into(),
                trust_proxy: false,
                max_db_connections: 5,
                mapbox_token: None,
                vapid_private_key: None,
                vapid_public_key: None,
                vapid_subject: None,
                ws_events_rate_cap: 30,
                public_base_url: None,
                synthesis_enabled: false,
                soft_visibility_enabled: false,
                emergency_mode_enabled: false,
                acoustic_confirm_enabled: false,
                consensus_require_established: false,
            }),
            http_client,
            hub: Arc::new(WsHub::new()),
            circle_hub: Arc::new(CircleHub::new()),
            redis_healthy: Arc::new(AtomicBool::new(false)),
            map_provider,
            acoustic_limiter,
            event_tx: Arc::new(event_tx_inner),
            redis,
        }
    }

    async fn test_app(secret: &str) -> Router {
        let state = make_state(secret).await;
        Router::new()
            .route(
                "/protected",
                post(|_auth: InternalServiceAuth| async { "ok" }),
            )
            .with_state(state)
    }

    #[tokio::test]
    async fn missing_header_returns_401() {
        let app = test_app("supersecret").await;
        let resp = app
            .oneshot(Request::post("/protected").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn wrong_token_returns_401() {
        let app = test_app("supersecret").await;
        let resp = app
            .oneshot(
                Request::post("/protected")
                    .header("authorization", "Bearer wrongtoken")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn correct_token_passes() {
        let app = test_app("supersecret").await;
        let resp = app
            .oneshot(
                Request::post("/protected")
                    .header("authorization", "Bearer supersecret")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }
}
