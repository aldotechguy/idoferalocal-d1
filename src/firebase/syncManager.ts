import { broadcastTabChange, subscribeTabSync } from './services';

/**
 * The legacy Firebase live-sync manager is gone — the app syncs through the
 * storage API (PATCH micro-batches + snapshot reads). The only piece that is
 * still live is the cross-tab change broadcast, kept here so two open tabs of
 * the same store re-read each other's IndexedDB writes.
 */
export { broadcastTabChange, subscribeTabSync };

