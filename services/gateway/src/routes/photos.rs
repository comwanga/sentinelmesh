use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, State},
    response::Json,
    routing::post,
    Router,
};

use crate::{error::AppError, middleware::nostr_auth::NostrAuth, AppState};

// Compressed report photos are small (max 800px JPEG @ 0.85). Cap at 5 MB.
const MAX_PHOTO_BYTES: usize = 5 * 1024 * 1024;

/// POST /api/photos/pin
///
/// Authenticated server-side proxy to Pinata. The IPFS credential lives only in
/// the gateway environment (PINATA_JWT) — it is never shipped to the browser.
/// Requires a valid NIP-98 signed request.
async fn pin_photo(
    State(state): State<AppState>,
    _auth: NostrAuth,
    body: Bytes,
) -> Result<Json<serde_json::Value>, AppError> {
    if body.is_empty() {
        return Err(AppError::BadRequest("empty photo body".into()));
    }
    if body.len() > MAX_PHOTO_BYTES {
        return Err(AppError::BadRequest("photo exceeds 5 MB limit".into()));
    }

    let jwt = std::env::var("PINATA_JWT")
        .map_err(|_| AppError::BadRequest("photo pinning is not configured".into()))?;

    let part = reqwest::multipart::Part::bytes(body.to_vec())
        .file_name("report-photo.jpg")
        .mime_str("image/jpeg")
        .map_err(|e| AppError::Internal(e.into()))?;
    let form = reqwest::multipart::Form::new().part("file", part);

    let res = state
        .http_client
        .post("https://api.pinata.cloud/pinning/pinFileToIPFS")
        .bearer_auth(jwt)
        .multipart(form)
        .send()
        .await
        .map_err(|e| AppError::Internal(e.into()))?;

    if !res.status().is_success() {
        tracing::warn!(status = %res.status(), "pinata upload failed");
        return Err(AppError::Internal(anyhow::anyhow!("ipfs pin failed")));
    }

    let data: serde_json::Value = res
        .json()
        .await
        .map_err(|e| AppError::Internal(e.into()))?;
    let cid = data
        .get("IpfsHash")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("missing IpfsHash in pinata response")))?;

    Ok(Json(serde_json::json!({ "cid": cid })))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/pin", post(pin_photo))
        .layer(DefaultBodyLimit::max(MAX_PHOTO_BYTES))
}
