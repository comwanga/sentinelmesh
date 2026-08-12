use anyhow::Result;

pub struct Config {
    pub database_url: String,
    pub redis_url: String,
    pub port: u16,
    pub blockchain_service_url: Option<String>,
    pub internal_service_secret: String,
    /// HMAC key for per-circle social-graph tokens (C-3). Dedicated and STABLE:
    /// rotating it invalidates every stored circle/member/recipient token and
    /// requires a re-tokenization migration. Do not reuse INTERNAL_SERVICE_SECRET.
    pub circle_token_secret: String,
    pub trust_proxy: bool,
    pub max_db_connections: u32,
    pub mapbox_token: Option<String>,
    pub vapid_private_key: Option<String>,
    pub vapid_public_key: Option<String>,
    pub vapid_subject: Option<String>,
    pub ws_events_rate_cap: u32,
    pub public_base_url: Option<String>,
    pub synthesis_enabled: bool,
    /// Gates the NLP trust-ladder synthesis worker (promotion + push-on-confirm
    /// + TTL expiry). Default true so the ladder is live; set false to dark-launch.
    pub nlp_synthesis_enabled: bool,
    pub soft_visibility_enabled: bool,
    pub emergency_mode_enabled: bool,
    /// Gates acoustic cluster promotion to `confirmed` + public_event creation.
    /// Default false: without explicit opt-in the synthesis worker corroborates
    /// (telemetry only) but never auto-publishes acoustic events to the map.
    pub acoustic_confirm_enabled: bool,
    pub anchoring_enabled: bool,
    /// Default **true** (C-1a): the gate is on; personhood (genesis/earned/vouched)
    /// seeds the established cohort. Set `CONSENSUS_REQUIRE_ESTABLISHED=false` to disable.
    pub consensus_require_established: bool,
    /// Operator-designated web-of-trust roots (C-1a). Hex Nostr pubkeys that can
    /// issue the first vouches; trust propagates outward from them. Empty by
    /// default (dev); seed in production before enabling the consensus gate.
    pub vouch_genesis_roots: Vec<String>,
    /// Max active (non-revoked) vouches a single voucher may hold (C-1a).
    pub vouch_budget: u32,
    /// Trust worker tick interval (snapshot + decay passes). Default 3600s.
    pub trust_worker_tick_secs: u64,
    /// Apply reputation decay (default false — dark-launch; snapshots still run).
    pub reputation_decay_enabled: bool,
    /// Days since last VERIFIED before decay begins. Default 90.
    pub reputation_decay_grace_days: u32,
    /// Days over which a past-grace score decays toward the floor (1x..2x by accuracy). Default 180.
    pub reputation_decay_horizon_days: u32,
    /// Lowest score decay can reach. Default 0.
    pub reputation_decay_floor: i32,
    /// Min vouchees before a voucher_quality ratio is shown without a low-confidence flag. Default 5.
    pub quality_min_sample: u32,
    /// Days of metrics snapshots to retain. Default 180.
    pub observatory_snapshot_retention_days: u32,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let production = is_production();

        // Fail closed in production: the internal-service secret must be set to a
        // strong, non-default value or the process refuses to start.
        let internal_service_secret = resolve_internal_secret(production)?;
        let circle_token_secret = resolve_circle_token_secret(production)?;

