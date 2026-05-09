// services/blockchain/src/utils/fee_estimator.rs
use anyhow::Result;

const ANCHOR_TX_VBYTES: u64 = 154;
const FALLBACK_SAT_PER_VBYTE: u64 = 20;
const MIN_FEE_SATS: u64 = 1000;

#[derive(serde::Deserialize)]
struct MempoolFeeResponse {
    #[serde(rename = "hourFee")]
    hour_fee: u64,
}

/// Fetches recommended fee from mempool.space and computes total sats for the anchor tx.
/// Falls back to FALLBACK_SAT_PER_VBYTE on any error, matching TypeScript behavior.
pub async fn estimate_fee(fee_url: &str) -> u64 {
    match fetch_fee(fee_url).await {
        Ok(fee) => fee,
        Err(e) => {
            tracing::warn!("fee estimator using fallback: {}", e);
            FALLBACK_SAT_PER_VBYTE * ANCHOR_TX_VBYTES
        }
    }
}

async fn fetch_fee(fee_url: &str) -> Result<u64> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()?;
    let resp: MempoolFeeResponse = client.get(fee_url).send().await?.json().await?;
    Ok((resp.hour_fee * ANCHOR_TX_VBYTES).max(MIN_FEE_SATS))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_fee_is_reasonable() {
        let fallback = FALLBACK_SAT_PER_VBYTE * ANCHOR_TX_VBYTES;
        assert_eq!(fallback, 3080);
        assert!(fallback >= MIN_FEE_SATS);
    }
}
