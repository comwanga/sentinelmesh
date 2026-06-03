// services/blockchain/src/config.rs
use anyhow::{anyhow, Result};

#[derive(Debug, Clone)]
pub enum BitcoinNetwork {
    Mainnet,
    Testnet,
}

impl BitcoinNetwork {
    fn from_str(s: &str) -> Result<Self> {
        match s {
            "mainnet" => Ok(Self::Mainnet),
            "testnet" => Ok(Self::Testnet),
            other => Err(anyhow!(
                "Invalid BITCOIN_NETWORK {:?}. Must be \"mainnet\" or \"testnet\".",
                other
            )),
        }
    }

    pub fn mempool_fee_url(&self) -> &'static str {
        match self {
            Self::Mainnet => "https://mempool.space/api/v1/fees/recommended",
            Self::Testnet => "https://mempool.space/testnet/api/v1/fees/recommended",
        }
    }

    pub fn mempool_broadcast_url(&self) -> &'static str {
        match self {
            Self::Mainnet => "https://mempool.space/api/tx",
            Self::Testnet => "https://mempool.space/testnet/api/tx",
        }
    }

    pub fn blockstream_broadcast_url(&self) -> &'static str {
        match self {
            Self::Mainnet => "https://blockstream.info/api/tx",
            Self::Testnet => "https://blockstream.info/testnet/api/tx",
        }
    }

    pub fn mempool_tx_url(&self, txid: &str) -> String {
        match self {
            Self::Mainnet => format!("https://mempool.space/api/tx/{}", txid),
            Self::Testnet => format!("https://mempool.space/testnet/api/tx/{}", txid),
        }
    }

    pub fn to_bitcoin_network(&self) -> bitcoin::Network {
        match self {
            Self::Mainnet => bitcoin::Network::Bitcoin,
            Self::Testnet => bitcoin::Network::Testnet,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub database_url: String,
    pub nostr_privkey: String,
    pub relay_urls: Vec<String>,
    pub bitcoin_wif: String,
    pub bitcoin_network: BitcoinNetwork,
    pub poll_interval_ms: u64,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let database_url = required("DATABASE_URL")?;
        let nostr_privkey = required("NOSTR_PRIVKEY")?;
        if nostr_privkey.len() != 64 || !nostr_privkey.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(anyhow!("NOSTR_PRIVKEY must be 64 hex chars"));
        }
        let bitcoin_wif = required("BITCOIN_WIF")?;
        let network_str = std::env::var("BITCOIN_NETWORK").unwrap_or_else(|_| "testnet".into());
        let bitcoin_network = BitcoinNetwork::from_str(&network_str)?;
        // Default: 4 geographically diverse relays so at least one is fast from Kenya.
        // Operators can override via RELAY_URLS env var (comma-separated).
        let relay_urls = std::env::var("RELAY_URLS")
            .unwrap_or_else(|_| {
                "wss://relay.damus.io,wss://nos.lol,wss://relay.nostr.band,wss://nostr.wine".into()
            })
            .split(',')
            .map(|s| s.trim().to_string())
            .collect();
        let port = std::env::var("BLOCKCHAIN_PORT")
            .unwrap_or_else(|_| "3003".into())
            .parse::<u16>()
            .map_err(|_| anyhow!("BLOCKCHAIN_PORT must be a valid port number"))?;
        let poll_interval_ms = std::env::var("POLL_INTERVAL_MS")
            .unwrap_or_else(|_| "10000".into())
            .parse::<u64>()
            .map_err(|_| anyhow!("POLL_INTERVAL_MS must be a valid integer"))?;

        Ok(Config {
            port,
            database_url,
            nostr_privkey,
            relay_urls,
            bitcoin_wif,
            bitcoin_network,
            poll_interval_ms,
        })
    }
}

fn required(key: &str) -> Result<String> {
    std::env::var(key).map_err(|_| anyhow!("Missing required env var: {}", key))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_network() {
        assert!(BitcoinNetwork::from_str("invalid").is_err());
        assert!(BitcoinNetwork::from_str("mainnet").is_ok());
        assert!(BitcoinNetwork::from_str("testnet").is_ok());
    }

    #[test]
    fn from_env_fails_without_required_vars() {
        unsafe {
            std::env::remove_var("DATABASE_URL");
        }
        assert!(Config::from_env().is_err());
    }
}