        Ok(Config {
            database_url: require("DATABASE_URL")?,
            redis_url: require("REDIS_URL")?,
            port: std::env::var("PORT")
                .unwrap_or_else(|_| "3000".into())
                .parse()?,
            acoustic_confirm_enabled: std::env::var("ACOUSTIC_CONFIRM_ENABLED")
                .map(|v| v == "true" || v == "1")
                .unwrap_or(false),
            anchoring_enabled: std::env::var("ANCHORING_ENABLED")
                .map(|v| v == "true" || v == "1")
                .unwrap_or(false),
            consensus_require_established: std::env::var("CONSENSUS_REQUIRE_ESTABLISHED")
                .map(|v| v == "true" || v == "1")
                .unwrap_or(true),
            vouch_genesis_roots: parse_genesis_roots(
                &std::env::var("VOUCH_GENESIS_ROOTS").unwrap_or_default(),
            ),
            vouch_budget: parse_vouch_budget(std::env::var("VOUCH_BUDGET").ok()),
            trust_worker_tick_secs: parse_u64_env_or(
                std::env::var("TRUST_WORKER_TICK_SECS").ok(),
                3600,
            ),
            reputation_decay_enabled: std::env::var("REPUTATION_DECAY_ENABLED")
                .map(|v| v == "true" || v == "1")
                .unwrap_or(false),
            reputation_decay_grace_days: parse_u32_env_or(
                std::env::var("REPUTATION_DECAY_GRACE_DAYS").ok(),
                90,
            ),
            reputation_decay_horizon_days: parse_u32_env_or(
                std::env::var("REPUTATION_DECAY_HORIZON_DAYS").ok(),
                180,
            ),
            reputation_decay_floor: parse_i32_env_or(
                std::env::var("REPUTATION_DECAY_FLOOR").ok(),
                0,
            ),
            quality_min_sample: parse_u32_env_or(std::env::var("QUALITY_MIN_SAMPLE").ok(), 5),
            observatory_snapshot_retention_days: parse_u32_env_or(
                std::env::var("OBSERVATORY_SNAPSHOT_RETENTION_DAYS").ok(),
                180,
            ),
            blockchain_service_url: std::env::var("BLOCKCHAIN_SERVICE_URL").ok(),
            internal_service_secret,
            circle_token_secret,
            trust_proxy: std::env::var("TRUST_PROXY")
                .map(|v| v == "true" || v == "1")
                .unwrap_or(false),
            max_db_connections: std::env::var("MAX_DB_CONNECTIONS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(50),
            mapbox_token: std::env::var("MAPBOX_TOKEN").ok(),
            vapid_private_key: std::env::var("VAPID_PRIVATE_KEY").ok(),
            vapid_public_key: std::env::var("VAPID_PUBLIC_KEY").ok(),
            vapid_subject: std::env::var("VAPID_SUBJECT").ok(),
            ws_events_rate_cap: std::env::var("WS_EVENTS_RATE_CAP")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(30),
            public_base_url: load_public_base_url()?,
            synthesis_enabled: std::env::var("SYNTHESIS_ENABLED")
                .map(|v| v == "true" || v == "1")
                .unwrap_or(false),
            // Default true (on): unlike acoustic, the NLP ladder is meant to run
            // by default — heuristic events surface immediately and the worker is
            // what eventually promotes/expires them. Set "false"/"0" to disable.
            nlp_synthesis_enabled: std::env::var("NLP_SYNTHESIS_ENABLED")
                .map(|v| !(v == "false" || v == "0"))
                .unwrap_or(true),
            soft_visibility_enabled: std::env::var("SOFT_VISIBILITY_ENABLED")
                .map(|v| v == "true" || v == "1")
                .unwrap_or(false),
            emergency_mode_enabled: std::env::var("EMERGENCY_MODE_ENABLED")
                .map(|v| v == "true" || v == "1")
                .unwrap_or(false),
        })
    }
}

fn require(key: &str) -> Result<String> {
    std::env::var(key).map_err(|_| anyhow::anyhow!("missing required env var: {key}"))
}

const INSECURE_INTERNAL_DEFAULT: &str = "dev-only-insecure-secret";
const WEAK_SECRETS: &[&str] = &[
    "",
    "dev-only-insecure-secret",
    "test",
    "secret",
    "changeme",
    "password",
    "default",
];

/// True when NODE_ENV is "production" (case-insensitive).
fn is_production() -> bool {
    std::env::var("NODE_ENV")
        .map(|v| v.eq_ignore_ascii_case("production"))
        .unwrap_or(false)
}

/// Resolve INTERNAL_SERVICE_SECRET. In production an unset/default/empty value is
/// a hard error (fail closed). In non-production we fall back to a clearly-labelled
/// insecure dev default with a warning.
fn resolve_internal_secret(production: bool) -> Result<String> {
    match std::env::var("INTERNAL_SERVICE_SECRET") {
        Ok(s) if !s.is_empty() && s != INSECURE_INTERNAL_DEFAULT => {
            if production {
                reject_weak_secret("INTERNAL_SERVICE_SECRET", &s)?;
            }
            Ok(s)
        }
        _ if production => anyhow::bail!(
            "INTERNAL_SERVICE_SECRET must be set to a strong, non-default value when NODE_ENV=production"
        ),
        _ => {
            tracing::warn!(
                "INTERNAL_SERVICE_SECRET not set — using insecure dev default (NON-PRODUCTION ONLY)"
            );
            Ok(INSECURE_INTERNAL_DEFAULT.to_string())
        }
    }
}

