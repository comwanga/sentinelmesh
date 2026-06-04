use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::Json,
    routing::{get, post},
    Router,
};
use chrono::Utc;
use dashmap::DashMap;
use serde::Deserialize;
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use uuid::Uuid;

use crate::{
    error::AppError,
    reports::{
        consensus::compute_new_status,
        service::{
            apply_status_transition, cast_vote, create_report, list_reports, CastVoteInput,
            CreateReportInput, ListReportsParams,
        },
    },
    AppState,
};

// ---------------------------------------------------------------------------
// Rate limiter — in-memory sliding window using DashMap
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct RateLimiter(Arc<DashMap<String, (u32, Instant)>>, u32, Duration);

impl RateLimiter {
    fn new(max: u32, window: Duration) -> Self {
        Self(Arc::new(DashMap::new()), max, window)
    }

    fn check(&self, key: &str) -> bool {
        let now = Instant::now();
        let mut entry = self.0.entry(key.to_string()).or_insert((0, now));
        if now.duration_since(entry.1) >= self.2 {
            *entry = (1, now);
            return true;
        }
        if entry.0 < self.1 {
            entry.0 += 1;
            true
        } else {
            false
        }
    }
}

// Newtype wrappers so both can coexist in axum's Extension layer
#[derive(Clone)]
struct ReportRl(Arc<RateLimiter>);

#[derive(Clone)]
struct VoteRl(Arc<RateLimiter>);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_REPORT_TYPES: &[&str] = &[
    "ROAD_BLOCKED",
    "FLOODING",
    "SECURITY_INCIDENT",
    "FIRE",
    "PROTEST_MARCH",
    "ACCIDENT",
    "INFRASTRUCTURE",
    "ALL_CLEAR",
    "OTHER",
];

// ---------------------------------------------------------------------------
// Request body types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct CreateReportBody {
    report_type: String,
    description: Option<String>,
    lat: f64,
    lng: f64,
    place_name: Option<String>,
    nostr_pubkey: String,
    nostr_event: serde_json::Value,
    photo_ipfs_cid: Option<String>,
    linked_event_id: Option<Uuid>,
}

