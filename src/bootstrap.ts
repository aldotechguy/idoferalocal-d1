const DEV_RELOAD_KEY = 'idofera_dev_sw_cleanup_reload';
const APP_CACHE_PREFIX = 'idofera-pos-';

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
  await import('./main.tsx');
}

void start();