const INSECURE_CIRCLE_TOKEN_DEFAULT: &str = "dev-only-insecure-circle-token-secret";

/// Resolve CIRCLE_TOKEN_SECRET. Production requires a strong, non-default value
/// (fail closed); non-production falls back to a labelled insecure default.
fn resolve_circle_token_secret(production: bool) -> Result<String> {
    match std::env::var("CIRCLE_TOKEN_SECRET") {
        Ok(s) if !s.is_empty() && s != INSECURE_CIRCLE_TOKEN_DEFAULT => {
            if production {
                reject_weak_secret("CIRCLE_TOKEN_SECRET", &s)?;
            }
            Ok(s)
        }
        _ if production => anyhow::bail!(
            "CIRCLE_TOKEN_SECRET must be set to a strong, non-default value when NODE_ENV=production"
        ),
        _ => {
            tracing::warn!(
                "CIRCLE_TOKEN_SECRET not set — using insecure dev default (NON-PRODUCTION ONLY)"
            );
            Ok(INSECURE_CIRCLE_TOKEN_DEFAULT.to_string())
        }
    }
}

/// Reject known-placeholder or too-short secrets. Production use only.
fn reject_weak_secret(name: &str, value: &str) -> Result<()> {
    if WEAK_SECRETS.iter().any(|w| value.eq_ignore_ascii_case(w)) || value.len() < 16 {
        anyhow::bail!(
            "{name} is too weak for production: must be at least 16 chars and not a known placeholder"
        );
    }
    Ok(())
}

