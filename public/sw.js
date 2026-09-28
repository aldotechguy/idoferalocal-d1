const CACHE_NAME = 'idofera-pos-v3';
const STATIC_ASSETS = [
  '/manifest.json',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png'
];

// Install event - Cache core app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[ServiceWorker] Pre-cache partial failure:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate event - Clean up old caches immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - Serve from network/cache depending on request type
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests or external extensions
  if (request.method !== 'GET' || !url.protocol.startsWith('http')) {
    return;
  }

  // Never cache Vite dev server modules, pre-bundled deps, or HMR scripts
  if (
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/node_modules/') ||
    url.pathname.startsWith('/@') ||
    url.pathname.endsWith('.tsx') ||
    url.pathname.endsWith('.ts') ||
    url.searchParams.has('v') ||
    url.searchParams.has('t')
  ) {
    return;
  }

  // Handle API requests with Network First
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() => {
        return new Response(
          JSON.stringify({
            error: 'Offline Mode Active',
            message: 'You are currently offline. Local data operations continue via IndexedDB.',
            offline: true
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 503
          }
        );
      })
    );
    return;
  }

  // Always check the network for HTML navigation
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Network First with cache fallback for production static assets to prevent version skew
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        const contentType = networkResponse.headers.get('content-type') || '';
        const isExecutableAsset = request.destination === 'script' || request.destination === 'style';
        const validAsset = !isExecutableAsset || !contentType.includes('text/html');
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic' && validAsset) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => caches.match(request))
  );
});
