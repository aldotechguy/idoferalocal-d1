import React from 'react';
import { useMall } from '../context/MallContext';
import { MallHero } from './MallHero';
import { MallTrustRow, MallHelpStrip } from './MallTrustRow';
import { MallFlashSales, MallCategoryTiles, MallRail, RailIcons } from './MallSections';
import { MallBrowseGrid, fetchSearch } from './MallBrowseGrid';
import { mallClient } from '../services/mallClient';

export const MallHome: React.FC = () => {
  const { products, order } = useMall();
  const [sections, setSections] = React.useState<Awaited<ReturnType<typeof mallClient.home>> | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);
  const [retry, setRetry] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    mallClient.ensureSession();
    setLoading(true);
    setError(false);
    mallClient.home().then(data => { if (alive) setSections(data); })
      .catch(() => { if (alive) setError(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [order, retry]);
  const cats = React.useMemo(() => {
    return (products?.categories ?? []).map((c) => (typeof c === 'string' ? { name: c, count: 0 } : c));
  }, [products]);
  return (
    <div className="space-y-5">
      <MallHero />
      <MallTrustRow />
      {error && <div role="alert" className="text-sm text-slate-600 dark:text-slate-300">Featured sections could not load. <button type="button" className="underline font-bold" onClick={() => setRetry(value => value + 1)}>Retry sections</button></div>}
      <MallFlashSales products={sections?.flashSales ?? []} loading={loading} />
      <div id="mall-categories">
        {loading ? <MallRail title="For you" icon={RailIcons.RotateCcw} products={[]} loading limit={10} />
          : sections?.buyAgain.length ? <MallRail title="Buy Again" sub="Your previous purchases, at today’s prices" icon={RailIcons.RotateCcw} products={sections.buyAgain} loading={false} limit={10} />
          : <MallCategoryTiles categories={cats} />}
      </div>
      <MallRail title="Top Sellers" sub="Most loved right now" icon={RailIcons.Trophy} products={sections?.topSellers ?? []} loading={loading} />
      <MallRail title="New Arrivals" sub="Recently restocked" icon={RailIcons.Sparkles} products={sections?.newArrivals ?? []} loading={loading} />
      <MallBrowseGrid title="Explore the Mall" sub="Browse our complete product catalog — in-stock items first" fetchKey="catalog:all" fetchFn={fetchSearch('')} stockFirst />
      <MallHelpStrip />
    </div>
  );
};
