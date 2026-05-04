import * as bitcoin from 'bitcoinjs-lib'
import ECPairFactory from 'ecpair'
import * as tinysecp from 'tiny-secp256k1'

const ECPair = ECPairFactory(tinysecp)

export interface AnchorInput {
  anchorHash: string      // 64-char hex = 32 bytes
  wif: string
  utxoTxid: string
  utxoVout: number
  utxoValue: number       // satoshis
  changeAddress: string
  network: 'mainnet' | 'testnet'
}

const FEE_SATS = 2000

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

async function broadcastHex(url: string, txHex: string): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: txHex,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  return (await res.text()).trim()
}

export async function broadcastAnchor(input: AnchorInput): Promise<string> {
  const btcNetwork = input.network === 'mainnet' ? bitcoin.networks.bitcoin : bitcoin.networks.testnet
  const keyPair = ECPair.fromWIF(input.wif, btcNetwork)
  const pubkey = Buffer.from(keyPair.publicKey)

  const p2wpkh = bitcoin.payments.p2wpkh({ pubkey, network: btcNetwork })
  const embed = bitcoin.payments.embed({ data: [Buffer.from(input.anchorHash, 'hex')] })

  const psbt = new bitcoin.Psbt({ network: btcNetwork })

  psbt.addInput({
    hash: input.utxoTxid,
    index: input.utxoVout,
    witnessUtxo: {
      script: p2wpkh.output!,
      value: input.utxoValue,
    },
  })

  psbt.addOutput({ script: embed.output!, value: 0 })
  psbt.addOutput({ address: input.changeAddress, value: input.utxoValue - FEE_SATS })

  psbt.signInput(0, keyPair)
  psbt.finalizeAllInputs()
  const txHex = psbt.extractTransaction().toHex()

  const eps = ENDPOINTS[input.network]

  try {
    return await broadcastHex(eps.mempool, txHex)
  } catch {
    try {
      return await broadcastHex(eps.blockstream, txHex)
    } catch {
      throw new Error('Bitcoin broadcast failed on both mempool.space and Blockstream')
    }
  }
}
