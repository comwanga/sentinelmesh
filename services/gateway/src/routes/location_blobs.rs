use axum::{
    body::Bytes,
    extract::{FromRef, FromRequestParts, Path, State},
    http::{request::Parts, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::get,
    Router,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    circles::token::circle_token, error::AppError, middleware::nostr_auth::NostrAuth, AppState,
};

const MAX_CIPHERTEXT_BYTES: usize = 16 * 1024;
const MAX_BODY_BYTES: usize = 24 * 1024;
const MAX_EXPIRY_SECONDS: i64 = 5 * 60;
const PUBLISH_INTERVAL_SECONDS: usize = 10;

struct SafeLocationAuth(NostrAuth);

#[async_trait::async_trait]
impl<S> FromRequestParts<S> for SafeLocationAuth
where
    S: Send + Sync,
    AppState: FromRef<S>,
{
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        if !AppState::from_ref(state)
            .config
            .safe_circle_location_enabled
        {
            return Err(AppError::Unavailable.into_response());
        }
        NostrAuth::from_request_parts(parts, state)
            .await
            .map(Self)
            .map_err(IntoResponse::into_response)
    }
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct CircleLocationEnvelopeV1 {
    pub id: Uuid,
    #[sqlx(rename = "protocol_version")]
    pub version: i16,
    pub circle_id: Uuid,
    pub key_epoch: i32,
    pub ciphertext: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PushEnvelopeBody {
    version: i16,
    key_epoch: i32,
    ciphertext: String,
    expires_at: DateTime<Utc>,
}

fn verify_payload_binding(auth: &NostrAuth, body: &[u8]) -> Result<(), AppError> {
    let expected = hex::encode(Sha256::digest(body));
    if auth
        .payload
        .as_deref()
        .is_some_and(|value| value.eq_ignore_ascii_case(&expected))
    {
        Ok(())
    } else {
        Err(AppError::BadRequest(
            "missing or invalid NIP-98 payload binding".into(),
        ))
    }
}

fn validate_body(body: &[u8], now: DateTime<Utc>) -> Result<(PushEnvelopeBody, Vec<u8>), AppError> {
    if body.len() > MAX_BODY_BYTES {
        return Err(AppError::BadRequest(
            "location envelope body is oversized".into(),
        ));
    }
    let value: PushEnvelopeBody = serde_json::from_slice(body)
        .map_err(|_| AppError::BadRequest("invalid location envelope JSON".into()))?;
    if value.version != 1 || value.key_epoch < 1 {
        return Err(AppError::BadRequest(
            "unsupported location envelope version or epoch".into(),
        ));
    }
    let decoded = BASE64
        .decode(&value.ciphertext)
        .map_err(|_| AppError::BadRequest("ciphertext must be canonical base64".into()))?;
    if decoded.is_empty()
        || decoded.len() > MAX_CIPHERTEXT_BYTES
        || BASE64.encode(&decoded) != value.ciphertext
    {
        return Err(AppError::BadRequest(
            "ciphertext is empty, oversized, or non-canonical".into(),
        ));
    }
    if value.expires_at <= now || value.expires_at > now + Duration::seconds(MAX_EXPIRY_SECONDS) {
        return Err(AppError::BadRequest(
            "expires_at must be within the next five minutes".into(),
        ));
    }
    Ok((value, decoded))
}

fn validate_circle_state(
    current_epoch: i32,
    protocol_version: i16,
    rekey_required: bool,
    envelope_epoch: i32,
) -> Result<(), AppError> {
    if protocol_version != 1 || rekey_required || current_epoch != envelope_epoch {
        Err(AppError::Conflict(
            "circle epoch is not ready for location publication".into(),
        ))
    } else {
        Ok(())
    }
}

async fn rate_limit(state: &AppState, circle_id: Uuid, sender_token: &str) -> Result<(), AppError> {
    let key = format!("circle-location:v1:rate:{circle_id}:{sender_token}");
    let mut connection = state.redis.clone();
    let result: Option<String> = tokio::time::timeout(
        std::time::Duration::from_millis(250),
        redis::cmd("SET")
            .arg(key)
            .arg(1)
            .arg("NX")
            .arg("EX")
            .arg(PUBLISH_INTERVAL_SECONDS)
            .query_async(&mut connection),
    )
    .await
    .map_err(|_| AppError::Unavailable)?
    .map_err(|_| AppError::Unavailable)?;
    result.map(|_| ()).ok_or(AppError::RateLimited)
}

async fn push_envelope(
    State(state): State<AppState>,
    SafeLocationAuth(auth): SafeLocationAuth,
    Path(circle_id): Path<Uuid>,
    body: Bytes,
) -> Result<(StatusCode, Json<CircleLocationEnvelopeV1>), AppError> {
    verify_payload_binding(&auth, &body)?;
    let now = Utc::now();
    let (body, decoded) = validate_body(&body, now)?;
    let sender_token = circle_token(&state.config.circle_token_secret, circle_id, &auth.pubkey);

    let circle: Option<(i32, i16, bool, bool)> = sqlx::query_as(
        "SELECT key_epoch, location_protocol_version, rekey_required,
                owner_token = $2 OR EXISTS (
                  SELECT 1 FROM circle_members
                   WHERE circle_id = $1 AND member_token = $2 AND membership_state = 'ACTIVE'
                )
           FROM circles WHERE id = $1",
    )
    .bind(circle_id)
    .bind(&sender_token)
    .fetch_optional(&state.db)
    .await?;
    let Some((epoch, protocol, rekey_required, active_member)) = circle else {
        return Err(AppError::NotFound);
    };
    if !active_member {
        return Err(AppError::Forbidden);
    }
    validate_circle_state(epoch, protocol, rekey_required, body.key_epoch)?;
    rate_limit(&state, circle_id, &sender_token).await?;
    let hash = Sha256::digest(decoded).to_vec();

    let envelope = sqlx::query_as::<_, CircleLocationEnvelopeV1>(
        "INSERT INTO location_blobs
           (circle_id, protocol_version, key_epoch, sender_token, ciphertext, ciphertext_hash, created_at, expires_at)
         VALUES ($1, 1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (circle_id, sender_token) DO UPDATE SET
           id = gen_random_uuid(), protocol_version = 1, key_epoch = EXCLUDED.key_epoch,
           ciphertext = EXCLUDED.ciphertext, ciphertext_hash = EXCLUDED.ciphertext_hash,
           created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at
         RETURNING id, protocol_version, circle_id, key_epoch, ciphertext, created_at, expires_at",
    ).bind(circle_id).bind(body.key_epoch).bind(sender_token).bind(body.ciphertext)
        .bind(hash).bind(now).bind(body.expires_at).fetch_one(&state.db).await
        .map_err(|error| {
            if error.as_database_error().and_then(|value| value.constraint())
                == Some("location_blobs_replay_hash") {
                AppError::Conflict("location envelope replay detected".into())
            } else {
                error.into()
            }
        })?;

    // This discriminant is a future transport contract. PWA rendering remains disabled.
    let message =
        serde_json::json!({ "type": "CIRCLE_LOCATION_ENVELOPE", "payload": envelope }).to_string();
    state.circle_hub.broadcast(circle_id, message.into());
    Ok((StatusCode::CREATED, Json(envelope)))
}

async fn list_envelopes(
    State(state): State<AppState>,
    SafeLocationAuth(auth): SafeLocationAuth,
    Path(circle_id): Path<Uuid>,
) -> Result<Json<Vec<CircleLocationEnvelopeV1>>, AppError> {
    let token = circle_token(&state.config.circle_token_secret, circle_id, &auth.pubkey);
    let member: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM circles WHERE id = $1 AND owner_token = $2)
             OR EXISTS (SELECT 1 FROM circle_members
                         WHERE circle_id = $1 AND member_token = $2 AND membership_state = 'ACTIVE')",
    )
    .bind(circle_id)
    .bind(token)
    .fetch_one(&state.db)
    .await?;
    if !member {
        return Err(AppError::Forbidden);
    }
    let envelopes = sqlx::query_as::<_, CircleLocationEnvelopeV1>(
        "SELECT id, protocol_version, circle_id, key_epoch, ciphertext, created_at, expires_at
           FROM location_blobs WHERE circle_id = $1 AND expires_at > now() ORDER BY created_at DESC",
    ).bind(circle_id).fetch_all(&state.db).await?;
    Ok(Json(envelopes))
}

pub fn router() -> Router<AppState> {
    Router::new().route("/:id/location", get(list_envelopes).post(push_envelope))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_bound_bounded_v1_body() {
        let expiry = Utc::now() + Duration::minutes(2);
        let raw = serde_json::json!({"version":1,"key_epoch":2,"ciphertext":BASE64.encode([1,2,3]),"expires_at":expiry}).to_string();
        let auth = NostrAuth {
            pubkey: "a".repeat(64),
            payload: Some(hex::encode(Sha256::digest(raw.as_bytes()))),
        };
        assert!(verify_payload_binding(&auth, raw.as_bytes()).is_ok());
        assert!(validate_body(raw.as_bytes(), Utc::now()).is_ok());
        assert!(verify_payload_binding(&auth, b"{}").is_err());
    }

    #[test]
    fn rejects_bad_expiry_version_and_oversize() {
        let now = Utc::now();
        for value in [
            serde_json::json!({"version":0,"key_epoch":1,"ciphertext":"AQ==","expires_at":now + Duration::minutes(1)}),
            serde_json::json!({"version":1,"key_epoch":1,"ciphertext":"AQ==","expires_at":now + Duration::minutes(6)}),
            serde_json::json!({"version":1,"key_epoch":1,"ciphertext":BASE64.encode(vec![0; MAX_CIPHERTEXT_BYTES + 1]),"expires_at":now + Duration::minutes(1)}),
        ] {
            assert!(validate_body(value.to_string().as_bytes(), now).is_err());
        }
        assert!(validate_body(&vec![b' '; MAX_BODY_BYTES + 1], now).is_err());
    }

    #[test]
    fn legacy_rekey_and_epoch_mismatch_fail_closed() {
        assert!(validate_circle_state(1, 0, true, 1).is_err());
        assert!(validate_circle_state(2, 1, false, 1).is_err());
        assert!(validate_circle_state(2, 1, true, 2).is_err());
        assert!(validate_circle_state(2, 1, false, 2).is_ok());
    }

    #[test]
    fn response_type_is_opaque() {
        let envelope = CircleLocationEnvelopeV1 {
            id: Uuid::nil(),
            version: 1,
            circle_id: Uuid::nil(),
            key_epoch: 1,
            ciphertext: "AQ==".into(),
            created_at: Utc::now(),
            expires_at: Utc::now() + Duration::minutes(1),
        };
        let json = serde_json::to_value(envelope).unwrap();
        assert_eq!(json.as_object().unwrap().len(), 7);
        assert!(json.get("sender_token").is_none() && json.get("recipient_token").is_none());
    }
}
