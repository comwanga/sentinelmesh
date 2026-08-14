use crate::{
    maps::{
        types::{
            ErrorBody, ErrorCode, ErrorResponse, LatLng, ReverseRequest, ReverseResponse,
            RouteRequest, RouteResponse, SearchRequest, SearchResponse,
        },
        MapProviderError,
    },
    AppState,
};
use axum::{
    extract::{rejection::JsonRejection, rejection::QueryRejection, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SearchParams {
    q: String,
    lat: Option<f64>,
    lng: Option<f64>,
    limit: Option<u8>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReverseParams {
    lat: f64,
    lng: f64,
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    code: ErrorCode,
    message: String,
    retryable: bool,
}

impl ApiError {
    fn invalid(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code: ErrorCode::InvalidRequest,
            message: message.into(),
            retryable: false,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ErrorResponse {
                error: ErrorBody {
                    code: self.code,
                    message: self.message,
                    retryable: self.retryable,
                },
            }),
        )
            .into_response()
    }
}

impl From<MapProviderError> for ApiError {
    fn from(error: MapProviderError) -> Self {
        let (status, code, message, retryable) = match error {
            MapProviderError::Unavailable => (
                StatusCode::SERVICE_UNAVAILABLE,
                ErrorCode::ProviderUnavailable,
                "map provider is unavailable",
                true,
            ),
            MapProviderError::Timeout => (
                StatusCode::GATEWAY_TIMEOUT,
                ErrorCode::ProviderTimeout,
                "map provider request timed out",
                true,
            ),
            MapProviderError::RateLimited => (
                StatusCode::TOO_MANY_REQUESTS,
                ErrorCode::RateLimited,
                "map provider rate limit exceeded",
                true,
            ),
            MapProviderError::NoRoute => (
                StatusCode::NOT_FOUND,
                ErrorCode::NoRoute,
                "no route found",
                false,
            ),
            MapProviderError::Upstream => (
                StatusCode::BAD_GATEWAY,
                ErrorCode::ProviderError,
                "map provider request failed",
                true,
            ),
        };
        tracing::error!(code = ?code, "map provider request failed");
        Self {
            status,
            code,
            message: message.into(),
            retryable,
        }
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/search", get(search_handler))
        .route("/route", post(route_handler))
        .route("/reverse", get(reverse_handler))
}

async fn search_handler(
    State(state): State<AppState>,
    query: Result<Query<SearchParams>, QueryRejection>,
) -> Result<Json<SearchResponse>, ApiError> {
    let Query(params) = query.map_err(|_| ApiError::invalid("invalid search parameters"))?;
    let request = validate_search(params)?;
    let results = state.map_provider.search(request).await?;
    Ok(Json(SearchResponse { results }))
}

fn validate_search(params: SearchParams) -> Result<SearchRequest, ApiError> {
    let query = params.q.trim();
    if !(2..=120).contains(&query.chars().count()) {
        return Err(ApiError::invalid(
            "q must contain 2 to 120 trimmed characters",
        ));
    }
    let limit = params.limit.unwrap_or(5);
    if !(1..=10).contains(&limit) {
        return Err(ApiError::invalid("limit must be between 1 and 10"));
    }
    let proximity = match (params.lat, params.lng) {
        (None, None) => None,
        (Some(lat), Some(lng)) => Some(LatLng { lat, lng }.validate().map_err(ApiError::invalid)?),
        _ => return Err(ApiError::invalid("lat and lng must be provided together")),
    };
    Ok(SearchRequest {
        query: query.to_owned(),
        proximity,
        limit,
    })
}

async fn route_handler(
    State(state): State<AppState>,
    payload: Result<Json<RouteRequest>, JsonRejection>,
) -> Result<Json<RouteResponse>, ApiError> {
    let Json(request) = payload.map_err(|_| ApiError::invalid("invalid route request body"))?;
    request.from.validate().map_err(ApiError::invalid)?;
    request.to.validate().map_err(ApiError::invalid)?;
    let routes = match state.map_provider.route(request).await {
        Ok(routes) => routes,
        Err(MapProviderError::NoRoute) => Vec::new(),
        Err(error) => return Err(error.into()),
    };
    Ok(Json(RouteResponse { routes }))
}

async fn reverse_handler(
    State(state): State<AppState>,
    query: Result<Query<ReverseParams>, QueryRejection>,
) -> Result<Json<ReverseResponse>, ApiError> {
    let Query(params) = query.map_err(|_| ApiError::invalid("invalid reverse parameters"))?;
    let location = LatLng {
        lat: params.lat,
        lng: params.lng,
    }
    .validate()
    .map_err(ApiError::invalid)?;
    let result = state
        .map_provider
        .reverse(ReverseRequest { location })
        .await?;
    Ok(Json(ReverseResponse { result }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_validation_trims_and_bounds_query() {
        let valid = validate_search(SearchParams {
            q: " Nairobi ".into(),
            lat: None,
            lng: None,
            limit: None,
        })
        .unwrap();
        assert_eq!(valid.query, "Nairobi");

        for q in [" ".to_owned(), "x".repeat(121)] {
            assert!(validate_search(SearchParams {
                q,
                lat: None,
                lng: None,
                limit: None,
            })
            .is_err());
        }
    }

    #[test]
    fn search_validation_requires_valid_paired_proximity_and_limit() {
        for params in [
            SearchParams {
                q: "park".into(),
                lat: Some(1.0),
                lng: None,
                limit: Some(5),
            },
            SearchParams {
                q: "park".into(),
                lat: Some(91.0),
                lng: Some(1.0),
                limit: Some(5),
            },
            SearchParams {
                q: "park".into(),
                lat: Some(1.0),
                lng: Some(f64::INFINITY),
                limit: Some(5),
            },
            SearchParams {
                q: "park".into(),
                lat: None,
                lng: None,
                limit: Some(0),
            },
            SearchParams {
                q: "park".into(),
                lat: None,
                lng: None,
                limit: Some(11),
            },
        ] {
            assert!(validate_search(params).is_err());
        }
    }

    #[test]
    fn provider_errors_have_stable_codes() {
        let error = ApiError::from(MapProviderError::Unavailable);
        assert_eq!(error.status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(error.code, ErrorCode::ProviderUnavailable);
        assert!(error.retryable);

        let rate_limited = ApiError::from(MapProviderError::RateLimited);
        assert_eq!(rate_limited.status, StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(rate_limited.code, ErrorCode::RateLimited);
        assert!(rate_limited.retryable);
        assert_eq!(rate_limited.message, "map provider rate limit exceeded");

        let upstream = ApiError::from(MapProviderError::Upstream);
        assert_eq!(upstream.code, ErrorCode::ProviderError);
        assert_eq!(upstream.message, "map provider request failed");
        assert!(upstream.retryable);
    }
}
