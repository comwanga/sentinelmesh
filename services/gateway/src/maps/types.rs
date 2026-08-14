use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct LatLng {
    pub lat: f64,
    pub lng: f64,
}

impl LatLng {
    pub fn validate(self) -> Result<Self, &'static str> {
        if !self.lat.is_finite() || !self.lng.is_finite() {
            return Err("coordinates must be finite");
        }
        if !(-90.0..=90.0).contains(&self.lat) || !(-180.0..=180.0).contains(&self.lng) {
            return Err("coordinates are out of range");
        }
        Ok(self)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TravelMode {
    Walking,
    Driving,
    Cycling,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct RouteRequest {
    pub from: LatLng,
    pub to: LatLng,
    pub mode: TravelMode,
    #[serde(default)]
    pub alternatives: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SearchRequest {
    pub query: String,
    pub proximity: Option<LatLng>,
    pub limit: u8,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ReverseRequest {
    pub location: LatLng,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SearchResult {
    pub id: String,
    pub label: String,
    pub kind: SearchKind,
    pub lat: f64,
    pub lng: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bbox: Option<[f64; 4]>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SearchKind {
    Address,
    Road,
    Place,
    Poi,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RouteResult {
    pub id: String,
    pub coordinates: Vec<[f64; 2]>,
    pub distance_m: f64,
    pub duration_s: f64,
    pub warnings: Vec<String>,
    pub degraded: bool,
}

#[derive(Debug, Serialize)]
pub struct SearchResponse {
    pub results: Vec<SearchResult>,
}

#[derive(Debug, Serialize)]
pub struct ReverseResponse {
    pub result: Option<SearchResult>,
}

#[derive(Debug, Serialize)]
pub struct RouteResponse {
    pub routes: Vec<RouteResult>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    InvalidRequest,
    ProviderUnavailable,
    ProviderTimeout,
    ProviderError,
    RateLimited,
    NoRoute,
}

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: ErrorBody,
}

#[derive(Debug, Serialize)]
pub struct ErrorBody {
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_coordinate_ranges_and_finiteness() {
        assert!(LatLng {
            lat: 90.0,
            lng: -180.0
        }
        .validate()
        .is_ok());
        assert!(LatLng {
            lat: 90.1,
            lng: 0.0
        }
        .validate()
        .is_err());
        assert!(LatLng {
            lat: 0.0,
            lng: f64::INFINITY
        }
        .validate()
        .is_err());
    }

    #[test]
    fn route_request_rejects_unknown_fields() {
        let json =
            r#"{"from":{"lat":0,"lng":0},"to":{"lat":1,"lng":1},"mode":"walking","extra":true}"#;
        assert!(serde_json::from_str::<RouteRequest>(json).is_err());
    }

    #[test]
    fn search_kind_has_stable_provider_independent_values() {
        assert_eq!(
            serde_json::to_string(&SearchKind::Address).unwrap(),
            "\"address\""
        );
        assert_eq!(
            serde_json::to_string(&SearchKind::Road).unwrap(),
            "\"road\""
        );
        assert_eq!(
            serde_json::to_string(&SearchKind::Place).unwrap(),
            "\"place\""
        );
        assert_eq!(serde_json::to_string(&SearchKind::Poi).unwrap(), "\"poi\"");
    }
}
