import * as bitcoin from 'bitcoinjs-lib'
import ECPairFactory from 'ecpair'
import * as tinysecp from 'tiny-secp256k1'

const ECPair = ECPairFactory(tinysecp)

export class PreBroadcastError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PreBroadcastError'
  }
}

export class PostBroadcastError extends Error {
  constructor(
    message: string,
    public readonly txid: string,
    public readonly changeVout: number,
    public readonly changeValue: number,
  ) {
    super(message)
    this.name = 'PostBroadcastError'
  }
}

export interface AnchorInput {
  anchorHash: string   // 64-char hex = 32 bytes
  wif: string
  utxoTxid: string
  utxoVout: number
  utxoValue: number   // satoshis
  fee: number         // satoshis (from estimateFee)
  network: 'mainnet' | 'testnet'
}

export interface AnchorResult {
  txid: string
  changeVout: number
  changeValue: number
}

const DUST_LIMIT = 546  // P2WPKH minimum output in satoshis

const ENDPOINTS = {
  mainnet: {
    mempool: 'https://mempool.space/api/tx',
    blockstream: 'https://blockstream.info/api/tx',
  },
  testnet: {
    mempool: 'https://mempool.space/testnet/api/tx',
    blockstream: 'https://blockstream.info/testnet/api/tx',
  },
}

async function broadcastHex(url: string, txHex: string): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: txHex,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
}

export async function broadcastAnchor(input: AnchorInput): Promise<AnchorResult> {
  const changeValue = input.utxoValue - input.fee
  if (changeValue < DUST_LIMIT) {
    throw new PreBroadcastError(
      `UTXO value ${input.utxoValue} sats is insufficient for fee ${input.fee} + dust limit ${DUST_LIMIT}`,
    )
  }

  const btcNetwork = input.network === 'mainnet' ? bitcoin.networks.bitcoin : bitcoin.networks.testnet
  const keyPair = ECPair.fromWIF(input.wif, btcNetwork)
  const pubkey = Buffer.from(keyPair.publicKey)
  const p2wpkh = bitcoin.payments.p2wpkh({ pubkey, network: btcNetwork })
  const embed = bitcoin.payments.embed({ data: [Buffer.from(input.anchorHash, 'hex')] })

  const psbt = new bitcoin.Psbt({ network: btcNetwork })
  psbt.addInput({
    hash: input.utxoTxid,
    index: input.utxoVout,
    witnessUtxo: { script: p2wpkh.output!, value: input.utxoValue },
  })
  psbt.addOutput({ script: embed.output!, value: 0 })
  psbt.addOutput({ address: p2wpkh.address!, value: changeValue })
  psbt.signInput(0, keyPair)
  psbt.finalizeAllInputs()

  const tx = psbt.extractTransaction()
  const txHex = tx.toHex()
  const txid = tx.getId()
  const changeVout = tx.outs.findIndex(o => !o.script.equals(embed.output!))

  const eps = ENDPOINTS[input.network]
  let broadcastOk = false

  try {
    await broadcastHex(eps.mempool, txHex)
    broadcastOk = true
  } catch { /* try fallback */ }

  if (!broadcastOk) {
    try {
      await broadcastHex(eps.blockstream, txHex)
      broadcastOk = true
    } catch { /* both failed */ }
  }

  if (!broadcastOk) {
    throw new PostBroadcastError(
      'Bitcoin broadcast failed on both mempool.space and Blockstream',
      txid,
      changeVout,
      changeValue,
    )
  }

  return { txid, changeVout, changeValue }
}
