use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::Json,
    routing::post,
    Router,
};
use serde::Deserialize;
use std::{sync::Arc, time::Duration};

use crate::{
    error::AppError,
    routes::reports::{extract_ip, replay_guard, verify_nostr_event, RateLimiter},
    trust::personhood,
    AppState,
};

#[derive(Clone)]
struct VouchRl(Arc<RateLimiter>);

#[derive(Deserialize)]
struct IssueVouchBody {
    voucher_pubkey: String,
    vouchee_pubkey: String,
    nostr_event: serde_json::Value,
}

#[derive(Deserialize)]
struct RevokeVouchBody {
    voucher_pubkey: String,
    nostr_event: serde_json::Value,
}

/// Canonical binding for a vouch. The signed event's content must byte-equal
/// this; domain-separated so a signature from another context can't be replayed
/// as a vouch. MUST match the PWA `vouchBindingContent`.
pub fn vouch_binding_content(vouchee_pubkey: &str) -> String {
    format!("sentinelmesh:vouch:v1:{vouchee_pubkey}")
}

/// Canonical binding for a vouch revocation. MUST match `vouchRevokeBindingContent`.
pub fn vouch_revoke_binding_content(vouchee_pubkey: &str) -> String {
    format!("sentinelmesh:vouch-revoke:v1:{vouchee_pubkey}")
}

/// POST /api/vouches
async fn post_vouch(
    State(state): State<AppState>,
    axum::Extension(VouchRl(rl)): axum::Extension<VouchRl>,
    headers: HeaderMap,
    Json(body): Json<IssueVouchBody>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let ip = extract_ip(&headers, state.config.trust_proxy);
    if !rl.check(&format!("vouch:{}", body.voucher_pubkey)) && !rl.check(&format!("ip:{ip}")) {
        return Err(AppError::RateLimited);
    }
    if body.voucher_pubkey == body.vouchee_pubkey {
        return Err(AppError::BadRequest("cannot vouch for yourself".into()));
    }
    if !is_hex64(&body.vouchee_pubkey) {
        return Err(AppError::BadRequest(
            "vouchee_pubkey must be a 64-char hex Nostr pubkey".into(),
        ));
    }

    verify_nostr_event(&body.nostr_event, &body.voucher_pubkey, 300)?;
    let expected = vouch_binding_content(&body.vouchee_pubkey);
    if body.nostr_event["content"].as_str() != Some(expected.as_str()) {
        return Err(AppError::BadRequest(
            "nostr_event content is not bound to this vouch".into(),
        ));
    }
    let event_id = body.nostr_event["id"].as_str().unwrap_or("").to_string();
    replay_guard(&state.redis, &event_id).await?;

    let roots = &state.config.vouch_genesis_roots;
    let is_root = personhood::is_root(roots, &body.voucher_pubkey);
    let tier_est = personhood::tier_is_established(
        &personhood::reputation_tier(&state.db, &body.voucher_pubkey)
            .await
            .map_err(|e| AppError::Internal(e.into()))?,
    );
    if !personhood::eligible_from(is_root, tier_est) {
        return Err(AppError::Forbidden);
    }
    let basis = if is_root { "ROOT" } else { "EARNED" };

    // Advisory accountability (C-1b-1): operators can suspend a voucher or set a
    // per-voucher budget override. Genesis roots are never auto-acted-on, but an
    // operator may still set these fields manually.
    let (suspended, override_budget): (bool, Option<i32>) = sqlx::query_as(
        "SELECT vouching_suspended, vouch_budget_override FROM users WHERE nostr_pubkey = $1",
    )
    .bind(&body.voucher_pubkey)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| AppError::Internal(e.into()))?
    .unwrap_or((false, None));
    if suspended {
        return Err(AppError::Forbidden);
    }
    let effective_budget = override_budget
        .map(|b| b as i64)
        .unwrap_or(state.config.vouch_budget as i64);

    // Atomic budget-check + insert (serialized per voucher) — no TOCTOU overrun.
    match crate::vouches::issue_vouch(
        &state.db,
        &body.voucher_pubkey,
        &body.vouchee_pubkey,
        basis,
        &event_id,
        effective_budget,
    )
    .await
    .map_err(AppError::Internal)?
    {
        crate::vouches::IssueOutcome::Inserted => Ok((
            StatusCode::CREATED,
            Json(
                serde_json::json!({ "vouchee_pubkey": body.vouchee_pubkey, "issuance_basis": basis }),
            ),
        )),
        crate::vouches::IssueOutcome::BudgetExhausted => {
            Err(AppError::Conflict("vouch budget exhausted".into()))
        }
        crate::vouches::IssueOutcome::Duplicate => {
            Err(AppError::Conflict("already vouching for this key".into()))
        }
    }
}

/// A 64-char lowercase/uppercase hex Nostr pubkey.
fn is_hex64(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// DELETE /api/vouches/:vouchee
async fn delete_vouch(
    State(state): State<AppState>,
    axum::Extension(VouchRl(rl)): axum::Extension<VouchRl>,
    headers: HeaderMap,
    Path(vouchee): Path<String>,
    Json(body): Json<RevokeVouchBody>,
) -> Result<StatusCode, AppError> {
    let ip = extract_ip(&headers, state.config.trust_proxy);
    if !rl.check(&format!("vouch:{}", body.voucher_pubkey)) && !rl.check(&format!("ip:{ip}")) {
        return Err(AppError::RateLimited);
    }
    verify_nostr_event(&body.nostr_event, &body.voucher_pubkey, 300)?;
    let expected = vouch_revoke_binding_content(&vouchee);
    if body.nostr_event["content"].as_str() != Some(expected.as_str()) {
        return Err(AppError::BadRequest(
            "nostr_event content is not bound to this revocation".into(),
        ));
    }
    let event_id = body.nostr_event["id"].as_str().unwrap_or("").to_string();
    replay_guard(&state.redis, &event_id).await?;

    let revoked = crate::vouches::revoke_vouch(&state.db, &body.voucher_pubkey, &vouchee)
        .await
        .map_err(AppError::Internal)?;
    if !revoked {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

pub fn router() -> Router<AppState> {
    let vouch_rl = VouchRl(Arc::new(RateLimiter::new(20, Duration::from_secs(3600))));
    Router::new()
        .route("/", post(post_vouch))
        .route("/:vouchee", axum::routing::delete(delete_vouch))
        .layer(axum::Extension(vouch_rl))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn vouch_binding_is_domain_separated() {
        assert_eq!(vouch_binding_content("abc"), "sentinelmesh:vouch:v1:abc");
    }
    #[test]
    fn vouch_revoke_binding_is_domain_separated() {
        assert_eq!(
            vouch_revoke_binding_content("abc"),
            "sentinelmesh:vouch-revoke:v1:abc"
        );
    }
}
