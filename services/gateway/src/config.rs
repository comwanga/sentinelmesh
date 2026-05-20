use anyhow::Result;

pub struct Config {
    pub database_url: String,
    pub redis_url: String,
    pub port: u16,
    pub zap_webhook_secret: String,
    pub blockchain_service_url: Option<String>,
    pub lnd_rest_url: Option<String>,
    pub lnd_macaroon_hex: Option<String>,
    pub lnd_tls_skip_verify: bool,
    pub lnd_tls_cert_pem: Option<Vec<u8>>,
    pub nostr_private_key: Option<String>,
    pub nostr_relays: Vec<String>,
    pub zap_rate_limit_per_minute: u32,
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
    pub soft_visibility_enabled: bool,
    pub emergency_mode_enabled: bool,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let internal_service_secret = std::env::var("INTERNAL_SERVICE_SECRET")
            .unwrap_or_else(|_| {
                tracing::warn!("INTERNAL_SERVICE_SECRET not set — using insecure dev default");
                "dev-only-insecure-secret".into()
            });
        Ok(Config {
            database_url: require("DATABASE_URL")?,
            redis_url: require("REDIS_URL")?,
            port: std::env::var("PORT")
                .unwrap_or_else(|_| "3000".into())
                .parse()?,
            zap_webhook_secret: require("ZAP_WEBHOOK_SECRET")?,
            blockchain_service_url: std::env::var("BLOCKCHAIN_SERVICE_URL").ok(),
            lnd_rest_url: std::env::var("LND_REST_URL").ok(),
            lnd_macaroon_hex: std::env::var("LND_MACAROON_HEX").ok(),
            lnd_tls_skip_verify: std::env::var("LND_TLS_SKIP_VERIFY")
                .map(|v| v == "true" || v == "1")
                .unwrap_or(false),
            lnd_tls_cert_pem: load_cert_pem()?,
            nostr_private_key: load_nostr_private_key()?,
            nostr_relays: std::env::var("NOSTR_RELAYS")
                .unwrap_or_else(|_| "wss://nos.lol".into())
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
            zap_rate_limit_per_minute: std::env::var("ZAP_RATE_LIMIT_PER_MINUTE")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(10),
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

fn load_cert_pem() -> Result<Option<Vec<u8>>> {
    let Some(path) = std::env::var("LND_TLS_CERT_PATH").ok() else {
        return Ok(None);
    };
    let bytes = std::fs::read(&path)
        .map_err(|e| anyhow::anyhow!("failed to read LND_TLS_CERT_PATH={path}: {e}"))?;
    Ok(Some(bytes))
}

fn load_public_base_url() -> anyhow::Result<Option<String>> {
    let Some(raw) = std::env::var("PUBLIC_BASE_URL").ok() else {
        return Ok(None);
    };
    let lowered = raw.to_lowercase();
    let trimmed = lowered.trim_end_matches('/');
    let uri: axum::http::Uri = trimmed.parse().map_err(|e| {
        anyhow::anyhow!("PUBLIC_BASE_URL is not a valid URL ({e}): {raw}")
    })?;
    let scheme = uri.scheme_str().ok_or_else(|| {
        anyhow::anyhow!("PUBLIC_BASE_URL must include scheme (e.g. https://): {raw}")
    })?;
    let path = uri.path();
    if !path.is_empty() && path != "/" {
        anyhow::bail!(
            "PUBLIC_BASE_URL must not include a path component (got {path:?}): {raw}"
        );
    }
    if scheme != "http" && scheme != "https" {
        anyhow::bail!(
            "PUBLIC_BASE_URL scheme must be http or https (got {scheme:?}): {raw}"
        );
    }
    let authority = uri.authority().ok_or_else(|| {
        anyhow::anyhow!("PUBLIC_BASE_URL must include a host: {raw}")
    })?;
    let host = authority.host();
    let port = authority.port_u16();
    let host_part = match (scheme, port) {
        ("https", Some(443)) | ("http", Some(80)) => host.to_string(),
        (_, Some(p)) => format!("{host}:{p}"),
        (_, None) => host.to_string(),
    };
    Ok(Some(format!("{scheme}://{host_part}")))
}

fn load_nostr_private_key() -> Result<Option<String>> {
    if let Ok(path) = std::env::var("NOSTR_PRIVATE_KEY_FILE") {
        let content = std::fs::read_to_string(&path)
            .map_err(|e| anyhow::anyhow!("failed to read NOSTR_PRIVATE_KEY_FILE={path}: {e}"))?;
        return Ok(Some(content.trim().to_string()));
    }
    if let Ok(key) = std::env::var("NOSTR_PRIVATE_KEY") {
        tracing::warn!(
            "NOSTR_PRIVATE_KEY loaded from environment variable — \
             use NOSTR_PRIVATE_KEY_FILE for production"
        );
        return Ok(Some(key));
    }
    Ok(None)
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
        assert!(result.unwrap_err().to_string().contains("GATEWAY_TEST_MISSING_VAR_XYZ"));
    }

    #[test]
    fn nostr_relays_parse_from_env() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var("NOSTR_RELAYS", "wss://a.example,wss://b.example");
        let relays: Vec<String> = std::env::var("NOSTR_RELAYS")
            .unwrap_or_default()
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        std::env::remove_var("NOSTR_RELAYS");
        assert_eq!(relays, vec!["wss://a.example", "wss://b.example"]);
    }

    #[test]
    fn nostr_relays_default_when_unset() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::remove_var("NOSTR_RELAYS");
        let relays: Vec<String> = std::env::var("NOSTR_RELAYS")
            .unwrap_or_else(|_| "wss://nos.lol".into())
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        assert_eq!(relays, vec!["wss://nos.lol"]);
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
        assert!(msg.contains("PUBLIC_BASE_URL"), "missing PUBLIC_BASE_URL in: {msg}");
        assert!(msg.contains("scheme") || msg.contains("valid URL"), "missing error detail in: {msg}");
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
}
