use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::{delete, get, post},
    Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    circles::token::circle_token, error::AppError, middleware::nostr_auth::NostrAuth, AppState,
};

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Circle {
    pub id: Uuid,
    pub owner_token: String,
    pub name: Option<String>,
    pub name_ciphertext: Option<String>,
    pub name_version: i16,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct CircleMember {
    pub circle_id: Uuid,
    pub member_token: String,
    pub member_label_ciphertext: Option<String>,
    pub alert_radius_km: Option<f64>,
    pub alert_severity: Option<String>,
    pub joined_at: DateTime<Utc>,
}

#[derive(Deserialize)]
struct CreateCircleBody {
    name_ciphertext: String,
}

#[derive(Deserialize)]
struct AddMemberBody {
    member_pubkey: String,
    member_label_ciphertext: String,
    alert_radius_km: Option<f64>,
    alert_severity: Option<String>,
}

#[derive(Deserialize)]
struct ListCirclesQuery {
    /// Comma-separated circle UUIDs the client knows it belongs to.
    ids: Option<String>,
}

async fn list_circles(
    State(state): State<AppState>,
    auth: NostrAuth,
    Query(q): Query<ListCirclesQuery>,
) -> Result<Json<Vec<serde_json::Value>>, AppError> {
    let ids: Vec<Uuid> = q
        .ids
        .unwrap_or_default()
        .split(',')
        .filter_map(|s| Uuid::parse_str(s.trim()).ok())
        .collect();
    if ids.is_empty() {
        return Ok(Json(vec![]));
    }

    let secret = &state.config.circle_token_secret;
    let mut out = Vec::new();
    for id in ids {
        let circle = sqlx::query_as::<_, Circle>("SELECT * FROM circles WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.db)
            .await?;
        let Some(circle) = circle else { continue };
        let my_token = circle_token(secret, id, &auth.pubkey);
        let is_owner = circle.owner_token == my_token;
        let is_member = if is_owner {
            true
        } else {
            let count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM circle_members WHERE circle_id = $1 AND member_token = $2",
            )
            .bind(id)
            .bind(&my_token)
            .fetch_one(&state.db)
            .await?;
            count > 0
        };
        if !is_member {
            continue;
        }
        out.push(serde_json::json!({
            "id": circle.id,
            "name": circle.name,
            "name_ciphertext": circle.name_ciphertext,
            "name_version": circle.name_version,
            "created_at": circle.created_at,
            "is_owner": is_owner,
        }));
    }
    Ok(Json(out))
}

async fn create_circle(
    State(state): State<AppState>,
    auth: NostrAuth,
    Json(body): Json<CreateCircleBody>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let id = Uuid::new_v4();
    let owner_token = circle_token(&state.config.circle_token_secret, id, &auth.pubkey);
    let circle = sqlx::query_as::<_, Circle>(
        "INSERT INTO circles (id, owner_token, name_ciphertext, name_version)
         VALUES ($1, $2, $3, 1) RETURNING *",
    )
    .bind(id)
    .bind(&owner_token)
    .bind(&body.name_ciphertext)
    .fetch_one(&state.db)
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": circle.id,
            "name_ciphertext": circle.name_ciphertext,
            "name_version": circle.name_version,
            "created_at": circle.created_at,
            "is_owner": true,
        })),
    ))
}

async fn get_circle(
    State(state): State<AppState>,
    auth: NostrAuth,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let circle = sqlx::query_as::<_, Circle>("SELECT * FROM circles WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)?;

    let my_token = circle_token(&state.config.circle_token_secret, id, &auth.pubkey);
    let is_owner = circle.owner_token == my_token;
    if !is_owner {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM circle_members WHERE circle_id = $1 AND member_token = $2",
        )
        .bind(id)
        .bind(&my_token)
        .fetch_one(&state.db)
        .await?;
        if count == 0 {
            return Err(AppError::Forbidden);
        }
    }

    let members =
        sqlx::query_as::<_, CircleMember>("SELECT * FROM circle_members WHERE circle_id = $1")
            .bind(id)
            .fetch_all(&state.db)
            .await?;

    Ok(Json(serde_json::json!({
        "id": circle.id,
        "name": circle.name,
        "name_ciphertext": circle.name_ciphertext,
        "name_version": circle.name_version,
        "created_at": circle.created_at,
        "is_owner": is_owner,
        "members": members,
    })))
}

