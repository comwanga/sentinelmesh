use super::{
    provider::{MapProvider, MapProviderError},
    types::{
        LatLng, ReverseRequest, RouteRequest, RouteResult, SearchKind, SearchRequest, SearchResult,
    },
};
use async_trait::async_trait;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::time::Duration;

const API_BASE: &str = "https://nominatim.openstreetmap.org";
const USER_AGENT: &str = "SentinelMesh/0.1 (local development)";
const PROVIDER_TIMEOUT: Duration = Duration::from_secs(5);

/// Keyless geocoding via OpenStreetMap Nominatim. Used for search + reverse so
/// location lookup and home-address setup work without a paid API key. Routing is
/// intentionally unsupported (returns Unavailable) — routes require Stadia.
pub struct NominatimAdapter {
    client: reqwest::Client,
}

impl NominatimAdapter {
    pub fn new(client: reqwest::Client) -> Self {
        Self { client }
    }

    fn request(&self, url: &str) -> reqwest::RequestBuilder {
        self.client
            .get(url)
            .header("User-Agent", USER_AGENT)
            .timeout(PROVIDER_TIMEOUT)
    }
}

#[derive(Deserialize)]
struct NominatimPlace {
    osm_type: Option<String>,
    osm_id: Option<u64>,
    lat: String,
    lon: String,
    display_name: Option<String>,
    #[serde(default)]
    addresstype: Option<String>,
    #[serde(default)]
    category: Option<String>,
    #[serde(default)]
    boundingbox: Vec<String>,
}

fn stable_id(osm_type: &str, osm_id: u64) -> String {
    format!(
        "map-{}",
        hex::encode(Sha256::digest(format!("{osm_type}:{osm_id}").as_bytes()))
    )
}

fn kind_for(addresstype: Option<&str>, category: Option<&str>) -> SearchKind {
    match addresstype.unwrap_or("") {
        "road" | "highway" | "residential" | "street" => return SearchKind::Road,
        "house" | "building" | "address" => return SearchKind::Address,
        "amenity" | "shop" | "tourism" | "leisure" => return SearchKind::Poi,
        _ => {}
    }
    match category.unwrap_or("") {
        "highway" => SearchKind::Road,
        "amenity" | "shop" | "tourism" | "leisure" => SearchKind::Poi,
        _ => SearchKind::Place,
    }
}

fn normalize_place(place: &NominatimPlace) -> Result<SearchResult, MapProviderError> {
    let osm_type = place.osm_type.as_deref().unwrap_or("node");
    let osm_id = place.osm_id.ok_or(MapProviderError::Upstream)?;
    let lat: f64 = place.lat.parse().map_err(|_| MapProviderError::Upstream)?;
    let lng: f64 = place.lon.parse().map_err(|_| MapProviderError::Upstream)?;
    let location = LatLng { lat, lng }
        .validate()
        .map_err(|_| MapProviderError::Upstream)?;
    let label = place
        .display_name
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or(MapProviderError::Upstream)?;
    let bbox = if place.boundingbox.len() == 4 {
        let south: f64 = place.boundingbox[0]
            .parse()
            .map_err(|_| MapProviderError::Upstream)?;
        let north: f64 = place.boundingbox[1]
            .parse()
            .map_err(|_| MapProviderError::Upstream)?;
        let west: f64 = place.boundingbox[2]
            .parse()
            .map_err(|_| MapProviderError::Upstream)?;
        let east: f64 = place.boundingbox[3]
            .parse()
            .map_err(|_| MapProviderError::Upstream)?;
        let bbox = [west, south, east, north];
        validate_bbox(bbox)?;
        Some(bbox)
    } else {
        None
    };
    Ok(SearchResult {
        id: stable_id(osm_type, osm_id),
        label: label.to_string(),
        kind: kind_for(place.addresstype.as_deref(), place.category.as_deref()),
        lat: location.lat,
        lng: location.lng,
        bbox,
    })
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
    if let Some(error) = status_error(response.status()) {
        return Err(error);
    }
    response.json().await.map_err(provider_error)
}

