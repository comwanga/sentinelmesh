use super::types::{ReverseRequest, RouteRequest, RouteResult, SearchRequest, SearchResult};
use async_trait::async_trait;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum MapProviderError {
    #[error("map provider is unavailable")]
    Unavailable,
    #[error("map provider request timed out")]
    Timeout,
    #[error("map provider rate limit exceeded")]
    RateLimited,
    #[error("no route found")]
    NoRoute,
    #[error("map provider request failed")]
    Upstream,
}

#[async_trait]
pub trait MapProvider: Send + Sync {
    async fn search(&self, request: SearchRequest) -> Result<Vec<SearchResult>, MapProviderError>;
    async fn route(&self, request: RouteRequest) -> Result<Vec<RouteResult>, MapProviderError>;
    async fn reverse(
        &self,
        request: ReverseRequest,
    ) -> Result<Option<SearchResult>, MapProviderError>;
}
