import { useEffect } from 'react'
import { loadOrCreateKeypair } from '../services/nostrService'

const API_BASE = import.meta.env['VITE_API_BASE_URL'] ?? ''
const VAPID_PUBLIC_KEY = import.meta.env['VITE_VAPID_PUBLIC_KEY'] ?? ''

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

export function usePushSubscription(): void {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !VAPID_PUBLIC_KEY) return

    async function subscribe() {
      try {
        const reg = await navigator.serviceWorker.ready
        const existing = await reg.pushManager.getSubscription()
        if (existing) return

        const permission = await Notification.requestPermission()
        if (permission !== 'granted') return

        const subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as BufferSource,
        })

        const keypair = loadOrCreateKeypair()
        const _ac = new AbortController()
        setTimeout(() => _ac.abort(), 15_000)
        await fetch(`${API_BASE}/api/push/subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: _ac.signal,
          body: JSON.stringify({
            subscription: subscription.toJSON(),
            nostr_pubkey: keypair.publicKey,
          }),
        })
      } catch {
        // push not available or user denied — non-fatal
      }
    }

    subscribe()
  }, [])
}
