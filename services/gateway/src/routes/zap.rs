use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::Json,
    routing::post,
    Router,
};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::Sha256;
use subtle::ConstantTimeEq;
use uuid::Uuid;

use crate::{error::AppError, AppState};

type HmacSha256 = Hmac<Sha256>;

#[derive(Deserialize)]
struct ZapRequestBody {
    report_id: Uuid,
    amount_sats: i64,
}

#[derive(Deserialize)]
struct WebhookBody {
    payment_hash: String,
}

fn verify_hmac(secret: &str, body: &[u8], provided_hex_sig: &str) -> bool {
    let Ok(provided) = hex::decode(provided_hex_sig) else {
        return false;
    };
    let Ok(mut mac) = HmacSha256::new_from_slice(secret.as_bytes()) else {
        return false;
    };
    mac.update(body);
    let computed = mac.finalize().into_bytes();
    computed.as_slice().ct_eq(&provided).into()
}

async fn zap_request(
    State(state): State<AppState>,
    Json(body): Json<ZapRequestBody>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let (lnd_url, lnd_mac) = match (&state.config.lnd_rest_url, &state.config.lnd_macaroon_hex) {
        (Some(u), Some(m)) => (u.clone(), m.clone()),
        _ => return Err(AppError::BadRequest("LND not configured".into())),
    };

    let lnd = crate::lightning::lnd_client::LndClient::new(
        &lnd_url,
        &lnd_mac,
        state.config.lnd_tls_skip_verify,
    )
    .map_err(AppError::Internal)?;

    if body.amount_sats <= 0 {
        return Err(AppError::BadRequest("amount_sats must be positive".into()));
    }

    let result =
        crate::lightning::zap_service::create_zap_request(&state.db, &lnd, body.report_id, body.amount_sats)
            .await
            .map_err(|e| {
                if e.to_string().contains("not found") {
                    AppError::NotFound
                } else if e.to_string().contains("maximum") {
                    AppError::BadRequest(e.to_string())
                } else {
                    AppError::Internal(e)
                }
            })?;

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "zap_id": result.zap_id,
            "payment_request": result.payment_request,
            "amount_sats": result.amount_sats,
        })),
    ))
}

async fn webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<serde_json::Value>, AppError> {
    let sig = headers
        .get("x-lnd-signature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if !verify_hmac(&state.config.zap_webhook_secret, &body, sig) {
        return Err(AppError::Unauthorized);
    }

    let parsed: WebhookBody = serde_json::from_slice(&body)
        .map_err(|_| AppError::BadRequest("invalid JSON body".into()))?;

    crate::lightning::zap_service::handle_payment_webhook(
        &state.db,
        &parsed.payment_hash,
        state.config.nostr_private_key.as_deref(),
    )
    .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/request", post(zap_request))
        .route("/webhook", post(webhook))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_hmac_passes() {
        let secret = "test-secret";
        let body = b"hello world";
        let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(body);
        let sig = hex::encode(mac.finalize().into_bytes());
        assert!(verify_hmac(secret, body, &sig));
    }

    #[test]
    fn wrong_sig_fails() {
        assert!(!verify_hmac("secret", b"body", "deadbeef"));
    }

    #[test]
    fn tampered_body_fails() {
        let secret = "test-secret";
        let body = b"original";
        let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(body);
        let sig = hex::encode(mac.finalize().into_bytes());
        assert!(!verify_hmac(secret, b"tampered", &sig));
    }
}
