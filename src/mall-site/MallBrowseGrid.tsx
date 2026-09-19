import React from 'react';
import { SearchX, Package } from 'lucide-react';
import { mallClient } from '../services/mallClient';
import type { MallCategory, MallProduct } from '../types/mall';
import { MallProductCard } from './MallProductCard';
import { ProductCardSkeleton } from './mallUi';
import { AsyncState } from '../components/common/AsyncState';
import { arrangeStockRows, mallGridColumns } from '../shared/mallStockRows';

const PAGE_SIZE = 10;

export type MallCatalogParams = { limit: number; offset: number; sort: string; brand?: string };
export type MallCatalogFetcher = (params: MallCatalogParams) => Promise<{
  products: MallProduct[]; total: number; brands?: MallCategory[];
  search?: { query: string; approximate: boolean };
}>;

const SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'popular', label: 'Popularity' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'newest', label: 'Newest' },
];

/**
 * Sorting, brand filtering and paging are ALL server-side, so they apply to the
 * complete catalog rather than only the products the browser happens to hold.
 */
export const MallBrowseGrid: React.FC<{
  title: string;
  sub?: string;
  fetchKey: string;
  fetchFn: MallCatalogFetcher;
  emptyTitle?: string;
  maxSoldOutPerRow?: number;
}> = ({ title, sub, fetchKey, fetchFn, emptyTitle, maxSoldOutPerRow }) => {
  const [columns, setColumns] = React.useState(() => mallGridColumns(typeof window === 'undefined' ? 0 : window.innerWidth));
  React.useEffect(() => {
    if (maxSoldOutPerRow === undefined) return;
    const resize = () => setColumns(mallGridColumns(window.innerWidth));
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [maxSoldOutPerRow]);
  const [items, setItems] = React.useState<MallProduct[]>([]);
  const [total, setTotal] = React.useState(0);
  const [brands, setBrands] = React.useState<MallCategory[]>([]);
  const [search, setSearch] = React.useState<{ query: string; approximate: boolean }>();
  const [sort, setSort] = React.useState('relevance');
  const [brand, setBrand] = React.useState('all');
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState('');
  const [moreError, setMoreError] = React.useState('');
  const nextOffset = React.useRef(0);
  const generation = React.useRef(0);
  const pendingMore = React.useRef(false);
  const [reload, setReload] = React.useState(0);

  // Callers pass a fresh fetcher each render; keep the latest without retriggering.
  const fetcher = React.useRef(fetchFn);
  fetcher.current = fetchFn;

  const request = React.useCallback((offset: number) => fetcher.current({
    limit: PAGE_SIZE,
    offset,
    sort,
    ...(brand !== 'all' ? { brand } : {}),
  }), [sort, brand]);

  React.useEffect(() => {
    let alive = true;
    generation.current += 1;
    pendingMore.current = false;
    setLoadingMore(false);
    setMoreError('');
    nextOffset.current = 0;
    setLoading(true);
    setError('');
    request(0)
      .then((result) => {
        if (!alive) return;
        setItems(result.products);
        nextOffset.current = result.products.length;
        setTotal(result.total);
        setBrands(result.brands ?? []);
        setSearch(result.search);
        setLoading(false);
      })
      .catch((reason) => {
        if (!alive) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setLoading(false);
      });
    return () => { alive = false; generation.current += 1; };
  }, [fetchKey, request, reload]);

  const loadMore = async () => {
    if (pendingMore.current || loading) return;
    const currentGeneration = generation.current;
    pendingMore.current = true;
    setLoadingMore(true);
    setMoreError('');
    try {
      const result = await request(nextOffset.current);
      if (currentGeneration !== generation.current) return;
      nextOffset.current += result.products.length;
      if (!result.products.length) nextOffset.current = result.total;
      // Guard against duplicates if the catalog shifted between page requests.
      setItems((previous) => {
        const seen = new Set(previous.map((product) => product.id));
        return [...previous, ...result.products.filter((product) => !seen.has(product.id))];
      });
      setTotal(result.total);
      setBrands(result.brands ?? []);
    } catch (reason) {
      if (currentGeneration === generation.current) setMoreError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (currentGeneration === generation.current) {
        pendingMore.current = false;
        setLoadingMore(false);
      }
    }
  };

  const hasMore = !loading && !error && items.length > 0 && nextOffset.current < total;

  return (
    <section>
      <div className="mb-3">
        <h1 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight">{title}</h1>
        {sub && <p className="text-xs sm:text-sm text-slate-400 font-medium">{sub}</p>}
        {!loading && !error && total > 0 && search?.approximate && <p role="status" className="text-sm text-amber-700 dark:text-amber-400">Similar matches for “{search.query}”</p>}
        {!loading && !error && <p role="status" className="text-[11px] text-slate-400 mt-0.5">Showing {items.length} of {total} product{total === 1 ? '' : 's'}</p>}
      </div>
      {!loading && !error && total > 0 && <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white/75 p-3">
        <label className="text-xs font-bold text-slate-600">Sort <select value={sort} onChange={(event) => setSort(event.target.value)} className="ml-1 h-9 rounded-lg border px-2 text-sm">{SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        {brands.length > 1 && <label className="text-xs font-bold text-slate-600">Brand <select value={brand} onChange={(event) => setBrand(event.target.value)} className="ml-1 h-9 rounded-lg border px-2 text-sm"><option value="all">All brands</option>{brands.map((option) => <option key={option.name} value={option.name}>{option.name} ({option.count})</option>)}</select></label>}
        <span className="ml-auto text-[11px] font-semibold text-slate-400">Out-of-stock products stay visible but cannot be purchased</span>
      </div>}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 sm:gap-3">
          {Array.from({ length: PAGE_SIZE }).map((_, index) => <ProductCardSkeleton key={index} />)}
        </div>
      ) : error ? (
        <AsyncState title="Products could not be loaded" message={error} onRetry={() => setReload((value) => value + 1)} />
      ) : items.length === 0 ? (
        <div className="text-center py-14 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900">
          {fetchKey.startsWith('search:') ? <SearchX className="w-9 h-9 mx-auto text-slate-300 dark:text-slate-600" /> : <Package className="w-9 h-9 mx-auto text-slate-300 dark:text-slate-600" />}
          <p className="mt-2 text-sm font-extrabold text-slate-700 dark:text-slate-200">{emptyTitle || 'No products found'}</p>
          <p className="text-xs text-slate-400 mt-1">Try a different search, brand or category.</p>
        </div>
      ) : maxSoldOutPerRow !== undefined ? (
        <div className="space-y-2.5 sm:space-y-3" aria-busy={loadingMore}>
          {arrangeStockRows<MallProduct>(items, columns, maxSoldOutPerRow).map((row, index) => (
            <div key={index} className="grid gap-2.5 sm:gap-3" style={{gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`}}>
              {row.map(product => <MallProductCard key={product.id} product={product} />)}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 sm:gap-3" aria-busy={loadingMore}>
          {items.map((product) => <MallProductCard key={product.id} product={product} />)}
        </div>
      )}
      {hasMore && <div className="mt-5 text-center">
        {moreError && <p role="alert" className="mb-2 text-sm text-red-600">Could not load more products. {moreError}</p>}
        <button type="button" onClick={loadMore} disabled={loadingMore} className="h-11 px-6 rounded-xl border border-amber-500 bg-white text-amber-700 text-sm font-extrabold disabled:opacity-50">
          {loadingMore ? 'Loading…' : moreError ? 'Retry loading more' : 'Load more products'}
        </button>
      </div>}
      {!loading && !error && !hasMore && items.length > 0 && <p className="mt-5 text-center text-sm text-slate-500">{items.length >= total ? `You’ve viewed all ${total} products.` : 'You’ve reached the end of this catalog. Refresh to see recent changes.'}</p>}
    </section>
  );
};

export function fetchSearch(q: string): MallCatalogFetcher {
  return (params) => mallClient.products({ q, ...params });
}

export function fetchCategory(cat: string): MallCatalogFetcher {
  return (params) => mallClient.products({ category: cat, ...params });
}
