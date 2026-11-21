import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:8000';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'icons/*.svg', 'pcm-worklet.js'],
      manifest: {
        name: 'Tilawa — récitation du Coran',
        short_name: 'Tilawa',
        description: 'Réciter le Coran à voix haute avec correction en temps réel',
        lang: 'fr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f6f3ea',
        theme_color: '#0f5c4d',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Texte du Coran (≈ 2 Mo) + police précachés : fonctionne hors ligne.
        globPatterns: ['**/*.{js,css,html,woff2,png,svg}', 'data/quran.json', 'pcm-worklet.js'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api\//, /^\/ws\//],
      },
    }),
  ],
  server: {
    host: true,
    proxy: {
      '/api': BACKEND,
      '/ws': { target: BACKEND.replace(/^http/, 'ws'), ws: true },
    },
  },
  preview: {
    host: true,
    proxy: {
      '/api': BACKEND,
      '/ws': { target: BACKEND.replace(/^http/, 'ws'), ws: true },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
