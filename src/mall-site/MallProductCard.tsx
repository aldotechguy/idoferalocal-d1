import React from 'react';
import { ShoppingCart, Minus, Plus, Package } from 'lucide-react';
import { useMall } from '../context/MallContext';
import { useNavigateMall } from '../hooks/useRoute';
import type { MallProduct } from '../types/mall';
import { formatNaira, discountPct, soldCount, Stars } from './mallUi';

export const MallProductCard: React.FC<{ product: MallProduct }> = ({ product }) => {
  const { cart, addToCart, setCartQty } = useMall();
  const go = useNavigateMall();
  const [adding, setAdding] = React.useState(false);
  const inCart = cart?.items.find((i) => i.productId === product.id);
  const qty = inCart?.qty ?? 0;
  const pct = discountPct(product);

  const change = async (next: number) => {
    if (next < 0 || next > 99) return;
    setAdding(true);
    try { await setCartQty(product.id, next); } finally { setAdding(false); }
  };

  return (
    <div className="group relative flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden hover:shadow-lg hover:border-blue-300 dark:hover:border-blue-700 hover:-translate-y-0.5 transition-all duration-200">
      <button type="button" onClick={() => go(`/product/${encodeURIComponent(product.id)}`)} className="relative aspect-square bg-slate-100 dark:bg-slate-800 overflow-hidden text-left" aria-label={product.name}>
        {product.image ? (
          <img src={product.image} alt={product.name} loading="lazy" className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-slate-300 dark:text-slate-600"><Package className="w-10 h-10" /></span>
        )}
        {pct != null && (
          <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-rose-600 text-white text-[10px] font-black shadow">-{pct}%</span>
        )}
        {!product.available && (
          <span className="absolute inset-0 bg-slate-900/55 flex items-center justify-center text-[11px] font-bold uppercase tracking-wider text-white">Out of stock</span>
        )}
      </button>
      <div className="flex-1 flex flex-col p-2.5 sm:p-3 gap-1 min-h-0">
        <button type="button" onClick={() => go(`/product/${encodeURIComponent(product.id)}`)} className="text-left min-h-0">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 truncate">{product.brand || product.category || product.unit}</span>
          <span className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100 leading-snug line-clamp-2 min-h-[2.4em]">{product.name}</span>
        </button>
        <Stars seed={product.id} />
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="text-[15px] font-black text-slate-900 dark:text-white">{formatNaira(product.price)}</span>
          {pct != null && product.retailPriceKobo != null && (
            <span className="text-[11px] text-slate-400 line-through">{formatNaira(product.retailPriceKobo)}</span>
          )}
        </div>
        <p className="text-[10px] text-slate-400 font-medium">{soldCount(product)} sold • {product.available ? `${product.stock} left` : 'Unavailable'}</p>
        <div className="mt-auto pt-1.5">
          {qty > 0 ? (
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => change(qty - 1)} disabled={adding} className="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40" aria-label="Decrease"><Minus className="w-4 h-4" /></button>
              <span className="w-7 text-center text-sm font-extrabold text-slate-900 dark:text-white">{qty}</span>
              <button type="button" onClick={() => change(qty + 1)} disabled={adding} className="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40" aria-label="Increase"><Plus className="w-4 h-4" /></button>
            </div>
          ) : (
            <button
              type="button" onClick={async () => { setAdding(true); try { await addToCart(product.id, 1); } finally { setAdding(false); } }}
              disabled={adding || !product.available}
              className="w-full h-9 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-400 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 transition-colors"
            >
              <ShoppingCart className="w-4 h-4" /> Add to Cart
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
