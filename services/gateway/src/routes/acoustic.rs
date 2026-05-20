use axum::{extract::State, http::StatusCode, response::Json, routing::post, Router};
use h3o::{LatLng, Resolution};
use serde::Deserialize;
use sqlx::Row;

use crate::{error::AppError, middleware::nostr_auth::NostrAuth, AppState};

#[derive(Deserialize)]
pub struct SubmitSignalBody {
    pub client_id:           uuid::Uuid,
    pub threat_class:        String,
    pub confidence:          f32,
    pub confidence_variance: Option<f32>,
    pub lat:                 f64,
    pub lng:                 f64,
    pub model_version:       String,
    pub threshold_profile:   String,
    pub inference_backend:   String,
    pub processing_latency:  Option<i32>,
    pub dropped_frames:      i32,
    pub device_category:     Option<String>,
    pub signal_fingerprint:  Option<String>,
}

fn validate_signal_body(body: &SubmitSignalBody) -> Result<(), AppError> {
    if !(0.0..=1.0).contains(&body.confidence) {
        return Err(AppError::BadRequest("confidence must be 0.0–1.0".into()));
    }
    if let Some(v) = body.confidence_variance {
        if !(0.0..=1.0).contains(&v) {
            return Err(AppError::BadRequest("confidence_variance must be 0.0–1.0".into()));
        }
    }
    if !(-90.0..=90.0).contains(&body.lat) {
        return Err(AppError::BadRequest("lat out of range".into()));
    }
    if !(-180.0..=180.0).contains(&body.lng) {
        return Err(AppError::BadRequest("lng out of range".into()));
    }
    if body.threat_class.is_empty() {
        return Err(AppError::BadRequest("threat_class must not be empty".into()));
    }
    if body.model_version.is_empty() {
        return Err(AppError::BadRequest("model_version must not be empty".into()));
    }
    if body.dropped_frames < 0 {
        return Err(AppError::BadRequest("dropped_frames must be non-negative".into()));
    }
    Ok(())
}

fn h3_cells_from(lat: f64, lng: f64) -> Result<(String, String), AppError> {
    let ll = LatLng::new(lat, lng)
        .map_err(|_| AppError::BadRequest("invalid coordinates for H3".into()))?;
    let r9 = ll.to_cell(Resolution::Nine).to_string();
    let r7 = ll.to_cell(Resolution::Seven).to_string();
    Ok((r9, r7))
}

async fn submit_signal(
    State(state): State<AppState>,
    auth: NostrAuth,
    Json(body): Json<SubmitSignalBody>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    if state.acoustic_limiter.check_key(&auth.pubkey).is_err() {
        tracing::warn!(pubkey = %auth.pubkey, "acoustic rate limit exceeded");
        return Err(AppError::RateLimited);
    }
    validate_signal_body(&body)?;
    let (h3_r9, h3_r7) = h3_cells_from(body.lat, body.lng)?;

    let row = sqlx::query(
        r#"
        INSERT INTO acoustic_signals
            (client_id, pubkey, threat_class, confidence, confidence_variance,
             lat, lng, h3_r9, h3_r7, model_version, threshold_profile,
             inference_backend, processing_latency, dropped_frames,
             device_category, signal_fingerprint)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        ON CONFLICT (client_id) DO NOTHING
        RETURNING id
        "#,
    )
    .bind(body.client_id)
    .bind(&auth.pubkey)
    .bind(&body.threat_class)
    .bind(body.confidence)
    .bind(body.confidence_variance)
    .bind(body.lat)
    .bind(body.lng)
    .bind(&h3_r9)
    .bind(&h3_r7)
    .bind(&body.model_version)
    .bind(&body.threshold_profile)
    .bind(&body.inference_backend)
    .bind(body.processing_latency)
    .bind(body.dropped_frames)
    .bind(&body.device_category)
    .bind(&body.signal_fingerprint)
    .fetch_optional(&state.db)
    .await?;

    match row {
        Some(r) => {
            let id: uuid::Uuid = r.try_get("id")?;
            Ok((
                StatusCode::CREATED,
                Json(serde_json::json!({ "id": id, "trust_state": "pending" })),
            ))
        }
        None => Ok((
            StatusCode::OK,
            Json(serde_json::json!({ "deduplicated": true })),
        )),
    }
}

