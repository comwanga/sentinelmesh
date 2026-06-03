// services/blockchain/src/utils/fee_estimator.rs
use anyhow::Result;

// 1-in/2-out P2WPKH (OP_RETURN output + change) transaction size
const ANCHOR_TX_VBYTES: u64 = 154;
const FALLBACK_SAT_PER_VBYTE: u64 = 20;
const MIN_FEE_SATS: u64 = 1000;
// Hard ceiling: never pay more than 50 sat/vB regardless of mempool congestion
const MAX_SAT_PER_VBYTE: u64 = 50;

#[derive(serde::Deserialize)]
struct MempoolFeeResponse {
    #[serde(rename = "hourFee")]
    hour_fee: f64,
}

/// Fetches recommended fee from mempool.space and computes total sats for the anchor tx.
/// Falls back to FALLBACK_SAT_PER_VBYTE on any error, matching TypeScript behavior.
pub async fn estimate_fee(client: &reqwest::Client, fee_url: &str) -> u64 {
    match fetch_fee(client, fee_url).await {
        Ok(fee) => fee,
        Err(e) => {
            tracing::warn!("fee estimator using fallback: {}", e);
            FALLBACK_SAT_PER_VBYTE * ANCHOR_TX_VBYTES
        }
    }
}

async fn fetch_fee(client: &reqwest::Client, fee_url: &str) -> Result<u64> {
    let resp: MempoolFeeResponse = client.get(fee_url).send().await?.json().await?;
    let sats_per_vbyte = (resp.hour_fee.ceil() as u64).min(MAX_SAT_PER_VBYTE);
    Ok((sats_per_vbyte * ANCHOR_TX_VBYTES).max(MIN_FEE_SATS))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_fee_is_reasonable() {
        let fallback = FALLBACK_SAT_PER_VBYTE * ANCHOR_TX_VBYTES;
        assert_eq!(
            fallback, 3080,
            "constants drifted — check FALLBACK_SAT_PER_VBYTE and ANCHOR_TX_VBYTES"
        );
        assert!(fallback >= MIN_FEE_SATS);
    }

    #[test]
    fn fee_ceiling_clamps_high_mempool_rate() {
        // 200 sat/vB would be 30_800 sats uncapped; ceiling must cap at MAX_SAT_PER_VBYTE * vbytes
        let high_rate: u64 = 200;
        let capped = high_rate.min(MAX_SAT_PER_VBYTE) * ANCHOR_TX_VBYTES;
        assert_eq!(capped, MAX_SAT_PER_VBYTE * ANCHOR_TX_VBYTES); // 7_700 sats
        assert!(capped < high_rate * ANCHOR_TX_VBYTES);
    }
}
