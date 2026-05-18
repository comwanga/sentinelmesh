import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'SentinelMesh',
        short_name: 'SentinelMesh',
        description: 'Privacy-first community safety network',
        theme_color: '#0B0E14',
        background_color: '#0B0E14',
        display: 'standalone',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname.includes('/tiles/') || url.href.endsWith('.pmtiles'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'sm-tiles',
              expiration: { maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/api/') &&
              !url.pathname.startsWith('/api/circles') &&
              !url.pathname.startsWith('/api/location'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'sm-api',
              expiration: { maxAgeSeconds: 60 },
            },
          },
          {
            urlPattern: ({ url }) =>
              url.pathname.endsWith('.json') ||
              /\.(woff2?)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'sm-assets',
              expiration: { maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
        ],
      },
    }),
  ],
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