async fn add_member(
    State(state): State<AppState>,
    auth: NostrAuth,
    Path(id): Path<Uuid>,
    Json(body): Json<AddMemberBody>,
) -> Result<(StatusCode, Json<CircleMember>), AppError> {
    let owner_token: Option<String> =
        sqlx::query_scalar("SELECT owner_token FROM circles WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.db)
            .await?;
    let my_token = circle_token(&state.config.circle_token_secret, id, &auth.pubkey);
    if owner_token.as_deref() != Some(my_token.as_str()) {
        return Err(AppError::Forbidden);
    }

    let member_token = circle_token(&state.config.circle_token_secret, id, &body.member_pubkey);
    let member = sqlx::query_as::<_, CircleMember>(
        "INSERT INTO circle_members
           (circle_id, member_token, member_label_ciphertext, alert_radius_km, alert_severity)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (circle_id, member_token) DO UPDATE
           SET member_label_ciphertext = EXCLUDED.member_label_ciphertext,
               alert_radius_km         = EXCLUDED.alert_radius_km,
               alert_severity          = EXCLUDED.alert_severity
         RETURNING *",
    )
    .bind(id)
    .bind(&member_token)
    .bind(&body.member_label_ciphertext)
    .bind(body.alert_radius_km)
    .bind(&body.alert_severity)
    .fetch_one(&state.db)
    .await?;

    Ok((StatusCode::CREATED, Json(member)))
}

async fn remove_member(
    State(state): State<AppState>,
    auth: NostrAuth,
    Path((circle_id, member_pubkey)): Path<(Uuid, String)>,
) -> Result<StatusCode, AppError> {
    let owner_token: Option<String> =
        sqlx::query_scalar("SELECT owner_token FROM circles WHERE id = $1")
            .bind(circle_id)
            .fetch_optional(&state.db)
            .await?;
    let secret = &state.config.circle_token_secret;
    let caller_token = circle_token(secret, circle_id, &auth.pubkey);
    let target_token = circle_token(secret, circle_id, &member_pubkey);
    if owner_token.as_deref() != Some(caller_token.as_str()) && caller_token != target_token {
        return Err(AppError::Forbidden);
    }

    sqlx::query("DELETE FROM circle_members WHERE circle_id = $1 AND member_token = $2")
        .bind(circle_id)
        .bind(&target_token)
        .execute(&state.db)
        .await?;

    let msg = serde_json::json!({ "type": "MEMBER_REMOVED", "token": target_token }).to_string();
    state.circle_hub.broadcast(circle_id, msg.into());

    Ok(StatusCode::NO_CONTENT)
}

async fn delete_circle(
    State(state): State<AppState>,
    auth: NostrAuth,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let owner_token = circle_token(&state.config.circle_token_secret, id, &auth.pubkey);
    let result = sqlx::query("DELETE FROM circles WHERE id = $1 AND owner_token = $2")
        .bind(id)
        .bind(&owner_token)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::Forbidden);
    }
    Ok(StatusCode::NO_CONTENT)
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_circles).post(create_circle))
        .route("/:id", get(get_circle).delete(delete_circle))
        .route("/:id/members", post(add_member))
        .route("/:id/members/:pubkey", delete(remove_member))
}

impl From<Circle> for sentinel_core::Circle {
    fn from(row: Circle) -> Self {
        Self {
            id: row.id,
            name: row.name.unwrap_or_default(),
            created_at: row.created_at,
        }
    }
}

impl From<CircleMember> for sentinel_core::CircleMember {
    fn from(row: CircleMember) -> Self {
        Self {
            circle_id: row.circle_id,
            member_token: row.member_token,
            alert_radius_km: row.alert_radius_km,
            alert_severity: row.alert_severity,
            joined_at: row.joined_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use uuid::Uuid;

    #[test]
    fn circle_converts_to_domain() {
        let id = Uuid::new_v4();
        let now = Utc::now();
        let row = Circle {
            id,
            owner_token: "v1:x".into(),
            name: Some("Home".into()),
            name_ciphertext: None,
            name_version: 0,
            created_at: now,
        };
        let d = sentinel_core::Circle::from(row);
        assert_eq!(d.id, id);
        assert_eq!(d.name, "Home");
    }

    #[test]
    fn circle_member_converts_to_domain() {
        let cid = Uuid::new_v4();
        let now = Utc::now();
        let row = CircleMember {
            circle_id: cid,
            member_token: "v1:m".into(),
            member_label_ciphertext: None,
            alert_radius_km: Some(5.0),
            alert_severity: Some("HIGH".into()),
            joined_at: now,
        };
        let d = sentinel_core::CircleMember::from(row);
        assert_eq!(d.circle_id, cid);
        assert_eq!(d.member_token, "v1:m");
        assert_eq!(d.alert_radius_km, Some(5.0));
        assert_eq!(d.alert_severity, Some("HIGH".into()));
    }

    #[test]
    fn circle_member_no_alerts_converts_to_domain() {
        let now = Utc::now();
        let row = CircleMember {
            circle_id: Uuid::nil(),
            member_token: "v1:anon".into(),
            member_label_ciphertext: None,
            alert_radius_km: None,
            alert_severity: None,
            joined_at: now,
        };
        let d = sentinel_core::CircleMember::from(row);
        assert_eq!(d.alert_radius_km, None);
        assert_eq!(d.alert_severity, None);
    }
}
