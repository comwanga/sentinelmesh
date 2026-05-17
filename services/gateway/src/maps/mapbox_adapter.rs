use async_trait::async_trait;
use super::{provider::MapProvider, types::{RouteResult, SearchResult}};

pub struct MapboxAdapter {
    pub(super) client: reqwest::Client,
    pub(super) token: String,
}

impl MapboxAdapter {
    pub fn new(client: reqwest::Client, token: String) -> Self {
        Self { client, token }
    }
}

#[async_trait]
impl MapProvider for MapboxAdapter {
    async fn search(&self, _query: &str, _lat: Option<f64>, _lng: Option<f64>, _limit: u8) -> anyhow::Result<Vec<SearchResult>> {
        Ok(vec![])
    }
    async fn route(&self, _from_lng: f64, _from_lat: f64, _to_lng: f64, _to_lat: f64) -> anyhow::Result<Option<RouteResult>> {
        Ok(None)
    }
    async fn reverse(&self, _lat: f64, _lng: f64) -> anyhow::Result<Option<String>> {
        Ok(None)
    }
}
