use std::{collections::HashMap, net::IpAddr, num::NonZeroU32, sync::Arc, time::Duration};

use axum::{
    body::Bytes, extract::State, http::StatusCode, response::Json, routing::get, Extension, Router,
};
use chrono::{DateTime, Utc};
use governor::{DefaultKeyedRateLimiter, Quota, RateLimiter};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{error::AppError, middleware::nostr_auth::NostrAuth, AppState};

const MAX_IDENTIFIER_LEN: usize = 255;
const MAX_RESPONSE_BYTES: usize = 64 * 1024;
const VERIFICATION_TTL_HOURS: i64 = 24;

type Nip05Limiter = Arc<DefaultKeyedRateLimiter<String>>;

#[derive(Debug, Deserialize)]
struct SetIdentityBody {
    identifier: String,
}

#[derive(Debug, Deserialize)]
struct Nip05Document {
    names: HashMap<String, String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct StoredIdentity {
    identifier: String,
    verified_at: DateTime<Utc>,
    valid_until: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
struct IdentityResponse {
    nip05: Option<Nip05Status>,
}

#[derive(Debug, Serialize)]
struct Nip05Status {
    identifier: String,
    verified: bool,
    verified_at: DateTime<Utc>,
    valid_until: DateTime<Utc>,
}

impl From<StoredIdentity> for Nip05Status {
    fn from(value: StoredIdentity) -> Self {
        Self {
            verified: value.valid_until > Utc::now(),
            identifier: value.identifier,
            verified_at: value.verified_at,
            valid_until: value.valid_until,
        }
    }
}

fn verify_payload_binding(payload: Option<&str>, body: &[u8]) -> Result<(), AppError> {
    let expected = hex::encode(Sha256::digest(body));
    match payload {
        Some(value) if value.eq_ignore_ascii_case(&expected) => Ok(()),
        Some(_) => Err(AppError::BadRequest(
            "signed payload hash does not match request body".into(),
        )),
        None => Err(AppError::BadRequest(
            "missing NIP-98 payload binding".into(),
        )),
    }
}

fn canonical_identifier(input: &str) -> Result<(String, String, String), AppError> {
    let input = input.trim();
    if input.len() > MAX_IDENTIFIER_LEN || input.matches('@').count() != 1 {
        return Err(AppError::BadRequest(
            "identifier must be name@domain and at most 255 characters".into(),
        ));
    }
    let (name, domain_input) = input.split_once('@').unwrap();
    if name.is_empty()
        || !name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.'))
    {
        return Err(AppError::BadRequest(
            "identifier name contains unsupported characters".into(),
        ));
    }
    if domain_input.contains(':') {
        return Err(AppError::BadRequest(
            "identifier domain must not include a port".into(),
        ));
    }

    let parsed = reqwest::Url::parse(&format!("https://{domain_input}/"))
        .map_err(|_| AppError::BadRequest("identifier domain is invalid".into()))?;
    let domain = parsed
        .host_str()
        .filter(|_| {
            parsed.scheme() == "https"
                && parsed.port().is_none()
                && parsed.username().is_empty()
                && parsed.password().is_none()
                && parsed.path() == "/"
                && parsed.query().is_none()
                && parsed.fragment().is_none()
        })
        .ok_or_else(|| AppError::BadRequest("identifier domain is invalid".into()))?
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if domain.is_empty() || !domain.contains('.') || domain.parse::<IpAddr>().is_ok() {
        return Err(AppError::BadRequest(
            "identifier must use a public domain name".into(),
        ));
    }

    let name = name.to_ascii_lowercase();
    Ok((format!("{name}@{domain}"), name, domain))
}

fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, _, _] = ip.octets();
            !(ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_multicast()
                || ip.is_broadcast()
                || ip.is_unspecified()
                || a == 0
                || a >= 240
                || (a == 100 && (64..=127).contains(&b))
                || (a == 192 && b == 0)
                || (a == 198 && (b == 18 || b == 19 || b == 51))
                || (a == 203 && b == 0))
        }
        IpAddr::V6(ip) => {
            if let Some(mapped) = ip.to_ipv4_mapped() {
                return is_public_ip(IpAddr::V4(mapped));
            }
            let first = ip.segments()[0];
            !(ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_multicast()
                || (first & 0xfe00) == 0xfc00
                || (first & 0xffc0) == 0xfe80
                || (first == 0x2001 && ip.segments()[1] == 0x0db8))
        }
    }
}

