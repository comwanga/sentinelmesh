use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::get,
    Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{error::AppError, middleware::internal_auth::InternalServiceAuth, AppState};

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct SafetyEvent {
    pub id: Uuid,
    pub event_type: String,
    pub severity: String,
    pub title: String,
    pub lat: f64,
    pub lng: f64,
    pub started_at: DateTime<Utc>,
    pub summary: Option<String>,
    pub place_name: Option<String>,
    pub county: Option<String>,
    pub radius_meters: Option<i32>,
    pub confidence: Option<f64>,
    pub source_count: Option<i32>,
    pub source_breakdown: Option<serde_json::Value>,
    pub trust_state: String,
    pub origin_class: String,
    pub is_active: bool,
    pub state: String,
    pub nostr_event_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Deserialize)]
pub struct CreateEventBody {
    pub event_type: String,
    pub severity: String,
    pub title: String,
    pub lat: f64,
    pub lng: f64,
    pub started_at: DateTime<Utc>,
    pub summary: Option<String>,
    pub place_name: Option<String>,
    pub county: Option<String>,
    pub radius_meters: Option<i32>,
    pub confidence: Option<f64>,
    pub source_count: Option<i32>,
    pub source_breakdown: Option<serde_json::Value>,
    pub is_active: Option<bool>,
}

#[derive(Deserialize)]
pub struct ListEventsQuery {
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub radius_km: Option<f64>,
    pub severity: Option<String>,
    pub r#type: Option<String>,
    pub active_only: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Deserialize)]
pub struct BoundsQuery {
    pub min_lat: f64,
    pub max_lat: f64,
    pub min_lng: f64,
    pub max_lng: f64,
    pub zoom: Option<f64>,
}

fn viewport_limit(zoom: f64) -> i64 {
    ((1000.0 / (zoom - 8.0).max(1.0)) as i64).clamp(50, 500)
}

