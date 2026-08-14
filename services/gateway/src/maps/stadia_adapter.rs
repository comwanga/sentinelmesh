use super::{
    provider::{MapProvider, MapProviderError},
    types::{
        LatLng, ReverseRequest, RouteRequest, RouteResult, SearchKind, SearchRequest, SearchResult,
        TravelMode,
    },
};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::Duration;

const API_BASE: &str = "https://api.stadiamaps.com";
const PROVIDER_TIMEOUT: Duration = Duration::from_secs(3);

pub struct StadiaAdapter {
    client: reqwest::Client,
    api_key: String,
}

impl StadiaAdapter {
    pub fn new(client: reqwest::Client, api_key: String) -> Self {
        Self { client, api_key }
    }

    fn authorized(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        request
            .header("Authorization", format!("Stadia-Auth {}", self.api_key))
            .timeout(PROVIDER_TIMEOUT)
    }
}

#[derive(Deserialize)]
struct GeocodeResponse {
    features: Vec<GeocodeFeature>,
}

#[derive(Deserialize)]
struct GeocodeFeature {
    geometry: PointGeometry,
    properties: GeocodeProperties,
    bbox: Option<[f64; 4]>,
}

#[derive(Deserialize)]
struct PointGeometry {
    coordinates: [f64; 2],
}

#[derive(Deserialize)]
struct GeocodeProperties {
    gid: Option<String>,
    id: Option<String>,
    label: Option<String>,
    formatted_address_line: Option<String>,
    name: Option<String>,
    layer: String,
}

#[derive(Serialize)]
struct StadiaRouteRequest {
    id: &'static str,
    locations: [StadiaLocation; 2],
    costing: &'static str,
    format: &'static str,
    alternates: u8,
    units: &'static str,
}

#[derive(Serialize)]
struct StadiaLocation {
    lat: f64,
    lon: f64,
}

#[derive(Deserialize)]
struct OsrmRouteResponse {
    code: String,
    #[serde(default)]
    routes: Vec<OsrmRoute>,
}

#[derive(Deserialize)]
struct OsrmRoute {
    geometry: String,
    distance: f64,
    duration: f64,
}

fn normalize_geocode(data: GeocodeResponse) -> Result<Vec<SearchResult>, MapProviderError> {
    data.features
        .into_iter()
        .map(|feature| {
            let provider_id = feature
                .properties
                .gid
                .or(feature.properties.id)
                .ok_or(MapProviderError::Upstream)?;
            let label = feature
                .properties
                .formatted_address_line
                .or(feature.properties.label)
                .or(feature.properties.name)
                .ok_or(MapProviderError::Upstream)?;
            let [lng, lat] = feature.geometry.coordinates;
            LatLng { lat, lng }
                .validate()
                .map_err(|_| MapProviderError::Upstream)?;
            if let Some(bbox) = feature.bbox {
                validate_bbox(bbox)?;
            }
            Ok(SearchResult {
                id: stable_search_id(&provider_id),
                label,
                kind: normalize_layer(&feature.properties.layer),
                lat,
                lng,
                bbox: feature.bbox,
            })
        })
        .collect()
}

fn stable_search_id(provider_id: &str) -> String {
    format!(
        "map-{}",
        hex::encode(Sha256::digest(provider_id.as_bytes()))
    )
}

fn normalize_layer(layer: &str) -> SearchKind {
    match layer {
        "address" => SearchKind::Address,
        "street" => SearchKind::Road,
        "venue" | "poi" => SearchKind::Poi,
        _ => SearchKind::Place,
    }
}

fn validate_bbox([west, south, east, north]: [f64; 4]) -> Result<(), MapProviderError> {
    LatLng {
        lat: south,
        lng: west,
    }
    .validate()
    .map_err(|_| MapProviderError::Upstream)?;
    LatLng {
        lat: north,
        lng: east,
    }
    .validate()
    .map_err(|_| MapProviderError::Upstream)?;
    if west > east || south > north {
        return Err(MapProviderError::Upstream);
    }
    Ok(())
}

fn normalize_routes(data: OsrmRouteResponse) -> Result<Vec<RouteResult>, MapProviderError> {
    if data.code != "Ok" {
        return if data.code == "NoRoute" {
            Ok(Vec::new())
        } else {
            Err(MapProviderError::Upstream)
        };
    }
    data.routes
        .into_iter()
        .enumerate()
        .map(|(index, route)| {
            let coordinates = decode_polyline6(&route.geometry)?;
            if !route.distance.is_finite()
                || route.distance < 0.0
                || !route.duration.is_finite()
                || route.duration < 0.0
                || coordinates.len() < 2
            {
                return Err(MapProviderError::Upstream);
            }
            validate_route_coordinates(&coordinates)?;
            Ok(RouteResult {
                id: format!("route-{index}"),
                coordinates,
                distance_m: route.distance,
                duration_s: route.duration,
                warnings: Vec::new(),
                degraded: false,
            })
        })
        .collect()
}

