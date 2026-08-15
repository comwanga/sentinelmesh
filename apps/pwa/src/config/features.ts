function enabled(value: string | undefined): boolean {
  return value?.toLowerCase() === 'true'
}

export const experimentalFeatures = Object.freeze({
  acoustic: enabled(import.meta.env.VITE_ENABLE_EXPERIMENTAL_ACOUSTIC),
  insights: enabled(import.meta.env.VITE_ENABLE_EXPERIMENTAL_INSIGHTS),
  photos: enabled(import.meta.env.VITE_ENABLE_EXPERIMENTAL_PHOTOS),
  routing: enabled(import.meta.env.VITE_ENABLE_EXPERIMENTAL_ROUTING),
})

// Family Circles is a core feature (always available). Circle location sharing
// stays behind its own gate.
export const safeCircleLocationEnabled = enabled(import.meta.env.VITE_ENABLE_SAFE_CIRCLE_LOCATION)

// Chat (NIP-29 public channels + NIP-17/NIP-59 encrypted DMs and Circle rooms).
// Disabled by default; enables the chat foundation modules and future UI.
export const chatEnabled = enabled(import.meta.env.VITE_ENABLE_CHAT)
