self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {}
  const title = data.title ?? 'SentinelMesh Alert'
  const options = {
    body: data.body ?? '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag: data.event_id ?? 'sentinel-alert',
    renotify: true,
    data: { url: data.url ?? '/' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      const match = windowClients.find(w => w.url === url && 'focus' in w)
      if (match) return match.focus()
      return clients.openWindow(url)
    })
  )
})
