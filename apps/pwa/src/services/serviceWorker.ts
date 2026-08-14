export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return

  const hadController = Boolean(navigator.serviceWorker.controller)
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return
    reloading = true
    window.location.reload()
  })

  void navigator.serviceWorker.register('/sw.js').then(registration => {
    void registration.update()
  }).catch(() => {/* offline startup remains supported */})
}

export function unregisterServiceWorkers(): void {
  if (!('serviceWorker' in navigator)) return
  void navigator.serviceWorker.getRegistrations().then(registrations => {
    registrations.forEach(registration => void registration.unregister())
  }).catch(() => {/* non-fatal */})
}
