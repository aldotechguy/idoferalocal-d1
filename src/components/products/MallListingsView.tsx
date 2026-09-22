import React from 'react';
import { BadgeCheck, RefreshCw, Search, Star, Store } from 'lucide-react';
import { AccessibleOverlay } from '../common/AccessibleOverlay';
import { AsyncState } from '../common/AsyncState';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { staffMallListingClient, type MallListingPreview, type StaffMallListing } from '../../services/staffMallListingClient';

const money = (kobo: number) => `₦${(kobo / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const toKobo = (naira: string): number | null => {
  if (!naira.trim()) return null;
  const value = Number(naira);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
};
const fromKobo = (kobo: number | null) => (kobo == null ? '' : String(kobo / 100));
/** ISO -> the local `datetime-local` value the browser expects. */
const toLocalInput = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16) : '');
const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : null);

type Draft = {
  mallPrice: string; mallDescription: string;
  featured: boolean; displayOrder: string;
  promoPrice: string; promoStart: string; promoEnd: string;
};

const draftFrom = (listing: StaffMallListing): Draft => ({
  mallPrice: fromKobo(listing.mallPriceKobo),
  mallDescription: listing.mallDescription,
  featured: listing.featured,
  displayOrder: listing.displayOrder == null ? '' : String(listing.displayOrder),
  promoPrice: fromKobo(listing.promoPriceKobo),
  promoStart: toLocalInput(listing.promoStart),
  promoEnd: toLocalInput(listing.promoEnd),
});

const payloadFrom = (draft: Draft) => ({
  mallPriceKobo: toKobo(draft.mallPrice),
  mallDescription: draft.mallDescription,
  featured: draft.featured,
  displayOrder: draft.displayOrder.trim() === '' ? null : Number(draft.displayOrder),
  promoPriceKobo: toKobo(draft.promoPrice),
  promoStart: fromLocalInput(draft.promoStart),
  promoEnd: fromLocalInput(draft.promoEnd),
});

const VIEWS = [
  { value: 'all', label: 'All products' },
  { value: 'active', label: 'Visible (Active)' },
  { value: 'hidden', label: 'Hidden (not Active)' },
];

export const MallListingsView: React.FC = () => {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const canEdit = ['Administrator', 'Store Manager'].includes(currentUser?.role || '');

  const [listings, setListings] = React.useState<StaffMallListing[]>([]);
  const [counts, setCounts] = React.useState({ active: 0, hidden: 0 });
  const [view, setView] = React.useState('all');
  const [query, setQuery] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [selected, setSelected] = React.useState<StaffMallListing | null>(null);
  const [preview, setPreview] = React.useState<MallListingPreview | null>(null);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [blockers, setBlockers] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [posPromosEnabled, setPosPromosEnabled] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await staffMallListingClient.list({ view, q: query.trim(), limit: 200 });
      setListings(data.listings);
      setCounts(data.counts);
      setPosPromosEnabled(data.posPromosEnabled === true);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setLoading(false); }
  }, [query, view]);

  React.useEffect(() => { load(); }, [load]);

  const open = async (listing: StaffMallListing) => {
    setSelected(listing);
    setDraft(draftFrom(listing));
    setFieldErrors({});
    setBlockers(listing.issues);
    setPreview(null);
    try {
      const detail = await staffMallListingClient.detail(listing.id);
      setSelected(detail.listing);
      setDraft(draftFrom(detail.listing));
      setBlockers(detail.listing.issues);
      setPreview(detail.preview);
      setPosPromosEnabled(detail.posPromosEnabled === true);
    } catch (err) {
      showToast({ title: 'Listing details failed', message: err instanceof Error ? err.message : String(err), type: 'error' });
    }
  };

  const save = async () => {
    if (!selected || !draft) return;
    setBusy(true);
    setFieldErrors({});
    try {
      const result = await staffMallListingClient.save(selected.id, payloadFrom(draft));
      setSelected(result.listing);
      setDraft(draftFrom(result.listing));
      setPreview(result.preview);
      setBlockers(result.listing.issues);
      await load();
      showToast({
        title: 'Mall merchandising saved',
        message: result.listing.name, type: 'success',
      });
    } catch (err) {
      const failure = err as Error & { fields?: Record<string, string> };
      setFieldErrors(failure.fields || {});
      showToast({ title: 'Listing not saved', message: failure.message, type: 'error' });
    } finally { setBusy(false); }
  };

  const notReady = listings.filter((listing) => listing.issues.length).length;

  return <div className="space-y-4">
    <div className="grid sm:grid-cols-3 gap-3">
      <div className="rounded-2xl border bg-white dark:bg-slate-900 p-4"><p className="text-xs font-bold text-slate-500">Visible (Active)</p><p className="text-2xl font-black">{counts.active}</p></div>
      <div className="rounded-2xl border bg-white dark:bg-slate-900 p-4"><p className="text-xs font-bold text-slate-500">Hidden (not Active)</p><p className="text-2xl font-black">{counts.hidden}</p></div>
      <div className="rounded-2xl border bg-white dark:bg-slate-900 p-4"><p className="text-xs font-bold text-slate-500">Loaded products with issues</p><p className="text-2xl font-black">{notReady}</p></div>
    </div>

    <div className="rounded-2xl border bg-white dark:bg-slate-900 p-3 flex flex-col sm:flex-row gap-2">
      <label className="flex-1 relative"><span className="sr-only">Search products</span><Search className="absolute left-3 top-3 w-4 h-4 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Product name, SKU or brand" className="w-full h-10 pl-9 pr-3 rounded-xl border bg-transparent text-sm" /></label>
      <select value={view} onChange={(event) => setView(event.target.value)} className="h-10 px-3 rounded-xl border bg-transparent text-sm font-bold">{VIEWS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      <button type="button" onClick={load} className="h-10 px-3 rounded-xl border inline-flex items-center justify-center gap-2 text-sm font-bold"><RefreshCw className="w-4 h-4" /> Refresh</button>
    </div>

    {loading ? <AsyncState busy title="Loading Mall listings" />
      : error ? <AsyncState title="Mall listings unavailable" message={error} onRetry={load} />
      : !listings.length ? <AsyncState title="No products match" message="Adjust the search or filter to see products." />
      : <div className="rounded-2xl border bg-white dark:bg-slate-900 divide-y dark:divide-slate-800">
        {listings.map((listing) => <button type="button" key={listing.id} onClick={() => open(listing)} className="w-full p-4 text-left flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/60">
          <div className="min-w-0 flex items-center gap-3">
            {listing.images[0]
              ? <img src={listing.images[0]} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" loading="lazy" />
              : <span className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 shrink-0" />}
            <div className="min-w-0">
              <p className="font-black text-sm truncate flex items-center gap-1.5">{listing.name}{listing.featured && <Star className="w-3.5 h-3.5 text-amber-500" />}</p>
              <p className="text-xs text-slate-500 truncate">{listing.sku} · stock {listing.stock} · {listing.imageCount} image{listing.imageCount === 1 ? '' : 's'}</p>
              {listing.issues.length > 0 && <p className="text-xs font-bold text-amber-600">Attention: {listing.issues[0]}</p>}
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="font-black text-sm">{money(listing.publicPriceKobo)}</p>
            <p className={`text-xs font-bold ${listing.visibleOnMall ? 'text-emerald-600' : 'text-slate-400'}`}>{listing.visibleOnMall ? 'Visible' : 'Hidden'}</p>
            {listing.promoActive && <p className="text-[10px] font-bold text-rose-600">PROMO ACTIVE</p>}
          </div>
        </button>)}
      </div>}

    <AccessibleOverlay open={Boolean(selected)} onClose={() => setSelected(null)} title={selected ? `Mall listing — ${selected.name}` : 'Mall listing'} description={selected ? `${selected.sku} · ${selected.productStatus} · stock ${selected.stock}` : undefined} className="max-w-2xl">
      {selected && draft && <div className="space-y-4">
        <p className="rounded-xl border p-3 text-sm">All Active products appear automatically. Change product status in product management to hide a product. Buying also requires stock and a valid price.</p>

        {blockers.length > 0 && <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3">
          <p className="text-xs font-black text-amber-800 dark:text-amber-300">Product quality and availability notes</p>
          <ul className="mt-1 list-disc pl-5 text-xs text-amber-800 dark:text-amber-300">{blockers.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>}

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-xs font-bold">Mall price (₦)
            <input inputMode="decimal" value={draft.mallPrice} disabled={!canEdit} onChange={(event) => setDraft({ ...draft, mallPrice: event.target.value })} placeholder={fromKobo(selected.retailPriceKobo)} className="mt-1 w-full h-10 px-3 rounded-xl border bg-transparent text-sm" />
            <span className="mt-1 block font-normal text-slate-500">Retail {money(selected.retailPriceKobo)}{selected.minimumSellingPriceKobo > 0 ? ` · floor ${money(selected.minimumSellingPriceKobo)}` : ''}</span>
            {fieldErrors.mallPriceKobo && <span className="text-rose-600">{fieldErrors.mallPriceKobo}</span>}
          </label>
          <label className="text-xs font-bold">Display order
            <input inputMode="numeric" value={draft.displayOrder} disabled={!canEdit} onChange={(event) => setDraft({ ...draft, displayOrder: event.target.value })} placeholder="Lower shows first" className="mt-1 w-full h-10 px-3 rounded-xl border bg-transparent text-sm" />
            {fieldErrors.displayOrder && <span className="text-rose-600">{fieldErrors.displayOrder}</span>}
          </label>
        </div>

        <label className="text-xs font-bold block">Mall description
          <textarea value={draft.mallDescription} disabled={!canEdit} onChange={(event) => setDraft({ ...draft, mallDescription: event.target.value })} rows={4} placeholder={selected.internalDescription || 'Customer-facing description'} className="mt-1 w-full p-3 rounded-xl border bg-transparent text-sm" />
          <span className="mt-1 block font-normal text-slate-500">{draft.mallDescription.length}/2000 · blank falls back to the internal description</span>
          {fieldErrors.mallDescription && <span className="text-rose-600">{fieldErrors.mallDescription}</span>}
        </label>

        <label className="flex items-center gap-3 rounded-xl border p-3">
          <input type="checkbox" checked={draft.featured} disabled={!canEdit} onChange={(event) => setDraft({ ...draft, featured: event.target.checked })} />
          <span className="text-sm font-bold">Feature near the top of the storefront</span>
        </label>

        <fieldset className="rounded-xl border p-3 space-y-3">
          <legend className="px-1 text-xs font-black">Optional promotion</legend>
          <label className="text-xs font-bold block">Promotional price (₦)
            <input inputMode="decimal" value={draft.promoPrice} disabled={!canEdit} onChange={(event) => setDraft({ ...draft, promoPrice: event.target.value })} className="mt-1 w-full h-10 px-3 rounded-xl border bg-transparent text-sm" />
            {fieldErrors.promoPriceKobo && <span className="text-rose-600">{fieldErrors.promoPriceKobo}</span>}
          </label>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs font-bold">Starts
              <input type="datetime-local" value={draft.promoStart} disabled={!canEdit} onChange={(event) => setDraft({ ...draft, promoStart: event.target.value })} className="mt-1 w-full h-10 px-3 rounded-xl border bg-transparent text-sm" />
              {fieldErrors.promoStart && <span className="text-rose-600">{fieldErrors.promoStart}</span>}
            </label>
            <label className="text-xs font-bold">Ends
              <input type="datetime-local" value={draft.promoEnd} disabled={!canEdit} onChange={(event) => setDraft({ ...draft, promoEnd: event.target.value })} className="mt-1 w-full h-10 px-3 rounded-xl border bg-transparent text-sm" />
              {fieldErrors.promoEnd && <span className="text-rose-600">{fieldErrors.promoEnd}</span>}
            </label>
          </div>
        </fieldset>

        {selected.posPromoPriceKobo != null && (
          <p className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs font-bold text-amber-700 dark:text-amber-300">
            POS promotional price {money(selected.posPromoPriceKobo)} {posPromosEnabled ? 'is active on the storefront (MALL_HONOR_POS_PROMOS is enabled).' : 'would apply on the storefront once MALL_HONOR_POS_PROMOS is set to "true" in wrangler.toml and the Worker is redeployed.'}
          </p>
        )}

        {preview && <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3">
          <p className="text-xs font-black flex items-center gap-1.5"><Store className="w-3.5 h-3.5" /> Storefront preview</p>
          <div className="mt-2 flex gap-3">
            {preview.image ? <img src={preview.image} alt="" className="w-16 h-16 rounded-lg object-cover" /> : <span className="w-16 h-16 rounded-lg bg-slate-200 dark:bg-slate-700" />}
            <div className="min-w-0 text-sm">
              <p className="font-black truncate">{preview.name}</p>
              <p className="font-bold">{money(preview.price)}{preview.promoActive && <span className="ml-2 text-xs text-rose-600">promo</span>}</p>
              <p className="text-xs text-slate-500 line-clamp-2">{preview.description || 'No description'}</p>
              <p className={`text-xs font-bold ${preview.visibleOnMall ? 'text-emerald-600' : 'text-slate-400'}`}>{preview.visibleOnMall ? 'Visible on the Mall' : 'Not visible to customers'}</p>
            </div>
          </div>
        </div>}

        {canEdit
          ? <button type="button" disabled={busy} onClick={save} className="w-full h-11 rounded-xl bg-blue-600 disabled:bg-slate-300 text-white font-bold inline-flex items-center justify-center gap-2"><BadgeCheck className="w-4 h-4" /> {busy ? 'Saving…' : 'Save listing'}</button>
          : <p className="rounded-xl border p-3 text-xs font-bold text-slate-500">Only an Administrator or Store Manager can change Mall listings.</p>}
      </div>}
    </AccessibleOverlay>
  </div>;
};