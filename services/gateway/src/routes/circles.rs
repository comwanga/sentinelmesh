use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{delete, get, post},
    Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{error::AppError, middleware::nostr_auth::NostrAuth, AppState};

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Circle {
    pub id: Uuid,
    pub owner_pubkey: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct CircleMember {
    pub circle_id: Uuid,
    pub member_pubkey: String,
    pub alert_radius_km: Option<f64>,
    pub alert_severity: Option<String>,
    pub joined_at: DateTime<Utc>,
}

#[derive(Deserialize)]
struct CreateCircleBody {
    name: String,
}

#[derive(Deserialize)]
struct AddMemberBody {
    member_pubkey: String,
    alert_radius_km: Option<f64>,
    alert_severity: Option<String>,
}

async fn list_circles(
    State(state): State<AppState>,
    auth: NostrAuth,
) -> Result<Json<Vec<Circle>>, AppError> {
    let circles = sqlx::query_as::<_, Circle>(
        "SELECT DISTINCT c.id, c.owner_pubkey, c.name, c.created_at
         FROM circles c
         LEFT JOIN circle_members m ON m.circle_id = c.id
         WHERE c.owner_pubkey = $1 OR m.member_pubkey = $1
         ORDER BY c.created_at DESC",
    )
    .bind(&auth.pubkey)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(circles))
}

async fn create_circle(
    State(state): State<AppState>,
    auth: NostrAuth,
    Json(body): Json<CreateCircleBody>,
) -> Result<(StatusCode, Json<Circle>), AppError> {
    let circle = sqlx::query_as::<_, Circle>(
        "INSERT INTO circles (id, owner_pubkey, name) VALUES (gen_random_uuid(), $1, $2) RETURNING *"
    )
    .bind(&auth.pubkey)
    .bind(&body.name)
    .fetch_one(&state.db)
    .await?;
    Ok((StatusCode::CREATED, Json(circle)))
}

async fn get_circle(
    State(state): State<AppState>,
    _auth: NostrAuth,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let circle = sqlx::query_as::<_, Circle>("SELECT * FROM circles WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)?;

    let members = sqlx::query_as::<_, CircleMember>(
        "SELECT * FROM circle_members WHERE circle_id = $1",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(serde_json::json!({
        "id": circle.id,
        "owner_pubkey": circle.owner_pubkey,
        "name": circle.name,
        "created_at": circle.created_at,
        "members": members
    })))
}

async fn add_member(
    State(state): State<AppState>,
    auth: NostrAuth,
    Path(id): Path<Uuid>,
    Json(body): Json<AddMemberBody>,
) -> Result<(StatusCode, Json<CircleMember>), AppError> {
    let owner: Option<String> =
        sqlx::query_scalar("SELECT owner_pubkey FROM circles WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.db)
            .await?;
    if owner.as_deref() != Some(auth.pubkey.as_str()) {
        return Err(AppError::Forbidden);
    }

    let member = sqlx::query_as::<_, CircleMember>(
        "INSERT INTO circle_members (circle_id, member_pubkey, alert_radius_km, alert_severity)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (circle_id, member_pubkey) DO UPDATE
           SET alert_radius_km = EXCLUDED.alert_radius_km,
               alert_severity  = EXCLUDED.alert_severity
         RETURNING *",
    )
    .bind(id)
    .bind(&body.member_pubkey)
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
    let owner: Option<String> =
        sqlx::query_scalar("SELECT owner_pubkey FROM circles WHERE id = $1")
            .bind(circle_id)
            .fetch_optional(&state.db)
            .await?;
    if owner.as_deref() != Some(auth.pubkey.as_str()) && auth.pubkey != member_pubkey {
        return Err(AppError::Forbidden);
    }

    sqlx::query("DELETE FROM circle_members WHERE circle_id = $1 AND member_pubkey = $2")
        .bind(circle_id)
        .bind(&member_pubkey)
        .execute(&state.db)
        .await?;

    // Notify WebSocket clients in this circle that the member was removed
    let msg =
        serde_json::json!({ "type": "MEMBER_REMOVED", "pubkey": member_pubkey }).to_string();
    state.circle_hub.broadcast(circle_id, msg.into());

    Ok(StatusCode::NO_CONTENT)
}

async fn delete_circle(
    State(state): State<AppState>,
    auth: NostrAuth,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let result =
        sqlx::query("DELETE FROM circles WHERE id = $1 AND owner_pubkey = $2")
            .bind(id)
            .bind(&auth.pubkey)
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

impl From<Circle> for sentinel_core::domain::circle::Circle {
    fn from(row: Circle) -> Self {
        Self {
            id: row.id,
            owner_pubkey: row.owner_pubkey,
            name: row.name,
            created_at: row.created_at,
        }
    }
}

impl From<CircleMember> for sentinel_core::domain::circle::CircleMember {
    fn from(row: CircleMember) -> Self {
        Self {
            circle_id: row.circle_id,
            member_pubkey: row.member_pubkey,
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
        let row = Circle { id, owner_pubkey: "pk".into(), name: "Home".into(), created_at: now };
        let d = sentinel_core::domain::circle::Circle::from(row);
        assert_eq!(d.id, id);
        assert_eq!(d.name, "Home");
        assert_eq!(d.owner_pubkey, "pk");
    }

    #[test]
    fn circle_member_converts_to_domain() {
        let cid = Uuid::new_v4();
        let now = Utc::now();
        let row = CircleMember {
            circle_id: cid,
            member_pubkey: "mpk".into(),
            alert_radius_km: Some(5.0),
            alert_severity: Some("HIGH".into()),
            joined_at: now,
        };
        let d = sentinel_core::domain::circle::CircleMember::from(row);
        assert_eq!(d.circle_id, cid);
        assert_eq!(d.member_pubkey, "mpk");
        assert_eq!(d.alert_radius_km, Some(5.0));
        assert_eq!(d.alert_severity, Some("HIGH".into()));
    }

    #[test]
    fn circle_member_no_alerts_converts_to_domain() {
        let now = Utc::now();
        let row = CircleMember {
            circle_id: Uuid::nil(),
            member_pubkey: "anon".into(),
            alert_radius_km: None,
            alert_severity: None,
            joined_at: now,
        };
        let d = sentinel_core::domain::circle::CircleMember::from(row);
        assert_eq!(d.alert_radius_km, None);
        assert_eq!(d.alert_severity, None);
    }
}
