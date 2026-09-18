import React from 'react';
import { ShoppingCart } from 'lucide-react';
import { useMall } from '../context/MallContext';
import { useNavigateMall } from '../hooks/useRoute';
import type { MallProduct } from '../types/mall';
import { formatNaira, discountPct } from './mallUi';
import { MallQuantityControl } from './MallQuantityControl';
import { ProductImage } from '../components/common/ProductImage';
import { hasMallPrice, mallStockLabel, mallUnavailableLabel } from '../shared/mallProductPresentation';

export const MallProductCard: React.FC<{ product: MallProduct }> = ({ product }) => {
  const { cart, addToCart, setCartQty } = useMall();
  const go = useNavigateMall();
  const [adding, setAdding] = React.useState(false);
  const inCart = cart?.items.find((i) => i.productId === product.id);
  const qty = inCart?.qty ?? 0;
  const pct = discountPct(product);
  const purchasable = product.available && hasMallPrice(product.price);

  const change = async (next: number) => {
    if (!purchasable || next < 0 || next > product.stock) return false;
    setAdding(true);
    try { return await setCartQty(product.id, next); } finally { setAdding(false); }
  };

  return (
    <div className="group relative flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden hover:shadow-lg hover:border-blue-300 dark:hover:border-blue-700 hover:-translate-y-0.5 transition-all duration-200">
      <button type="button" onClick={() => go(`/product/${encodeURIComponent(product.id)}`)} className="relative aspect-square bg-slate-100 dark:bg-slate-800 overflow-hidden text-left" aria-label={product.name}>
        <ProductImage src={product.image} alt={product.name} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" fallbackClassName="absolute inset-0" />
        {pct != null && (
          <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-rose-600 text-white text-[10px] font-black shadow">-{pct}%</span>
        )}
        {!purchasable && (
          <span className="absolute inset-0 bg-slate-900/55 flex items-center justify-center text-[11px] font-bold uppercase tracking-wider text-white">{mallUnavailableLabel(product)}</span>
        )}
      </button>
      <div className="flex-1 flex flex-col p-2.5 sm:p-3 gap-1 min-h-0">
        <button type="button" onClick={() => go(`/product/${encodeURIComponent(product.id)}`)} className="text-left min-h-0">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 truncate">{product.brand || product.category || product.unit}</span>
          <span className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100 leading-snug line-clamp-2 min-h-[2.4em]">{product.name}</span>
        </button>
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="text-[15px] font-black text-slate-900 dark:text-white">{hasMallPrice(product.price) ? formatNaira(product.price) : 'Price unavailable'}</span>
          {pct != null && product.retailPriceKobo != null && (
            <span className="text-[11px] text-slate-400 line-through">{formatNaira(product.retailPriceKobo)}</span>
          )}
        </div>
        <p className="text-xs text-slate-500 font-medium">{product.unit}{product.unit ? ' • ' : ''}{mallStockLabel(product.stock)}</p>
        <div className="mt-auto pt-1.5">
          {qty > 0 && purchasable ? (
            <MallQuantityControl value={qty} min={0} max={product.stock} onChange={change} disabled={adding} compact label={`${product.name} quantity`} />
          ) : (
            <button
              type="button" onClick={async () => { setAdding(true); try { await addToCart(product.id, 1); } finally { setAdding(false); } }}
              disabled={adding || !purchasable}
              className="w-full h-9 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-400 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 transition-colors"
            >
              <ShoppingCart className="w-4 h-4" /> {purchasable ? 'Add to Cart' : mallUnavailableLabel(product)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