fn validate_route_coordinates(coordinates: &[[f64; 2]]) -> Result<(), MapProviderError> {
    for [lng, lat] in coordinates {
        LatLng {
            lat: *lat,
            lng: *lng,
        }
        .validate()
        .map_err(|_| MapProviderError::Upstream)?;
    }
    Ok(())
}

// Stadia's OSRM response documents route geometry as an encoded polyline with
// six decimal places rather than OSRM's usual five.
fn decode_polyline6(encoded: &str) -> Result<Vec<[f64; 2]>, MapProviderError> {
    fn component(bytes: &[u8], index: &mut usize) -> Result<i64, MapProviderError> {
        let mut result = 0_i64;
        let mut shift = 0_u32;
        loop {
            let byte = *bytes.get(*index).ok_or(MapProviderError::Upstream)?;
            *index += 1;
            if !(63..=126).contains(&byte) || shift > 60 {
                return Err(MapProviderError::Upstream);
            }
            let value = i64::from(byte - 63);
            result |= (value & 0x1f) << shift;
            if value < 0x20 {
                return Ok(if result & 1 == 1 {
                    !(result >> 1)
                } else {
                    result >> 1
                });
            }
            shift += 5;
        }
    }

    let bytes = encoded.as_bytes();
    let mut index = 0;
    let mut lat = 0_i64;
    let mut lng = 0_i64;
    let mut coordinates = Vec::new();
    while index < bytes.len() {
        lat = lat
            .checked_add(component(bytes, &mut index)?)
            .ok_or(MapProviderError::Upstream)?;
        lng = lng
            .checked_add(component(bytes, &mut index)?)
            .ok_or(MapProviderError::Upstream)?;
        coordinates.push([lng as f64 / 1_000_000.0, lat as f64 / 1_000_000.0]);
    }
    Ok(coordinates)
}

fn costing(mode: TravelMode) -> &'static str {
    match mode {
        TravelMode::Walking => "pedestrian",
        TravelMode::Driving => "auto",
        TravelMode::Cycling => "bicycle",
    }
}

fn provider_error(error: reqwest::Error) -> MapProviderError {
    if error.is_timeout() {
        MapProviderError::Timeout
    } else {
        MapProviderError::Upstream
    }
}

fn status_error(status: reqwest::StatusCode) -> Option<MapProviderError> {
    if status.is_success() {
        None
    } else if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        Some(MapProviderError::RateLimited)
    } else {
        Some(MapProviderError::Upstream)
    }
}

async fn decode<T: serde::de::DeserializeOwned>(
    response: reqwest::Response,
) -> Result<T, MapProviderError> {
    let status = response.status();
    if let Some(error) = status_error(status) {
        return Err(error);
    }
    response.json().await.map_err(provider_error)
}

#[async_trait]
impl MapProvider for StadiaAdapter {
    async fn search(&self, request: SearchRequest) -> Result<Vec<SearchResult>, MapProviderError> {
        let mut query = vec![("text", request.query), ("size", request.limit.to_string())];
        if let Some(point) = request.proximity {
            query.push(("focus.point.lat", point.lat.to_string()));
            query.push(("focus.point.lon", point.lng.to_string()));
        }
        let response = self
            .authorized(
                self.client
                    .get(format!("{API_BASE}/geocoding/v2/autocomplete")),
            )
            .query(&query)
            .send()
            .await
            .map_err(provider_error)?;
        normalize_geocode(decode(response).await?)
    }

    async fn route(&self, request: RouteRequest) -> Result<Vec<RouteResult>, MapProviderError> {
        let body = StadiaRouteRequest {
            id: "sentinelmesh-route",
            locations: [
                StadiaLocation {
                    lat: request.from.lat,
                    lon: request.from.lng,
                },
                StadiaLocation {
                    lat: request.to.lat,
                    lon: request.to.lng,
                },
            ],
            costing: costing(request.mode),
            format: "osrm",
            alternates: if request.alternatives { 2 } else { 0 },
            units: "kilometers",
        };
        let response = self
            .authorized(self.client.post(format!("{API_BASE}/route/v1")))
            .json(&body)
            .send()
            .await
            .map_err(provider_error)?;
        normalize_routes(decode(response).await?)
    }

