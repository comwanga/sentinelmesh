use super::{
    provider::MapProvider,
    types::{RouteResult, SearchResult},
};
use async_trait::async_trait;
use serde::Deserialize;

pub struct MapboxAdapter {
    pub(super) client: reqwest::Client,
    pub(super) token: String,
}

impl MapboxAdapter {
    pub fn new(client: reqwest::Client, token: String) -> Self {
        Self { client, token }
    }
}

#[derive(Deserialize)]
struct GeocodeResponse {
    features: Vec<GeocodeFeature>,
}

#[derive(Deserialize)]
struct GeocodeFeature {
    place_name: String,
    center: [f64; 2],
}

#[derive(Deserialize)]
struct DirectionsResponse {
    routes: Vec<DirectionsRoute>,
}

#[derive(Deserialize)]
struct DirectionsRoute {
    geometry: DirectionsGeometry,
    distance: f64,
    duration: f64,
}

#[derive(Deserialize)]
struct DirectionsGeometry {
    coordinates: Vec<[f64; 2]>,
}

#[async_trait]
impl MapProvider for MapboxAdapter {
    async fn search(
        &self,
        query: &str,
        lat: Option<f64>,
        lng: Option<f64>,
        limit: u8,
    ) -> anyhow::Result<Vec<SearchResult>> {
        let encoded = urlencoding::encode(query);
        let prox = match (lat, lng) {
            (Some(la), Some(lo)) => format!("&proximity={lo},{la}"),
            _ => String::new(),
        };
        let url = format!(
            "https://api.mapbox.com/geocoding/v5/mapbox.places/{encoded}.json\
             ?access_token={}&types=address,place,poi&limit={limit}{prox}",
            self.token,
        );
        let res = self.client.get(&url).send().await?;
        if !res.status().is_success() {
            anyhow::bail!("geocoding upstream returned {}", res.status());
        }
        let data: GeocodeResponse = res.json().await?;
        Ok(data
            .features
            .into_iter()
            .map(|f| SearchResult {
                label: f.place_name,
                lat: f.center[1],
                lng: f.center[0],
            })
            .collect())
    }

    async fn route(
        &self,
        from_lng: f64,
        from_lat: f64,
        to_lng: f64,
        to_lat: f64,
    ) -> anyhow::Result<Option<RouteResult>> {
        let url = format!(
            "https://api.mapbox.com/directions/v5/mapbox/walking/{from_lng},{from_lat};{to_lng},{to_lat}\
             ?access_token={}&geometries=geojson&overview=full",
            self.token,
        );
        let res = self.client.get(&url).send().await?;
        if !res.status().is_success() {
            anyhow::bail!("directions upstream returned {}", res.status());
        }
        let data: DirectionsResponse = res.json().await?;
        Ok(data.routes.into_iter().next().map(|r| RouteResult {
            coordinates: r.geometry.coordinates,
            distance: r.distance,
            duration: r.duration,
        }))
    }

    async fn reverse(&self, lat: f64, lng: f64) -> anyhow::Result<Option<String>> {
        let url = format!(
            "https://api.mapbox.com/geocoding/v5/mapbox.places/{lng},{lat}.json\
             ?access_token={}&types=place,locality,neighborhood&limit=1",
            self.token,
        );
        let res = self.client.get(&url).send().await?;
        if !res.status().is_success() {
            anyhow::bail!("reverse geocoding upstream returned {}", res.status());
        }
        let data: GeocodeResponse = res.json().await?;
        Ok(data.features.into_iter().next().map(|f| f.place_name))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_adapter() -> MapboxAdapter {
        MapboxAdapter::new(reqwest::Client::new(), "test-token".into())
    }

    #[test]
    fn adapter_stores_token() {
        let a = make_adapter();
        assert_eq!(a.token, "test-token");
    }

    #[test]
    fn geocode_response_deserializes() {
        let json = r#"{"features":[{"place_name":"Nairobi","center":[36.82,-1.29]}]}"#;
        let r: GeocodeResponse = serde_json::from_str(json).unwrap();
        assert_eq!(r.features[0].place_name, "Nairobi");
        assert_eq!(r.features[0].center[0], 36.82);
    }

    #[test]
    fn directions_response_deserializes() {
        let json = r#"{"routes":[{"geometry":{"coordinates":[[36.82,-1.29],[36.83,-1.28]]},"distance":1500.0,"duration":900.0}]}"#;
        let r: DirectionsResponse = serde_json::from_str(json).unwrap();
        assert_eq!(r.routes[0].distance, 1500.0);
        assert_eq!(r.routes[0].geometry.coordinates[0], [36.82_f64, -1.29_f64]);
    }
}
