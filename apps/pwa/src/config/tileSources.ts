export const TILE_SOURCE = {
  stadia: (import.meta.env.VITE_MAP_TILE_URL as string | undefined) ??
    'https://tiles.stadiamaps.com/data/openmaptiles.json',
  glyphs: 'https://tiles.stadiamaps.com/fonts/{fontstack}/{range}.pbf',
} as const
