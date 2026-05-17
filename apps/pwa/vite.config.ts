import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: 'react-map-gl/maplibre', replacement: resolve('node_modules/react-map-gl/dist/maplibre.js') },
      { find: 'react-map-gl/mapbox',   replacement: resolve('node_modules/react-map-gl/dist/maplibre.js') },
      { find: 'react-map-gl',          replacement: resolve('node_modules/react-map-gl/dist/maplibre.js') },
    ],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true, changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
})
