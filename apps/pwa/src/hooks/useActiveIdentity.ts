import { useSyncExternalStore } from 'react'
import { getActiveIdentity, subscribeActiveIdentity } from '../services/signerService'

export function useActiveIdentity() {
  return useSyncExternalStore(subscribeActiveIdentity, getActiveIdentity, getActiveIdentity)
}
