import { useCallback, useEffect, useState } from 'react'
import { sha256Hex, signNip98AuthEvent } from '../services/nostrService'

const API_BASE = import.meta.env['VITE_API_BASE_URL'] ?? ''
const VAPID_PUBLIC_KEY = import.meta.env['VITE_VAPID_PUBLIC_KEY'] ?? ''
const PREFERENCES_KEY = 'sentinelmesh-push-perimeter-v1'

export type PushSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
export interface PushPreferences { minSeverity: PushSeverity; radiusKm: number; center: { lat: number; lng: number } | null }
export type PushState = 'unsupported' | 'idle' | 'enabled' | 'denied' | 'working' | 'error'

export function loadPushPreferences(): PushPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? 'null') as PushPreferences | null
    if (value && matchesSeverity(value.minSeverity) && value.radiusKm >= 1 && value.radiusKm <= 100
      && value.center && Math.abs(value.center.lat) <= 90 && Math.abs(value.center.lng) <= 180) return value
  } catch { /* ignore invalid local preferences */ }
  return { minSeverity: 'HIGH', radiusKm: 15, center: null }
}

function matchesSeverity(value: string): value is PushSeverity {
  return ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(value)
}

function urlBase64ToUint8Array(value: string): Uint8Array {
  const padded = value + '='.repeat((4 - value.length % 4) % 4)
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, char => char.charCodeAt(0))
}

function currentPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
    position => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }), reject,
    { enableHighAccuracy: false, timeout: 12_000, maximumAge: 300_000 },
  ))
}

async function request(method: 'POST' | 'DELETE', body: string): Promise<void> {
  const url = new URL('/api/push/subscribe', API_BASE || window.location.origin).toString()
  const auth = await signNip98AuthEvent(url, method, await sha256Hex(body))
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-Nostr-Auth': JSON.stringify(auth) }, body, signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`Alert service rejected the request (${response.status})`)
}

export function usePushSubscription(vapidPublicKey = VAPID_PUBLIC_KEY) {
  const supported = typeof Notification !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && Boolean(vapidPublicKey)
  const [state, setState] = useState<PushState>(supported ? 'idle' : 'unsupported')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!supported) return
    if (Notification.permission === 'denied') { setState('denied'); return }
    const saved = loadPushPreferences()
    if (!localStorage.getItem(PREFERENCES_KEY) || !saved.center) return
    void navigator.serviceWorker.ready.then(registration => registration.pushManager.getSubscription()).then(subscription => {
      if (!subscription) { setState('idle'); return }
      const body = JSON.stringify({
        subscription: subscription.toJSON(), min_severity: saved.minSeverity,
        center_lat: saved.center!.lat, center_lng: saved.center!.lng, radius_km: saved.radiusKm,
      })
      return request('POST', body).then(() => setState('enabled'))
    }).catch(() => setState('error'))
  }, [supported])

  const enable = useCallback(async (preferences: PushPreferences) => {
    if (!supported || !preferences.center) return
    setState('working'); setError(null)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setState(permission === 'denied' ? 'denied' : 'idle'); return }
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource,
      })
      await request('POST', JSON.stringify({
        subscription: subscription.toJSON(), min_severity: preferences.minSeverity,
        center_lat: Number(preferences.center.lat.toFixed(2)), center_lng: Number(preferences.center.lng.toFixed(2)), radius_km: preferences.radiusKm,
      }))
      const coarsePreferences = { ...preferences, center: {
        lat: Number(preferences.center.lat.toFixed(2)), lng: Number(preferences.center.lng.toFixed(2)),
      } }
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(coarsePreferences))
      setState('enabled')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not enable alerts'); setState('error')
    }
  }, [supported, vapidPublicKey])

  const disable = useCallback(async () => {
    if (!supported) return
    setState('working'); setError(null)
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        await request('DELETE', JSON.stringify({ endpoint: subscription.endpoint }))
        await subscription.unsubscribe()
      }
      localStorage.removeItem(PREFERENCES_KEY)
      setState('idle')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not disable alerts'); setState('error')
    }
  }, [supported])

  return { state, error, enable, disable, locate: currentPosition }
}
