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
    pub nostr_private_key: Option<String>,
    pub internal_service_secret: String,
    pub trust_proxy: bool,
    pub max_db_connections: u32,
    pub mapbox_token: Option<String>,
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
            nostr_private_key: std::env::var("NOSTR_PRIVATE_KEY").ok(),
            internal_service_secret,
            trust_proxy: std::env::var("TRUST_PROXY")
                .map(|v| v == "true" || v == "1")
                .unwrap_or(false),
            max_db_connections: std::env::var("MAX_DB_CONNECTIONS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(50),
            mapbox_token: std::env::var("MAPBOX_TOKEN").ok(),
        })
    }
}

fn require(key: &str) -> Result<String> {
    std::env::var(key).map_err(|_| anyhow::anyhow!("missing required env var: {key}"))
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
}
