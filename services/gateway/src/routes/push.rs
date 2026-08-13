use axum::{
    body::Bytes, extract::State, http::StatusCode, response::IntoResponse, routing::post, Router,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::AppError;
use crate::{middleware::nostr_auth::NostrAuth, AppState};

#[derive(Deserialize)]
struct SubscribeRequest {
    subscription: PushSubscriptionJson,
    min_severity: String,
    center_lat: f64,
    center_lng: f64,
    radius_km: f64,
}

#[derive(Deserialize, Serialize)]
struct PushSubscriptionJson {
    endpoint: String,
    keys: PushSubscriptionKeys,
}

#[derive(Deserialize, Serialize)]
struct PushSubscriptionKeys {
    p256dh: String,
    auth: String,
}

async fn subscribe(
    State(state): State<AppState>,
    auth: NostrAuth,
    body: Bytes,
) -> Result<impl IntoResponse, AppError> {
    verify_payload_binding(&auth, &body)?;
    let req: SubscribeRequest = serde_json::from_slice(&body)
        .map_err(|_| AppError::BadRequest("invalid push subscription".into()))?;
    validate_subscription(&req)?;
    // Bind the subscription to the NIP-98-authenticated pubkey. The client can no
    // longer register a subscription under an arbitrary identity.
    let rows = sqlx::query(
        "INSERT INTO push_subscriptions
           (nostr_pubkey, endpoint, p256dh, auth, min_severity, center_lat, center_lng, radius_km, center_geog, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                 ST_SetSRID(ST_MakePoint($7, $6), 4326)::geography, NOW())
         ON CONFLICT (endpoint) DO UPDATE SET
           nostr_pubkey = EXCLUDED.nostr_pubkey,
           p256dh       = EXCLUDED.p256dh,
           auth         = EXCLUDED.auth,
           min_severity = EXCLUDED.min_severity,
           center_lat   = EXCLUDED.center_lat,
           center_lng   = EXCLUDED.center_lng,
           radius_km    = EXCLUDED.radius_km,
           center_geog  = EXCLUDED.center_geog,
           updated_at   = NOW()
         WHERE push_subscriptions.nostr_pubkey = EXCLUDED.nostr_pubkey",
    )
    .bind(&auth.pubkey)
    .bind(&req.subscription.endpoint)
    .bind(&req.subscription.keys.p256dh)
    .bind(&req.subscription.keys.auth)
    .bind(&req.min_severity)
    .bind(req.center_lat)
    .bind(req.center_lng)
    .bind(req.radius_km)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("push subscribe DB error: {e}");
        AppError::Internal(e.into())
    })?
    .rows_affected();

    if rows == 0 {
        return Err(AppError::Conflict(
            "push endpoint belongs to another identity".into(),
        ));
    }

    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct UnsubscribeRequest {
    endpoint: String,
}

async fn unsubscribe(
    State(state): State<AppState>,
    auth: NostrAuth,
    body: Bytes,
) -> Result<StatusCode, AppError> {
    verify_payload_binding(&auth, &body)?;
    let req: UnsubscribeRequest = serde_json::from_slice(&body)
        .map_err(|_| AppError::BadRequest("invalid unsubscribe request".into()))?;
    if req.endpoint.len() > 2048 || !req.endpoint.starts_with("https://") {
        return Err(AppError::BadRequest("invalid push endpoint".into()));
    }
    sqlx::query("DELETE FROM push_subscriptions WHERE endpoint = $1 AND nostr_pubkey = $2")
        .bind(req.endpoint)
        .bind(auth.pubkey)
        .execute(&state.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

fn verify_payload_binding(auth: &NostrAuth, body: &[u8]) -> Result<(), AppError> {
    let expected = hex::encode(Sha256::digest(body));
    if auth.payload.as_deref() != Some(expected.as_str()) {
        return Err(AppError::Unauthorized);
    }
    Ok(())
}

fn validate_subscription(req: &SubscribeRequest) -> Result<(), AppError> {
    if req.subscription.endpoint.len() > 2048
        || !req.subscription.endpoint.starts_with("https://")
        || req.subscription.keys.p256dh.is_empty()
        || req.subscription.keys.p256dh.len() > 512
        || req.subscription.keys.auth.is_empty()
        || req.subscription.keys.auth.len() > 256
        || !matches!(
            req.min_severity.as_str(),
            "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
        )
        || !(-90.0..=90.0).contains(&req.center_lat)
        || !(-180.0..=180.0).contains(&req.center_lng)
        || !(1.0..=100.0).contains(&req.radius_km)
    {
        return Err(AppError::BadRequest(
            "invalid push subscription preferences".into(),
        ));
    }
    Ok(())
}

pub fn router() -> Router<AppState> {
    Router::new().route("/subscribe", post(subscribe).delete(unsubscribe))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> SubscribeRequest {
        SubscribeRequest {
            subscription: PushSubscriptionJson {
                endpoint: "https://push.example/subscription".into(),
                keys: PushSubscriptionKeys {
                    p256dh: "key".into(),
                    auth: "auth".into(),
                },
            },
            min_severity: "HIGH".into(),
            center_lat: -1.29,
            center_lng: 36.82,
            radius_km: 15.0,
        }
    }

    #[test]
    fn validates_targeted_subscription_bounds() {
        assert!(validate_subscription(&request()).is_ok());
        let mut invalid = request();
        invalid.radius_km = 101.0;
        assert!(validate_subscription(&invalid).is_err());
        invalid = request();
        invalid.subscription.endpoint = "http://push.example/subscription".into();
        assert!(validate_subscription(&invalid).is_err());
    }

    #[test]
    fn requires_exact_payload_hash() {
        let body = br#"{"subscription":{}}"#;
        let auth = NostrAuth {
            pubkey: "a".repeat(64),
            payload: Some(hex::encode(Sha256::digest(body))),
        };
        assert!(verify_payload_binding(&auth, body).is_ok());
        assert!(verify_payload_binding(&auth, b"{}").is_err());
    }
}
