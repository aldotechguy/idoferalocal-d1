import React from 'react';
import { SearchX, Package } from 'lucide-react';
import { mallClient } from '../services/mallClient';
import type { MallProduct } from '../types/mall';
import { MallProductCard } from './MallProductCard';
import { ProductCardSkeleton } from './mallUi';
import { AsyncState } from '../components/common/AsyncState';

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
  const [error, setError] = React.useState('');
  const [sort, setSort] = React.useState<'relevance' | 'popular' | 'price-asc' | 'price-desc'>('relevance');
  const [brand, setBrand] = React.useState('all');
  const [availableOnly, setAvailableOnly] = React.useState(true);
  const [visible, setVisible] = React.useState(18);
  const [reload, setReload] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    setVisible(18);
    fetchFn()
      .then((r) => { if (alive) { setItems(r.products); setTotal(r.total); setLoading(false); } })
      .catch((reason) => { if (alive) { setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey, reload]);

  const brands = React.useMemo(() => [...new Set(items.map((item) => item.brand).filter(Boolean) as string[])].sort(), [items]);
  const filtered = React.useMemo(() => {
    const result = items.filter((item) => (!availableOnly || item.available) && (brand === 'all' || item.brand === brand));
    if (sort === 'popular') result.sort((a, b) => b.sold - a.sold);
    if (sort === 'price-asc') result.sort((a, b) => a.price - b.price);
    if (sort === 'price-desc') result.sort((a, b) => b.price - a.price);
    return result;
  }, [availableOnly, brand, items, sort]);

  return (
    <section>
      <div className="mb-3">
        <h1 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight">{title}</h1>
        {sub && <p className="text-xs sm:text-sm text-slate-400 font-medium">{sub}</p>}
        {!loading && total > 0 && <p className="text-[11px] text-slate-400 mt-0.5">{total} product{total === 1 ? '' : 's'}</p>}
      </div>
      {!loading && !error && items.length > 0 && <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white/75 p-3">
        <label className="text-xs font-bold text-slate-600">Sort <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="ml-1 h-9 rounded-lg border px-2 text-sm"><option value="relevance">Relevance</option><option value="popular">Popularity</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option></select></label>
        {brands.length > 1 && <label className="text-xs font-bold text-slate-600">Brand <select value={brand} onChange={(e) => setBrand(e.target.value)} className="ml-1 h-9 rounded-lg border px-2 text-sm"><option value="all">All brands</option>{brands.map((value) => <option key={value}>{value}</option>)}</select></label>}
        <label className="ml-auto inline-flex min-h-9 items-center gap-2 text-xs font-bold text-slate-600"><input type="checkbox" checked={availableOnly} onChange={(e) => setAvailableOnly(e.target.checked)} /> In stock only</label>
      </div>}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2.5 sm:gap-3">
          {Array.from({ length: 12 }).map((_, i) => <ProductCardSkeleton key={i} />)}
        </div>
      ) : error ? (
        <AsyncState title="Products could not be loaded" message={error} onRetry={() => setReload((value) => value + 1)} />
      ) : filtered.length === 0 ? (
        <div className="text-center py-14 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900">
          {fetchKey.startsWith('search:') ? <SearchX className="w-9 h-9 mx-auto text-slate-300 dark:text-slate-600" /> : <Package className="w-9 h-9 mx-auto text-slate-300 dark:text-slate-600" />}
          <p className="mt-2 text-sm font-extrabold text-slate-700 dark:text-slate-200">{emptyTitle || 'No products found'}</p>
          <p className="text-xs text-slate-400 mt-1">Try a different search or category.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2.5 sm:gap-3">
          {filtered.slice(0, visible).map((p) => <MallProductCard key={p.id} product={p} />)}
        </div>
      )}
      {!loading && !error && visible < filtered.length && <div className="mt-5 text-center"><button type="button" onClick={() => setVisible((value) => value + 18)} className="h-11 px-6 rounded-xl border border-amber-500 bg-white text-amber-700 text-sm font-extrabold">Load more products</button></div>}
    </section>
  );
};

export function fetchSearch(q: string) {
  return () => mallClient.products({ q, limit: 60, offset: 0 });
}

export function fetchCategory(cat: string) {
  return () => mallClient.products({ category: cat, limit: 60, offset: 0 });
}
