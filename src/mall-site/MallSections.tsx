import React from 'react';
import { Zap, LayoutGrid, Store, Trophy, Sparkles, RotateCcw } from 'lucide-react';
import type { MallProduct } from '../types/mall';
import { useNavigateMall } from '../hooks/useRoute';
import { MallProductCard } from './MallProductCard';
import { SectionHeader, ProductCardSkeleton, discountPct } from './mallUi';
import { MallCarousel } from './MallCarousel';

function useCountdown() {
  const [left, setLeft] = React.useState('');
  React.useEffect(() => {
    const tick = () => {
      const now = new Date();
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      const d = Math.max(0, end.getTime() - now.getTime());
      const h = Math.floor(d / 3600000);
      const m = Math.floor((d % 3600000) / 60000);
      const s = Math.floor((d % 60000) / 1000);
      setLeft(`${String(h).padStart(2, '0')}h : ${String(m).padStart(2, '0')}m : ${String(s).padStart(2, '0')}s`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  return left;
}

export const MallFlashSales: React.FC<{ products: MallProduct[]; loading: boolean }> = ({ products, loading }) => {
  const left = useCountdown();
  const deals = products.filter((p) => discountPct(p) != null).slice(0, 10);
  if (!loading && deals.length === 0) return null;
  return (
    <section className="mall-flash rounded-2xl p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="p-1.5 rounded-lg bg-white/20"><Zap className="w-4 h-4" /></span>
          <h2 className="text-base sm:text-lg font-black tracking-tight">Flash Sales</h2>
          <span className="text-[11px] sm:text-xs font-bold bg-black/30 px-2 py-1 rounded-lg tabular-nums">{left}</span>
        </div>
      </div>
      <MallCarousel label="Flash Sales">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => <ProductCardSkeleton key={i} />)
          : deals.map((p) => <MallProductCard key={p.id} product={p} />)}
      </MallCarousel>
    </section>
  );
};

export const MallCategoryTiles: React.FC<{ categories: { name: string; count: number }[] }> = ({ categories }) => {
  const go = useNavigateMall();
  if (categories.length === 0) return null;
  return (
    <section>
      <SectionHeader icon={LayoutGrid} title="Shop by Category" sub="Everything in the outlet, grouped" />
      <MallCarousel label="Shop by Category">
        {categories.slice(0, 10).map((c) => (
          <button
            key={c.name} type="button"
            onClick={() => go(`/category/${encodeURIComponent(c.name)}`)}
            className="w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 text-center hover:border-blue-400 hover:shadow-md transition-all group"
          >
            <span className="mx-auto w-11 h-11 rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center font-black text-lg group-hover:scale-110 transition-transform">
              {c.name.charAt(0).toUpperCase()}
            </span>
            <span className="block mt-2 text-xs font-extrabold text-slate-800 dark:text-slate-100 truncate">{c.name}</span>
            <span className="block text-[10px] text-slate-400 font-semibold">{c.count} item{c.count === 1 ? '' : 's'}</span>
          </button>
        ))}
      </MallCarousel>
    </section>
  );
};

export function MallRail({ title, sub, icon, products, loading, limit = 12 }: {
  title: string; sub?: string; icon: React.ElementType; products: MallProduct[]; loading: boolean; limit?: number;
}) {
  if (!loading && products.length === 0) return null;
  return (
    <section>
      <SectionHeader icon={icon} title={title} sub={sub} />
      <MallCarousel label={title}>
        {loading
          ? Array.from({ length: 6 }).map((_, i) => <ProductCardSkeleton key={i} />)
          : products.slice(0, limit).map((p) => <MallProductCard key={p.id} product={p} />)}
      </MallCarousel>
    </section>
  );
}

export const RailIcons = { Store, Trophy, Sparkles, RotateCcw };
