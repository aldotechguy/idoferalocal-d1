import { useEffect, useState } from 'react';
import { staffMallClient } from '../services/staffMallClient';
import type { UserProfile } from '../types';

export type CommittedStock = {
  units: number;
  costKobo: number;
  orders: number;
  byStatus: { status: string; orders: number; units: number; costKobo: number }[];
};

const ROLES = ['Administrator', 'Store Manager', 'Accountant'];

/**
 * Committed (escrow) Mall stock: inventory reserved by Mall orders that has already
 * left `products.stock_qty` at checkout but has not become a Sale/receivable yet.
 * It is deliberately absent from every client-side inventory/revenue reducer, so
 * the dashboard would otherwise show the shortfall with no explanation. Polled
 * from the staff operations endpoint (the same payload the Mall console uses),
 * which is cached for ~20s server-side, so N open tabs cost one aggregate.
 *
 * Returns null while unavailable (non-management role, worker unreachable, first
 * poll pending) so the caller renders nothing rather than a misleading zero.
 */
export function useCommittedMallStock(currentUser: UserProfile | null | undefined, refreshMs = 120_000): CommittedStock | null {
  const allowed = Boolean(currentUser && ROLES.includes(currentUser.role));
  const [committed, setCommitted] = useState<CommittedStock | null>(null);
  useEffect(() => {
    if (!allowed) { setCommitted(null); return; }
    let cancelled = false;
    const load = () => {
      staffMallClient.operations()
        .then((data: any) => { if (!cancelled && data?.committedStock) setCommitted(data.committedStock as CommittedStock); })
        .catch(() => { /* worker unreachable: keep the last value, render nothing on first failure */ });
    };
    load();
    const timer = setInterval(load, refreshMs);
    return () => { cancelled = true; clearInterval(timer); };
  }, [allowed, refreshMs]);
  return committed;
}
