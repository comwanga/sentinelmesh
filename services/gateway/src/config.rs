use anyhow::Result;

pub struct Config {
    pub database_url: String,
    pub redis_url: String,
    pub port: u16,
    pub blockchain_service_url: Option<String>,
    pub internal_service_secret: String,
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
    /// Gates the established-voter requirement for report consensus escalation.
    /// Default false (usable at cold-start with no trusted accounts). When true,
    /// VERIFIED/AUTHORITATIVE additionally require distinct non-NEWCOMER voters,
    /// blocking pure-Sybil escalation. The reputation framework is always active;
    /// this flag only toggles the gate, so it can be enabled with no code changes.
    pub consensus_require_established: bool,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let production = is_production();

        // Fail closed in production: the internal-service secret must be set to a
        // strong, non-default value or the process refuses to start.
        let internal_service_secret = resolve_internal_secret(production)?;

        Ok(Config {
            database_url: require("DATABASE_URL")?,
            redis_url: require("REDIS_URL")?,
            port: std::env::var("PORT")
                .unwrap_or_else(|_| "3000".into())
                .parse()?,
            acoustic_confirm_enabled: std::env::var("ACOUSTIC_CONFIRM_ENABLED")
                .map(|v| v == "true" || v == "1")
                .unwrap_or(false),
            consensus_require_established: std::env::var("CONSENSUS_REQUIRE_ESTABLISHED")
                .map(|v| v == "true" || v == "1")
                .unwrap_or(false),
            blockchain_service_url: std::env::var("BLOCKCHAIN_SERVICE_URL").ok(),
            internal_service_secret,
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

/// Reject known-placeholder or too-short secrets. Production use only.
fn reject_weak_secret(name: &str, value: &str) -> Result<()> {
    if WEAK_SECRETS.iter().any(|w| value.eq_ignore_ascii_case(w)) || value.len() < 16 {
        anyhow::bail!(
            "{name} is too weak for production: must be at least 16 chars and not a known placeholder"
        );
    }
    Ok(())
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
}