pub fn router() -> Router<AppState> {
    Router::new().route("/signals", post(submit_signal))
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn valid_body() -> SubmitSignalBody {
        SubmitSignalBody {
            client_id: Uuid::new_v4(),
            threat_class: "gunshot".into(),
            confidence: 0.9,
            confidence_variance: None,
            lat: 37.7749,
            lng: -122.4194,
            model_version: "yamnet-tfjs-1".into(),
            threshold_profile: "default-v1".into(),
            inference_backend: "webgl".into(),
            processing_latency: None,
            dropped_frames: 0,
            device_category: None,
            signal_fingerprint: None,
        }
    }

    #[test]
    fn valid_body_passes() {
        assert!(validate_signal_body(&valid_body()).is_ok());
    }

    #[test]
    fn confidence_above_1_rejected() {
        let mut b = valid_body(); b.confidence = 1.1;
        assert!(matches!(validate_signal_body(&b), Err(AppError::BadRequest(_))));
    }

    #[test]
    fn confidence_below_0_rejected() {
        let mut b = valid_body(); b.confidence = -0.1;
        assert!(matches!(validate_signal_body(&b), Err(AppError::BadRequest(_))));
    }

    #[test]
    fn confidence_variance_above_1_rejected() {
        let mut b = valid_body(); b.confidence_variance = Some(1.1);
        assert!(matches!(validate_signal_body(&b), Err(AppError::BadRequest(_))));
    }

    #[test]
    fn lat_out_of_range_rejected() {
        let mut b = valid_body(); b.lat = 91.0;
        assert!(matches!(validate_signal_body(&b), Err(AppError::BadRequest(_))));
    }

    #[test]
    fn lng_out_of_range_rejected() {
        let mut b = valid_body(); b.lng = 181.0;
        assert!(matches!(validate_signal_body(&b), Err(AppError::BadRequest(_))));
    }

    #[test]
    fn empty_threat_class_rejected() {
        let mut b = valid_body(); b.threat_class = "".into();
        assert!(matches!(validate_signal_body(&b), Err(AppError::BadRequest(_))));
    }

    #[test]
    fn empty_model_version_rejected() {
        let mut b = valid_body(); b.model_version = "".into();
        assert!(matches!(validate_signal_body(&b), Err(AppError::BadRequest(_))));
    }

    #[test]
    fn negative_dropped_frames_rejected() {
        let mut b = valid_body(); b.dropped_frames = -1;
        assert!(matches!(validate_signal_body(&b), Err(AppError::BadRequest(_))));
    }

    #[test]
    fn h3_cells_valid_coords() {
        let (r9, r7) = h3_cells_from(37.7749, -122.4194).unwrap();
        assert!(!r9.is_empty());
        assert!(!r7.is_empty());
        assert_ne!(r9, r7);
    }

    #[test]
    fn h3_cells_poles_valid() {
        assert!(h3_cells_from(90.0, 0.0).is_ok());
        assert!(h3_cells_from(-90.0, 0.0).is_ok());
    }

    #[test]
    fn rate_limiter_blocks_after_limit() {
        use governor::{Quota, RateLimiter};
        use std::{num::NonZeroU32, sync::Arc};
        let limiter: Arc<governor::DefaultKeyedRateLimiter<String>> =
            Arc::new(RateLimiter::keyed(Quota::per_minute(NonZeroU32::new(2).unwrap())));
        let key = "pubkey_test".to_string();
        assert!(limiter.check_key(&key).is_ok());
        assert!(limiter.check_key(&key).is_ok());
        assert!(limiter.check_key(&key).is_err());
    }
}
