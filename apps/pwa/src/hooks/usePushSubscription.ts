import { useEffect } from 'react'
import { signNip98AuthEvent } from '../services/nostrService'

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

        const url = new URL('/api/push/subscribe', API_BASE || window.location.origin).toString()
        const authEvent = await signNip98AuthEvent(url, 'POST')
        const _ac = new AbortController()
        setTimeout(() => _ac.abort(), 15_000)
        await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Nostr-Auth': JSON.stringify(authEvent),
          },
          signal: _ac.signal,
          body: JSON.stringify({
            subscription: subscription.toJSON(),
          }),
        })
      } catch {
        // push not available or user denied — non-fatal
      }
    }

    subscribe()
  }, [])
}
