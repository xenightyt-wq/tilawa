import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Connect, Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Un fichier absent sous /models/ ou /ort/ doit répondre 404 (et non la page
 * de l'app) : transformers.js teste des fichiers optionnels et prendrait le
 * HTML pour une configuration.
 */
function strict404(): Plugin {
  const mw =
    (root: string): Connect.NextHandleFunction =>
    (req, res, next) => {
      const path = decodeURIComponent((req.url ?? '').split('?')[0]);
      if (/^\/(models|ort)\//.test(path) && !existsSync(join(root, path))) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      next();
    };
  return {
    name: 'strict-404-models',
    configureServer: (s) => void s.middlewares.use(mw(join(s.config.root, 'public'))),
    configurePreviewServer: (s) => void s.middlewares.use(mw(join(s.config.root, 'dist'))),
  };
}

const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:8000';


export default defineConfig({
  plugins: [
    strict404(),
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
        navigateFallbackDenylist: [/^\/api\//, /^\/ws\//, /^\/models\//, /^\/ort\//],
        // Moteur ONNX : précaché à part, au premier usage (le modèle est mis en
        // cache par transformers.js lui-même).
        globIgnores: ['ort/**', 'models/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/ort/'),
            handler: 'CacheFirst',
            options: { cacheName: 'ort-runtime', expiration: { maxEntries: 20 } },
          },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@huggingface/transformers', 'onnxruntime-web'] },
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
