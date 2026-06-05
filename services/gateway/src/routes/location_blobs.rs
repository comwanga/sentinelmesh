use crate::circles::token::circle_token;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::get,
    Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{error::AppError, middleware::nostr_auth::NostrAuth, AppState};

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct LocationBlob {
    pub id: Uuid,
    pub circle_id: Option<Uuid>,
    pub recipient_token: String,
    pub sender_ephemeral_pubkey: String,
    pub encrypted_payload: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Deserialize)]
struct PushBlobBody {
    encrypted_payload: String,
    sender_ephemeral_pubkey: String,
    recipient_pubkey: String,
}

async fn is_circle_member(
    db: &sqlx::PgPool,
    secret: &str,
    circle_id: Uuid,
    pubkey: &str,
) -> anyhow::Result<bool> {
    let token = circle_token(secret, circle_id, pubkey);
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM (
           SELECT 1 FROM circle_members WHERE circle_id = $1 AND member_token = $2
           UNION
           SELECT 1 FROM circles WHERE id = $1 AND owner_token = $2
         ) sub",
    )
    .bind(circle_id)
    .bind(&token)
    .fetch_one(db)
    .await?;
    Ok(count > 0)
}

async fn push_blob(
    State(state): State<AppState>,
    auth: NostrAuth,
    Path(circle_id): Path<Uuid>,
    Json(body): Json<PushBlobBody>,
) -> Result<(StatusCode, Json<LocationBlob>), AppError> {
    let secret = &state.config.circle_token_secret;
    if !is_circle_member(&state.db, secret, circle_id, &auth.pubkey).await? {
        return Err(AppError::Forbidden);
    }
    let recipient_token = circle_token(secret, circle_id, &body.recipient_pubkey);

    let blob = sqlx::query_as::<_, LocationBlob>(
        "INSERT INTO location_blobs (id, circle_id, recipient_token, sender_ephemeral_pubkey, encrypted_payload, expires_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW() + INTERVAL '10 minutes')
         RETURNING *",
    )
    .bind(circle_id)
    .bind(&recipient_token)
    .bind(&body.sender_ephemeral_pubkey)
    .bind(&body.encrypted_payload)
    .fetch_one(&state.db)
    .await?;

    let msg = serde_json::json!({ "type": "CIRCLE_LOCATION_BLOB", "payload": blob }).to_string();
    state.circle_hub.broadcast(circle_id, msg.into());

    Ok((StatusCode::CREATED, Json(blob)))
}

async fn list_blobs(
    State(state): State<AppState>,
    auth: NostrAuth,
    Path(circle_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let secret = &state.config.circle_token_secret;
    if !is_circle_member(&state.db, secret, circle_id, &auth.pubkey).await? {
        return Err(AppError::Forbidden);
    }
    let recipient_token = circle_token(secret, circle_id, &auth.pubkey);

    let blobs = sqlx::query_as::<_, LocationBlob>(
        "SELECT * FROM location_blobs
         WHERE circle_id = $1 AND recipient_token = $2 AND expires_at > NOW()",
    )
    .bind(circle_id)
    .bind(&recipient_token)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "blobs": blobs })))
}

pub fn router() -> Router<AppState> {
    Router::new().route("/:id/location", get(list_blobs).post(push_blob))
}

impl From<LocationBlob> for sentinel_core::LocationBlob {
    fn from(row: LocationBlob) -> Self {
        Self {
            id: row.id,
            circle_id: row.circle_id.unwrap_or(Uuid::nil()),
            recipient_token: row.recipient_token,
            sender_ephemeral_pubkey: row.sender_ephemeral_pubkey,
            encrypted_payload: row.encrypted_payload,
            created_at: row.created_at,
            expires_at: row.expires_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::DateTime;
    use uuid::Uuid;

    #[test]
    fn location_blob_converts_to_domain() {
        let id = Uuid::new_v4();
        let cid = Uuid::new_v4();
        let created = DateTime::from_timestamp(0, 0).unwrap();
        let expires = DateTime::from_timestamp(600, 0).unwrap();
        let row = LocationBlob {
            id,
            circle_id: Some(cid),
            recipient_token: "v1:hash".into(),
            sender_ephemeral_pubkey: "ephpubkey".into(),
            encrypted_payload: "ciphertext".into(),
            created_at: created,
            expires_at: expires,
        };
        let d = sentinel_core::LocationBlob::from(row);
        assert_eq!(d.id, id);
        assert_eq!(d.circle_id, cid);
        assert_eq!(d.recipient_token, "v1:hash");
        assert_eq!(d.sender_ephemeral_pubkey, "ephpubkey");
        assert_eq!(d.encrypted_payload, "ciphertext");
        assert_eq!(d.created_at, created);
        assert_eq!(d.expires_at, expires);
    }
}
