use axum::{body::Bytes, extract::State, http::StatusCode, response::Json, routing::get, Router};
use serde::{Deserialize, Serialize};

use crate::{error::AppError, middleware::nostr_auth::NostrAuth, AppState};

#[derive(Deserialize)]
struct PreferencesBody {
    #[serde(default = "default_true")]
    dm_enabled: bool,
    #[serde(default)]
    quiet_hours: serde_json::Value,
    #[serde(default)]
    public_channels: serde_json::Value,
}

#[derive(Serialize)]
struct Preferences {
    dm_enabled: bool,
    quiet_hours: serde_json::Value,
    public_channels: serde_json::Value,
}

fn default_true() -> bool {
    true
}

async fn get_preferences(
    State(state): State<AppState>,
    auth: NostrAuth,
) -> Result<Json<Preferences>, AppError> {
    let row: Option<(bool, serde_json::Value, serde_json::Value)> = sqlx::query_as(
        "SELECT dm_enabled, quiet_hours, public_channels
         FROM chat_notification_preferences WHERE nostr_pubkey = $1",
    )
    .bind(&auth.pubkey)
    .fetch_optional(&state.db)
    .await?;
    let (dm_enabled, quiet_hours, public_channels) =
        row.unwrap_or_else(|| (true, serde_json::json!({}), serde_json::json!([])));
    Ok(Json(Preferences {
        dm_enabled,
        quiet_hours,
        public_channels,
    }))
}

async fn put_preferences(
    State(state): State<AppState>,
    auth: NostrAuth,
    body: Bytes,
) -> Result<StatusCode, AppError> {
    let prefs: PreferencesBody = serde_json::from_slice(&body)
        .map_err(|_| AppError::BadRequest("invalid preferences body".into()))?;
    sqlx::query(
        "INSERT INTO chat_notification_preferences
           (nostr_pubkey, dm_enabled, quiet_hours, public_channels, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (nostr_pubkey) DO UPDATE SET
           dm_enabled      = EXCLUDED.dm_enabled,
           quiet_hours     = EXCLUDED.quiet_hours,
           public_channels = EXCLUDED.public_channels,
           updated_at      = now()",
    )
    .bind(&auth.pubkey)
    .bind(prefs.dm_enabled)
    .bind(prefs.quiet_hours)
    .bind(prefs.public_channels)
    .execute(&state.db)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub fn router() -> Router<AppState> {
    Router::new().route("/preferences", get(get_preferences).put(put_preferences))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preferences_body_defaults_dm_enabled_true() {
        let body: PreferencesBody =
            serde_json::from_str(r#"{"quiet_hours":{},"public_channels":[]}"#).unwrap();
        assert!(body.dm_enabled);
    }
}
