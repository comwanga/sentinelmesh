use anyhow::Result;
use base64::{engine::general_purpose, Engine};
use reqwest::Client;
use serde::Deserialize;

#[derive(Clone)]
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
    pub fn new(base_url: &str, macaroon_hex: &str, tls_skip_verify: bool) -> Result<Self> {
        let client = Client::builder()
            .danger_accept_invalid_certs(tls_skip_verify)
            .build()?;
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