async fn create_event(
    State(state): State<AppState>,
    _auth: InternalServiceAuth,
    Json(body): Json<CreateEventBody>,
) -> Result<(StatusCode, Json<SafetyEvent>), AppError> {
    if body.event_type.is_empty() || body.title.is_empty() || body.severity.is_empty() {
        return Err(AppError::BadRequest(
            "event_type, title, severity are required".into(),
        ));
    }

    if !(-90.0..=90.0).contains(&body.lat) || !(-180.0..=180.0).contains(&body.lng) {
        return Err(AppError::BadRequest(
            "lat must be in -90..90, lng in -180..180".into(),
        ));
    }

    let event = sqlx::query_as::<_, SafetyEvent>(
        "INSERT INTO safety_events
           (event_type, severity, title, lat, lng, started_at, summary, place_name, county,
            radius_meters, confidence, source_count, source_breakdown, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING id, event_type, severity, title, lat, lng, started_at,
                   summary, place_name, county, radius_meters, confidence,
                   source_count, source_breakdown, trust_state, origin_class,
                   is_active, state,
                    nostr_event_id, created_at, updated_at",
    )
    .bind(&body.event_type)
    .bind(&body.severity)
    .bind(&body.title)
    .bind(body.lat)
    .bind(body.lng)
    .bind(body.started_at)
    .bind(&body.summary)
    .bind(&body.place_name)
    .bind(&body.county)
    .bind(body.radius_meters)
    .bind(body.confidence)
    .bind(body.source_count)
    .bind(&body.source_breakdown)
    .bind(body.is_active.unwrap_or(true))
    .fetch_one(&state.db)
    .await?;

    let msg = serde_json::json!({ "type": "NEW_EVENT", "payload": event });
    state.hub.broadcast(
        body.county.as_deref(),
        serde_json::to_string(&msg).unwrap().into(),
    );
    let viewport_json = serde_json::json!({
        "id": event.id,
        "event_type": event.event_type,
        "severity": event.severity,
        "state": event.state,
        "trust_state": event.trust_state,
        "title": event.title,
        "lat": event.lat,
        "lng": event.lng,
        "started_at": event.started_at,
    });
    let _ = state.event_tx.send(crate::ws::ViewportEvent {
        id: event.id,
        lat: event.lat,
        lng: event.lng,
        severity: event.severity.clone(),
        event_json: viewport_json.to_string().into(),
    });

    Ok((StatusCode::CREATED, Json(event)))
}

async fn list_events(
    State(state): State<AppState>,
    Query(q): Query<ListEventsQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let radius_m = q.radius_km.unwrap_or(10.0) * 1000.0;
    let limit = q.limit.unwrap_or(50).min(200);
    let active_only = q.active_only.as_deref() != Some("false");

    let severity_filter: Option<Vec<String>> = q
        .severity
        .as_deref()
        .map(|s| s.split(',').map(|x| x.trim().to_uppercase()).collect());
    let type_filter: Option<Vec<String>> = q
        .r#type
        .as_deref()
        .map(|s| s.split(',').map(|x| x.trim().to_uppercase()).collect());

    let events = sqlx::query_as::<_, SafetyEvent>(
        "SELECT id, event_type, severity, title, lat, lng, started_at,
                summary, place_name, county, radius_meters, confidence,
                source_count, source_breakdown, trust_state, origin_class,
                is_active, state,
                 nostr_event_id, created_at, updated_at
         FROM safety_events
         WHERE ($1::float8 IS NULL OR
                earth_distance(ll_to_earth($1,$2), ll_to_earth(lat,lng)) <= $3)
           AND ($4::text[] IS NULL OR severity = ANY($4))
           AND ($5::text[] IS NULL OR event_type = ANY($5))
           AND (NOT $6 OR is_active = true)
         ORDER BY created_at DESC
         LIMIT $7",
    )
    .bind(q.lat)
    .bind(q.lng)
    .bind(radius_m)
    .bind(severity_filter)
    .bind(type_filter)
    .bind(active_only)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;

    let total = events.len() as i64;
    Ok(Json(
        serde_json::json!({ "events": events, "total": total }),
    ))
}

async fn get_event(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<SafetyEvent>, AppError> {
    let event = sqlx::query_as::<_, SafetyEvent>(
        "SELECT id, event_type, severity, title, lat, lng, started_at,
                summary, place_name, county, radius_meters, confidence,
                source_count, source_breakdown, trust_state, origin_class,
                is_active, state,
                 nostr_event_id, created_at, updated_at
         FROM safety_events WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;

    Ok(Json(event))
}

async fn list_events_by_bounds(
    State(state): State<AppState>,
    Query(q): Query<BoundsQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let limit = viewport_limit(q.zoom.unwrap_or(12.0));
    let events = sqlx::query_as::<_, SafetyEvent>(
        "SELECT id, event_type, severity, title, lat, lng, started_at,
                summary, place_name, county, radius_meters, confidence,
                source_count, source_breakdown, trust_state, origin_class,
                is_active, state,
                 nostr_event_id, created_at, updated_at
           FROM safety_events
          WHERE geog && ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography
            AND state NOT IN ('RESOLVED', 'EXPIRED')
          ORDER BY created_at DESC
          LIMIT $5",
    )
    .bind(q.min_lng)
    .bind(q.min_lat)
    .bind(q.max_lng)
    .bind(q.max_lat)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;
    let total = events.len() as i64;
    Ok(Json(
        serde_json::json!({ "events": events, "total": total }),
    ))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_events).post(create_event))
        .route("/bounds", get(list_events_by_bounds))
        .route("/:id", get(get_event))
}

impl From<SafetyEvent> for sentinel_core::Event {
    fn from(row: SafetyEvent) -> Self {
        Self {
            id: row.id,
            event_type: row.event_type,
            severity: row.severity,
            title: row.title,
            lat: row.lat,
            lng: row.lng,
            started_at: row.started_at,
            summary: row.summary,
            place_name: row.place_name,
            county: row.county,
            is_active: row.is_active,
            state: Some(row.state),
            created_at: row.created_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use uuid::Uuid;

    fn sample_db_row() -> SafetyEvent {
        let now = Utc::now();
        SafetyEvent {
            id: Uuid::nil(),
            event_type: "FLOOD".into(),
            severity: "CRITICAL".into(),
            title: "Flooding downtown".into(),
            lat: -1.2921,
            lng: 36.8219,
            started_at: now,
            summary: Some("Roads impassable".into()),
            place_name: Some("CBD".into()),
            county: Some("Nairobi".into()),
            radius_meters: Some(2000),
            confidence: Some(0.95),
            source_count: Some(3),
            source_breakdown: None,
            trust_state: "confirmed".into(),
            origin_class: "machine".into(),
            is_active: true,
            state: "ACTIVE".into(),
            nostr_event_id: Some("nevent1abc".into()),
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn from_safety_event_maps_core_fields() {
        let row = sample_db_row();
        let e = sentinel_core::Event::from(row);
        assert_eq!(e.id, Uuid::nil());
        assert_eq!(e.event_type, "FLOOD");
        assert_eq!(e.severity, "CRITICAL");
        assert_eq!(e.lat, -1.2921);
        assert_eq!(e.county, Some("Nairobi".into()));
        assert!(e.is_active);
    }

    #[test]
    fn from_safety_event_drops_db_only_fields() {
        let row = sample_db_row();
        let e = sentinel_core::Event::from(row);
        // These fields exist on the domain type (compile-time check):
        let _: Uuid = e.id;
        let _: String = e.event_type;
        let _: String = e.severity;
        let _: bool = e.is_active;
    }

    #[test]
    fn safety_event_api_exposes_only_current_fields() {
        let value = serde_json::to_value(sample_db_row()).unwrap();
        assert!(value.get("nostr_event_id").is_some());
        assert!(value.get("bitcoin_txid").is_none());
        assert!(value.get("bitcoin_block").is_none());
        assert!(value.get("anchor_hash").is_none());
    }

    #[test]
    fn viewport_limit_clamped_to_max_at_low_zoom() {
        assert_eq!(viewport_limit(8.0), 500);
    }

    #[test]
    fn viewport_limit_mid_zoom() {
        assert_eq!(viewport_limit(12.0), 250);
    }

    #[test]
    fn viewport_limit_clamped_to_min_at_high_zoom() {
        assert_eq!(viewport_limit(30.0), 50);
    }
}
