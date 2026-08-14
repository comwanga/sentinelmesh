use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::post,
    Router,
};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::Sha256;

use crate::{error::AppError, AppState};

type HmacSha256 = Hmac<Sha256>;

const WEBHOOK_KIND_GIFT_WRAP: i32 = 1059;
const WEBHOOK_TIMESTAMP_TOLERANCE_SECS: i64 = 300;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct InboxWebhookBody {
    outer_event_id: String,
    recipient_p: String,
    kind: u16,
}

/// Constant-time HMAC-SHA256 verification of a `sha256=<hex>` signature header.
fn verify_hmac(secret: &str, body: &[u8], signature_header: &str) -> bool {
    let Some(hex_digest) = signature_header.strip_prefix("sha256=") else {
        return false;
    };
    let Ok(expected) = hex::decode(hex_digest) else {
        return false;
    };
    let Ok(mut mac) = HmacSha256::new_from_slice(secret.as_bytes()) else {
        return false;
    };
    mac.update(body);
    mac.verify_slice(&expected).is_ok()
}

fn is_hex64(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit())
}

fn validate_body(body: &InboxWebhookBody) -> bool {
    body.kind == WEBHOOK_KIND_GIFT_WRAP as u16
        && is_hex64(&body.outer_event_id)
        && is_hex64(&body.recipient_p)
}

async fn inbox_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, AppError> {
    let Some(secret) = state.config.relay_webhook_secret.as_deref() else {
        return Err(AppError::Unavailable);
    };

    let signature = headers
        .get("x-relay-signature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !verify_hmac(secret, &body, signature) {
        return Err(AppError::Unauthorized);
    }

    let timestamp_ok = headers
        .get("x-relay-timestamp")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<i64>().ok())
        .map(|ts| (chrono::Utc::now().timestamp() - ts).abs() <= WEBHOOK_TIMESTAMP_TOLERANCE_SECS)
        .unwrap_or(false);
    if !timestamp_ok {
        return Err(AppError::Unauthorized);
    }

    if let Some(allowed) = state.config.relay_webhook_allowed_source.as_deref() {
        let source = headers
            .get("x-relay-source")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if source != allowed {
            return Err(AppError::Unauthorized);
        }
    }

    let delivery_id = headers
        .get("x-relay-delivery")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if delivery_id.is_empty() || delivery_id.len() > 256 {
        return Err(AppError::BadRequest("missing relay delivery id".into()));
    }

    let payload: InboxWebhookBody = serde_json::from_slice(&body)
        .map_err(|_| AppError::BadRequest("invalid webhook payload".into()))?;
    if !validate_body(&payload) {
        return Err(AppError::BadRequest("invalid webhook payload".into()));
    }

    let inserted = sqlx::query(
        "INSERT INTO relay_webhook_receipts (delivery_id, relay_event_id, recipient_pubkey, kind)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (relay_event_id) DO NOTHING",
    )
    .bind(delivery_id)
    .bind(&payload.outer_event_id)
    .bind(&payload.recipient_p)
    .bind(payload.kind as i32)
    .execute(&state.db)
    .await?
    .rows_affected();
    if inserted == 0 {
        return Ok(StatusCode::OK);
    }

    if state.config.chat_push_enabled {
        let payload_json = serde_json::json!({ "title": "New encrypted message" });
        sqlx::query(
            "INSERT INTO chat_push_deliveries (subscription_id, dedupe_key, payload)
             SELECT s.id, $2 || ':' || s.id, $3
               FROM push_subscriptions s
               LEFT JOIN chat_notification_preferences p ON p.nostr_pubkey = s.nostr_pubkey
              WHERE s.nostr_pubkey = $1 AND COALESCE(p.dm_enabled, true)
             ON CONFLICT (dedupe_key) DO NOTHING",
        )
        .bind(&payload.recipient_p)
        .bind(&payload.outer_event_id)
        .bind(&payload_json)
        .execute(&state.db)
        .await?;
    }

    Ok(StatusCode::OK)
}

pub fn router() -> Router<AppState> {
    Router::new().route("/inbox", post(inbox_webhook))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hmac_verifies_matching_signature() {
        let secret = "test-secret";
        let body = br#"{"outer_event_id":"abc"}"#;
        let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(body);
        let sig = format!("sha256={}", hex::encode(mac.finalize().into_bytes()));
        assert!(verify_hmac(secret, body, &sig));
    }

    #[test]
    fn hmac_rejects_wrong_secret_and_malformed_header() {
        let body = br#"{"outer_event_id":"abc"}"#;
        let mut mac = HmacSha256::new_from_slice("right".as_bytes()).unwrap();
        mac.update(body);
        let sig = format!("sha256={}", hex::encode(mac.finalize().into_bytes()));
        assert!(!verify_hmac("wrong", body, &sig));
        assert!(!verify_hmac("right", body, "not-a-signature"));
        assert!(!verify_hmac("right", body, "sha256=zz"));
    }

    #[test]
    fn validates_webhook_body_shape() {
        let good = InboxWebhookBody {
            outer_event_id: "a".repeat(64),
            recipient_p: "b".repeat(64),
            kind: 1059,
        };
        assert!(validate_body(&good));

        let bad_kind = InboxWebhookBody {
            outer_event_id: "a".repeat(64),
            recipient_p: "b".repeat(64),
            kind: 1,
        };
        assert!(!validate_body(&bad_kind));

        let bad_id = InboxWebhookBody {
            outer_event_id: "short".into(),
            recipient_p: "b".repeat(64),
            kind: 1059,
        };
        assert!(!validate_body(&bad_id));
    }
}
