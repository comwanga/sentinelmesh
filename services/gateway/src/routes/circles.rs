use crate::{
    circles::token::circle_token, error::AppError, middleware::nostr_auth::NostrAuth, AppState,
};
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

const CIRCLE_KEY_EVENT_KIND: u16 = 30079;
const CIRCLE_KEY_EVENT_TYPE_V2: &str = "sentinelmesh-circle-key-v2";
const MAX_KEY_WRAP_CONTENT_LEN: usize = 4096;
const MAX_CIRCLE_MEMBERS: i64 = 25;
const KEY_WRAP_FRESHNESS_SECS: i64 = 60;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Circle {
    pub id: Uuid,
    pub owner_token: String,
    pub name_ciphertext: Option<String>,
    pub name_version: i16,
    pub key_epoch: i32,
    pub location_protocol_version: i16,
    pub rekey_required: bool,
    pub membership_revision: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct CircleMember {
    pub circle_id: Uuid,
    pub member_token: String,
    pub member_label_ciphertext: Option<String>,
    pub alert_radius_km: Option<f64>,
    pub alert_severity: Option<String>,
    pub membership_state: String,
    pub accepted_at: Option<DateTime<Utc>>,
    pub key_wrap_epoch: Option<i32>,
    pub joined_at: DateTime<Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct CircleMemberKeyWrap {
    key_wrap_version: Option<i16>,
    key_wrap_ciphertext: Option<String>,
    key_wrap_epoch: Option<i32>,
    key_wrap_event: Option<serde_json::Value>,
}

const CIRCLE_COLUMNS: &str =
    "id, owner_token, name_ciphertext, name_version, key_epoch, location_protocol_version, \
     rekey_required, membership_revision, created_at";
const MEMBER_COLUMNS: &str =
    "circle_id, member_token, member_label_ciphertext, alert_radius_km, alert_severity, \
     membership_state, accepted_at, key_wrap_epoch, joined_at";

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
    key_wrap_epoch: i32,
    key_wrap_event: serde_json::Value,
}

#[derive(Deserialize)]
struct MemberLabel {
    member_token: String,
    label_ciphertext: String,
}

#[derive(Deserialize)]
struct MemberWrap {
    member_token: String,
    key_wrap_event: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CommitEpochBody {
    expected_revision: i32,
    next_epoch: i32,
    name_ciphertext: String,
    #[serde(default)]
    member_labels: Vec<MemberLabel>,
    #[serde(default)]
    member_wraps: Vec<MemberWrap>,
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

fn verify_payload_binding(auth: &NostrAuth, body: &[u8]) -> Result<(), AppError> {
    let expected = hex::encode(Sha256::digest(body));
    match auth.payload.as_deref() {
        Some(value) if value.eq_ignore_ascii_case(&expected) => Ok(()),
        _ => Err(AppError::BadRequest(
            "missing or invalid NIP-98 payload binding".into(),
        )),
    }
}

fn tag_values(event: &nostr_sdk::Event, name: &str) -> Vec<String> {
    event
        .tags
        .iter()
        .filter_map(|tag| {
            let values = tag.as_slice();
            (values.first().map(String::as_str) == Some(name))
                .then(|| values.get(1).cloned())
                .flatten()
        })
        .collect()
}

/// Require exactly one `name` tag and return its value.
fn single_tag(event: &nostr_sdk::Event, name: &str) -> Result<String, AppError> {
    let values = tag_values(event, name);
    match values.as_slice() {
        [value] => Ok(value.clone()),
        _ => Err(AppError::BadRequest(format!(
            "circle key event must bind exactly one {name} tag"
        ))),
    }
}

/// Validate a v2 owner-signed circle key wrap. Returns the recipient pubkey
/// (lowercase hex) extracted from the `p` tag on success.
fn validate_key_wrap_v2(
    owner_pubkey: &str,
    circle_id: Uuid,
    expected_epoch: i32,
    value: &serde_json::Value,
) -> Result<String, AppError> {
    let event: nostr_sdk::Event = serde_json::from_value(value.clone())
        .map_err(|_| AppError::BadRequest("invalid circle key event".into()))?;
    event
        .verify()
        .map_err(|_| AppError::BadRequest("invalid circle key event signature".into()))?;
    if event.pubkey.to_hex() != owner_pubkey
        || event.kind != nostr_sdk::Kind::Custom(CIRCLE_KEY_EVENT_KIND)
    {
        return Err(AppError::BadRequest(
            "circle key event is not signed by the circle owner".into(),
        ));
    }
    let created_at = event.created_at.as_u64() as i64;
    if (Utc::now().timestamp() - created_at).abs() > KEY_WRAP_FRESHNESS_SECS {
        return Err(AppError::BadRequest("circle key event is not fresh".into()));
    }

    let d = single_tag(&event, "d")?;
    let circle = single_tag(&event, "circle")?;
    let epoch = single_tag(&event, "epoch")?;
    let recipient = single_tag(&event, "p")?.to_ascii_lowercase();

    if d != CIRCLE_KEY_EVENT_TYPE_V2
        || circle != circle_id.to_string()
        || epoch != expected_epoch.to_string()
        || recipient.len() != 64
        || !recipient.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(AppError::BadRequest(
            "circle key event is not bound to this circle, epoch, and recipient".into(),
        ));
    }

    if event.content.is_empty() || event.content.len() > MAX_KEY_WRAP_CONTENT_LEN {
        return Err(AppError::BadRequest(
            "circle key event content is invalid".into(),
        ));
    }

    Ok(recipient)
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
        let circle = sqlx::query_as::<_, Circle>(&format!(
            "SELECT {CIRCLE_COLUMNS} FROM circles WHERE id = $1"
        ))
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
            "key_epoch": circle.key_epoch,
            "location_protocol_version": circle.location_protocol_version,
            "rekey_required": circle.rekey_required,
            "membership_revision": circle.membership_revision,
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
    let circle = sqlx::query_as::<_, Circle>(&format!(
        "INSERT INTO circles (id, owner_token, name_ciphertext, name_version)
         VALUES ($1, $2, $3, 1)
         RETURNING {CIRCLE_COLUMNS}"
    ))
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
            "key_epoch": circle.key_epoch,
            "location_protocol_version": circle.location_protocol_version,
            "rekey_required": circle.rekey_required,
            "membership_revision": circle.membership_revision,
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
    let circle = sqlx::query_as::<_, Circle>(&format!(
        "SELECT {CIRCLE_COLUMNS} FROM circles WHERE id = $1"
    ))
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

    let members = sqlx::query_as::<_, CircleMember>(&format!(
        "SELECT {MEMBER_COLUMNS} FROM circle_members WHERE circle_id = $1"
    ))
    .bind(id)
    .fetch_all(&state.db)
    .await?;
    let my_key_wrap = if is_owner {
        None
    } else {
        sqlx::query_as::<_, CircleMemberKeyWrap>(
            "SELECT key_wrap_version, key_wrap_ciphertext, key_wrap_epoch, key_wrap_event \
             FROM circle_members WHERE circle_id = $1 AND member_token = $2",
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
        "key_epoch": circle.key_epoch,
        "location_protocol_version": circle.location_protocol_version,
        "rekey_required": circle.rekey_required,
        "membership_revision": circle.membership_revision,
        "created_at": circle.created_at,
        "is_owner": is_owner,
        "self_token": my_token,
        "members": members.iter().map(|m| serde_json::json!({
            "circle_id": m.circle_id,
            // Member tokens are never exposed to non-owner members.
            "member_token": if is_owner { Some(&m.member_token) } else { None },
            "member_label_ciphertext": m.member_label_ciphertext,
            "alert_radius_km": m.alert_radius_km,
            "alert_severity": m.alert_severity,
            "membership_state": m.membership_state,
            "accepted_at": m.accepted_at,
            "key_wrap_epoch": m.key_wrap_epoch,
            "joined_at": m.joined_at,
        })).collect::<Vec<_>>(),
        "my_key_wrap": my_key_wrap.map(|wrap| serde_json::json!({
            "version": wrap.key_wrap_epoch.map(|_| 2).or(wrap.key_wrap_version),
            "epoch": wrap.key_wrap_epoch,
            "event": wrap.key_wrap_event,
            "ciphertext": wrap.key_wrap_ciphertext,
        })),
    })))
}

