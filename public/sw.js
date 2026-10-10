const CACHE_NAME = 'idofera-pos-v6';
// Read payloads the worker serves when the network fails. Kept under its own name
// so `activate` can preserve it while dropping stale asset caches.
const DATA_CACHE = 'idofera-mall-data-v1';
/** Bound on cached read payloads (one per catalog page/sort/filter). */
const DATA_CACHE_MAX = 60;
/** Cache names that survive activate: the asset/shell cache and the read payloads. */
const KEEP_CACHES = new Set([CACHE_NAME, DATA_CACHE]);
const STATIC_ASSETS = [
  '/manifest.json',
  '/manifest-staff.json',
  'https://idofera.de5.net/images/mall/logo/logo.png'
];
// The storefront shell. Precaching /index.html means a repeat visit paints the
// chrome immediately instead of waiting on the entry module; the scripts
// themselves stay network-first below, so this can never pair an old shell with
// a new runtime.
//
// /index.html alone cannot boot a SPA. PRECACHE_MANIFEST_URL is written by the
// post-build step (scripts/generate-precache-manifest.ts) and lists the hashed
// /assets files the boot chain needs, so an offline cold start has a complete,
// runnable shell rather than a blank or unstyled page.
const PRECACHE_MANIFEST_URL = '/precache-manifest.json';
const SHELL_ASSETS = ['/index.html'];

/** Every URL the shell precache wrote, so eviction can never take the shell. */
const precachedShell = new Set([...STATIC_ASSETS, ...SHELL_ASSETS]);

/** Adds everything the build says is needed to boot, plus the static assets. */
async function precacheShell() {
  const cache = await caches.open(CACHE_NAME);
  const urls = [...precachedShell];
  try {
    const response = await fetch(PRECACHE_MANIFEST_URL, { cache: 'no-store' });
    if (response.ok) {
      const manifest = await response.json();
      if (Array.isArray(manifest?.assets)) {
        for (const asset of manifest.assets) {
          if (typeof asset === 'string' && asset.startsWith('/assets/')) urls.push(asset);
        }
      }
    }
  } catch (err) {
    // Dev server, or a deployment that predates the manifest: the HTML-only
    // shell is still better than nothing.
    console.warn('[ServiceWorker] Precache manifest unavailable:', err);
  }
  // Record the shell before writing it. The precached files are the OLDEST
  // entries in the cache, so without this they are the first thing eviction
  // takes once the cap is reached -- which would break offline boot after
  // enough deployments rather than immediately.
  for (const url of urls) precachedShell.add(url);
  // addAll is all-or-nothing, so add one at a time: a single 404 on a stale
  // hashed name must not cost us the whole app shell.
  await Promise.all(urls.map((url) => cache.add(url).catch((err) => {
    console.warn('[ServiceWorker] Pre-cache skipped', url, err);
  })));
}

// Bound on cached executable assets. Without a cap Cache Storage grows forever
// across deployments, and a quota error on a phone silently drops the cache.
const ASSET_CACHE_MAX = 60;

/** Evicts oldest read payloads so catalog paging cannot grow the cache forever. */
async function trimDataCache() {
  try {
    const cache = await caches.open(DATA_CACHE);
    const keys = await cache.keys();
    if (keys.length <= DATA_CACHE_MAX) return;
    await Promise.all(keys.slice(0, keys.length - DATA_CACHE_MAX).map((key) => cache.delete(key)));
  } catch (err) {
    console.warn('[ServiceWorker] Data cache trim failed:', err);
  }
}

function withCacheMarker(headers, marker) {
  const next = new Headers(headers);
  next.set('X-From-Cache', marker);
  return next;
}

/** Honest offline body. The Mall has no IndexedDB write path; D1 is the authority. */
function offlineResponse() {
  return new Response(
    JSON.stringify({
      error: 'You appear to be offline.',
      message: 'Showing the last products loaded on this device. Reconnect to see live prices and stock.',
      offline: true
    }),
    { headers: { 'Content-Type': 'application/json' }, status: 503 }
  );
}

/** Evicts oldest-first until the cache is within ASSET_CACHE_MAX entries. */
async function trimAssetCache() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    if (keys.length <= ASSET_CACHE_MAX) return;
    const protectedPaths = precachedShell;
    const evictable = keys.filter((key) => {
      try {
        const path = new URL(key.url).pathname;
        return !protectedPaths.has(path) && !protectedPaths.has(key.url);
      } catch {
        return true;
      }
    });
    if (evictable.length <= ASSET_CACHE_MAX) return;
    // keys() is insertion-ordered, so the head is the oldest write.
    await Promise.all(evictable.slice(0, evictable.length - ASSET_CACHE_MAX).map((key) => cache.delete(key)));
  } catch (err) {
    console.warn('[ServiceWorker] Asset cache trim failed:', err);
  }
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Install event - Cache core app shell
//
// NO self.skipWaiting() here. A new release must NOT activate underneath a page
// that is still running the previous hashed modules: clients.claim() plus an
// immediate skipWaiting() can hand a live tab a new worker while its old module
// graph is still resident, which is the version-skew failure the network-first
// rule for executable assets exists to prevent. The waiting worker is activated
// by the page posting SKIP_WAITING (see the message handler above), or picked up
// naturally on the next cold load.
self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell());
});

