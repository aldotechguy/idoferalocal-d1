import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function MallCarousel({ label, children }: { label: string; children: React.ReactNode }) {
  const rail = React.useRef<HTMLDivElement>(null);
  const id = React.useId();
  const [edges, setEdges] = React.useState({ start: true, end: true });
  const measure = React.useCallback(() => {
    const node = rail.current;
    if (node) setEdges({ start: node.scrollLeft <= 1, end: node.scrollLeft + node.clientWidth >= node.scrollWidth - 1 });
  }, []);
  React.useEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (rail.current) observer.observe(rail.current);
    return () => observer.disconnect();
  }, [children, measure]);
  const slide = (direction: number) => {
    const node = rail.current;
    node?.scrollBy({ left: direction * node.clientWidth * 0.85,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  return (
    <div role="region" aria-label={label} aria-roledescription="carousel">
      <div className="flex justify-end gap-2 mb-2">
        <button type="button" aria-label={`Previous ${label}`} aria-controls={id} disabled={edges.start} onClick={() => slide(-1)} className="p-2 rounded-lg border disabled:opacity-30 focus-visible:outline-2"><ChevronLeft className="w-4 h-4" /></button>
        <button type="button" aria-label={`Next ${label}`} aria-controls={id} disabled={edges.end} onClick={() => slide(1)} className="p-2 rounded-lg border disabled:opacity-30 focus-visible:outline-2"><ChevronRight className="w-4 h-4" /></button>
      </div>
      <div id={id} ref={rail} tabIndex={0} aria-label={`${label} items`} onScroll={measure}
        onKeyDown={event => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); slide(event.key === 'ArrowLeft' ? -1 : 1); }
        }}
        className="flex flex-nowrap gap-2.5 sm:gap-3 overflow-x-auto snap-x snap-mandatory pb-2 px-1 focus-visible:outline-2">
        {React.Children.map(children, child => <div className="w-40 sm:w-48 lg:w-52 shrink-0 snap-start">{child}</div>)}
      </div>
    </div>
  );
}