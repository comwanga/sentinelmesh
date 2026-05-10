use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Report {
    pub id: Uuid,
    pub report_type: String,
    pub description: Option<String>,
    pub lat: f64,
    pub lng: f64,
    pub place_name: Option<String>,
    pub nostr_pubkey: String,
    pub nostr_signature: String,
    pub nostr_event_id: String,
    pub reporter_tier: String,
    pub consensus_score: i32,
    pub confirmation_count: i32,
    pub denial_count: i32,
    pub status: String,
    pub photo_ipfs_cid: Option<String>,
    pub linked_event_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub struct CreateReportInput {
    pub report_type: String,
    pub description: Option<String>,
    pub lat: f64,
    pub lng: f64,
    pub place_name: Option<String>,
    pub nostr_pubkey: String,
    pub nostr_signature: String,
    pub nostr_event_id: String,
    pub photo_ipfs_cid: Option<String>,
    pub linked_event_id: Option<Uuid>,
}

pub struct CastVoteInput {
    pub voter_pubkey: String,
    pub vote: String,
    pub voter_lat: Option<f64>,
    pub voter_lng: Option<f64>,
}

#[derive(Deserialize)]
pub struct ListReportsParams {
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub radius_km: Option<f64>,
    pub status: Option<String>,
    pub reporter_tier: Option<String>,
    pub linked_event_id: Option<Uuid>,
    pub limit: Option<i64>,
}

fn tier_score(tier: &str) -> i32 {
    match tier {
        "TRUSTED"  => 2,
        "VETERAN"  => 3,
        "SENTINEL" => 4,
        _          => 1,
    }
}

fn compute_tier(score: i64) -> &'static str {
    if score >= 50      { "SENTINEL" }
    else if score >= 20 { "VETERAN" }
    else if score >= 5  { "TRUSTED" }
    else                { "NEWCOMER" }
}

pub async fn create_report(pool: &PgPool, input: CreateReportInput) -> Result<Report> {
    let mut tx = pool.begin().await?;

    sqlx::query(
        "INSERT INTO users (nostr_pubkey, total_reports, last_active, reputation_score, reputation_tier, accurate_reports)
         VALUES ($1, 1, NOW(), 0, 'NEWCOMER', 0)
         ON CONFLICT (nostr_pubkey) DO UPDATE
           SET total_reports = users.total_reports + 1, last_active = NOW()"
    )
    .bind(&input.nostr_pubkey)
    .execute(&mut *tx)
    .await?;

    let tier: String = sqlx::query_scalar(
        "SELECT reputation_tier FROM users WHERE nostr_pubkey = $1"
    )
    .bind(&input.nostr_pubkey)
    .fetch_one(&mut *tx)
    .await?;

    let initial_score = tier_score(&tier);

    let report = sqlx::query_as::<_, Report>(
        "INSERT INTO community_reports
           (report_type, description, lat, lng, place_name, nostr_pubkey, nostr_signature,
            nostr_event_id, reporter_tier, consensus_score, confirmation_count, denial_count,
            status, photo_ipfs_cid, linked_event_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,0,'PENDING',$11,$12)
         RETURNING *"
    )
    .bind(&input.report_type)
    .bind(&input.description)
    .bind(input.lat)
    .bind(input.lng)
    .bind(&input.place_name)
    .bind(&input.nostr_pubkey)
    .bind(&input.nostr_signature)
    .bind(&input.nostr_event_id)
    .bind(&tier)
    .bind(initial_score)
    .bind(&input.photo_ipfs_cid)
    .bind(input.linked_event_id)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(report)
}

