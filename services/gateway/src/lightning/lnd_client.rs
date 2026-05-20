use anyhow::Result;
use base64::{engine::general_purpose, Engine};
use reqwest::Client;
use serde::Deserialize;

#[derive(Clone, Debug)]
pub struct LndClient {
    client: Client,
    base_url: String,
    macaroon_hex: String,
}

pub struct InvoiceResult {
    pub payment_request: String,
    pub payment_hash_hex: String,
}

#[derive(Deserialize)]
struct LndInvoiceResponse {
    payment_request: String,
    r_hash: String, // base64 standard encoded
}

impl LndClient {
    /// Create an LND client.
    ///
    /// - `tls_skip_verify=true`: skip TLS verification (dev only — MITM risk in production)
    /// - `tls_cert_pem=Some(bytes)`: pin LND's self-signed cert (production path)
    /// - both false/None: use system root CAs
    pub fn new(
        base_url: &str,
        macaroon_hex: &str,
        tls_skip_verify: bool,
        tls_cert_pem: Option<&[u8]>,
    ) -> Result<Self> {
        let client = match (tls_skip_verify, tls_cert_pem) {
            (true, _) => Client::builder()
                .danger_accept_invalid_certs(true)
                .build()?,
            (false, Some(pem_bytes)) => {
                let cert = reqwest::Certificate::from_pem(pem_bytes)
                    .map_err(|e| anyhow::anyhow!("invalid LND TLS certificate: {e}"))?;
                Client::builder()
                    .add_root_certificate(cert)
                    .build()?
            }
            (false, None) => Client::builder().build()?,
        };
        Ok(Self {
            client,
            base_url: base_url.trim_end_matches('/').to_string(),
            macaroon_hex: macaroon_hex.to_string(),
        })
    }

    pub async fn create_invoice(&self, amount_sats: i64, memo: &str) -> Result<InvoiceResult> {
        let resp: LndInvoiceResponse = self
            .client
            .post(format!("{}/v1/invoices", self.base_url))
            .header("Grpc-Metadata-macaroon", &self.macaroon_hex)
            .json(&serde_json::json!({
                "value": amount_sats,
                "memo": memo,
                "expiry": 3600
            }))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        let hash_bytes = general_purpose::STANDARD.decode(&resp.r_hash)?;
        let payment_hash_hex = hex::encode(hash_bytes);

        Ok(InvoiceResult {
            payment_request: resp.payment_request,
            payment_hash_hex,
        })
    }

    #[allow(dead_code)]
    pub async fn get_invoice(&self, payment_hash_hex: &str) -> Result<serde_json::Value> {
        let hash_bytes = hex::decode(payment_hash_hex)?;
        let b64url = general_purpose::URL_SAFE_NO_PAD.encode(hash_bytes);

        let val = self
            .client
            .get(format!("{}/v1/invoice/{}", self.base_url, b64url))
            .header("Grpc-Metadata-macaroon", &self.macaroon_hex)
            .send()
            .await?
            .error_for_status()?
            .json::<serde_json::Value>()
            .await?;

        Ok(val)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skip_verify_flag_builds_without_cert() {
        let result = LndClient::new("https://localhost:8080", "aabbcc", true, None);
        assert!(result.is_ok());
    }

    #[test]
    fn system_roots_builds_without_cert() {
        let result = LndClient::new("https://localhost:8080", "aabbcc", false, None);
        assert!(result.is_ok());
    }

    #[test]
    fn invalid_pem_returns_error() {
        let bad_pem = b"this is not a PEM certificate";
        let result = LndClient::new("https://localhost:8080", "aabbcc", false, Some(bad_pem));
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("certificate"));
    }
}
