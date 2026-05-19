use axum::{extract::State, http::StatusCode, response::IntoResponse, routing::post, Json, Router};
use serde::{Deserialize, Serialize};
use web_push::{
    ContentEncoding, HyperWebPushClient, SubscriptionInfo, URL_SAFE_NO_PAD,
    VapidSignatureBuilder, WebPushClient, WebPushMessageBuilder,
};

use crate::AppState;

#[derive(Deserialize)]
struct SubscribeRequest {
    nostr_pubkey: String,
    subscription: PushSubscriptionJson,
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
    Json(req): Json<SubscribeRequest>,
) -> impl IntoResponse {
    sqlx::query(
        "INSERT INTO push_subscriptions (nostr_pubkey, endpoint, p256dh, auth, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (endpoint) DO UPDATE SET
           nostr_pubkey = EXCLUDED.nostr_pubkey,
           p256dh       = EXCLUDED.p256dh,
           auth         = EXCLUDED.auth,
           updated_at   = NOW()",
    )
    .bind(&req.nostr_pubkey)
    .bind(&req.subscription.endpoint)
    .bind(&req.subscription.keys.p256dh)
    .bind(&req.subscription.keys.auth)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("push subscribe DB error: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok::<_, StatusCode>(StatusCode::NO_CONTENT)
}

pub fn router() -> Router<AppState> {
    Router::new().route("/subscribe", post(subscribe))
}

/// Send a push notification to all subscriptions. Silently skips invalid/expired
/// subscriptions so one bad entry does not block the others.
pub async fn broadcast_push(
    pool: &sqlx::PgPool,
    vapid_private_key: &str,
    _vapid_subject: &str,
    title: &str,
    body: &str,
    event_id: &str,
) {
    let rows: Vec<(String, String, String)> = match sqlx::query_as(
        "SELECT endpoint, p256dh, auth FROM push_subscriptions",
    )
    .fetch_all(pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("push broadcast: DB fetch error: {e}");
            return;
        }
    };

    if rows.is_empty() {
        return;
    }

    let client = HyperWebPushClient::new();

    let payload = serde_json::json!({
        "title": title,
        "body": body,
        "event_id": event_id,
        "url": "/",
    })
    .to_string();

    for (endpoint, p256dh, auth) in &rows {
        // SubscriptionInfo::new returns SubscriptionInfo directly (infallible)
        let info = SubscriptionInfo::new(endpoint, p256dh, auth);

        let sig_builder = match VapidSignatureBuilder::from_base64(
            vapid_private_key,
            URL_SAFE_NO_PAD,
            &info,
        ) {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!("push broadcast: VAPID builder error for {endpoint}: {e}");
                continue;
            }
        };

        let signature = match sig_builder.build() {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!("push broadcast: VAPID sign error: {e}");
                continue;
            }
        };

        // WebPushMessageBuilder::new returns directly (infallible)
        let mut msg_builder = WebPushMessageBuilder::new(&info);
        msg_builder.set_payload(ContentEncoding::Aes128Gcm, payload.as_bytes());
        msg_builder.set_vapid_signature(signature);

        let message = match msg_builder.build() {
            Ok(m) => m,
            Err(e) => {
                tracing::warn!("push broadcast: message build error: {e}");
                continue;
            }
        };

        if let Err(e) = client.send(message).await {
            tracing::warn!("push broadcast: send error for {endpoint}: {e}");
        }
    }
}
