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
        theme_color: '#F7F8F3',
        background_color: '#F7F8F3',
        display: 'standalone',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        importScripts: ['/push-sw.js'],
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,woff2}'],
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
            handler: 'NetworkFirst',
            options: {
              cacheName: 'sm-api',
              networkTimeoutSeconds: 3,
              expiration: { maxAgeSeconds: 60 },
              plugins: [{ handlerDidError: async () => new Response('{"events":[]}', { headers: { 'Content-Type': 'application/json' } }) }],
            },
          },
          {
            urlPattern: ({ url, request }) =>
              request.method === 'GET' && url.pathname.startsWith('/api/reports'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'sm-api',
              networkTimeoutSeconds: 3,
              expiration: { maxAgeSeconds: 60 },
              plugins: [{ handlerDidError: async () => new Response('{"reports":[]}', { headers: { 'Content-Type': 'application/json' } }) }],
            },
          },
          {
            urlPattern: ({ url }) => /\.(woff2?)$/.test(url.pathname),
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
      '/api': process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000',
      '/ws': { target: process.env.VITE_WS_PROXY_TARGET ?? 'ws://localhost:3000', ws: true, changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
})
