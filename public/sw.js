const CACHE_NAME = 'idofera-pos-v4';
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
      console.log('[ServiceWorker] Pre-caching App Shell');
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[ServiceWorker] Pre-cache partial failure:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate event - Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[ServiceWorker] Removing old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - Serve from cache/network depending on request type
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Staff navigation must always pass the server gate, including when offline.
  if (/^\/(labs|app)(\/|$)/.test(url.pathname)) {
    event.respondWith(fetch(request).catch(() => Response.redirect(new URL('/', url).href, 302)));
    return;
  }

  // Skip non-GET requests or external extensions
  if (request.method !== 'GET' || !url.protocol.startsWith('http')) {
    return;
  }

  // Never intercept Vite's development graph. Caching these versioned modules
  // can pair ReactDOM with a stale React dispatcher and trigger invalid hooks.
  const isDevelopmentHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const isViteModule = url.pathname.startsWith('/src/')
    || url.pathname.startsWith('/@vite/')
    || url.pathname.startsWith('/@react-refresh')
    || url.pathname.startsWith('/node_modules/.vite/');
  if (isDevelopmentHost || isViteModule) return;

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

  // Always check the network for HTML so a new deployment cannot retain an
  // index page that points at an expired hashed JavaScript bundle.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', responseToCache)));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cached = await caches.match('/index.html');
          return cached || new Response('Idofera is offline. Reconnect and try again.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        })
    );
    return;
  }

  // Executable assets are network-first so a deployment can never combine an
  // old module with a new runtime. Other static assets remain stale-while-revalidate.
  const isExecutableAsset = request.destination === 'script' || request.destination === 'style';
  if (isExecutableAsset) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          const contentType = networkResponse.headers.get('content-type') || '';
          if (networkResponse.status === 200 && networkResponse.type === 'basic' && !contentType.includes('text/html')) {
            const responseToCache = networkResponse.clone();
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache)));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || new Response('Asset unavailable while offline.', { status: 503 });
        })
    );
    return;
  }

  // Handle non-executable static assets with stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache)));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse || new Response('Resource unavailable while offline.', { status: 503 }));

      return cachedResponse || fetchPromise;
    })
  );
});
