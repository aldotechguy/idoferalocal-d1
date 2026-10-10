const DEV_RELOAD_KEY = 'idofera_dev_sw_cleanup_reload';
const APP_CACHE_PREFIX = 'idofera-pos-';

/**
 * Without this, a browser under storage pressure may evict the whole Cache
 * Storage -- silently turning the offline shell into a blank page the next time
 * a shopper loses signal. Persistent storage opts out of that eviction.
 * Best-effort: the prompt is only a hint, and a refusal must never break boot.
 */
function requestPersistentStorage(): void {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return;
  void navigator.storage.persist().catch(() => { /* declined by user or browser */ });
}

/**
 * Registers the offline worker for EVERY surface.
 *
 * This used to live inside usePWAInstall, which is only mounted by
 * PWAInstallBanner -- and that banner only renders in StaffApp. The Mall
 * therefore had no service worker at all: no shell precache, no offline
 * navigation, not installable. Registering here means the storefront and the
 * staff workspace share one worker, and it happens before React mounts so the
 * very first navigation is already under worker control.
 */
async function registerServiceWorker(): Promise<void> {
  // A worker must never cache Vite's versioned dev modules: mixing two React
  // module graphs after a dependency re-optimisation causes invalid hooks.
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (error) {
    console.warn('[PWA] ServiceWorker registration failed:', error);
  }
}

async function start() {
  try {
    const wasControlled = await clearDevelopmentServiceWorker();
    if (wasControlled && sessionStorage.getItem(DEV_RELOAD_KEY) !== 'done') {
      sessionStorage.setItem(DEV_RELOAD_KEY, 'done');
      window.location.reload();
      return;
    }
  } catch (error) {
    console.warn('[PWA] Development service worker cleanup failed:', error);
  }

  sessionStorage.removeItem(DEV_RELOAD_KEY);
  // Registered before the app mounts so the first paint is already covered.
  // Deliberately not awaited into the critical path: a failed or slow
  // registration must never delay the storefront from rendering.
  void registerServiceWorker();
  requestPersistentStorage();
  await import('./main.tsx');
}

void start();

async function clearDevelopmentServiceWorker(): Promise<boolean> {
  if (!import.meta.env.DEV || !('serviceWorker' in navigator)) return false;

  const wasControlled = Boolean(navigator.serviceWorker.controller);
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));

  if ('caches' in window) {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => name.startsWith(APP_CACHE_PREFIX))
      .map((name) => caches.delete(name)));
  }

  return wasControlled;
}
