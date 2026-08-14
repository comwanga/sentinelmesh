use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};

#[derive(thiserror::Error, Debug)]
pub enum AppError {
    #[error("not found")]
    NotFound,
    #[error("{0}")]
    BadRequest(String),
    // Kept for future authed endpoints; its only constructor (the zap webhook) was
    // removed with the Lightning subsystem.
    #[allow(dead_code)]
    #[error("unauthorized")]
    Unauthorized,
    #[error("forbidden")]
    Forbidden,
    #[error("rate limited")]
    RateLimited,
    #[error("safe circle location is unavailable")]
    Unavailable,
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    Unprocessable(String),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, retryable) = match &self {
            AppError::NotFound => (StatusCode::NOT_FOUND, "NOT_FOUND", false),
            AppError::BadRequest(_) => (StatusCode::BAD_REQUEST, "BAD_REQUEST", false),
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "UNAUTHORIZED", false),
            AppError::Forbidden => (StatusCode::FORBIDDEN, "FORBIDDEN", false),
            AppError::RateLimited => (StatusCode::TOO_MANY_REQUESTS, "RATE_LIMITED", true),
            AppError::Unavailable => (StatusCode::SERVICE_UNAVAILABLE, "SERVICE_UNAVAILABLE", true),
            AppError::Conflict(_) => (StatusCode::CONFLICT, "CONFLICT", false),
            AppError::Unprocessable(_) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "VERIFICATION_FAILED",
                false,
            ),
            AppError::Internal(e) => {
                tracing::error!("internal error: {e:#}");
                (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true)
            }
        };
        let body = serde_json::json!({ "code": code, "message": self.to_string(), "retryable": retryable });
        (status, Json(body)).into_response()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        AppError::Internal(e.into())
    }
}
