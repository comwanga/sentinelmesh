import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: {
        name: 'SentinelMesh',
        short_name: 'SentinelMesh',
        description: 'Privacy-first community safety network',
        id: '/',
        start_url: '/',
        scope: '/',
        lang: 'en',
        theme_color: '#0B0E14',
        background_color: '#0B0E14',
        display: 'standalone',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        importScripts: ['/push-sw.js'],
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
            urlPattern: ({ url, request }) =>
              request.method === 'GET' && url.pathname.startsWith('/api/events'),
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