#[async_trait]
impl MapProvider for NominatimAdapter {
    async fn search(&self, request: SearchRequest) -> Result<Vec<SearchResult>, MapProviderError> {
        let mut query = vec![
            ("q".to_string(), request.query),
            ("format".to_string(), "jsonv2".to_string()),
            ("limit".to_string(), request.limit.to_string()),
            ("accept-language".to_string(), "en".to_string()),
        ];
        // Bias, not bound: Nominatim viewbox is a soft preference.
        if let Some(point) = request.proximity {
            let d = 0.25;
            query.push((
                "viewbox".to_string(),
                format!(
                    "{},{},{},{}",
                    point.lng - d,
                    point.lat - d,
                    point.lng + d,
                    point.lat + d
                ),
            ));
            query.push(("bounded".to_string(), "0".to_string()));
        }
        let response = self
            .request(&format!("{API_BASE}/search"))
            .query(&query)
            .send()
            .await
            .map_err(provider_error)?;
        let places: Vec<NominatimPlace> = decode(response).await?;
        places.iter().map(normalize_place).collect()
    }

    async fn route(&self, _request: RouteRequest) -> Result<Vec<RouteResult>, MapProviderError> {
        Err(MapProviderError::Unavailable)
    }

    async fn reverse(
        &self,
        request: ReverseRequest,
    ) -> Result<Option<SearchResult>, MapProviderError> {
        let query = [
            ("format".to_string(), "jsonv2".to_string()),
            ("lat".to_string(), request.location.lat.to_string()),
            ("lon".to_string(), request.location.lng.to_string()),
            ("accept-language".to_string(), "en".to_string()),
        ];
        let response = self
            .request(&format!("{API_BASE}/reverse"))
            .query(&query)
            .send()
            .await
            .map_err(provider_error)?;
        let place: NominatimPlace = decode(response).await?;
        Ok(Some(normalize_place(&place)?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn place(fixture: &str) -> NominatimPlace {
        serde_json::from_str(fixture).unwrap()
    }

    #[test]
    fn normalizes_nominatim_search_result() {
        let p = place(
            r#"{"place_id":1,"osm_type":"way","osm_id":42,"lat":"-1.2921","lon":"36.8219","display_name":"Kibera, Nairobi, Kenya","addresstype":"residential","category":"place","boundingbox":["-1.30","-1.28","36.81","36.83"]}"#,
        );
        let result = normalize_place(&p).unwrap();
        assert_eq!(result.id, stable_id("way", 42));
        assert_eq!(result.label, "Kibera, Nairobi, Kenya");
        assert_eq!(result.kind, SearchKind::Road);
        assert_eq!(result.lat, -1.2921);
        assert_eq!(result.lng, 36.8219);
        assert_eq!(result.bbox, Some([36.81, -1.30, 36.83, -1.28]));
    }

    #[test]
    fn maps_poi_and_place_kinds() {
        let poi = place(
            r#"{"place_id":2,"osm_type":"node","osm_id":7,"lat":"0","lon":"0","display_name":"Cafe","category":"amenity"}"#,
        );
        assert_eq!(kind_for(None, poi.category.as_deref()), SearchKind::Poi);

        let city = place(
            r#"{"place_id":3,"osm_type":"node","osm_id":1,"lat":"0","lon":"0","display_name":"Nairobi","category":"place"}"#,
        );
        assert_eq!(kind_for(None, city.category.as_deref()), SearchKind::Place);
    }

    #[test]
    fn rejects_invalid_coordinates() {
        let p = place(
            r#"{"place_id":4,"osm_type":"node","osm_id":9,"lat":"91","lon":"0","display_name":"Bad"}"#,
        );
        assert_eq!(normalize_place(&p).unwrap_err(), MapProviderError::Upstream);
    }

    #[test]
    fn maps_http_429_to_rate_limited() {
        assert_eq!(
            status_error(reqwest::StatusCode::TOO_MANY_REQUESTS),
            Some(MapProviderError::RateLimited)
        );
        assert_eq!(status_error(reqwest::StatusCode::OK), None);
    }
}
