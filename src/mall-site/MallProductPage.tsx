import React from 'react';
import { ShoppingCart, Truck, Package, ChevronRight, Share2 } from 'lucide-react';
import { useMall } from '../context/MallContext';
import { useNavigateMall } from '../hooks/useRoute';
import { formatNaira } from './mallUi';
import { MallQuantityControl } from './MallQuantityControl';
import { ProductImage } from '../components/common/ProductImage';
import { useToast } from '../context/ToastContext';
import { mallClient, type MallProduct } from '../services/mallClient';
import { hasMallPrice, mallUnavailableLabel } from '../shared/mallProductPresentation';

export const MallProductPage: React.FC<{ id: string }> = ({ id }) => {
  const { products, cart, addToCart, refreshProducts } = useMall();
  const go = useNavigateMall();
  const toast = useToast();
  const [qty, setQty] = React.useState(1);
  const [adding, setAdding] = React.useState(false);

  React.useEffect(() => { if (!products) refreshProducts(); }, [products, refreshProducts]);

  const key = decodeURIComponent(id);
  const [product, setProduct] = React.useState<MallProduct | null>(null);
  const [detailLoading,setDetailLoading] = React.useState(true);
  const [detailError,setDetailError] = React.useState('');
  React.useEffect(()=>{
    let active=true;
    setDetailLoading(true); setDetailError(''); setProduct(null);
    mallClient.product(key).then(result=>{if(active) setProduct(result.product);})
      .catch(error=>{if(active) setDetailError(error instanceof Error?error.message:'Unable to load product.');})
      .finally(()=>{if(active) setDetailLoading(false);});
    return ()=>{active=false;};
  },[key]);
  React.useEffect(() => {
    if (product) document.title = `${product.name} — IdoferaMall`;
  }, [product]);

  if (detailLoading) {
    return <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 animate-pulse"><div className="h-48 rounded-xl bg-slate-100 dark:bg-slate-800" /></div>;
  }
  if (!product) {
    return (
      <div className="text-center py-16 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900">
        <Package className="w-9 h-9 mx-auto text-slate-300 dark:text-slate-600" />
        <p className="mt-2 text-sm font-extrabold text-slate-700 dark:text-slate-200">{detailError || 'Product not found'}</p>
        <button type="button" onClick={() => go('/')} className="mt-3 h-10 px-5 rounded-xl bg-blue-600 text-white text-sm font-extrabold hover:bg-blue-500">Back to Mall</button>
      </div>
    );
  }

  const inCart = cart?.items.find((i) => i.productId === product.id);
  const purchasable = product.available && hasMallPrice(product.price);
  const related = (products?.products || []).filter((p) => p.id !== product.id && (p.category || '') === (product.category || '')).slice(0, 6);
  const share = async () => {
    const data = { title: product.name, text: `${product.name} on IdoferaMall`, url: window.location.href };
    try {
      if (navigator.share) await navigator.share(data);
      else { await navigator.clipboard.writeText(window.location.href); toast.showToast({ title: 'Link copied', message: 'Product link copied to your clipboard.', type: 'success' }); }
    } catch { /* User cancelled sharing. */ }
  };

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs font-semibold text-slate-500">
        <button type="button" onClick={() => go('/')} className="hover:text-amber-700">Mall</button><ChevronRight className="w-3 h-3" />
        {product.category && <><button type="button" onClick={() => go(`/category/${encodeURIComponent(product.category || '')}`)} className="hover:text-amber-700">{product.category}</button><ChevronRight className="w-3 h-3" /></>}
        <span aria-current="page" className="truncate text-slate-700">{product.name}</span>
      </nav>
      <div className="liquid-glass rounded-2xl text-slate-900 p-4 sm:p-6">
        <div className="grid sm:grid-cols-2 gap-5 sm:gap-8">
          <div className="relative aspect-square rounded-2xl bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <ProductImage src={product.image} alt={product.name} loading="eager" className="absolute inset-0 w-full h-full object-cover" fallbackClassName="absolute inset-0" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-widest text-blue-600 dark:text-blue-400">{product.brand || product.category || 'Idofera Mall'}</p>
            <h1 className="mt-1 text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight leading-tight">{product.name}</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{product.description?.trim() || 'Product description has not been provided yet.'}</p>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900 dark:text-white">{hasMallPrice(product.price) ? formatNaira(product.price) : 'Price unavailable'}</span>
              {hasMallPrice(product.price) && product.retailPriceKobo != null && product.retailPriceKobo > product.price && (
                <span className="text-sm text-slate-400 line-through">{formatNaira(product.retailPriceKobo)}</span>
              )}
            </div>
            {product.wholesaleOffer && hasMallPrice(product.price) && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 px-2.5 py-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                <Package className="w-3.5 h-3.5 shrink-0" /> Buy {product.wholesaleOffer.minQty}+ at {formatNaira(product.wholesaleOffer.price)} each — save {Math.round((1 - product.wholesaleOffer.price / product.price) * 100)}%
              </p>
            )}
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-xl bg-white/60 p-2"><dt className="text-xs text-slate-500">Unit</dt><dd className="font-bold">{product.unit}</dd></div>
              <div className="rounded-xl bg-white/60 p-2"><dt className="text-xs text-slate-500">Availability</dt><dd className="font-bold">{product.stock > 0 ? `${product.stock.toLocaleString('en-NG')} in stock` : 'Out of stock'}</dd></div>
            </dl>
            <div className="mt-4 flex items-center gap-2">
              <MallQuantityControl value={qty} min={1} max={product.stock} onChange={setQty} disabled={adding || !purchasable} label={`${product.name} quantity`} />
              <button
                type="button" disabled={adding || !purchasable}
                onClick={async () => { setAdding(true); try { await addToCart(product.id, qty); } finally { setAdding(false); } }}
                className="flex-1 h-11 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-200 text-white text-sm font-extrabold flex items-center justify-center gap-2"
              >
                <ShoppingCart className="w-4 h-4" /> {!purchasable ? mallUnavailableLabel(product) : adding ? 'Adding…' : inCart ? 'Add More' : 'Add to Cart'}
              </button>
            </div>
            {product.wholesaleOffer && qty >= product.wholesaleOffer.minQty && (
              <p className="mt-2 text-xs font-bold text-emerald-600 dark:text-emerald-400">Wholesale price {formatNaira(product.wholesaleOffer.price)} each applies at this quantity.</p>
            )}
            <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
              <Truck className="w-4 h-4 text-emerald-500" /> Pickup in Uyo • Pay on pickup
            </div>
            <button type="button" onClick={share} className="mt-3 min-h-10 px-3 rounded-xl border border-slate-200 inline-flex items-center gap-2 text-sm font-bold"><Share2 className="w-4 h-4" /> Share product</button>
          </div>
        </div>
      </div>
      {related.length > 0 && (
        <div>
          <h2 className="text-base font-black text-slate-900 dark:text-white mb-2.5">You may also like</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            {related.map((p) => (
              <button key={p.id} type="button" onClick={() => go(`/product/${encodeURIComponent(p.id)}`)} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden text-left hover:border-blue-400">
                <span className="block aspect-square bg-slate-100 dark:bg-slate-800 relative">
                  <ProductImage src={p.image} alt={p.name} className="absolute inset-0 w-full h-full object-cover" fallbackClassName="absolute inset-0" />
                </span>
                <span className="block p-2">
                  <span className="block text-xs font-semibold line-clamp-2 min-h-[2.2em]">{p.name}</span>
                  <span className="block mt-1 text-sm font-black">{hasMallPrice(p.price) ? formatNaira(p.price) : 'Price unavailable'}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
