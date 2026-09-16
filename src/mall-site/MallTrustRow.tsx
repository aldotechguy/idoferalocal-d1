import React from 'react';
import { Headset } from 'lucide-react';
import { TRUST_ITEMS } from './mallUi';

export const MallTrustRow: React.FC = () => (
  <section className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
    {TRUST_ITEMS.map((t) => (
      <div key={t.title} className="flex items-center gap-2.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3.5 py-3">
        <span className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 shrink-0">
          <t.icon className="w-4 h-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-extrabold text-slate-900 dark:text-white truncate">{t.title}</span>
          <span className="block text-[11px] text-slate-400 truncate">{t.sub}</span>
        </span>
      </div>
    ))}
  </section>
);

export function MallHelpStrip() {
  return (
    <a href="tel:+2348063766861" className="mall-help flex items-center gap-3 rounded-2xl text-slate-900 px-4 py-3.5">
      <span className="p-2.5 rounded-xl bg-white/15 dark:bg-slate-900/10">
        <Headset className="w-5 h-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-extrabold">Need help ordering? Call us</span>
        <span className="block text-xs opacity-70 font-semibold">+234 806 376 6861</span>
      </span>
    </a>
  );
}
