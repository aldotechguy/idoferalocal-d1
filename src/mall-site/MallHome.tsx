import React from 'react';
import { useMall } from '../context/MallContext';
import { MallHero } from './MallHero';
import { MallTrustRow, MallHelpStrip } from './MallTrustRow';
import { MallFlashSales, MallCategoryTiles, MallRail, RailIcons } from './MallSections';
import { MallBrowseGrid, fetchSearch } from './MallBrowseGrid';

export const MallHome: React.FC = () => {
  const { products, loading } = useMall();
  const list = products?.products ?? [];
  const cats = React.useMemo(() => {
    return (products?.categories ?? []).map((c) => (typeof c === 'string' ? { name: c, count: 0 } : c));
  }, [products]);
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
      <MallBrowseGrid title="Explore the Mall" sub="Browse our complete product catalog" fetchKey="catalog:all" fetchFn={fetchSearch('')} />
      <MallHelpStrip />
    </div>
  );
};