async fn add_member(
    State(state): State<AppState>,
    auth: NostrAuth,
    Path(id): Path<Uuid>,
    body: Bytes,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    verify_payload_binding(&auth, &body)?;
    let body: AddMemberBody = serde_json::from_slice(&body)
        .map_err(|_| AppError::BadRequest("invalid JSON body".into()))?;

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

    let member_pubkey = body.member_pubkey.to_ascii_lowercase();
    if member_pubkey == auth.pubkey {
        return Err(AppError::BadRequest(
            "cannot add the circle owner as a member".into(),
        ));
    }
    let member_token = circle_token(&state.config.circle_token_secret, id, &member_pubkey);

    // Lock the circle so the wrap is validated against a stable epoch and the
    // membership count/revision update is atomic with respect to epoch commits.
    let mut tx = state.db.begin().await?;
    let circle: Option<(String, i32)> =
        sqlx::query_as("SELECT owner_token, key_epoch FROM circles WHERE id = $1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;
    let Some((owner_token, key_epoch)) = circle else {
        return Err(AppError::NotFound);
    };
    let my_token = circle_token(&state.config.circle_token_secret, id, &auth.pubkey);
    if owner_token != my_token {
        return Err(AppError::Forbidden);
    }
    if body.key_wrap_epoch != key_epoch {
        return Err(AppError::BadRequest(
            "circle key event is not bound to the current epoch".into(),
        ));
    }
    let recipient = validate_key_wrap_v2(&auth.pubkey, id, key_epoch, &body.key_wrap_event)?;
    if recipient != member_pubkey {
        return Err(AppError::BadRequest(
            "circle key event is not bound to this member".into(),
        ));
    }

    let member_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM circle_members WHERE circle_id = $1")
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
    if member_count >= MAX_CIRCLE_MEMBERS {
        return Err(AppError::BadRequest(format!(
            "circles are limited to {MAX_CIRCLE_MEMBERS} members"
        )));
    }

    // Stored as PENDING until the recipient explicitly accepts. The v2 wrap is
    // retained so the recipient can decrypt name/labels upon acceptance.
    let member: CircleMember = sqlx::query_as::<_, CircleMember>(&format!(
        "INSERT INTO circle_members
           (circle_id, member_token, member_label_ciphertext, alert_radius_km, alert_severity,
            membership_state, accepted_at, key_wrap_epoch, key_wrap_event)
         VALUES ($1, $2, $3, $4, $5, 'PENDING', NULL, $6, $7)
         ON CONFLICT (circle_id, member_token) DO UPDATE
           SET member_label_ciphertext = EXCLUDED.member_label_ciphertext,
               alert_radius_km         = EXCLUDED.alert_radius_km,
               alert_severity          = EXCLUDED.alert_severity,
               membership_state        = 'PENDING',
               accepted_at             = NULL,
               key_wrap_epoch          = EXCLUDED.key_wrap_epoch,
               key_wrap_event          = EXCLUDED.key_wrap_event
         RETURNING {MEMBER_COLUMNS}"
    ))
    .bind(id)
    .bind(&member_token)
    .bind(&body.member_label_ciphertext)
    .bind(body.alert_radius_km)
    .bind(&body.alert_severity)
    .bind(body.key_wrap_epoch)
    .bind(&body.key_wrap_event)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query("UPDATE circles SET membership_revision = membership_revision + 1 WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "circle_id": member.circle_id,
            "member_token": member.member_token,
            "member_label_ciphertext": member.member_label_ciphertext,
            "alert_radius_km": member.alert_radius_km,
            "alert_severity": member.alert_severity,
            "membership_state": member.membership_state,
            "accepted_at": member.accepted_at,
            "key_wrap_epoch": member.key_wrap_epoch,
            "joined_at": member.joined_at,
        })),
    ))
}

