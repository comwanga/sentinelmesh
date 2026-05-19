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

    #[test]
    fn missing_required_var_returns_error() {
        let result = require("GATEWAY_TEST_MISSING_VAR_XYZ");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("GATEWAY_TEST_MISSING_VAR_XYZ"));
    }

    #[test]
    fn nostr_relays_parse_from_env() {
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
        std::env::remove_var("NOSTR_RELAYS");
        let relays: Vec<String> = std::env::var("NOSTR_RELAYS")
            .unwrap_or_else(|_| "wss://nos.lol".into())
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        assert_eq!(relays, vec!["wss://nos.lol"]);
    }
}
