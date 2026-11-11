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
          'elimikapdf-icon.png',
          'privacy-policy.html',
          'sw-share-handler.js',
          'assets/aistudio/WhatsApp_Image_2026-11-10_at_9.40.07_AM_beb423ac.jpeg',
          'screenshot-mobile.png',
          'screenshot-desktop.png',
        ],
        manifest: {
          id: '/',
          name: 'ElimikaPDF — PDF, Word & Document Reader',
          short_name: 'ElimikaPDF',
          description:
            'Fast PDF & Word Reader, document scanner, PDF editor, Word-to-PDF & PDF-to-Word converter, and OCR workbench.',
          theme_color: '#003FE8',
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
              src: 'assets/aistudio/WhatsApp_Image_2026-11-10_at_9.40.07_AM_beb423ac.jpeg',
              sizes: '512x512',
              type: 'image/jpeg',
              purpose: 'any',
            },
          ],
          screenshots: [
            {
              src: 'screenshot-mobile.png',
              sizes: '540x960',
              type: 'image/png',
              form_factor: 'narrow',
              label: 'ElimikaPDF Smart Document Scanner & Auto-Crop',
            },
            {
              src: 'screenshot-desktop.png',
              sizes: '1280x720',
              type: 'image/png',
              form_factor: 'wide',
              label: 'ElimikaPDF Editor & Word Conversion Workbench',
            },
          ],
          shortcuts: [
            {
              name: 'Open PDF or Word',
              short_name: 'Read Doc',
              description: 'Open and read PDF or Word documents in full-screen Reader Mode',
              url: '/?action=pdf-reader',
              icons: [{src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png'}],
            },
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
          launch_handler: {
            client_mode: 'navigate-existing',
          },
          handle_links: 'preferred',
          edge_side_panel: {
            preferred_width: 420,
          },
          file_handlers: [
            {
              action: '/?action=open-file',
              accept: {
                'application/pdf': ['.pdf'],
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
                'application/msword': ['.doc'],
                'application/rtf': ['.rtf'],
                'text/rtf': ['.rtf'],
                'text/plain': ['.txt', '.md', '.csv'],
                'application/vnd.oasis.opendocument.text': ['.odt'],
                'image/png': ['.png'],
                'image/jpeg': ['.jpg', '.jpeg'],
                'image/webp': ['.webp'],
              },
            },
          ],
          share_target: {
            action: '/share-target',
            method: 'POST',
            enctype: 'multipart/form-data',
            params: {
              title: 'title',
              text: 'text',
              url: 'url',
              files: [
                {
                  name: 'SharedFiles',
                  accept: [
                    'application/pdf',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    'application/msword',
                    'application/rtf',
                    'text/rtf',
                    'text/plain',
                    'application/vnd.oasis.opendocument.text',
                    'image/png',
                    'image/jpeg',
                    'image/webp',
                    'image/*',
                    'application/octet-stream',
                    '*/*',
                  ],
                },
              ],
            },
          },
        },
        workbox: {
          importScripts: ['/sw-share-handler.js'],
          maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,mjs}'],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [
            /^\/api\//,
            /^\/\.well-known\//,
            /^\/privacy/,
            /^\/__shared_file_latest/,
          ],
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
          enabled: false,
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