async fn accept_member(
    State(state): State<AppState>,
    auth: NostrAuth,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let secret = &state.config.circle_token_secret;
    let my_token = circle_token(secret, id, &auth.pubkey);

    let mut tx = state.db.begin().await?;
    let current_epoch: Option<i32> =
        sqlx::query_scalar("SELECT key_epoch FROM circles WHERE id = $1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;
    let Some(current_epoch) = current_epoch else {
        return Err(AppError::NotFound);
    };

    let member = sqlx::query_as::<_, CircleMember>(&format!(
        "SELECT {MEMBER_COLUMNS} FROM circle_members WHERE circle_id = $1 AND member_token = $2"
    ))
    .bind(id)
    .bind(&my_token)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(AppError::Forbidden)?;

    if member.membership_state != "PENDING" {
        return Err(AppError::Conflict("membership is already active".into()));
    }
    // A wrap from a stale epoch is not accepted: the owner must re-invite.
    if member.key_wrap_epoch != Some(current_epoch) {
        return Err(AppError::Conflict(
            "invitation predates the current epoch — ask the owner to re-invite".into(),
        ));
    }

    sqlx::query(
        "UPDATE circle_members SET membership_state = 'ACTIVE', accepted_at = now()
         WHERE circle_id = $1 AND member_token = $2",
    )
    .bind(id)
    .bind(&my_token)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE circles SET membership_revision = membership_revision + 1 WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    Ok(Json(serde_json::json!({
        "circle_id": id,
        "membership_state": "ACTIVE",
        "accepted_at": Utc::now(),
    })))
}

async fn commit_epoch(
    State(state): State<AppState>,
    auth: NostrAuth,
    Path(id): Path<Uuid>,
    body: Bytes,
) -> Result<Json<serde_json::Value>, AppError> {
    verify_payload_binding(&auth, &body)?;
    let body: CommitEpochBody = serde_json::from_slice(&body)
        .map_err(|_| AppError::BadRequest("invalid JSON body".into()))?;
    let secret = &state.config.circle_token_secret;
    let my_token = circle_token(secret, id, &auth.pubkey);

    let mut tx = state.db.begin().await?;
    let circle: Option<(String, i32, i32)> = sqlx::query_as(
        "SELECT owner_token, key_epoch, membership_revision FROM circles WHERE id = $1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((owner_token, key_epoch, revision)) = circle else {
        return Err(AppError::NotFound);
    };
    if owner_token != my_token {
        return Err(AppError::Forbidden);
    }
    if body.expected_revision != revision {
        return Err(AppError::Conflict(
            "circle membership changed since this epoch was prepared".into(),
        ));
    }
    if body.next_epoch != key_epoch + 1 {
        return Err(AppError::BadRequest(
            "next_epoch must be exactly one greater than the current epoch".into(),
        ));
    }

    let active: Vec<String> = sqlx::query_scalar(
        "SELECT member_token FROM circle_members WHERE circle_id = $1 AND membership_state = 'ACTIVE' ORDER BY member_token",
    )
    .bind(id)
    .fetch_all(&mut *tx)
    .await?;

    let mut wrap_tokens: Vec<String> = body
        .member_wraps
        .iter()
        .map(|w| w.member_token.clone())
        .collect();
    wrap_tokens.sort();
    if wrap_tokens != active {
        return Err(AppError::Conflict(
            "submitted member set does not match active members".into(),
        ));
    }
    let mut label_tokens: Vec<String> = body
        .member_labels
        .iter()
        .map(|l| l.member_token.clone())
        .collect();
    label_tokens.sort();
    if label_tokens != active {
        return Err(AppError::Conflict(
            "submitted labels do not match active members".into(),
        ));
    }

    for wrap in &body.member_wraps {
        let recipient =
            validate_key_wrap_v2(&auth.pubkey, id, body.next_epoch, &wrap.key_wrap_event)?;
        let expected_token = circle_token(secret, id, &recipient);
        if expected_token != wrap.member_token {
            return Err(AppError::BadRequest(
                "circle key event is not bound to its member".into(),
            ));
        }
    }

    sqlx::query(
        "UPDATE circles SET key_epoch = $2, location_protocol_version = 1, rekey_required = false,
         name_ciphertext = $3 WHERE id = $1",
    )
    .bind(id)
    .bind(body.next_epoch)
    .bind(&body.name_ciphertext)
    .execute(&mut *tx)
    .await?;

    for wrap in &body.member_wraps {
        sqlx::query(
            "UPDATE circle_members SET key_wrap_epoch = $3, key_wrap_event = $4
             WHERE circle_id = $1 AND member_token = $2",
        )
        .bind(id)
        .bind(&wrap.member_token)
        .bind(body.next_epoch)
        .bind(&wrap.key_wrap_event)
        .execute(&mut *tx)
        .await?;
    }
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

    sqlx::query("DELETE FROM location_blobs WHERE circle_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    let msg = serde_json::json!({
        "type": "CIRCLE_EPOCH_CHANGED",
        "payload": { "circle_id": id, "key_epoch": body.next_epoch, "rekey_required": false }
    })
    .to_string();
    state.circle_hub.broadcast(id, msg.into());

    Ok(Json(serde_json::json!({
        "circle_id": id,
        "key_epoch": body.next_epoch,
        "location_protocol_version": 1,
        "rekey_required": false,
    })))
}