/// Parse a comma-separated genesis-roots list, trimming whitespace and dropping empties.
fn parse_genesis_roots(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Parse the active-vouch budget, defaulting to 5 on absence or a bad value.
fn parse_vouch_budget(raw: Option<String>) -> u32 {
    raw.and_then(|v| v.parse().ok()).unwrap_or(5)
}

fn parse_u32_env_or(raw: Option<String>, default: u32) -> u32 {
    raw.and_then(|v| v.parse().ok()).unwrap_or(default)
}

fn parse_i32_env_or(raw: Option<String>, default: i32) -> i32 {
    raw.and_then(|v| v.parse().ok()).unwrap_or(default)
}

fn parse_u64_env_or(raw: Option<String>, default: u64) -> u64 {
    raw.and_then(|v| v.parse().ok()).unwrap_or(default)
}

fn load_public_base_url() -> anyhow::Result<Option<String>> {
    let Some(raw) = std::env::var("PUBLIC_BASE_URL").ok() else {
        return Ok(None);
    };
    let lowered = raw.to_lowercase();
    let trimmed = lowered.trim_end_matches('/');
    let uri: axum::http::Uri = trimmed
        .parse()
        .map_err(|e| anyhow::anyhow!("PUBLIC_BASE_URL is not a valid URL ({e}): {raw}"))?;
    let scheme = uri.scheme_str().ok_or_else(|| {
        anyhow::anyhow!("PUBLIC_BASE_URL must include scheme (e.g. https://): {raw}")
    })?;
    let path = uri.path();
    if !path.is_empty() && path != "/" {
        anyhow::bail!("PUBLIC_BASE_URL must not include a path component (got {path:?}): {raw}");
    }
    if scheme != "http" && scheme != "https" {
        anyhow::bail!("PUBLIC_BASE_URL scheme must be http or https (got {scheme:?}): {raw}");
    }
    let authority = uri
        .authority()
        .ok_or_else(|| anyhow::anyhow!("PUBLIC_BASE_URL must include a host: {raw}"))?;
    let host = authority.host();
    let port = authority.port_u16();
    let host_part = match (scheme, port) {
        ("https", Some(443)) | ("http", Some(80)) => host.to_string(),
        (_, Some(p)) => format!("{host}:{p}"),
        (_, None) => host.to_string(),
    };
    Ok(Some(format!("{scheme}://{host_part}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // Serialize env-mutating tests — Rust test threads share the process environment
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn missing_required_var_returns_error() {
        let _guard = ENV_LOCK.lock().unwrap();
        let result = require("GATEWAY_TEST_MISSING_VAR_XYZ");
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("GATEWAY_TEST_MISSING_VAR_XYZ"));
    }

    #[test]
    fn public_base_url_normalizes_uppercase_and_default_port() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var("PUBLIC_BASE_URL", "HTTPS://API.EXAMPLE.COM:443/");
        let result = load_public_base_url().unwrap();
        std::env::remove_var("PUBLIC_BASE_URL");
        assert_eq!(result, Some("https://api.example.com".to_string()));
    }

    #[test]
    fn public_base_url_preserves_non_default_port() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var("PUBLIC_BASE_URL", "https://api.example.com:8443");
        let result = load_public_base_url().unwrap();
        std::env::remove_var("PUBLIC_BASE_URL");
        assert_eq!(result, Some("https://api.example.com:8443".to_string()));
    }

    #[test]
    fn public_base_url_none_when_unset() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::remove_var("PUBLIC_BASE_URL");
        assert_eq!(load_public_base_url().unwrap(), None);
    }

    #[test]
    fn public_base_url_missing_scheme_is_error() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var("PUBLIC_BASE_URL", "api.example.com");
        let result = load_public_base_url();
        std::env::remove_var("PUBLIC_BASE_URL");
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(
            msg.contains("PUBLIC_BASE_URL"),
            "missing PUBLIC_BASE_URL in: {msg}"
        );
        assert!(
            msg.contains("scheme") || msg.contains("valid URL"),
            "missing error detail in: {msg}"
        );
    }

    #[test]
    fn public_base_url_strips_http_port_80() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var("PUBLIC_BASE_URL", "http://api.example.com:80");
        let result = load_public_base_url().unwrap();
        std::env::remove_var("PUBLIC_BASE_URL");
        assert_eq!(result, Some("http://api.example.com".to_string()));
    }

    #[test]
    fn public_base_url_with_path_is_error() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var("PUBLIC_BASE_URL", "https://api.example.com/v1");
        let result = load_public_base_url();
        std::env::remove_var("PUBLIC_BASE_URL");
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("path"), "expected 'path' in error: {msg}");
    }

    #[test]
    fn public_base_url_non_http_scheme_is_error() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var("PUBLIC_BASE_URL", "ftp://api.example.com");
        let result = load_public_base_url();
        std::env::remove_var("PUBLIC_BASE_URL");
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("scheme"), "expected 'scheme' in error: {msg}");
    }

    #[test]
    fn synthesis_enabled_reads_true() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var("SYNTHESIS_ENABLED", "true");
        let result = std::env::var("SYNTHESIS_ENABLED")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);
        std::env::remove_var("SYNTHESIS_ENABLED");
        assert!(result);
    }

    #[test]
    fn synthesis_enabled_defaults_false() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::remove_var("SYNTHESIS_ENABLED");
        let result = std::env::var("SYNTHESIS_ENABLED")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);
        assert!(!result);
    }

    #[test]
    fn synthesis_enabled_reads_1_as_true() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var("SYNTHESIS_ENABLED", "1");
        let result = std::env::var("SYNTHESIS_ENABLED")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);
        std::env::remove_var("SYNTHESIS_ENABLED");
        assert!(result);
    }

    #[test]
    fn soft_visibility_enabled_reads_true() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var("SOFT_VISIBILITY_ENABLED", "true");
        let result = std::env::var("SOFT_VISIBILITY_ENABLED")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);
        std::env::remove_var("SOFT_VISIBILITY_ENABLED");
        assert!(result);
    }

    #[test]
    fn soft_visibility_enabled_defaults_false() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::remove_var("SOFT_VISIBILITY_ENABLED");
        let result = std::env::var("SOFT_VISIBILITY_ENABLED")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);
        assert!(!result);
    }

    #[test]
    fn soft_visibility_enabled_reads_1_as_true() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var("SOFT_VISIBILITY_ENABLED", "1");
        let result = std::env::var("SOFT_VISIBILITY_ENABLED")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);
        std::env::remove_var("SOFT_VISIBILITY_ENABLED");
        assert!(result);
    }

    #[test]
    fn emergency_mode_enabled_reads_true() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var("EMERGENCY_MODE_ENABLED", "true");
        let result = std::env::var("EMERGENCY_MODE_ENABLED")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);
        std::env::remove_var("EMERGENCY_MODE_ENABLED");
        assert!(result);
    }

    #[test]
    fn emergency_mode_enabled_defaults_false() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::remove_var("EMERGENCY_MODE_ENABLED");
        let result = std::env::var("EMERGENCY_MODE_ENABLED")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);
        assert!(!result);
    }

    #[test]
    fn emergency_mode_enabled_reads_1_as_true() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var("EMERGENCY_MODE_ENABLED", "1");
        let result = std::env::var("EMERGENCY_MODE_ENABLED")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);
        std::env::remove_var("EMERGENCY_MODE_ENABLED");
        assert!(result);
    }

    #[test]
    fn internal_secret_unset_in_production_is_error() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::remove_var("INTERNAL_SERVICE_SECRET");
        let result = resolve_internal_secret(true);
        assert!(
            result.is_err(),
            "production must reject unset internal secret"
        );
    }

    #[test]
    fn internal_secret_default_in_production_is_error() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var("INTERNAL_SERVICE_SECRET", INSECURE_INTERNAL_DEFAULT);
        let result = resolve_internal_secret(true);
        std::env::remove_var("INTERNAL_SERVICE_SECRET");
        assert!(
            result.is_err(),
            "production must reject the insecure default value"
        );
    }

    #[test]
    fn internal_secret_strong_value_accepted_in_production() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var(
            "INTERNAL_SERVICE_SECRET",
            "a-strong-32-byte-secret-value-xx",
        );
        let result = resolve_internal_secret(true).unwrap();
        std::env::remove_var("INTERNAL_SERVICE_SECRET");
        assert_eq!(result, "a-strong-32-byte-secret-value-xx");
    }

    #[test]
    fn internal_secret_falls_back_to_default_in_dev() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::remove_var("INTERNAL_SERVICE_SECRET");
        let result = resolve_internal_secret(false).unwrap();
        assert_eq!(result, INSECURE_INTERNAL_DEFAULT);
    }

    #[test]
    fn weak_secrets_rejected_in_production() {
        assert!(reject_weak_secret("X", "").is_err());
        assert!(reject_weak_secret("X", "changeme").is_err());
        assert!(reject_weak_secret("X", "short").is_err());
        assert!(reject_weak_secret("X", INSECURE_INTERNAL_DEFAULT).is_err());
    }

    #[test]
    fn strong_secret_passes_weak_check() {
        assert!(reject_weak_secret("X", "a-strong-32-byte-secret-value-xx").is_ok());
    }

    #[test]
    fn circle_token_secret_unset_in_production_is_error() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::remove_var("CIRCLE_TOKEN_SECRET");
        assert!(resolve_circle_token_secret(true).is_err());
    }

    #[test]
    fn circle_token_secret_falls_back_in_dev() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::remove_var("CIRCLE_TOKEN_SECRET");
        assert_eq!(
            resolve_circle_token_secret(false).unwrap(),
            INSECURE_CIRCLE_TOKEN_DEFAULT
        );
    }

    #[test]
    fn circle_token_secret_strong_value_accepted_in_production() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var("CIRCLE_TOKEN_SECRET", "a-strong-32-byte-circle-secret-x");
        let r = resolve_circle_token_secret(true).unwrap();
        std::env::remove_var("CIRCLE_TOKEN_SECRET");
        assert_eq!(r, "a-strong-32-byte-circle-secret-x");
    }

    #[test]
    fn vouch_genesis_roots_parses_comma_separated() {
        assert_eq!(
            parse_genesis_roots("aa, bb ,cc"),
            vec!["aa".to_string(), "bb".to_string(), "cc".to_string()]
        );
    }

    #[test]
    fn vouch_genesis_roots_empty_is_empty_vec() {
        assert!(parse_genesis_roots("").is_empty());
        assert!(parse_genesis_roots("  ,  ").is_empty());
    }

    #[test]
    fn vouch_budget_defaults_to_five() {
        assert_eq!(parse_vouch_budget(None), 5);
        assert_eq!(parse_vouch_budget(Some("9".into())), 9);
        assert_eq!(parse_vouch_budget(Some("notanumber".into())), 5);
    }

    #[test]
    fn decay_defaults_are_conservative() {
        assert_eq!(parse_u32_env_or(None, 90), 90);
        assert_eq!(parse_u32_env_or(Some("30".into()), 90), 30);
        assert_eq!(parse_u32_env_or(Some("bad".into()), 90), 90);
    }

    #[test]
    fn decay_floor_parses() {
        assert_eq!(parse_i32_env_or(None, 0), 0);
        assert_eq!(parse_i32_env_or(Some("5".into()), 0), 5);
    }
    #[test]
    fn tick_secs_parses() {
        assert_eq!(parse_u64_env_or(None, 3600), 3600);
        assert_eq!(parse_u64_env_or(Some("60".into()), 3600), 60);
        assert_eq!(parse_u64_env_or(Some("bad".into()), 3600), 3600);
    }
}
