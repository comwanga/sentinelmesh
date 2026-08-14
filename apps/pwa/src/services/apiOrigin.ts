const API_BASE = import.meta.env['VITE_API_BASE_URL'] as string | undefined

export function websocketBaseUrl(): string {
  const base = new URL(API_BASE || window.location.origin, window.location.origin)
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  base.pathname = ''
  base.search = ''
  base.hash = ''
  return base.toString().replace(/\/$/, '')
}
