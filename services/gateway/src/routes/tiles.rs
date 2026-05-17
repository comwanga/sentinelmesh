use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use std::collections::HashMap;

use crate::AppState;

async fn proxy_tile(
    State(state): State<AppState>,
    Path(path): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let token = match &state.config.mapbox_token {
        Some(t) => t.clone(),
        None => {
            return (StatusCode::SERVICE_UNAVAILABLE, "tile proxy not configured").into_response()
        }
    };

    // Build upstream URL: strip any client-supplied access_token then add ours
    let mut upstream_params: Vec<(String, String)> = params
        .into_iter()
        .filter(|(k, _)| k != "access_token")
        .collect();
    upstream_params.push(("access_token".into(), token));

    let query_string = upstream_params
        .iter()
        .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("&");

    let upstream_url = format!("https://api.mapbox.com/{}?{}", path, query_string);

    let resp = match state.http_client.get(&upstream_url).send().await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("tile proxy request failed: {e}");
            return StatusCode::BAD_GATEWAY.into_response();
        }
    };

    let status = StatusCode::from_u16(resp.status().as_u16())
        .unwrap_or(StatusCode::BAD_GATEWAY);

    let mut headers = HeaderMap::new();
    for (name, value) in resp.headers() {
        // forward content-type and cache-control; skip transfer-encoding
        let lc = name.as_str().to_lowercase();
        if lc == "content-type" || lc == "cache-control" || lc == "etag" {
            if let Ok(v) = value.to_str() {
                if let (Ok(n), Ok(val)) = (
                    axum::http::HeaderName::try_from(name.as_str()),
                    axum::http::HeaderValue::from_str(v),
                ) {
                    headers.insert(n, val);
                }
            }
        }
    }

    let body = match resp.bytes().await {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!("tile proxy body read failed: {e}");
            return StatusCode::BAD_GATEWAY.into_response();
        }
    };

    (status, headers, body).into_response()
}

pub fn router() -> Router<AppState> {
    Router::new().route("/*path", get(proxy_tile))
}
