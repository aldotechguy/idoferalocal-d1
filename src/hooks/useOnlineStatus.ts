import { useSyncExternalStore } from 'react';

/**
 * Live connectivity, sourced from the browser so the first render is already
 * correct. `navigator.onLine` only reports whether an interface is up, so this is
 * a hint for the banner -- actual reachability is proven by the request
 * succeeding, and the Mall's read path already degrades to its cache on failure.
 */
function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

const getSnapshot = () => (typeof navigator === 'undefined' ? true : navigator.onLine);

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
