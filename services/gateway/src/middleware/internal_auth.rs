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
            Self::InvalidToken => "invalid bearer token",
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

        let raw = header
            .to_str()
            .map_err(|_| InternalAuthRejection::InvalidToken)?;
        let token = raw
            .strip_prefix("Bearer ")
            .ok_or(InternalAuthRejection::InvalidToken)?;

        let expected = state.config.internal_service_secret.as_bytes();
        let provided = token.as_bytes();

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
    use axum::{body::Body, http::Request, routing::post, Router};
    use std::sync::{atomic::AtomicBool, Arc};
    use tower::ServiceExt;

    async fn make_state(secret: &str) -> AppState {
        use crate::{
            config::Config,
            maps::{DisabledMapProvider, MapProvider},
            ws::{circle_hub::CircleHub, hub::WsHub},
        };
        use governor::{Quota, RateLimiter};
        use std::num::NonZeroU32;
        let http_client = reqwest::Client::new();
        let map_provider: Arc<dyn MapProvider> = Arc::new(DisabledMapProvider);
        let acoustic_limiter = Arc::new(RateLimiter::keyed(Quota::per_minute(
            NonZeroU32::new(5).unwrap(),
        )));
        let (event_tx_inner, _) = tokio::sync::broadcast::channel::<crate::ws::ViewportEvent>(1);
        let redis_client = redis::Client::open("redis://localhost").unwrap();
        let redis = redis::aio::ConnectionManager::new(redis_client)
            .await
            .expect("Redis required for gateway tests — ensure Redis is running on localhost:6379");
        AppState {
            db: sqlx::PgPool::connect_lazy("postgres://localhost/test").unwrap(),
            reputation_db: sqlx::PgPool::connect_lazy("postgres://localhost/test").unwrap(),
            config: Arc::new(Config {
                database_url: "postgres://localhost/test".into(),
                redis_url: "redis://localhost".into(),
                port: 3000,
                internal_service_secret: secret.into(),
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
                gateway_replicas: 1,
                relay_webhook_secret: None,
                relay_webhook_allowed_source: None,
                chat_push_enabled: false,
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
