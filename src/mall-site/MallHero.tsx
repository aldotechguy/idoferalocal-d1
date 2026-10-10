import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useNavigateMall } from '../hooks/useRoute';

const SLIDES = [
  { kicker: 'Idofera Mall Grand Opening', title: 'Packaging for every hustle.', sub: 'Nylons, bottles, jars, buckets and more.', cta: 'Shop Best Sellers', image: '01-variety' },
  { kicker: 'Buy Now, Pick Up Fast', title: 'Order online, pickup in Uyo.', sub: 'Pay on pickup. No queues, no stories.', cta: 'Start Shopping', image: '02-pickup' },
  { kicker: 'Official Store Deals', title: 'Flash prices this week.', sub: 'Discounted lines while stock lasts.', cta: 'See Flash Sales', image: '03-deals' },
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
    <section className="mall-hero relative overflow-hidden rounded-2xl aspect-[5/4] sm:aspect-[12/5] lg:aspect-[16/5] flex">
      <picture key={s.image} className="absolute inset-0 block" aria-hidden="true">
        <source media="(max-width: 639px)" srcSet={`/images/mall/hero/${s.image}-mobile.webp`} />
        <source media="(max-width: 1023px)" srcSet={`/images/mall/hero/${s.image}-tablet.webp`} />
        <img
          src={`/images/mall/hero/${s.image}-desktop.webp`}
          alt=""
          width="1600"
          height="500"
          loading={idx === 0 ? 'eager' : 'lazy'}
          fetchPriority={idx === 0 ? 'high' : 'auto'}
          decoding="async"
          className="w-full h-full object-fill"
        />
      </picture>
      <div className="mall-hero-copy relative z-10 p-5 sm:p-8 flex flex-col justify-start sm:justify-center max-w-[88%] sm:max-w-[50%] lg:max-w-lg">
        <span className="inline-flex w-fit text-[10px] sm:text-[11px] font-extrabold uppercase tracking-widest bg-white/20 px-2.5 py-1 rounded-full">{s.kicker}</span>
        <h1 className="mt-2 text-2xl sm:text-4xl font-black tracking-tight leading-tight">{s.title}</h1>
        <p className="mt-1.5 text-xs sm:text-sm text-slate-600 font-medium">{s.sub}</p>
        <div className="mt-4 flex items-center gap-2">
          <button type="button" onClick={() => go('/')} className="h-10 px-5 rounded-xl bg-blue-600 text-white text-sm font-extrabold">{s.cta}</button>
          <button type="button" onClick={() => go('/orders')} className="h-10 px-4 rounded-xl liquid-glass-pill text-slate-800 text-sm font-bold">Track Order</button>
        </div>
        <div className="mt-4 flex items-center gap-1.5">
          {SLIDES.map((_, i) => (
            <button key={i} type="button" aria-label={`Slide ${i + 1}`} aria-current={i === idx ? 'true' : undefined} onClick={() => setIdx(i)} className={`h-1.5 rounded-full transition-all ${i === idx ? 'w-8 bg-teal-700' : 'w-3 bg-teal-700/30'}`} />
          ))}
        </div>
      </div>
      <div className="hidden sm:flex absolute right-4 top-1/2 -translate-y-1/2 gap-1.5">
        <button type="button" aria-label="Previous" onClick={() => setIdx((idx + SLIDES.length - 1) % SLIDES.length)} className="p-2 rounded-full liquid-glass-pill text-slate-700 hover:text-teal-800"><ChevronLeft className="w-4 h-4" /></button>
        <button type="button" aria-label="Next" onClick={() => setIdx((idx + 1) % SLIDES.length)} className="p-2 rounded-full liquid-glass-pill text-slate-700 hover:text-teal-800"><ChevronRight className="w-4 h-4" /></button>
      </div>
    </section>
  );
};
