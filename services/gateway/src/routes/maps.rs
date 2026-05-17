use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::Json,
    routing::get,
    Router,
};
use serde::{Deserialize, Serialize};
use crate::AppState;

#[derive(Deserialize)]
pub struct SearchParams {
    pub q: String,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub limit: Option<u8>,
}

#[derive(Deserialize)]
pub struct RouteParams {
    pub from: String,
    pub to: String,
}

#[derive(Deserialize)]
pub struct ReverseParams {
    pub lat: f64,
    pub lng: f64,
}

#[derive(Serialize)]
struct SearchResponse {
    features: Vec<crate::maps::SearchResult>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/search",  get(search_handler))
        .route("/route",   get(route_handler))
        .route("/reverse", get(reverse_handler))
}

async fn search_handler(
    State(state): State<AppState>,
    Query(params): Query<SearchParams>,
) -> Result<Json<SearchResponse>, StatusCode> {
    let limit = params.limit.unwrap_or(5).min(10);
    state
        .map_provider
        .search(&params.q, params.lat, params.lng, limit)
        .await
        .map(|features| Json(SearchResponse { features }))
        .map_err(|e| {
            tracing::error!("maps/search error: {e}");
            StatusCode::BAD_GATEWAY
        })
}

async fn route_handler(
    State(state): State<AppState>,
    Query(params): Query<RouteParams>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let from = parse_lng_lat(&params.from).ok_or(StatusCode::BAD_REQUEST)?;
    let to   = parse_lng_lat(&params.to).ok_or(StatusCode::BAD_REQUEST)?;
    state
        .map_provider
        .route(from.0, from.1, to.0, to.1)
        .await
        .map(|r| Json(serde_json::to_value(&r).unwrap_or(serde_json::Value::Null)))
        .map_err(|e| {
            tracing::error!("maps/route error: {e}");
            StatusCode::BAD_GATEWAY
        })
}

async fn reverse_handler(
    State(state): State<AppState>,
    Query(params): Query<ReverseParams>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    state
        .map_provider
        .reverse(params.lat, params.lng)
        .await
        .map(|label| Json(serde_json::json!({ "label": label })))
        .map_err(|e| {
            tracing::error!("maps/reverse error: {e}");
            StatusCode::BAD_GATEWAY
        })
}

fn parse_lng_lat(s: &str) -> Option<(f64, f64)> {
    let mut parts = s.splitn(2, ',');
    let lng: f64 = parts.next()?.trim().parse().ok()?;
    let lat: f64 = parts.next()?.trim().parse().ok()?;
    Some((lng, lat))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_lng_lat_valid() {
        assert_eq!(parse_lng_lat("36.82,-1.29"), Some((36.82, -1.29)));
    }

    #[test]
    fn parse_lng_lat_with_spaces() {
        assert_eq!(parse_lng_lat("36.82, -1.29"), Some((36.82, -1.29)));
    }

    #[test]
    fn parse_lng_lat_invalid_returns_none() {
        assert!(parse_lng_lat("not-coords").is_none());
        assert!(parse_lng_lat("").is_none());
    }
}