// Activate event - Clean up old caches immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (!KEEP_CACHES.has(cache)) {
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
  // The path/extension/query extras cover the raw dev graph beyond the
  // pre-bundled deps so a stray source module is never served from cache.
  const isDevelopmentHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const isViteModule = url.pathname.startsWith('/src/')
    || url.pathname.startsWith('/@vite/')
    || url.pathname.startsWith('/@react-refresh')
    || url.pathname.startsWith('/@')
    || url.pathname.startsWith('/node_modules/')
    || url.pathname.startsWith('/node_modules/.vite/')
    || url.pathname.endsWith('.tsx')
    || url.pathname.endsWith('.ts')
    || url.searchParams.has('v')
    || url.searchParams.has('t');
  if (isDevelopmentHost || isViteModule) return;

  // Public catalog reads are the one place the worker, not the app, owns caching.
  // Network-first with a cache fallback, and every response carries an explicit
  // X-From-Cache marker so the UI can tell live data from a saved copy instead of
  // guessing. /home and /cart are deliberately NOT handled here: both are
  // session-scoped (/home returns this session's Buy Again history), so a
  // URL-keyed worker cache would leak one session's data into another on a shared
  // device. Those stay app-level, where resetSession() can evict them explicitly.
  if (url.pathname === '/api/mall/products' || url.pathname.startsWith('/api/mall/products?') || url.pathname.startsWith('/api/mall/products/')) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'opaque') {
            return networkResponse;
          }
          // Re-wrap so the marker can be added without disturbing the body the
          // page receives.
          const marked = new Response(networkResponse.body, {
            status: networkResponse.status,
            statusText: networkResponse.statusText,
            headers: new Headers(networkResponse.headers),
          });
          marked.headers.set('X-From-Cache', 'miss');
          const toStore = marked.clone();
          event.waitUntil(
            caches.open(DATA_CACHE)
              .then((cache) => cache.put(request, toStore))
              .then(trimDataCache)
          );
          return marked;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (!cached) return offlineResponse();
          const body = await cached.blob();
          return new Response(body, {
            status: 200,
            statusText: 'OK (from cache)',
            headers: withCacheMarker(cached.headers, 'hit'),
          });
        })
    );
    return;
  }

  // Handle API requests with Network First.
  //
  // The old body here claimed "Local data operations continue via IndexedDB",
  // which is false for the Mall: the storefront has no IndexedDB write path, and
  // D1 is the sole authority on price and stock. A failed read is now reported
  // honestly, and the client falls back to its own Cache Storage mirror of the
  // last-known-good catalog so a shopper on a bad link still sees the storefront.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() => {
        return new Response(
          JSON.stringify({
            error: 'You appear to be offline.',
            message: 'Showing the last products loaded on this device. Reconnect to see live prices and stock.',
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
            event.waitUntil(
              caches.open(CACHE_NAME)
                .then((cache) => cache.put(request, responseToCache))
                .then(trimAssetCache)
            );
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
          // Product photos are still hosted on images.unsplash.com, so they arrive
          // as OPAQUE responses (status 0, type 'opaque') for a cross-origin <img>.
          // Requiring `status === 200 && type === 'basic'` silently skipped every
          // one of them, which is why offline browsing showed no photos. Opaque
          // responses can be stored and replayed in Cache Storage -- the body just
          // cannot be inspected, which is acceptable for an <img> and lets the
          // worker's own immutable cache headers and a future R2 move take over.
          const isImage = request.destination === 'image';
          const isCacheable = isImage
            ? (networkResponse.type === 'opaque' || (networkResponse.status === 200 && networkResponse.type === 'basic'))
            : (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic');
          if (networkResponse && isCacheable) {
            const responseToCache = networkResponse.clone();
            event.waitUntil(
              caches.open(CACHE_NAME)
                .then((cache) => cache.put(request, responseToCache))
                .then(trimAssetCache)
            );
          }
          return networkResponse;
        })
        .catch(() => cachedResponse || new Response('Resource unavailable while offline.', { status: 503 }));

      return cachedResponse || fetchPromise;
    })
  );
});
