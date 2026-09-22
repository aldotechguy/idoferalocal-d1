import React from 'react';
import { Search, X, Package } from 'lucide-react';
import { PortalDropdown } from '../components/common/PortalDropdown';
import { useNavigateMall, useRoute } from '../hooks/useRoute';
import { mallClient, type MallProduct } from '../services/mallClient';
import { hasMallPrice, mallStockLabel } from '../shared/mallProductPresentation';
import { formatNaira } from './mallUi';

export const MallHeaderSearch: React.FC<{ query: string; setQuery: (q: string) => void }> = ({ query, setQuery }) => {
  const go = useNavigateMall();
  const route = useRoute();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const anchorRef = React.useRef<HTMLFormElement>(null);
  const portalRef = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  const [selected, setSelected] = React.useState(-1);
  const [retry, setRetry] = React.useState(0);
  const [result, setResult] = React.useState<{ query: string; products: MallProduct[]; total: number; error: string; approximate?: boolean } | null>(null);
  const cleanQuery = query.trim().slice(0, 80);
  const visible = open && !!cleanQuery;
  const current = result?.query === cleanQuery ? result : null;
  const products = current?.products ?? [];
  const busy = visible && !current;

  React.useEffect(() => { setOpen(false); setSelected(-1); }, [route]);
  React.useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!anchorRef.current?.contains(target) && !portalRef.current?.contains(target)) setOpen(false);
    };
    const blur = (event: FocusEvent) => {
      const target = event.target as Node;
      if (!anchorRef.current?.contains(target) && !portalRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('keydown', shortcut);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', blur);
    return () => {
      document.removeEventListener('keydown', shortcut);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', blur);
    };
  }, []);

  React.useEffect(() => {
    setSelected(-1);
    setResult(null);
    if (!visible) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      mallClient.products({ q: cleanQuery, limit: 6 }, { signal: controller.signal }).then((data) => {
        if (!controller.signal.aborted) setResult({ query: cleanQuery, products: data.products, total: data.total, error: '', approximate: data.search?.approximate });
      }).catch(() => {
        if (!controller.signal.aborted) setResult({ query: cleanQuery, products: [], total: 0, error: 'Suggestions could not be loaded.' });
      });
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [cleanQuery, visible, retry]);

  React.useEffect(() => {
    if (selected >= 0) document.getElementById(`mall-search-option-${selected}`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const navigate = (path: string) => { setOpen(false); setSelected(-1); go(path); };
  const submit = (event?: React.FormEvent) => {
    event?.preventDefault();
    navigate(cleanQuery ? `/search?q=${encodeURIComponent(cleanQuery)}` : '/');
  };

  return (
    <form ref={anchorRef} onSubmit={submit} role="search" className="flex-1 min-w-0 relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
      <input
        ref={inputRef} value={query} maxLength={80} autoComplete="off"
        onChange={(event) => { setQuery(event.target.value); setSelected(-1); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search products, brands and categories…"
        aria-label="Search mall products, brands and categories" role="combobox"
        aria-expanded={visible} aria-controls={visible ? 'mall-search-results' : undefined} aria-autocomplete="list"
        aria-activedescendant={visible && products[selected] ? `mall-search-option-${selected}` : undefined}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); setOpen(true);
            if (products.length) setSelected(previous => event.key === 'ArrowDown' ? (previous + 1) % products.length : (previous <= 0 ? products.length - 1 : previous - 1));
          } else if (event.key === 'Escape') {
            event.preventDefault(); setOpen(false); setSelected(-1);
          } else if (event.key === 'Enter' && visible && products[selected]) {
            event.preventDefault(); navigate(`/product/${encodeURIComponent(products[selected].id)}`);
          }
        }}
        className="w-full h-10 sm:h-11 pl-9 pr-28 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/60 focus:border-blue-500"
      />
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
        {query && <button type="button" aria-label="Clear search" onClick={() => { setQuery(''); setSelected(-1); inputRef.current?.focus(); }} className="p-1 text-slate-500"><X className="w-4 h-4" /></button>}
        <button type="submit" className="h-8 px-3 sm:px-4 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-extrabold">Search</button>
      </div>
      <PortalDropdown anchorRef={anchorRef} portalRef={portalRef} open={visible} desiredHeight={420} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xl">
        <div className="px-3 py-2 text-xs font-bold text-slate-500" role="status" aria-live="polite">
          {busy ? 'Searching…' : current?.error ? current.error : products.length ? current?.approximate ? `Similar matches for “${cleanQuery}”` : `${current?.total} matching products` : `No products found for “${cleanQuery}”`}
        </div>
        {current?.error && <button type="button" onClick={() => setRetry(value => value + 1)} className="px-3 py-2 text-sm font-bold text-blue-600">Retry suggestions</button>}
        <div id="mall-search-results" role="listbox" aria-label="Product suggestions" aria-busy={busy}>
          {products.map((product, index) => (
            <div key={product.id} id={`mall-search-option-${index}`} role="option" aria-selected={selected === index}
              onPointerDown={(event) => event.preventDefault()}
              onMouseEnter={() => setSelected(index)}
              onClick={() => navigate(`/product/${encodeURIComponent(product.id)}`)}
              className={`flex items-center gap-3 p-3 cursor-pointer ${selected === index ? 'bg-blue-50 dark:bg-blue-950' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
              {product.image ? <img src={product.image} alt="" className="w-10 h-10 rounded-lg object-contain shrink-0" /> : <Package className="w-10 h-10 p-2 text-slate-400 shrink-0" />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold truncate">{product.name}</p>
                <p className="text-xs text-slate-500 truncate">{[product.brand, product.category].filter(Boolean).join(' · ')}</p>
                <p className="text-xs font-semibold">{hasMallPrice(product.price) ? formatNaira(product.price) : 'Price unavailable'} · {mallStockLabel(product.stock)}{product.wholesaleOffer ? ` · ${formatNaira(product.wholesaleOffer.price)} each at ${product.wholesaleOffer.minQty}+` : ''}</p>
              </div>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => submit()} className="w-full border-t border-slate-200 dark:border-slate-700 p-3 text-left text-sm font-bold text-blue-600 dark:text-blue-400">View all results for “{cleanQuery}”</button>
      </PortalDropdown>
    </form>
  );
};