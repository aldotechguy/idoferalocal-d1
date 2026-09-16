import React from 'react';
import { Zap, ChevronRight, LayoutGrid, Store, Trophy, Sparkles } from 'lucide-react';
import type { MallProduct } from '../types/mall';
import { useNavigateMall } from '../hooks/useRoute';
import { MallProductCard } from './MallProductCard';
import { SectionHeader, ProductCardSkeleton, discountPct } from './mallUi';

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
  const deals = products.filter((p) => discountPct(p) != null && p.available).slice(0, 12);
  const go = useNavigateMall();
  if (!loading && deals.length === 0) return null;
  return (
    <section className="mall-flash rounded-2xl p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="p-1.5 rounded-lg bg-white/20"><Zap className="w-4 h-4" /></span>
          <h2 className="text-base sm:text-lg font-black tracking-tight">Flash Sales</h2>
          <span className="text-[11px] sm:text-xs font-bold bg-black/30 px-2 py-1 rounded-lg tabular-nums">{left}</span>
        </div>
        <button type="button" onClick={() => go('/')} className="text-xs font-extrabold inline-flex items-center gap-0.5 hover:underline">See All <ChevronRight className="w-3.5 h-3.5" /></button>
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1 -mx-1 px-1 snap-x">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="w-36 sm:w-44 shrink-0 snap-start"><ProductCardSkeleton /></div>)
          : deals.map((p) => <div key={p.id} className="w-36 sm:w-44 shrink-0 snap-start"><MallProductCard product={p} /></div>)}
      </div>
    </section>
  );
};

export const MallCategoryTiles: React.FC<{ categories: { name: string; count: number }[] }> = ({ categories }) => {
  const go = useNavigateMall();
  if (categories.length === 0) return null;
  return (
    <section>
      <SectionHeader icon={LayoutGrid} title="Shop by Category" sub="Everything in the outlet, grouped" />
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
        {categories.slice(0, 12).map((c) => (
          <button
            key={c.name} type="button"
            onClick={() => go(`/category/${encodeURIComponent(c.name)}`)}
            className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 text-center hover:border-blue-400 hover:shadow-md transition-all group"
          >
            <span className="mx-auto w-11 h-11 rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center font-black text-lg group-hover:scale-110 transition-transform">
              {c.name.charAt(0).toUpperCase()}
            </span>
            <span className="block mt-2 text-xs font-extrabold text-slate-800 dark:text-slate-100 truncate">{c.name}</span>
            <span className="block text-[10px] text-slate-400 font-semibold">{c.count} item{c.count === 1 ? '' : 's'}</span>
          </button>
        ))}
      </div>
    </section>
  );
};

export function MallRail({ title, sub, icon, products, loading }: {
  title: string; sub?: string; icon: React.ElementType; products: MallProduct[]; loading: boolean;
}) {
  if (!loading && products.length === 0) return null;
  return (
    <section>
      <SectionHeader icon={icon} title={title} sub={sub} actionLabel="See All" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2.5 sm:gap-3">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => <ProductCardSkeleton key={i} />)
          : products.slice(0, 12).map((p) => <MallProductCard key={p.id} product={p} />)}
      </div>
    </section>
  );
}

export const RailIcons = { Store, Trophy, Sparkles };
