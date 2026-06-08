use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use serde::Deserialize;

use crate::{
    error::AppError, middleware::internal_auth::InternalServiceAuth,
    trust::accountability::quality_components, AppState,
};

/// GET /api/admin/observatory/summary — latest snapshot + static config context.
async fn summary(
    _auth: InternalServiceAuth,
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let latest: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT metrics FROM trust_metrics_snapshots ORDER BY captured_at DESC LIMIT 1",
    )
    .fetch_optional(&state.db)
    .await
    .map_err(|e| AppError::Internal(e.into()))?;
    Ok(Json(serde_json::json!({
        "genesis_root_count": state.config.vouch_genesis_roots.len(),
        "decay_enabled": state.config.reputation_decay_enabled,
        "metrics": latest,
        "clusters": serde_json::Value::Null,
    })))
}

#[derive(Deserialize)]
struct TrendQuery {
    window_days: Option<i64>,
}

/// GET /api/admin/observatory/trends?window_days=30 — snapshot time series.
async fn trends(
    _auth: InternalServiceAuth,
    State(state): State<AppState>,
    Query(q): Query<TrendQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let window = q.window_days.unwrap_or(30).clamp(1, 365);
    let rows: Vec<(chrono::DateTime<chrono::Utc>, serde_json::Value)> = sqlx::query_as(
        "SELECT captured_at, metrics FROM trust_metrics_snapshots
         WHERE captured_at > now() - ($1 || ' days')::interval
         ORDER BY captured_at ASC",
    )
    .bind(window.to_string())
    .fetch_all(&state.db)
    .await
    .map_err(|e| AppError::Internal(e.into()))?;
    let series: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|(t, m)| serde_json::json!({ "captured_at": t, "metrics": m }))
        .collect();
    Ok(Json(
        serde_json::json!({ "window_days": window, "series": series }),
    ))
}

/// GET /api/admin/observatory/vouchers — per-voucher review list with quality.
async fn vouchers(
    _auth: InternalServiceAuth,
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let rows: Vec<(String, i64, i64, i64, bool, Option<i32>)> = sqlx::query_as(
        // Dedupe (voucher, vouchee) pairs FIRST: vouches is append-only, so a
        // revoke-then-re-vouch leaves duplicate rows for the same vouchee. Summing
        // the join directly would double-count that vouchee's accurate/rejected
        // reports. The DISTINCT inner query collapses each pair to one row.
        "SELECT v.voucher_pubkey,
                COUNT(DISTINCT v.vouchee_pubkey)                AS vouchee_count,
                COALESCE(SUM(u.accurate_reports), 0)            AS accurate,
                COALESCE(SUM(u.rejected_reports), 0)            AS rejected,
                COALESCE(BOOL_OR(vu.vouching_suspended), false) AS suspended,
                MAX(vu.vouch_budget_override)                   AS budget_override
           FROM (SELECT DISTINCT voucher_pubkey, vouchee_pubkey FROM vouches) v
           LEFT JOIN users u  ON u.nostr_pubkey  = v.vouchee_pubkey
           LEFT JOIN users vu ON vu.nostr_pubkey = v.voucher_pubkey
          GROUP BY v.voucher_pubkey
          ORDER BY rejected DESC, vouchee_count DESC
          LIMIT 500",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| AppError::Internal(e.into()))?;
    let min_sample = state.config.quality_min_sample;
    let list: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|(pk, n, acc, rej, suspended, override_b)| {
            let q = quality_components(n, acc, rej, min_sample);
            serde_json::json!({
                "voucher_pubkey": pk,
                "vouchee_count": q.vouchee_count,
                "accurate_count": q.accurate_count,
                "rejected_count": q.rejected_count,
                "quality_ratio": q.quality_ratio,
                "low_confidence": q.low_confidence,
                "vouching_suspended": suspended,
                "vouch_budget_override": override_b,
            })
        })
        .collect();
    Ok(Json(serde_json::json!({ "vouchers": list })))
}

#[derive(Deserialize)]
struct BudgetBody {
    budget: Option<i32>,
}

async fn suspend(
    _auth: InternalServiceAuth,
    State(state): State<AppState>,
    Path(pubkey): Path<String>,
) -> Result<StatusCode, AppError> {
    set_suspended(&state, &pubkey, true).await
}

async fn unsuspend(
    _auth: InternalServiceAuth,
    State(state): State<AppState>,
    Path(pubkey): Path<String>,
) -> Result<StatusCode, AppError> {
    set_suspended(&state, &pubkey, false).await
}

async fn set_suspended(state: &AppState, pubkey: &str, val: bool) -> Result<StatusCode, AppError> {
    let n = sqlx::query("UPDATE users SET vouching_suspended = $2 WHERE nostr_pubkey = $1")
        .bind(pubkey)
        .bind(val)
        .execute(&state.db)
        .await
        .map_err(|e| AppError::Internal(e.into()))?;
    if n.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn set_budget(
    _auth: InternalServiceAuth,
    State(state): State<AppState>,
    Path(pubkey): Path<String>,
    Json(body): Json<BudgetBody>,
) -> Result<StatusCode, AppError> {
    if let Some(b) = body.budget {
        if b < 0 {
            return Err(AppError::BadRequest("budget must be >= 0".into()));
        }
    }
    let n = sqlx::query("UPDATE users SET vouch_budget_override = $2 WHERE nostr_pubkey = $1")
        .bind(pubkey)
        .bind(body.budget)
        .execute(&state.db)
        .await
        .map_err(|e| AppError::Internal(e.into()))?;
    if n.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/summary", get(summary))
        .route("/trends", get(trends))
        .route("/vouchers", get(vouchers))
        .route("/vouchers/:pubkey/suspend", post(suspend))
        .route("/vouchers/:pubkey/unsuspend", post(unsuspend))
        .route("/vouchers/:pubkey/budget", post(set_budget))
}