async fn fetch_document(domain: &str, name: &str) -> Result<Nip05Document, AppError> {
    let addresses: Vec<_> = tokio::time::timeout(
        Duration::from_secs(5),
        tokio::net::lookup_host((domain, 443)),
    )
    .await
    .map_err(|_| AppError::Unprocessable("NIP-05 domain could not be resolved".into()))?
    .map_err(|_| AppError::Unprocessable("NIP-05 domain could not be resolved".into()))?
    .collect();
    if addresses.is_empty() || addresses.iter().any(|address| !is_public_ip(address.ip())) {
        return Err(AppError::Unprocessable(
            "NIP-05 domain does not resolve to a public address".into(),
        ));
    }

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .resolve(domain, addresses[0])
        .build()
        .map_err(|error| AppError::Internal(error.into()))?;
    let mut response = client
        .get(format!("https://{domain}/.well-known/nostr.json"))
        .query(&[("name", name)])
        .send()
        .await
        .map_err(|_| AppError::Unprocessable("NIP-05 document could not be fetched".into()))?;
    if !response.status().is_success() {
        return Err(AppError::Unprocessable(
            "NIP-05 document was not available".into(),
        ));
    }
    if response.content_length().unwrap_or(0) > MAX_RESPONSE_BYTES as u64 {
        return Err(AppError::Unprocessable(
            "NIP-05 document is too large".into(),
        ));
    }

    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| AppError::Unprocessable("NIP-05 document could not be read".into()))?
    {
        if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err(AppError::Unprocessable(
                "NIP-05 document is too large".into(),
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| AppError::Unprocessable("NIP-05 document is invalid".into()))
}

async fn current_identity(
    State(state): State<AppState>,
    auth: NostrAuth,
) -> Result<Json<IdentityResponse>, AppError> {
    let identity = sqlx::query_as::<_, StoredIdentity>(
        "SELECT nip05_identifier AS identifier, nip05_verified_at AS verified_at, \
         nip05_valid_until AS valid_until FROM users \
         WHERE nostr_pubkey = $1 AND nip05_identifier IS NOT NULL",
    )
    .bind(&auth.pubkey)
    .fetch_optional(&state.db)
    .await?;
    Ok(Json(IdentityResponse {
        nip05: identity.map(Into::into),
    }))
}

async fn set_identity(
    State(state): State<AppState>,
    Extension(limiter): Extension<Nip05Limiter>,
    auth: NostrAuth,
    body: Bytes,
) -> Result<Json<IdentityResponse>, AppError> {
    if limiter.check_key(&auth.pubkey).is_err() {
        return Err(AppError::RateLimited);
    }
    verify_payload_binding(auth.payload.as_deref(), &body)?;
    let body: SetIdentityBody = serde_json::from_slice(&body)
        .map_err(|_| AppError::BadRequest("invalid JSON body".into()))?;
    let (identifier, name, domain) = canonical_identifier(&body.identifier)?;
    let document = fetch_document(&domain, &name).await?;
    let mapped_key = document
        .names
        .get(&name)
        .map(|key| key.to_ascii_lowercase());
    if mapped_key.as_deref() != Some(auth.pubkey.as_str()) {
        return Err(AppError::Unprocessable(
            "NIP-05 identifier does not map to this local key".into(),
        ));
    }

    let mut transaction = state.db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(&identifier)
        .execute(&mut *transaction)
        .await?;
    sqlx::query(
        "UPDATE users SET nip05_identifier = NULL, nip05_verified_at = NULL, \
         nip05_valid_until = NULL WHERE nip05_identifier = $1 AND nip05_valid_until <= now()",
    )
    .bind(&identifier)
    .execute(&mut *transaction)
    .await?;
    let identity = sqlx::query_as::<_, StoredIdentity>(
        "INSERT INTO users \
           (nostr_pubkey, nip05_identifier, nip05_verified_at, nip05_valid_until) \
         VALUES ($1, $2, now(), now() + make_interval(hours => $3)) \
         ON CONFLICT (nostr_pubkey) DO UPDATE SET \
           nip05_identifier = EXCLUDED.nip05_identifier, \
           nip05_verified_at = EXCLUDED.nip05_verified_at, \
           nip05_valid_until = EXCLUDED.nip05_valid_until, \
           last_active = now() \
         RETURNING nip05_identifier AS identifier, nip05_verified_at AS verified_at, \
                   nip05_valid_until AS valid_until",
    )
    .bind(&auth.pubkey)
    .bind(&identifier)
    .bind(VERIFICATION_TTL_HOURS as i32)
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(database_error)
            if database_error.code().as_deref() == Some("23505") =>
        {
            AppError::Conflict("NIP-05 identifier is already claimed".into())
        }
        _ => AppError::Internal(error.into()),
    })?;
    transaction.commit().await?;

    Ok(Json(IdentityResponse {
        nip05: Some(identity.into()),
    }))
}

