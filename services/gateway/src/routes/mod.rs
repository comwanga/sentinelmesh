pub mod circles;
pub mod events;
pub mod location_blobs;
pub mod reports;
pub mod tiles;
pub mod zap;

use axum::Router;
use crate::AppState;

pub fn build_router() -> Router<AppState> {
    Router::new()
        .nest("/api/events",  events::router())
        .nest("/api/reports", reports::router())
        .nest("/api/circles", circles::router().merge(location_blobs::router()))
        .nest("/api/zaps",    zap::router())
        .nest("/api/tiles",   tiles::router())
}