    async fn reverse(
        &self,
        request: ReverseRequest,
    ) -> Result<Option<SearchResult>, MapProviderError> {
        let query = [
            ("point.lat", request.location.lat.to_string()),
            ("point.lon", request.location.lng.to_string()),
            ("size", "1".to_string()),
        ];
        let response = self
            .authorized(self.client.get(format!("{API_BASE}/geocoding/v2/reverse")))
            .query(&query)
            .send()
            .await
            .map_err(provider_error)?;
        Ok(normalize_geocode(decode(response).await?)?
            .into_iter()
            .next())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_stadia_geocoding_fixture() {
        let fixture = r#"{"features":[{"geometry":{"coordinates":[36.8219,-1.2921]},"properties":{"gid":"openstreetmap:locality:1","name":"Nairobi","formatted_address_line":"Nairobi, Kenya","layer":"locality"},"bbox":[36.7,-1.4,37.0,-1.1]}]}"#;
        let results = normalize_geocode(serde_json::from_str(fixture).unwrap()).unwrap();
        assert_eq!(results[0].id, stable_search_id("openstreetmap:locality:1"));
        assert!(!results[0].id.contains("openstreetmap"));
        assert_eq!(results[0].kind, SearchKind::Place);
        assert_eq!(results[0].label, "Nairobi, Kenya");
        assert_eq!(results[0].bbox, Some([36.7, -1.4, 37.0, -1.1]));
    }

    #[test]
    fn maps_stadia_layers_to_provider_independent_kinds() {
        assert_eq!(normalize_layer("address"), SearchKind::Address);
        assert_eq!(normalize_layer("street"), SearchKind::Road);
        assert_eq!(normalize_layer("venue"), SearchKind::Poi);
        assert_eq!(normalize_layer("locality"), SearchKind::Place);
    }

    #[test]
    fn rejects_invalid_geocoder_coordinates_and_bboxes() {
        let bad_point = r#"{"features":[{"geometry":{"coordinates":[181,0]},"properties":{"gid":"x","name":"X","layer":"locality"}}]}"#;
        assert_eq!(
            normalize_geocode(serde_json::from_str(bad_point).unwrap()).unwrap_err(),
            MapProviderError::Upstream
        );

        let bad_bbox = r#"{"features":[{"geometry":{"coordinates":[1,1]},"properties":{"gid":"x","name":"X","layer":"locality"},"bbox":[2,1,1,2]}]}"#;
        assert_eq!(
            normalize_geocode(serde_json::from_str(bad_bbox).unwrap()).unwrap_err(),
            MapProviderError::Upstream
        );
        assert_eq!(
            validate_bbox([f64::NEG_INFINITY, 1.0, 2.0, 2.0]).unwrap_err(),
            MapProviderError::Upstream
        );
    }

    #[test]
    fn normalizes_documented_osrm_route_fixture() {
        let fixture =
            r#"{"code":"Ok","routes":[{"geometry":"??AA","distance":1500.0,"duration":900.0}]}"#;
        let routes = normalize_routes(serde_json::from_str(fixture).unwrap()).unwrap();
        assert_eq!(routes[0].distance_m, 1500.0);
        assert_eq!(
            routes[0].coordinates,
            vec![[0.0, 0.0], [0.000001, 0.000001]]
        );
    }

    #[test]
    fn normalizes_no_route_as_empty_success() {
        let fixture = r#"{"code":"NoRoute","message":"No route found"}"#;
        let routes = normalize_routes(serde_json::from_str(fixture).unwrap()).unwrap();
        assert!(routes.is_empty());
    }

    #[test]
    fn rejects_invalid_route_coordinates_and_metrics() {
        assert_eq!(
            validate_route_coordinates(&[[0.0, 0.0], [181.0, 0.0]]).unwrap_err(),
            MapProviderError::Upstream
        );

        let bad_coordinate =
            r#"{"code":"Ok","routes":[{"geometry":"!","distance":1500,"duration":900}]}"#;
        assert_eq!(
            normalize_routes(serde_json::from_str(bad_coordinate).unwrap()).unwrap_err(),
            MapProviderError::Upstream
        );

        let bad_metric =
            r#"{"code":"Ok","routes":[{"geometry":"??AA","distance":-1,"duration":900}]}"#;
        assert_eq!(
            normalize_routes(serde_json::from_str(bad_metric).unwrap()).unwrap_err(),
            MapProviderError::Upstream
        );

        assert_eq!(
            normalize_routes(OsrmRouteResponse {
                code: "Ok".into(),
                routes: vec![OsrmRoute {
                    geometry: "??AA".into(),
                    distance: f64::NAN,
                    duration: 900.0,
                }],
            })
            .unwrap_err(),
            MapProviderError::Upstream
        );
    }

    #[test]
    fn maps_http_429_to_rate_limited() {
        assert_eq!(
            status_error(reqwest::StatusCode::TOO_MANY_REQUESTS),
            Some(MapProviderError::RateLimited)
        );
        assert_eq!(status_error(reqwest::StatusCode::OK), None);
    }

    #[test]
    fn maps_all_transport_modes_to_stadia_costing() {
        assert_eq!(costing(TravelMode::Walking), "pedestrian");
        assert_eq!(costing(TravelMode::Driving), "auto");
        assert_eq!(costing(TravelMode::Cycling), "bicycle");
    }
}