async fn delete_identity(
    State(state): State<AppState>,
    Extension(limiter): Extension<Nip05Limiter>,
    auth: NostrAuth,
) -> Result<StatusCode, AppError> {
    if limiter.check_key(&auth.pubkey).is_err() {
        return Err(AppError::RateLimited);
    }
    sqlx::query(
        "UPDATE users SET nip05_identifier = NULL, nip05_verified_at = NULL, \
         nip05_valid_until = NULL, last_active = now() WHERE nostr_pubkey = $1",
    )
    .bind(&auth.pubkey)
    .execute(&state.db)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub fn router() -> Router<AppState> {
    let limiter: Nip05Limiter = Arc::new(RateLimiter::keyed(Quota::per_minute(
        NonZeroU32::new(5).unwrap(),
    )));
    Router::new()
        .route(
            "/nip05",
            get(current_identity)
                .put(set_identity)
                .delete(delete_identity),
        )
        .layer(Extension(limiter))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, Ipv6Addr};

    #[test]
    fn canonicalizes_identifier() {
        assert_eq!(
            canonical_identifier(" Alice@Example.COM ").unwrap(),
            (
                "alice@example.com".into(),
                "alice".into(),
                "example.com".into()
            )
        );
    }

    #[test]
    fn rejects_url_shaped_and_local_identifiers() {
        for input in [
            "https://alice@example.com",
            "alice@localhost",
            "alice@127.0.0.1",
            "alice@example.com/path",
            "alice@example.com:443",
            "a@@example.com",
        ] {
            assert!(canonical_identifier(input).is_err(), "accepted {input}");
        }
    }

    #[test]
    fn rejects_non_public_addresses() {
        for ip in [
            IpAddr::V4(Ipv4Addr::LOCALHOST),
            IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1)),
            IpAddr::V4(Ipv4Addr::new(169, 254, 169, 254)),
            IpAddr::V4(Ipv4Addr::new(100, 64, 0, 1)),
            IpAddr::V4(Ipv4Addr::new(198, 51, 100, 1)),
            IpAddr::V4(Ipv4Addr::new(203, 0, 113, 1)),
            IpAddr::V6(Ipv6Addr::LOCALHOST),
            "fd00::1".parse().unwrap(),
            "fe80::1".parse().unwrap(),
            "::ffff:127.0.0.1".parse().unwrap(),
        ] {
            assert!(!is_public_ip(ip), "accepted {ip}");
        }
        assert!(is_public_ip("1.1.1.1".parse().unwrap()));
        assert!(is_public_ip("2606:4700:4700::1111".parse().unwrap()));
    }
}
