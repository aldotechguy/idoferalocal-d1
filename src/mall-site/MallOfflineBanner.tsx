import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

/**
 * Storefront connectivity banner. `stale` is the case that matters: the shopper
 * may well be online, but the products on screen came from the offline cache, so
 * the copy says "saved products" rather than falsely claiming they are
 * disconnected. Checkout is unaffected either way -- D1 re-validates price and
 * stock inside the atomic order batch, so nothing can be bought from stale data.
 */
export const MallOfflineBanner: React.FC<{ stale?: boolean }> = ({ stale = false }) => {
  const isOnline = useOnlineStatus();
  if (isOnline && !stale) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-amber-500 px-3 py-2 text-center text-[12px] font-extrabold text-white shadow"
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        {isOnline
          ? 'Showing saved products — prices and stock will refresh automatically.'
          : "You're offline. Browsing saved products — reconnect to pay."}
      </span>
    </div>
  );
};
