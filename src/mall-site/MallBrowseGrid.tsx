import React from 'react';
import { SearchX, Package } from 'lucide-react';
import { mallClient } from '../services/mallClient';
import type { MallProduct } from '../types/mall';
import { MallProductCard } from './MallProductCard';
import { ProductCardSkeleton } from './mallUi';

export const MallBrowseGrid: React.FC<{
  title: string;
  sub?: string;
  fetchKey: string;
  fetchFn: () => Promise<{ products: MallProduct[]; total: number }>;
  emptyTitle?: string;
}> = ({ title, sub, fetchKey, fetchFn, emptyTitle }) => {
  const [items, setItems] = React.useState<MallProduct[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchFn()
      .then((r) => { if (alive) { setItems(r.products); setTotal(r.total); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey]);

  return (
    <section>
      <div className="mb-3">
        <h1 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight">{title}</h1>
        {sub && <p className="text-xs sm:text-sm text-slate-400 font-medium">{sub}</p>}
        {!loading && total > 0 && <p className="text-[11px] text-slate-400 mt-0.5">{total} product{total === 1 ? '' : 's'}</p>}
      </div>
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2.5 sm:gap-3">
          {Array.from({ length: 12 }).map((_, i) => <ProductCardSkeleton key={i} />)}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-14 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900">
          {fetchKey.startsWith('search:') ? <SearchX className="w-9 h-9 mx-auto text-slate-300 dark:text-slate-600" /> : <Package className="w-9 h-9 mx-auto text-slate-300 dark:text-slate-600" />}
          <p className="mt-2 text-sm font-extrabold text-slate-700 dark:text-slate-200">{emptyTitle || 'No products found'}</p>
          <p className="text-xs text-slate-400 mt-1">Try a different search or category.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2.5 sm:gap-3">
          {items.map((p) => <MallProductCard key={p.id} product={p} />)}
        </div>
      )}
    </section>
  );
};

export function fetchSearch(q: string) {
  return () => mallClient.products({ q, limit: 60, offset: 0 });
}

export function fetchCategory(cat: string) {
  return () => mallClient.products({ category: cat, limit: 60, offset: 0 });
}