#[derive(Deserialize)]
struct CastVoteBody {
    voter_pubkey: String,
    vote: String,
    voter_nostr_event: serde_json::Value,
    voter_lat: Option<f64>,
    voter_lng: Option<f64>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn extract_ip(headers: &HeaderMap, trust_proxy: bool) -> String {
    if !trust_proxy {
        return "direct".to_string(); // disables IP-based RL when not behind a trusted proxy
    }
    headers
        .get("x-real-ip")
        .or_else(|| headers.get("x-forwarded-for"))
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or("").trim().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

/// Deserialise a raw JSON value as a nostr Event, verify pubkey and signature,
/// and reject events older than max_age_secs seconds.
fn verify_nostr_event(
    raw: &serde_json::Value,
    expected_pubkey: &str,
    max_age_secs: i64,
) -> Result<(), AppError> {
    let event: nostr_sdk::Event = serde_json::from_value(raw.clone())
        .map_err(|_| AppError::BadRequest("invalid nostr_event".into()))?;

    if event.pubkey.to_hex() != expected_pubkey {
        return Err(AppError::BadRequest("nostr_event pubkey mismatch".into()));
    }

    let age = Utc::now().timestamp() - event.created_at.as_u64() as i64;
    if age > max_age_secs || age < -10 {
        return Err(AppError::BadRequest("nostr_event is expired".into()));
    }

    event
        .verify()
        .map_err(|_| AppError::BadRequest("invalid nostr signature".into()))?;

    Ok(())
}

/// Canonical binding string for a report. Must byte-match the client's
/// `reportBindingContent` (fixed 6-decimal coords keep JS/Rust formatting equal).
fn report_binding_content(
    report_type: &str,
    lat: f64,
    lng: f64,
    description: Option<&str>,
) -> String {
    format!(
        "r1|{}|{:.6}|{:.6}|{}",
        report_type,
        lat,
        lng,
        description.unwrap_or("")
    )
}

/// Canonical binding string for a vote — binds the signature to this report + choice.
fn vote_binding_content(vote: &str, report_id: &Uuid) -> String {
    format!("v1|{}|{}", vote, report_id)
}

/// Per-event replay guard: SET NX with a TTL covering the freshness window.
/// Returns BadRequest on replay, Internal if Redis is unavailable (fail closed).
async fn replay_guard(
    redis: &redis::aio::ConnectionManager,
    event_id: &str,
) -> Result<(), AppError> {
    if event_id.is_empty() {
        return Err(AppError::BadRequest("nostr_event missing id".into()));
    }
    let key = format!("report:v1:jti:{event_id}");
    let mut conn = redis.clone();
    let set: Option<String> = redis::cmd("SET")
        .arg(&key)
        .arg(1)
        .arg("NX")
        .arg("EX")
        .arg(600)
        .query_async(&mut conn)
        .await
        .map_err(|e| AppError::Internal(e.into()))?;
    if set.is_none() {
        return Err(AppError::BadRequest(
            "duplicate submission (replay detected)".into(),
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// POST /api/reports
async fn post_report(
    State(state): State<AppState>,
    axum::Extension(ReportRl(rl)): axum::Extension<ReportRl>,
    headers: HeaderMap,
    Json(body): Json<CreateReportBody>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let ip = extract_ip(&headers, state.config.trust_proxy);
    let pk_key = format!("report:{}", body.nostr_pubkey);
    // Allow the request if either the per-pubkey OR the per-IP bucket still has
    // capacity.  Both buckets are debited on entry so we consume from pk first.
    if !rl.check(&pk_key) && !rl.check(&format!("ip:{ip}")) {
        return Err(AppError::RateLimited);
    }

    if !VALID_REPORT_TYPES.contains(&body.report_type.as_str()) {
        return Err(AppError::BadRequest(format!(
            "invalid report_type: {}",
            body.report_type
        )));
    }

    verify_nostr_event(&body.nostr_event, &body.nostr_pubkey, 300)?;

    if !(-90.0..=90.0).contains(&body.lat) || !(-180.0..=180.0).contains(&body.lng) {
        return Err(AppError::BadRequest(
            "lat must be in -90..90, lng in -180..180".into(),
        ));
    }

    // Bind the signature to the report content: the signed event's content must
    // equal the canonical binding recomputed from the submitted fields. Without
    // this, a valid signature proves only key possession, not what was reported.
    let expected = report_binding_content(
        &body.report_type,
        body.lat,
        body.lng,
        body.description.as_deref(),
    );
    if body.nostr_event["content"].as_str() != Some(expected.as_str()) {
        return Err(AppError::BadRequest(
            "nostr_event content is not bound to the report fields".into(),
        ));
    }

    let event_id = body.nostr_event["id"].as_str().unwrap_or("").to_string();
    replay_guard(&state.redis, &event_id).await?;

    let sig = body.nostr_event["sig"].as_str().unwrap_or("").to_string();

    let report = create_report(
        &state.db,
        CreateReportInput {
            report_type: body.report_type,
            description: body.description,
            lat: body.lat,
            lng: body.lng,
            place_name: body.place_name,
            nostr_pubkey: body.nostr_pubkey,
            nostr_signature: sig,
            nostr_event_id: event_id,
            photo_ipfs_cid: body.photo_ipfs_cid,
            linked_event_id: body.linked_event_id,
        },
    )
    .await?;

    let msg = serde_json::json!({ "type": "NEW_REPORT", "payload": report });
    state
        .hub
        .broadcast(None, serde_json::to_string(&msg).unwrap().into());

    Ok((
        StatusCode::CREATED,
        Json(serde_json::to_value(&report).unwrap()),
    ))
}

/// POST /api/reports/:id/vote
async fn vote(
    State(state): State<AppState>,
    axum::Extension(VoteRl(rl)): axum::Extension<VoteRl>,
    headers: HeaderMap,
    Path(report_id): Path<Uuid>,
    Json(body): Json<CastVoteBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let ip = extract_ip(&headers, state.config.trust_proxy);
    let pk_key = format!("vote:{}", body.voter_pubkey);
    if !rl.check(&pk_key) && !rl.check(&format!("ip:{ip}")) {
        return Err(AppError::RateLimited);
    }

    verify_nostr_event(&body.voter_nostr_event, &body.voter_pubkey, 300)?;

    // Bind the vote signature to this report + choice, then guard against replay
    // (closes cross-report replay of a captured signed vote event).
    let expected = vote_binding_content(&body.vote, &report_id);
    if body.voter_nostr_event["content"].as_str() != Some(expected.as_str()) {
        return Err(AppError::BadRequest(
            "voter_nostr_event content is not bound to this vote".into(),
        ));
    }
    let vote_event_id = body.voter_nostr_event["id"]
        .as_str()
        .unwrap_or("")
        .to_string();
    replay_guard(&state.redis, &vote_event_id).await?;

    // C-2: the report author lives in report_authors, readable only via the
    // reputation pool. Resolve it once: it gates self-votes and credits accuracy.
    let author = crate::reports::service::report_author(&state.reputation_db, report_id)
        .await
        .map_err(AppError::Internal)?
        .ok_or(AppError::NotFound)?;
    if author == body.voter_pubkey {
        return Err(AppError::BadRequest("cannot vote on your own report".into()));
    }

    let (updated, old_score, established_confirmations) = cast_vote(
        &state.db,
        report_id,
        CastVoteInput {
            voter_pubkey: body.voter_pubkey,
            vote: body.vote,
            voter_lat: body.voter_lat,
            voter_lng: body.voter_lng,
        },
    )
    .await
    .map_err(|e| {
        let msg = e.to_string();
        if msg.contains("unique") || msg.contains("duplicate") {
            AppError::BadRequest("already voted on this report".into())
        } else if msg.contains("not found") {
            AppError::NotFound
        } else {
            AppError::Internal(e)
        }
    })?;

    if let Some(new_status) = compute_new_status(
        &updated.status,
        updated.consensus_score,
        updated.confirmation_count,
        updated.denial_count,
        established_confirmations,
        state.config.consensus_require_established,
    ) {
        apply_status_transition(&state.db, report_id, &new_status, &author).await?;

        // Once the score crosses 3 for the first time, queue a publish job and
        // nudge the blockchain service so it picks it up quickly.
        //
        // Gated behind ANCHORING_ENABLED (default false): a raw vote count of 3 is
        // reachable by 3 Sybil keys, so auto-anchoring on it lets attackers drain the
        // hot wallet via on-chain fees. Off by default until anchoring is decoupled
        // from raw consensus and a spend cap exists (audit H-8 / C-1).
        let anchoring_enabled = std::env::var("ANCHORING_ENABLED")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);
        if anchoring_enabled && updated.consensus_score >= 3 && old_score < 3 {
            let _ = sqlx::query(
                "INSERT INTO publish_jobs (source_type, source_id, status, next_retry_at)
                 VALUES ('COMMUNITY_REPORT', $1, 'PENDING', NOW())
                 ON CONFLICT DO NOTHING",
            )
            .bind(report_id)
            .execute(&state.db)
            .await;

            if let Some(url) = state.config.blockchain_service_url.clone() {
                crate::nudge::nudge_blockchain(state.http_client.clone(), url);
            }
        }
    }

    let msg = serde_json::json!({ "type": "REPORT_UPDATED", "payload": updated });
    state
        .hub
        .broadcast(None, serde_json::to_string(&msg).unwrap().into());

    Ok(Json(serde_json::to_value(&updated).unwrap()))
}

/// GET /api/reports
async fn list(
    State(state): State<AppState>,
    Query(params): Query<ListReportsParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    let reports = list_reports(&state.db, params).await?;
    let total = reports.len() as i64;
    Ok(Json(
        serde_json::json!({ "reports": reports, "total": total }),
    ))
}

/// GET /api/reports/by-event/:event_id
async fn by_event(
    State(state): State<AppState>,
    Path(event_id): Path<Uuid>,
    Query(q): Query<ListReportsParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    let params = ListReportsParams {
        linked_event_id: Some(event_id),
        ..q
    };
    let reports = list_reports(&state.db, params).await?;
    let total = reports.len() as i64;
    Ok(Json(
        serde_json::json!({ "reports": reports, "total": total }),
    ))
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> Router<AppState> {
    let report_rl = ReportRl(Arc::new(RateLimiter::new(10, Duration::from_secs(3600))));
    let vote_rl = VoteRl(Arc::new(RateLimiter::new(30, Duration::from_secs(60))));

    Router::new()
        .route("/", post(post_report).get(list))
        .route("/:id/vote", post(vote))
        .route("/by-event/:event_id", get(by_event))
        .layer(axum::Extension(report_rl))
        .layer(axum::Extension(vote_rl))
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_limiter_allows_up_to_max() {
        let rl = RateLimiter::new(3, Duration::from_secs(60));
        assert!(rl.check("key1"));
        assert!(rl.check("key1"));
        assert!(rl.check("key1"));
        assert!(!rl.check("key1"));
    }

    #[test]
    fn rate_limiter_resets_after_window() {
        let rl = RateLimiter::new(1, Duration::from_millis(1));
        assert!(rl.check("key2"));
        assert!(!rl.check("key2"));
        std::thread::sleep(Duration::from_millis(5));
        assert!(rl.check("key2"));
    }

    // These must byte-match the PWA's reportBindingContent / voteBindingContent.
    #[test]
    fn report_binding_format_with_description() {
        assert_eq!(
            report_binding_content("FIRE", -1.2921, 36.8219, Some("smoke")),
            "r1|FIRE|-1.292100|36.821900|smoke"
        );
    }

    #[test]
    fn report_binding_format_no_description_and_zero_coords() {
        assert_eq!(
            report_binding_content("FLOODING", 0.0, 0.0, None),
            "r1|FLOODING|0.000000|0.000000|"
        );
    }

    #[test]
    fn vote_binding_format() {
        let id = Uuid::nil();
        assert_eq!(
            vote_binding_content("CONFIRM", &id),
            format!("v1|CONFIRM|{}", id)
        );
    }
}