/// Returns (updated_report, old_score) so callers can detect threshold crossings.
pub async fn cast_vote(
    pool: &PgPool,
    report_id: Uuid,
    input: CastVoteInput,
) -> Result<(Report, i32)> {
    let mut tx = pool.begin().await?;

    let report = sqlx::query_as::<_, Report>(
        "SELECT * FROM community_reports WHERE id = $1 FOR UPDATE"
    )
    .bind(report_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| anyhow::anyhow!("report not found"))?;

    if report.nostr_pubkey == input.voter_pubkey {
        anyhow::bail!("cannot vote on your own report");
    }

    let old_score = report.consensus_score;

    let nearby = match (input.voter_lat, input.voter_lng) {
        (Some(vlat), Some(vlng)) => {
            let dist: f64 = sqlx::query_scalar(
                "SELECT earth_distance(ll_to_earth($1,$2), ll_to_earth($3,$4))"
            )
            .bind(vlat).bind(vlng).bind(report.lat).bind(report.lng)
            .fetch_one(&mut *tx)
            .await?;
            dist <= 1000.0
        }
        _ => false,
    };

    let (score_delta, conf_delta, deny_delta) = match (input.vote.as_str(), nearby) {
        ("CONFIRM", true)  => (2i32, 1i32, 0i32),
        ("CONFIRM", false) => (1,     1,    0),
        ("DENY",    true)  => (-3,    0,    1),
        ("DENY",    false) => (-2,    0,    1),
        _ => anyhow::bail!("vote must be CONFIRM or DENY"),
    };

    sqlx::query(
        "INSERT INTO report_votes (report_id, voter_pubkey, vote, voter_lat, voter_lng)
         VALUES ($1, $2, $3, $4, $5)"
    )
    .bind(report_id).bind(&input.voter_pubkey).bind(&input.vote)
    .bind(input.voter_lat).bind(input.voter_lng)
    .execute(&mut *tx)
    .await?;

    let updated = sqlx::query_as::<_, Report>(
        "UPDATE community_reports
         SET consensus_score    = consensus_score + $2,
             confirmation_count = confirmation_count + $3,
             denial_count       = denial_count + $4,
             updated_at         = NOW()
         WHERE id = $1
         RETURNING *"
    )
    .bind(report_id).bind(score_delta).bind(conf_delta).bind(deny_delta)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok((updated, old_score))
}

pub async fn apply_status_transition(
    pool: &PgPool,
    report_id: Uuid,
    new_status: &str,
    reporter_pubkey: &str,
) -> Result<()> {
    let mut tx = pool.begin().await?;

    sqlx::query(
        "UPDATE community_reports SET status = $2, updated_at = NOW() WHERE id = $1"
    )
    .bind(report_id).bind(new_status)
    .execute(&mut *tx).await?;

    if new_status == "VERIFIED" {
        let new_score: i64 = sqlx::query_scalar(
            "UPDATE users
             SET accurate_reports = accurate_reports + 1,
                 reputation_score = reputation_score + 10
             WHERE nostr_pubkey = $1
             RETURNING reputation_score"
        )
        .bind(reporter_pubkey)
        .fetch_one(&mut *tx)
        .await?;

        let new_tier = compute_tier(new_score);
        sqlx::query(
            "UPDATE users SET reputation_tier = $2 WHERE nostr_pubkey = $1"
        )
        .bind(reporter_pubkey).bind(new_tier)
        .execute(&mut *tx).await?;
    }

    tx.commit().await?;
    Ok(())
}

pub async fn list_reports(pool: &PgPool, params: ListReportsParams) -> Result<Vec<Report>> {
    let limit = params.limit.unwrap_or(50).min(200);
    let radius_m = params.radius_km.unwrap_or(10.0) * 1000.0;

    let reports = sqlx::query_as::<_, Report>(
        "SELECT * FROM community_reports
         WHERE ($1::float8 IS NULL OR
                earth_distance(ll_to_earth($1,$2), ll_to_earth(lat,lng)) <= $3)
           AND ($4::text IS NULL OR status = $4)
           AND ($5::text IS NULL OR reporter_tier = $5)
           AND ($6::uuid IS NULL OR linked_event_id = $6)
         ORDER BY created_at DESC
         LIMIT $7"
    )
    .bind(params.lat)
    .bind(params.lng)
    .bind(radius_m)
    .bind(params.status)
    .bind(params.reporter_tier)
    .bind(params.linked_event_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    Ok(reports)
}
