import React from 'react';
import { ShoppingCart, Truck, Package } from 'lucide-react';
import { useMall } from '../context/MallContext';
import { useNavigateMall } from '../hooks/useRoute';
import { formatNaira } from './mallUi';
import { MallQuantityControl } from './MallQuantityControl';

export const MallProductPage: React.FC<{ id: string }> = ({ id }) => {
  const { products, cart, addToCart, refreshProducts } = useMall();
  const go = useNavigateMall();
  const [qty, setQty] = React.useState(1);
  const [adding, setAdding] = React.useState(false);

  React.useEffect(() => { if (!products) refreshProducts(); }, [products, refreshProducts]);

  const key = decodeURIComponent(id);
  const product = products?.products.find((p) => p.id === id || p.id === key);

  if (!products) {
    return <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 animate-pulse"><div className="h-48 rounded-xl bg-slate-100 dark:bg-slate-800" /></div>;
  }
  if (!product) {
    return (
      <div className="text-center py-16 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900">
        <Package className="w-9 h-9 mx-auto text-slate-300 dark:text-slate-600" />
        <p className="mt-2 text-sm font-extrabold text-slate-700 dark:text-slate-200">Product not found</p>
        <button type="button" onClick={() => go('/')} className="mt-3 h-10 px-5 rounded-xl bg-blue-600 text-white text-sm font-extrabold hover:bg-blue-500">Back to Mall</button>
      </div>
    );
  }

  const inCart = cart?.items.find((i) => i.productId === product.id);
  const related = products.products.filter((p) => p.id !== product.id && (p.category || '') === (product.category || '')).slice(0, 6);

  return (
    <div className="space-y-6">
      <div className="liquid-glass rounded-2xl text-slate-900 p-4 sm:p-6">
        <div className="grid sm:grid-cols-2 gap-5 sm:gap-8">
          <div className="relative aspect-square rounded-2xl bg-slate-100 dark:bg-slate-800 overflow-hidden">
            {product.image ? <img src={product.image} alt={product.name} className="absolute inset-0 w-full h-full object-cover" /> : <span className="absolute inset-0 flex items-center justify-center text-slate-300"><Package className="w-12 h-12" /></span>}
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-widest text-blue-600 dark:text-blue-400">{product.brand || product.category || 'Idofera Mall'}</p>
            <h1 className="mt-1 text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight leading-tight">{product.name}</h1>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900 dark:text-white">{formatNaira(product.price)}</span>
              {product.retailPriceKobo != null && product.retailPriceKobo > product.price && (
                <span className="text-sm text-slate-400 line-through">{formatNaira(product.retailPriceKobo)}</span>
              )}
            </div>
            <p className="mt-1 text-xs font-semibold text-slate-400">{product.available ? `${product.stock} in stock` : 'Out of stock'}</p>
            <div className="mt-4 flex items-center gap-2">
              <MallQuantityControl value={qty} min={1} max={product.stock} onChange={setQty} label={`${product.name} quantity`} />
              <button
                type="button" disabled={adding || !product.available}
                onClick={async () => { setAdding(true); try { await addToCart(product.id, qty); } finally { setAdding(false); } }}
                className="flex-1 h-11 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-200 text-white text-sm font-extrabold flex items-center justify-center gap-2"
              >
                <ShoppingCart className="w-4 h-4" /> {adding ? 'Adding…' : inCart ? 'Add More' : 'Add to Cart'}
              </button>
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
              <Truck className="w-4 h-4 text-emerald-500" /> Pickup in Uyo • Pay on pickup
            </div>
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
                  {p.image ? <img src={p.image} alt={p.name} loading="lazy" className="absolute inset-0 w-full h-full object-cover" /> : null}
                </span>
                <span className="block p-2">
                  <span className="block text-xs font-semibold line-clamp-2 min-h-[2.2em]">{p.name}</span>
                  <span className="block mt-1 text-sm font-black">{formatNaira(p.price)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
