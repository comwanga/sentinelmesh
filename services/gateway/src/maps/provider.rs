use super::types::{RouteResult, SearchResult};
use async_trait::async_trait;

#[async_trait]
pub trait MapProvider: Send + Sync {
    async fn search(
        &self,
        query: &str,
        lat: Option<f64>,
        lng: Option<f64>,
        limit: u8,
    ) -> anyhow::Result<Vec<SearchResult>>;

    async fn route(
        &self,
        from_lng: f64,
        from_lat: f64,
        to_lng: f64,
        to_lat: f64,
    ) -> anyhow::Result<Option<RouteResult>>;

    async fn reverse(&self, lat: f64, lng: f64) -> anyhow::Result<Option<String>>;
}
