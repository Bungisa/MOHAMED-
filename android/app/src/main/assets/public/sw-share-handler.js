const SHARED_CACHE_NAME = 'elimikapdf-shared-files-v1';

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Intercept Android / Desktop Web Share Target POST multipart/form-data requests
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
                'X-Shared-Filename': encodeURIComponent(
                  fileEntry.name || 'Shared_Document.pdf'
                ),
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

  // Serve latest shared file to the client when requested
  if (
    request.method === 'GET' &&
    url.origin === self.location.origin &&
    url.pathname === '/__shared_file_latest'
  ) {
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
  }
});
