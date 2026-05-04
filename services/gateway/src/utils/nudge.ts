import { config } from '../config'

export async function nudgeBlockchain(): Promise<void> {
  if (!config.blockchainServiceUrl) return
  try {
    await fetch(config.blockchainServiceUrl + '/internal/nudge', {
      method: 'POST',
      signal: AbortSignal.timeout(500),
    })
  } catch { /* advisory — ignore */ }
}
