import React from 'react';
import { ShoppingCart, Truck, ShieldCheck, RotateCcw, Headset, Zap, BadgePercent } from 'lucide-react';

export function formatNaira(kobo: number): string {
  return '₦' + Number((kobo / 100).toFixed(2)).toLocaleString('en-NG');
}

export function discountPct(p: { price: number; retailPriceKobo?: number }): number | null {
  if (p.retailPriceKobo == null || p.retailPriceKobo <= p.price || p.price <= 0) return null;
  return Math.round(((p.retailPriceKobo - p.price) / p.retailPriceKobo) * 100);
}

export function soldCount(p: { id: string; stock: number }): number {
  let h = 0;
  for (let i = 0; i < p.id.length; i++) h = (h * 31 + p.id.charCodeAt(i)) >>> 0;
  return 12 + (h % 900) + Math.min(400, Math.max(0, 60 - p.stock) * 8);
}

export function Stars({ seed }: { seed: string }) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 33 + seed.charCodeAt(i)) >>> 0;
  const rating = 3.6 + ((h % 14) / 10);
  const full = Math.round(rating);
  return (
    <span className="flex items-center gap-0.5" aria-label={`${rating.toFixed(1)} stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <svg key={i} viewBox="0 0 20 20" className={`w-3 h-3 ${i < full ? 'fill-amber-400' : 'fill-slate-200 dark:fill-slate-700'}`}>
          <path d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9 4.7 17.6l1-5.8L1.5 7.7l5.9-.9L10 1.5z" />
        </svg>
      ))}
      <span className="ml-1 text-[10px] font-semibold text-slate-400">{rating.toFixed(1)}</span>
    </span>
  );
}

export const TRUST_ITEMS = [
  { icon: Truck, title: 'Fast Delivery', sub: 'Uyo & nationwide' },
  { icon: ShieldCheck, title: 'Secure Payments', sub: 'Pay on pickup' },
  { icon: RotateCcw, title: 'Easy Returns', sub: '2 working days' },
  { icon: Headset, title: '24/7 Support', sub: 'Call or WhatsApp' },
];

export function SectionHeader({ icon: Icon, title, sub, actionLabel, onAction }: {
  icon: React.ElementType; title: string; sub?: string; actionLabel?: string; onAction?: () => void;
}) {
  return (
    <div className="flex items-end justify-between gap-3 mb-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="p-2 rounded-xl bg-blue-600 text-white shrink-0">
          <Icon className="w-4 h-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight truncate">{title}</h2>
          {sub && <p className="text-[11px] sm:text-xs text-slate-400 truncate">{sub}</p>}
        </div>
      </div>
      {actionLabel && (
        <button
          type="button"
          onClick={onAction}
          className="shrink-0 h-8 px-3 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 text-xs font-extrabold hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors flex items-center gap-1.5"
        >
          {actionLabel}
          {actionLabel === 'Flash' ? <Zap className="w-3.5 h-3.5" /> : <BadgePercent className="w-3.5 h-3.5" />}
        </button>
      )}
    </div>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden animate-pulse">
      <div className="aspect-square bg-slate-100 dark:bg-slate-800" />
      <div className="p-3 space-y-2">
        <div className="h-3 rounded bg-slate-100 dark:bg-slate-800 w-11/12" />
        <div className="h-3 rounded bg-slate-100 dark:bg-slate-800 w-2/3" />
        <div className="h-4 rounded bg-slate-100 dark:bg-slate-800 w-1/2" />
      </div>
    </div>
  );
}

export function CartIcon({ className }: { className?: string }) {
  return <ShoppingCart className={className} />;
}
