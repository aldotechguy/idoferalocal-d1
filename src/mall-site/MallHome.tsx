import React from 'react';
import { RefreshCw } from 'lucide-react';
import { useMall } from '../context/MallContext';
import { MallHero } from './MallHero';
import { MallTrustRow, MallHelpStrip } from './MallTrustRow';
import { MallFlashSales, MallCategoryTiles, MallRail, RailIcons } from './MallSections';
import { MallProductCard } from './MallProductCard';
import { discountPct } from './mallUi';

export const MallHome: React.FC = () => {
  const { products, loading, refreshProducts } = useMall();
  const list = products?.products ?? [];
  const cats = React.useMemo(() => {
    return (products?.categories ?? []).map((c) => (typeof c === 'string' ? { name: c, count: 0 } : c));
  }, [products]);
  const flash = list.filter((p) => discountPct(p) != null && p.available);
  const pool = flash.length >= 4 ? flash : list.filter((p) => p.available);
  const top = React.useMemo(() => [...list].sort((a, b) => b.sold - a.sold), [list]);
  const brands = React.useMemo(() => {
    const m = new Map<string, number>();
    list.forEach((p) => { if (p.brand) m.set(p.brand, (m.get(p.brand) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [list]);
  const brandProducts = brands.length ? list.filter((p) => p.brand === brands[0][0]) : [];
  return (
    <div className="space-y-5">
      <MallHero />
      <MallTrustRow />
      <MallFlashSales products={list} loading={loading} />
      <div id="mall-categories">
        <MallCategoryTiles categories={cats} />
      </div>
      <MallRail title="Top Sellers" sub="Most loved right now" icon={RailIcons.Trophy} products={top} loading={loading} />
      {brands.length > 0 && (
        <MallRail title={`${brands[0][0]} Official Store`} sub={`${brands[0][1]} products`} icon={RailIcons.Store} products={brandProducts} loading={loading} />
      )}
      <MallRail title="New Arrivals" sub="Fresh in the outlet" icon={RailIcons.Sparkles} products={[...list].reverse()} loading={loading} />
      {!loading && pool.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base sm:text-lg font-black">Explore the Mall</h2>
            <button type="button" onClick={() => refreshProducts()} className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold inline-flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2.5 sm:gap-3">
            {pool.slice(0, 18).map((p) => <MallProductCard key={p.id} product={p} />)}
          </div>
        </section>
      )}
      <MallHelpStrip />
    </div>
  );
};
