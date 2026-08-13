use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::{delete, get, post, put},
    Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    circles::token::circle_token, error::AppError, middleware::nostr_auth::NostrAuth, AppState,
};

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Circle {
    pub id: Uuid,
    pub owner_token: String,
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

#[derive(Debug, Clone, sqlx::FromRow)]
struct CircleMemberKeyWrap {
    key_wrap_version: i16,
    key_wrap_ciphertext: String,
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
    key_wrap_version: i16,
    key_wrap_event: serde_json::Value,
}

const CIRCLE_KEY_EVENT_KIND: u16 = 30079;
const MAX_KEY_WRAP_CONTENT_LEN: usize = 4096;

fn verify_payload_binding(auth: &NostrAuth, body: &[u8]) -> Result<(), AppError> {
    let expected = hex::encode(Sha256::digest(body));
    match auth.payload.as_deref() {
        Some(value) if value.eq_ignore_ascii_case(&expected) => Ok(()),
        _ => Err(AppError::BadRequest(
            "missing or invalid NIP-98 payload binding".into(),
        )),
    }
}

fn single_tag(event: &nostr_sdk::Event, name: &str) -> Option<String> {
    let matching: Vec<_> = event
        .tags
        .iter()
        .filter(|tag| {
            let values = tag.as_slice();
            values.first().map(String::as_str) == Some(name)
        })
        .collect();
    (matching.len() == 1)
        .then(|| matching[0].as_slice().get(1).cloned())
        .flatten()
}

fn validate_key_wrap(
    owner_pubkey: &str,
    member_pubkey: &str,
    circle_id: Uuid,
    version: i16,
    value: &serde_json::Value,
) -> Result<(), AppError> {
    if version != 2 {
        return Err(AppError::BadRequest(
            "only NIP-44 v2 circle key envelopes are supported".into(),
        ));
    }
    let event: nostr_sdk::Event = serde_json::from_value(value.clone())
        .map_err(|_| AppError::BadRequest("invalid circle key event".into()))?;
    event
        .verify()
        .map_err(|_| AppError::BadRequest("invalid circle key event".into()))?;
    if event.pubkey.to_hex() != owner_pubkey
        || event.kind != nostr_sdk::Kind::Custom(CIRCLE_KEY_EVENT_KIND)
        || event.content.is_empty()
        || event.content.len() > MAX_KEY_WRAP_CONTENT_LEN
        || single_tag(&event, "d").as_deref() != Some("sentinelmesh-circle-key-v1")
        || single_tag(&event, "circle").as_deref() != Some(circle_id.to_string().as_str())
        || single_tag(&event, "p").as_deref() != Some(member_pubkey)
    {
        return Err(AppError::BadRequest(
            "circle key event is not bound to this member and circle".into(),
        ));
    }
    Ok(())
}

#[derive(Deserialize)]
struct MemberLabel {
    member_token: String,
    label_ciphertext: String,
}

#[derive(Deserialize)]
struct SetEncryptionBody {
    name_ciphertext: String,
    #[serde(default)]
    member_labels: Vec<MemberLabel>,
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
        let circle = sqlx::query_as::<_, Circle>(
            "SELECT id, owner_token, name_ciphertext, name_version, created_at FROM circles WHERE id = $1",
        )
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
    body: Bytes,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    verify_payload_binding(&auth, &body)?;
    let body: CreateCircleBody = serde_json::from_slice(&body)
        .map_err(|_| AppError::BadRequest("invalid JSON body".into()))?;
    let id = Uuid::new_v4();
    let owner_token = circle_token(&state.config.circle_token_secret, id, &auth.pubkey);
    let circle = sqlx::query_as::<_, Circle>(
        "INSERT INTO circles (id, owner_token, name_ciphertext, name_version)
         VALUES ($1, $2, $3, 1)
         RETURNING id, owner_token, name_ciphertext, name_version, created_at",
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
    let circle = sqlx::query_as::<_, Circle>(
        "SELECT id, owner_token, name_ciphertext, name_version, created_at FROM circles WHERE id = $1",
    )
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

    let members = sqlx::query_as::<_, CircleMember>(
        "SELECT circle_id, member_token, member_label_ciphertext, alert_radius_km, \
         alert_severity, joined_at FROM circle_members WHERE circle_id = $1",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;
    let my_key_wrap = if is_owner {
        None
    } else {
        sqlx::query_as::<_, CircleMemberKeyWrap>(
            "SELECT key_wrap_version, key_wrap_ciphertext FROM circle_members \
             WHERE circle_id = $1 AND member_token = $2 AND key_wrap_version IS NOT NULL",
        )
        .bind(id)
        .bind(&my_token)
        .fetch_optional(&state.db)
        .await?
    };

    Ok(Json(serde_json::json!({
        "id": circle.id,
        "name_ciphertext": circle.name_ciphertext,
        "name_version": circle.name_version,
        "created_at": circle.created_at,
        "is_owner": is_owner,
        "members": members,
        "my_key_wrap": my_key_wrap.map(|wrap| serde_json::json!({
            "version": wrap.key_wrap_version,
            "ciphertext": wrap.key_wrap_ciphertext,
        })),
    })))
}

async fn add_member(
    State(state): State<AppState>,
    auth: NostrAuth,
    Path(id): Path<Uuid>,
    body: Bytes,
) -> Result<(StatusCode, Json<CircleMember>), AppError> {
    verify_payload_binding(&auth, &body)?;
    let body: AddMemberBody = serde_json::from_slice(&body)
        .map_err(|_| AppError::BadRequest("invalid JSON body".into()))?;
    let owner_token: Option<String> =
        sqlx::query_scalar("SELECT owner_token FROM circles WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.db)
            .await?;
    let my_token = circle_token(&state.config.circle_token_secret, id, &auth.pubkey);
    if owner_token.as_deref() != Some(my_token.as_str()) {
        return Err(AppError::Forbidden);
    }
    if body.member_pubkey.len() != 64
        || !body
            .member_pubkey
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(AppError::BadRequest(
            "member_pubkey must be a 64-character hex Nostr key".into(),
        ));
    }
    validate_key_wrap(
        &auth.pubkey,
        &body.member_pubkey.to_ascii_lowercase(),
        id,
        body.key_wrap_version,
        &body.key_wrap_event,
    )?;

    let member_pubkey = body.member_pubkey.to_ascii_lowercase();
    let member_token = circle_token(&state.config.circle_token_secret, id, &member_pubkey);
    let member = sqlx::query_as::<_, CircleMember>(
        "INSERT INTO circle_members
           (circle_id, member_token, member_label_ciphertext, alert_radius_km, alert_severity,
            key_wrap_version, key_wrap_ciphertext)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (circle_id, member_token) DO UPDATE
           SET member_label_ciphertext = EXCLUDED.member_label_ciphertext,
               alert_radius_km         = EXCLUDED.alert_radius_km,
                alert_severity          = EXCLUDED.alert_severity,
                key_wrap_version        = EXCLUDED.key_wrap_version,
                key_wrap_ciphertext     = EXCLUDED.key_wrap_ciphertext
         RETURNING circle_id, member_token, member_label_ciphertext, alert_radius_km,
                   alert_severity, joined_at",
    )
    .bind(id)
    .bind(&member_token)
    .bind(&body.member_label_ciphertext)
    .bind(body.alert_radius_km)
    .bind(&body.alert_severity)
    .bind(body.key_wrap_version)
    .bind(
        serde_json::from_value::<nostr_sdk::Event>(body.key_wrap_event.clone())
            .map_err(|_| AppError::BadRequest("invalid circle key event".into()))?
            .content,
    )
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

async fn set_encryption(
    State(state): State<AppState>,
    auth: NostrAuth,
    Path(id): Path<Uuid>,
    body: Bytes,
) -> Result<StatusCode, AppError> {
    verify_payload_binding(&auth, &body)?;
    let body: SetEncryptionBody = serde_json::from_slice(&body)
        .map_err(|_| AppError::BadRequest("invalid JSON body".into()))?;
    let owner_token: Option<String> =
        sqlx::query_scalar("SELECT owner_token FROM circles WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.db)
            .await?;
    let my_token = circle_token(&state.config.circle_token_secret, id, &auth.pubkey);
    if owner_token.as_deref() != Some(my_token.as_str()) {
        return Err(AppError::Forbidden);
    }

    let mut tx = state.db.begin().await?;
    sqlx::query("UPDATE circles SET name_ciphertext = $2, name_version = 1 WHERE id = $1")
        .bind(id)
        .bind(&body.name_ciphertext)
        .execute(&mut *tx)
        .await?;

    for label in &body.member_labels {
        sqlx::query(
            "UPDATE circle_members SET member_label_ciphertext = $3
              WHERE circle_id = $1 AND member_token = $2",
        )
        .bind(id)
        .bind(&label.member_token)
        .bind(&label.label_ciphertext)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

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
        .route("/:id/encryption", put(set_encryption))
}

impl From<Circle> for sentinel_core::Circle {
    fn from(row: Circle) -> Self {
        Self {
            id: row.id,
            name: String::new(),
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
    use nostr_sdk::{EventBuilder, Keys, Kind, Tag};
    use uuid::Uuid;

    #[test]
    fn circle_converts_to_domain() {
        let id = Uuid::new_v4();
        let now = Utc::now();
        let row = Circle {
            id,
            owner_token: "v1:x".into(),
            name_ciphertext: None,
            name_version: 1,
            created_at: now,
        };
        let d = sentinel_core::Circle::from(row);
        assert_eq!(d.id, id);
        assert_eq!(d.name, "");
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

    #[test]
    fn set_encryption_body_parses_with_labels() {
        let json = r#"{"name_ciphertext":"ct","member_labels":[{"member_token":"v1:a","label_ciphertext":"l"}]}"#;
        let b: SetEncryptionBody = serde_json::from_str(json).unwrap();
        assert_eq!(b.name_ciphertext, "ct");
        assert_eq!(b.member_labels.len(), 1);
        assert_eq!(b.member_labels[0].member_token, "v1:a");
    }

    #[test]
    fn set_encryption_body_defaults_empty_labels() {
        let b: SetEncryptionBody = serde_json::from_str(r#"{"name_ciphertext":"ct"}"#).unwrap();
        assert!(b.member_labels.is_empty());
    }

    #[test]
    fn key_wrap_requires_owner_signature_and_exact_bindings() {
        let owner = Keys::generate();
        let member = Keys::generate();
        let circle = Uuid::new_v4();
        let event = EventBuilder::new(Kind::Custom(CIRCLE_KEY_EVENT_KIND), "nip44-payload")
            .tags(vec![
                Tag::parse(["d", "sentinelmesh-circle-key-v1"]).unwrap(),
                Tag::parse(["circle", &circle.to_string()]).unwrap(),
                Tag::parse(["p", &member.public_key().to_hex()]).unwrap(),
            ])
            .sign_with_keys(&owner)
            .unwrap();
        let value = serde_json::to_value(event).unwrap();
        assert!(validate_key_wrap(
            &owner.public_key().to_hex(),
            &member.public_key().to_hex(),
            circle,
            2,
            &value,
        )
        .is_ok());
        assert!(validate_key_wrap(
            &member.public_key().to_hex(),
            &member.public_key().to_hex(),
            circle,
            2,
            &value,
        )
        .is_err());
        assert!(validate_key_wrap(
            &owner.public_key().to_hex(),
            &member.public_key().to_hex(),
            Uuid::new_v4(),
            2,
            &value,
        )
        .is_err());
    }

    #[test]
    fn payload_binding_is_required_for_circle_mutations() {
        let body = br#"{"name_ciphertext":"cipher"}"#;
        let hash = hex::encode(Sha256::digest(body));
        let valid = NostrAuth {
            pubkey: "a".repeat(64),
            payload: Some(hash),
        };
        assert!(verify_payload_binding(&valid, body).is_ok());
        assert!(verify_payload_binding(
            &NostrAuth {
                pubkey: "a".repeat(64),
                payload: None,
            },
            body,
        )
        .is_err());
    }
}
