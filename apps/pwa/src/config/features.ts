function enabled(value: string | undefined): boolean {
  return value?.toLowerCase() === 'true'
}

export const experimentalFeatures = Object.freeze({
  acoustic: enabled(import.meta.env.VITE_ENABLE_EXPERIMENTAL_ACOUSTIC),
  circles: enabled(import.meta.env.VITE_ENABLE_EXPERIMENTAL_CIRCLES),
  insights: enabled(import.meta.env.VITE_ENABLE_EXPERIMENTAL_INSIGHTS),
  photos: enabled(import.meta.env.VITE_ENABLE_EXPERIMENTAL_PHOTOS),
  routing: enabled(import.meta.env.VITE_ENABLE_EXPERIMENTAL_ROUTING),
})
