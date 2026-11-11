const CACHE_NAME = 'elimikapdf-v5';
const SHARED_CACHE_NAME = 'elimikapdf-shared-files-v1';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/privacy-policy.html',
  '/manifest.webmanifest',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
  '/apple-touch-icon.png',
  '/assets/aistudio/WhatsApp_Image_2026-11-10_at_9.40.07_AM_beb423ac.jpeg',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME && key !== SHARED_CACHE_NAME) {
              return caches.delete(key);
            }
            return Promise.resolve();
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Handle Android / Desktop Web Share Target POST multipart/form-data requests
  if (
    request.method === 'POST' &&
    url.origin === self.location.origin &&
    (url.pathname === '/share-target' || url.searchParams.has('share-target'))
  ) {
    event.respondWith(
      (async () => {
        try {
          const formData = await request.formData();
          const files = formData.getAll('SharedFiles');
          if (files && files.length > 0) {
            const sharedCache = await caches.open(SHARED_CACHE_NAME);
            const fileEntry = files[0];
            if (fileEntry && typeof fileEntry.arrayBuffer === 'function') {
              const buf = await fileEntry.arrayBuffer();
              const headers = new Headers({
                'Content-Type': fileEntry.type || 'application/octet-stream',
                'X-Shared-Filename': encodeURIComponent(fileEntry.name || 'Shared_Document.pdf'),
              });
              await sharedCache.put(
                new Request('/__shared_file_latest'),
                new Response(buf, { status: 200, headers })
              );
            }
          }
        } catch {
          // Ignore form parse errors and proceed to app
        }
        return Response.redirect('/?shared=1', 303);
      })()
    );
    return;
  }

  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // Serve latest shared file to the client when requested
  if (url.pathname === '/__shared_file_latest') {
    event.respondWith(
      (async () => {
        const sharedCache = await caches.open(SHARED_CACHE_NAME);
        const match = await sharedCache.match('/__shared_file_latest');
        if (match) {
          await sharedCache.delete('/__shared_file_latest');
          return match;
        }
        return new Response('Not found', { status: 404 });
      })()
    );
    return;
  }

  // Never intercept Vite internal modules or API download routes
  if (
    url.pathname.startsWith('/@vite') ||
    url.pathname.startsWith('/@react-refresh') ||
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/node_modules/') ||
    url.pathname.startsWith('/api/')
  ) {
    return;
  }

  // Dedicated handling for /privacy-policy, /privacy, and /privacy-policy.html
  if (
    url.pathname === '/privacy-policy' ||
    url.pathname === '/privacy-policy/' ||
    url.pathname === '/privacy' ||
    url.pathname === '/privacy-policy.html'
  ) {
    event.respondWith(
      fetch('/privacy-policy.html').catch(async () => {
        const cached = await caches.match('/privacy-policy.html');
        if (cached) return cached;
        return fetch(request);
      })
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, cloned));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') {
          const fallback = await caches.match('/index.html');
          if (fallback) return fallback;
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      })
  );
});

// Background Sync support (PWABuilder Service Worker capability)
self.addEventListener('sync', (event) => {
  if (event.tag === 'elimikapdf-sync-vault') {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {}))
    );
  }
});

// Periodic Background Sync support (PWABuilder Service Worker capability)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'elimikapdf-periodic-sync') {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {}))
    );
  }
});

// Push Notification support (PWABuilder Service Worker capability)
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'ElimikaPDF';
  const options = {
    body: data.body || 'Your document is ready in ElimikaPDF.',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      return undefined;
    })
  );
});
