import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useNavigateMall } from '../hooks/useRoute';

const SLIDES = [
  { kicker: 'Idofera Mall Grand Opening', title: 'Packaging for every hustle.', sub: 'Nylons, bottles, jars, buckets and more.', cta: 'Shop Best Sellers', bg: 'from-blue-700 via-indigo-700 to-violet-800' },
  { kicker: 'Buy Now, Pick Up Fast', title: 'Order online, pickup in Uyo.', sub: 'Pay on pickup. No queues, no stories.', cta: 'Start Shopping', bg: 'from-amber-600 via-orange-600 to-rose-700' },
  { kicker: 'Official Store Deals', title: 'Flash prices this week.', sub: 'Discounted lines while stock lasts.', cta: 'See Flash Sales', bg: 'from-emerald-600 via-teal-700 to-cyan-800' },
];

export const MallHero: React.FC = () => {
  const go = useNavigateMall();
  const [idx, setIdx] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % SLIDES.length), 6000);
    return () => clearInterval(t);
  }, []);
  const s = SLIDES[idx];
  return (
    <section className="mall-hero relative overflow-hidden rounded-2xl min-h-[220px] sm:min-h-[250px] flex">
      <div className="absolute -right-16 -top-16 w-64 h-64 rounded-full bg-white/10 blur-2xl" />
      <div className="relative p-5 sm:p-8 flex flex-col justify-center max-w-lg">
        <span className="inline-flex w-fit text-[10px] sm:text-[11px] font-extrabold uppercase tracking-widest bg-white/20 px-2.5 py-1 rounded-full">{s.kicker}</span>
        <h1 className="mt-2 text-2xl sm:text-4xl font-black tracking-tight leading-tight">{s.title}</h1>
        <p className="mt-1.5 text-xs sm:text-sm text-white/85 font-medium">{s.sub}</p>
        <div className="mt-4 flex items-center gap-2">
          <button type="button" onClick={() => go('/')} className="h-10 px-5 rounded-xl bg-white text-slate-900 text-sm font-extrabold hover:bg-slate-100">{s.cta}</button>
          <button type="button" onClick={() => go('/orders')} className="h-10 px-4 rounded-xl border border-white/40 text-white text-sm font-bold hover:bg-white/10">Track Order</button>
        </div>
        <div className="mt-4 flex items-center gap-1.5">
          {SLIDES.map((_, i) => (
            <button key={i} type="button" aria-label={`Slide ${i + 1}`} onClick={() => setIdx(i)} className={`h-1.5 rounded-full ${i === idx ? 'w-8 bg-white' : 'w-3 bg-white/40'}`} />
          ))}
        </div>
      </div>
      <div className="hidden sm:flex absolute right-4 top-1/2 -translate-y-1/2 gap-1.5">
        <button type="button" aria-label="Previous" onClick={() => setIdx((idx + SLIDES.length - 1) % SLIDES.length)} className="p-2 rounded-full bg-black/25 hover:bg-black/45 text-white"><ChevronLeft className="w-4 h-4" /></button>
        <button type="button" aria-label="Next" onClick={() => setIdx((idx + 1) % SLIDES.length)} className="p-2 rounded-full bg-black/25 hover:bg-black/45 text-white"><ChevronRight className="w-4 h-4" /></button>
      </div>
    </section>
  );
};
