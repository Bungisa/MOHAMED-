import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'icon.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
          'screenshot-mobile.png',
          'screenshot-desktop.png',
        ],
        manifest: {
          id: '/',
          name: 'ScanPro Studio — Document Scanner & PDF Editor',
          short_name: 'ScanPro',
          description:
            'Enterprise-grade document scanner, PDF editor, Word-to-PDF & PDF-to-Word converter, and OCR workbench.',
          theme_color: '#4A1D5E',
          background_color: '#FAF9FB',
          display: 'standalone',
          display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
          start_url: '/',
          scope: '/',
          orientation: 'any',
          lang: 'en',
          dir: 'ltr',
          categories: ['productivity', 'business', 'utilities'],
          prefer_related_applications: false,
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: 'icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any',
            },
          ],
          screenshots: [
            {
              src: 'screenshot-mobile.png',
              sizes: '540x960',
              type: 'image/png',
              form_factor: 'narrow',
              label: 'ScanPro Studio Smart Document Scanner & Auto-Crop',
            },
            {
              src: 'screenshot-desktop.png',
              sizes: '1280x720',
              type: 'image/png',
              form_factor: 'wide',
              label: 'ScanPro Studio PDF Editor & Word Conversion Workbench',
            },
          ],
          shortcuts: [
            {
              name: 'Scan Document',
              short_name: 'Scan',
              description: 'Capture and auto-crop a new document or receipt',
              url: '/?action=scan',
              icons: [{src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png'}],
            },
            {
              name: 'Edit PDF',
              short_name: 'PDF Editor',
              description: 'Annotate, sign, and redact PDF documents',
              url: '/?action=pdf-editor',
              icons: [{src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png'}],
            },
            {
              name: 'Word & PDF Converter',
              short_name: 'Convert',
              description: 'Convert Word to PDF or PDF to Word (.docx)',
              url: '/?action=pdf-tools',
              icons: [{src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png'}],
            },
          ],
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,mjs}'],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [/^\/api\//, /^\/\.well-known\//],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio to prevent WebSocket connection errors in the preview proxy.
      hmr: false,
      watch: null,
    },
  };
});
