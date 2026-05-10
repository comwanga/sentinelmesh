// services/blockchain/src/workers/bitcoin_anchor.rs
use anyhow::{anyhow, Result};
use bitcoin::hashes::Hash;
use bitcoin::{
    absolute::LockTime,
    address::KnownHrp,
    key::CompressedPublicKey,
    opcodes::all::OP_RETURN,
    script::{Builder, PushBytesBuf},
    secp256k1::{Message, Secp256k1},
    sighash::{EcdsaSighashType, SighashCache},
    transaction::Version,
    Address, Amount, Network, OutPoint, PrivateKey, Sequence, Transaction, TxIn, TxOut, Txid,
    Witness,
};

const DUST_LIMIT: i64 = 546;

#[derive(Debug, thiserror::Error)]
pub enum AnchorError {
    #[error("pre-broadcast: {0}")]
    PreBroadcast(String),
    /// Tx was built and may have been broadcast — caller must record txid+change.
    #[error("post-broadcast: {message}")]
    PostBroadcast {
        message: String,
        txid: String,
        change_vout: u32,
        change_value_sats: i64,
    },
}

pub struct AnchorInput {
    /// 64-char hex SHA256 hash (from build_anchor_hash)
    pub anchor_hash: String,
    pub wif: String,
    pub utxo_txid: String,
    pub utxo_vout: u32,
    pub utxo_value_sats: i64,
    pub fee_sats: i64,
    pub network: Network,
    pub mempool_broadcast_url: String,
    pub blockstream_broadcast_url: String,
}

#[derive(Debug)]
pub struct AnchorResult {
    pub txid: String,
    pub change_vout: u32,
    pub change_value_sats: i64,
}

pub async fn broadcast_anchor(input: AnchorInput) -> Result<AnchorResult, AnchorError> {
    let change_value = input.utxo_value_sats - input.fee_sats;
    if change_value < DUST_LIMIT {
        return Err(AnchorError::PreBroadcast(format!(
            "UTXO value {} sats is insufficient for fee {} + dust limit {}",
            input.utxo_value_sats, input.fee_sats, DUST_LIMIT
        )));
    }

    let tx = build_tx(&input).map_err(|e| AnchorError::PreBroadcast(e.to_string()))?;
    let tx_hex = bitcoin::consensus::encode::serialize_hex(&tx);
    let txid = tx.compute_txid().to_string();

    // Change output is at index 1 (OP_RETURN at 0, change at 1)
    let change_vout = 1u32;

    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| AnchorError::PostBroadcast {
            message: e.to_string(),
            txid: txid.clone(),
            change_vout,
            change_value_sats: change_value,
        })?;

    let broadcast_ok = broadcast_to(&http, &input.mempool_broadcast_url, &tx_hex).await
        || broadcast_to(&http, &input.blockstream_broadcast_url, &tx_hex).await;

    if !broadcast_ok {
        return Err(AnchorError::PostBroadcast {
            message: "Bitcoin broadcast failed on both mempool.space and Blockstream".into(),
            txid,
            change_vout,
            change_value_sats: change_value,
        });
    }

    Ok(AnchorResult { txid, change_vout, change_value_sats: change_value })
}

fn build_tx(input: &AnchorInput) -> Result<Transaction> {
    let secp = Secp256k1::new();
    let private_key = PrivateKey::from_wif(&input.wif)?;

    // bitcoin 0.32 requires CompressedPublicKey for p2wpkh
    let pub_key = private_key.public_key(&secp);
    let compressed_pub_key = CompressedPublicKey::try_from(pub_key)
        .map_err(|_| anyhow!("private key did not produce a compressed public key"))?;
    let hrp = KnownHrp::from(input.network);
    let address = Address::p2wpkh(&compressed_pub_key, hrp);

    // Decode 32-byte anchor hash and wrap in PushBytesBuf for push_slice
    let anchor_bytes = hex::decode(&input.anchor_hash)
        .map_err(|_| anyhow!("invalid anchor_hash hex"))?;
    let push_bytes = PushBytesBuf::try_from(anchor_bytes)
        .map_err(|_| anyhow!("anchor_hash too long for OP_RETURN push"))?;

    let op_return_script = Builder::new()
        .push_opcode(OP_RETURN)
        .push_slice(push_bytes)
        .into_script();

    let utxo_txid: Txid = input.utxo_txid.parse()?;
    let txin = TxIn {
        previous_output: OutPoint::new(utxo_txid, input.utxo_vout),
        sequence: Sequence::ENABLE_RBF_NO_LOCKTIME,
        ..Default::default()
    };

    let change_sats: u64 = (input.utxo_value_sats - input.fee_sats)
        .try_into()
        .map_err(|_| anyhow!("change value overflow"))?;

    let mut tx = Transaction {
        version: Version::TWO,
        lock_time: LockTime::ZERO,
        input: vec![txin],
        output: vec![
            TxOut { value: Amount::ZERO, script_pubkey: op_return_script },
            TxOut {
                value: Amount::from_sat(change_sats),
                script_pubkey: address.script_pubkey(),
            },
        ],
    };

    let utxo_script = address.script_pubkey();
    let utxo_amount = Amount::from_sat(
        input.utxo_value_sats.try_into()
            .map_err(|_| anyhow!("utxo value overflow"))?,
    );

    // Compute sighash before setting the witness (witness is empty at this point)
    let mut cache = SighashCache::new(&tx);
    let sighash = cache
        .p2wpkh_signature_hash(0, &utxo_script, utxo_amount, EcdsaSighashType::All)
        .map_err(|e| anyhow!("sighash error: {}", e))?;

    let message = Message::from_digest(sighash.to_byte_array());
    let sig = secp.sign_ecdsa(&message, &private_key.inner);
    let mut sig_bytes = sig.serialize_der().to_vec();
    sig_bytes.push(EcdsaSighashType::All as u8);

    let pub_key_bytes = compressed_pub_key.0.serialize().to_vec();
    tx.input[0].witness = Witness::from_slice(&[&sig_bytes, &pub_key_bytes]);
    Ok(tx)
}

async fn broadcast_to(client: &reqwest::Client, url: &str, tx_hex: &str) -> bool {
    client
        .post(url)
        .header("Content-Type", "text/plain")
        .body(tx_hex.to_string())
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pre_broadcast_error_on_insufficient_funds() {
        let input = AnchorInput {
            anchor_hash: "a".repeat(64),
            wif: "cNJFgo1driFnPcBdBX8BrJrpxchBWXwXCvNH5SoSkdcF6aFkoKqV".into(), // testnet WIF
            utxo_txid: "0".repeat(64),
            utxo_vout: 0,
            utxo_value_sats: 500, // less than fee + dust
            fee_sats: 1000,
            network: bitcoin::Network::Testnet,
            mempool_broadcast_url: "http://localhost".into(),
            blockstream_broadcast_url: "http://localhost".into(),
        };
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(broadcast_anchor(input));
        assert!(matches!(result, Err(AnchorError::PreBroadcast(_))));
    }
}
