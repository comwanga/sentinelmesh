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
    pub circle_id: Uuid,
    pub sender_pubkey: String,
    pub encrypted_payload: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Deserialize)]
struct PushBlobBody {
    encrypted_payload: String,
}

async fn is_circle_member(db: &sqlx::PgPool, circle_id: Uuid, pubkey: &str) -> anyhow::Result<bool> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM (
           SELECT 1 FROM circle_members WHERE circle_id = $1 AND member_pubkey = $2
           UNION
           SELECT 1 FROM circles WHERE id = $1 AND owner_pubkey = $2
         ) sub",
    )
    .bind(circle_id)
    .bind(pubkey)
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
    if !is_circle_member(&state.db, circle_id, &auth.pubkey).await? {
        return Err(AppError::Forbidden);
    }

    let blob = sqlx::query_as::<_, LocationBlob>(
        "INSERT INTO location_blobs (id, circle_id, sender_pubkey, encrypted_payload, expires_at)
         VALUES (gen_random_uuid(), $1, $2, $3, NOW() + INTERVAL '10 minutes')
         RETURNING *",
    )
    .bind(circle_id)
    .bind(&auth.pubkey)
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
    if !is_circle_member(&state.db, circle_id, &auth.pubkey).await? {
        return Err(AppError::Forbidden);
    }

    let blobs = sqlx::query_as::<_, LocationBlob>(
        "SELECT * FROM location_blobs WHERE circle_id = $1 AND expires_at > NOW()",
    )
    .bind(circle_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "blobs": blobs })))
}

pub fn router() -> Router<AppState> {
    Router::new().route("/:id/location", get(list_blobs).post(push_blob))
}