async fn remove_member(
    State(state): State<AppState>,
    auth: NostrAuth,
    Path((circle_id, member_pubkey)): Path<(Uuid, String)>,
) -> Result<StatusCode, AppError> {
    let secret = &state.config.circle_token_secret;
    let caller_token = circle_token(secret, circle_id, &auth.pubkey);
    let target_token = circle_token(secret, circle_id, &member_pubkey);

    let mut tx = state.db.begin().await?;
    let circle: Option<(String, i32)> =
        sqlx::query_as("SELECT owner_token, key_epoch FROM circles WHERE id = $1 FOR UPDATE")
            .bind(circle_id)
            .fetch_optional(&mut *tx)
            .await?;
    let Some((owner_token, key_epoch)) = circle else {
        return Err(AppError::NotFound);
    };
    // Owner may remove anyone; a member may remove only themselves.
    if owner_token != caller_token && caller_token != target_token {
        return Err(AppError::Forbidden);
    }

    let removed =
        sqlx::query("DELETE FROM circle_members WHERE circle_id = $1 AND member_token = $2")
            .bind(circle_id)
            .bind(&target_token)
            .execute(&mut *tx)
            .await?;
    if removed.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }

    sqlx::query("DELETE FROM location_blobs WHERE circle_id = $1 AND sender_token = $2")
        .bind(circle_id)
        .bind(&target_token)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "UPDATE circles SET rekey_required = true, membership_revision = membership_revision + 1
         WHERE id = $1",
    )
    .bind(circle_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    // Force-close the removed member's live socket (carries their own token so
    // only they match it; the token is an HMAC, not a pubkey). Others receive a
    // rekey-required epoch change and stop publishing.
    let removed_msg = serde_json::json!({
        "type": "CIRCLE_MEMBER_REMOVED",
        "payload": { "circle_id": circle_id, "key_epoch": key_epoch, "token": target_token }
    })
    .to_string();
    state.circle_hub.broadcast(circle_id, removed_msg.into());
    let epoch_msg = serde_json::json!({
        "type": "CIRCLE_EPOCH_CHANGED",
        "payload": { "circle_id": circle_id, "key_epoch": key_epoch, "rekey_required": true }
    })
    .to_string();
    state.circle_hub.broadcast(circle_id, epoch_msg.into());

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
        .route("/:id/accept", post(accept_member))
        .route("/:id/epoch", post(commit_epoch))
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
    use nostr_sdk::{EventBuilder, Keys, Kind, Tag, Timestamp};
    use uuid::Uuid;

    fn circle_row(id: Uuid) -> Circle {
        Circle {
            id,
            owner_token: "v1:x".into(),
            name_ciphertext: None,
            name_version: 1,
            key_epoch: 1,
            location_protocol_version: 0,
            rekey_required: true,
            membership_revision: 0,
            created_at: Utc::now(),
        }
    }

    #[test]
    fn circle_converts_to_domain() {
        let id = Uuid::new_v4();
        let d = sentinel_core::Circle::from(circle_row(id));
        assert_eq!(d.id, id);
        assert_eq!(d.name, "");
    }

    #[test]
    fn circle_member_converts_to_domain() {
        let cid = Uuid::new_v4();
        let row = CircleMember {
            circle_id: cid,
            member_token: "v1:m".into(),
            member_label_ciphertext: None,
            alert_radius_km: Some(5.0),
            alert_severity: Some("HIGH".into()),
            membership_state: "ACTIVE".into(),
            accepted_at: None,
            key_wrap_epoch: Some(2),
            joined_at: Utc::now(),
        };
        let d = sentinel_core::CircleMember::from(row);
        assert_eq!(d.circle_id, cid);
        assert_eq!(d.member_token, "v1:m");
        assert_eq!(d.alert_radius_km, Some(5.0));
        assert_eq!(d.alert_severity, Some("HIGH".into()));
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

    fn v2_wrap_event(
        owner: &Keys,
        recipient_pubkey: &str,
        circle_id: Uuid,
        epoch: i32,
    ) -> nostr_sdk::Event {
        // Content is an opaque NIP-44 ciphertext from the gateway's perspective.
        EventBuilder::new(
            Kind::Custom(CIRCLE_KEY_EVENT_KIND),
            "nip44-ciphertext-placeholder",
        )
        .tags(vec![
            Tag::parse(["d", CIRCLE_KEY_EVENT_TYPE_V2]).unwrap(),
            Tag::parse(["circle", &circle_id.to_string()]).unwrap(),
            Tag::parse(["epoch", &epoch.to_string()]).unwrap(),
            Tag::parse(["p", recipient_pubkey]).unwrap(),
        ])
        .sign_with_keys(owner)
        .unwrap()
    }

    #[test]
    fn key_wrap_v2_accepts_valid_owner_signed_event() {
        let owner = Keys::generate();
        let member = Keys::generate();
        let circle = Uuid::new_v4();
        let event = v2_wrap_event(&owner, &member.public_key().to_hex(), circle, 2);
        let value = serde_json::to_value(event).unwrap();
        let recipient =
            validate_key_wrap_v2(&owner.public_key().to_hex(), circle, 2, &value).unwrap();
        assert_eq!(recipient, member.public_key().to_hex());
    }

    #[test]
    fn key_wrap_v2_rejects_wrong_owner() {
        let owner = Keys::generate();
        let attacker = Keys::generate();
        let member = Keys::generate();
        let circle = Uuid::new_v4();
        let event = v2_wrap_event(&attacker, &member.public_key().to_hex(), circle, 2);
        let value = serde_json::to_value(event).unwrap();
        assert!(validate_key_wrap_v2(&owner.public_key().to_hex(), circle, 2, &value).is_err());
    }

    #[test]
    fn key_wrap_v2_rejects_wrong_epoch() {
        let owner = Keys::generate();
        let member = Keys::generate();
        let circle = Uuid::new_v4();
        let event = v2_wrap_event(&owner, &member.public_key().to_hex(), circle, 2);
        let value = serde_json::to_value(event).unwrap();
        assert!(validate_key_wrap_v2(&owner.public_key().to_hex(), circle, 3, &value).is_err());
    }

    #[test]
    fn key_wrap_v2_rejects_wrong_circle() {
        let owner = Keys::generate();
        let member = Keys::generate();
        let circle = Uuid::new_v4();
        let event = v2_wrap_event(&owner, &member.public_key().to_hex(), circle, 2);
        let value = serde_json::to_value(event).unwrap();
        assert!(
            validate_key_wrap_v2(&owner.public_key().to_hex(), Uuid::new_v4(), 2, &value).is_err()
        );
    }

    #[test]
    fn key_wrap_v2_rejects_expired_event() {
        let owner = Keys::generate();
        let member = Keys::generate();
        let circle = Uuid::new_v4();
        let stale = Utc::now().timestamp() - 3600;
        let event = EventBuilder::new(
            Kind::Custom(CIRCLE_KEY_EVENT_KIND),
            "nip44-ciphertext-placeholder",
        )
        .tags(vec![
            Tag::parse(["d", CIRCLE_KEY_EVENT_TYPE_V2]).unwrap(),
            Tag::parse(["circle", &circle.to_string()]).unwrap(),
            Tag::parse(["epoch", "2"]).unwrap(),
            Tag::parse(["p", &member.public_key().to_hex()]).unwrap(),
        ])
        .custom_created_at(Timestamp::from(stale as u64))
        .sign_with_keys(&owner)
        .unwrap();
        let value = serde_json::to_value(event).unwrap();
        assert!(validate_key_wrap_v2(&owner.public_key().to_hex(), circle, 2, &value).is_err());
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
