pub mod acoustic;
pub mod circles;
pub mod events;
pub mod location_blobs;
pub mod maps;
pub mod photos;
pub mod push;
pub mod reports;
pub mod tiles;

use crate::AppState;
use axum::Router;

pub fn build_router() -> Router<AppState> {
    Router::new()
        .nest("/api/events", events::router())
        .nest("/api/reports", reports::router())
        .nest(
            "/api/circles",
            circles::router().merge(location_blobs::router()),
        )
        .nest("/api/tiles", tiles::router())
        .nest("/api/push", push::router())
        .nest("/api/photos", photos::router())
        .nest("/api/maps", maps::router())
        .nest("/api/acoustic", acoustic::router())
}
