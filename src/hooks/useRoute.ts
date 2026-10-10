import { useSyncExternalStore, useCallback } from 'react';

export type PublicRoute =
  | { surface: 'mall'; page: 'home' | 'category' | 'search' | 'product' | 'checkout' | 'orders' | 'success'; param?: string }
  | { surface: 'staff'; staffPage?: string; legacyPath?: boolean };

export function parseRoute(pathname: string, search: string): PublicRoute {
  const path = (pathname || '/').replace(/\/+$/, '') || '/';
  if (path === '/labs' || path.startsWith('/labs/')) {
    const rest = path.slice('/labs'.length).replace(/^\//, '');
    return { surface: 'staff', staffPage: rest || undefined };
  }
  if (path === '/app' || path.startsWith('/app/')) {
    const rest = path.slice('/app'.length).replace(/^\//, '');
    return { surface: 'staff', staffPage: rest || undefined, legacyPath: true };
  }
  const params = new URLSearchParams(search || '');
  if (path.startsWith('/category/')) {
    return { surface: 'mall', page: 'category', param: decodeURIComponent(path.slice('/category/'.length)) };
  }
  if (path.startsWith('/product/')) {
    return { surface: 'mall', page: 'product', param: decodeURIComponent(path.slice('/product/'.length)) };
  }
  if (path === '/search') return { surface: 'mall', page: 'search', param: params.get('q') || '' };
  if (path === '/checkout') return { surface: 'mall', page: 'checkout' };
  if (path === '/orders') return { surface: 'mall', page: 'orders' };
  if (path === '/order-success') return { surface: 'mall', page: 'success' };
  return { surface: 'mall', page: 'home' };
}

function subscribe(cb: () => void) {
  window.addEventListener('popstate', cb);
  return () => window.removeEventListener('popstate', cb);
}

const serverRoute: PublicRoute = { surface: 'mall', page: 'home' };
let cachedLocation: string | undefined;
let cachedRoute: PublicRoute = serverRoute;

function getSnapshot(): PublicRoute {
  const location = window.location.pathname + window.location.search;
  // React requires the same snapshot reference until the location changes.
  if (location !== cachedLocation) {
    cachedRoute = parseRoute(window.location.pathname, window.location.search);
    cachedLocation = location;
  }
  return cachedRoute;
}

function getServerSnapshot(): PublicRoute {
  return serverRoute;
}

export function navigateMall(to: string) {
  window.history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({ top: 0 });
}

export function navigateStaff(page: string, replace = false) {
  const target = `/labs/${encodeURIComponent(page || 'dashboard')}`;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', target);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({ top: 0, behavior: 'auto' });
}

export function useRoute(): PublicRoute {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useNavigateMall() {
  return useCallback((to: string) => navigateMall(to), []);
}
