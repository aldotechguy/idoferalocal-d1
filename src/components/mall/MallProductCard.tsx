import React from 'react';
import { ShoppingCart, Minus, Plus, Package } from 'lucide-react';
import { useMall } from '../../context/MallContext';
import type { MallProduct } from '../../types/mall';

interface Props {
  product: MallProduct;
}

function toNaira(kobo: number): string {
  const naira = kobo / 100;
  return '₦' + Number(naira.toFixed(2)).toLocaleString('en-NG');
}

export const MallProductCard: React.FC<Props> = ({ product }) => {
  const { cart, addToCart, setCartQty } = useMall();
  const [adding, setAdding] = React.useState(false);

  const inCart = cart?.items.find((i) => i.productId === product.id);
  const cartQty = inCart?.qty ?? 0;
  const maxAdd = product.available ? Math.max(0, Math.min(99, (product.stock || 0) - (cartQty || 0))) : 0;

  const handleAdd = React.useCallback(async (qty: number) => {
    if (!product.available) return;
    if (qty < 1 || qty > 99) return;
    setAdding(true);
    try {
      await addToCart(product.id, qty);
    } finally {
      setAdding(false);
    }
  }, [product, addToCart]);

  const handleQtyChange = React.useCallback(async (next: number) => {
    if (next < 0 || next > 99) return;
    if (next === cartQty) return;
    setAdding(true);
    try {
      await setCartQty(product.id, next);
    } finally {
      setAdding(false);
    }
  }, [product.id, cartQty, setCartQty]);

  const increment = () => {
    if (maxAdd < 1) return;
    handleAdd(cartQty + 1);
  };
  const decrement = () => {
    if (cartQty <= 0) return;
    handleQtyChange(cartQty - 1);
  };

  return (
    <div className="group relative flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs hover:shadow-md hover:border-blue-300 dark:hover:border-blue-700 transition-all duration-200">
      {/* Image */}
      <div className="relative aspect-[4/3] bg-slate-100 dark:bg-slate-800 overflow-hidden">
        {product.image ? (
          <img
            src={product.image}
            alt={product.name}
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-slate-300 dark:text-slate-600">
            <Package className="w-10 h-10" />
          </div>
        )}
        {!product.available && (
          <div className="absolute inset-0 bg-slate-900/50 flex items-center justify-center">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200 dark:text-slate-400">Out of stock</span>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col p-3 space-y-2 min-h-0">
        <div className="min-h-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 truncate">
            {product.unit}
          </p>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white leading-snug mt-0.5 line-clamp-2">
            {product.name}
          </h3>
        </div>

        <div className="flex items-baseline justify-between">
          <span className="text-base font-extrabold text-blue-600 dark:text-blue-400">
            {toNaira(product.price)}
          </span>
          <span className="text-[11px] text-slate-400 dark:text-slate-500">
            {product.available ? `${product.stock} left` : 'Unavailable'}
          </span>
        </div>

        {/* Qty controls */}
        <div className="flex items-center gap-1.5 mt-auto">
          {cartQty > 0 ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={decrement}
                disabled={adding || cartQty <= 0}
                className="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center justify-center text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                aria-label="Decrease quantity"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="w-8 text-center text-sm font-extrabold text-slate-900 dark:text-white">
                {cartQty}
              </span>
              <button
                type="button"
                onClick={increment}
                disabled={adding || maxAdd < 1}
                className="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center justify-center text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                aria-label="Increase quantity"
              >
                <Plus className="w-4 h-4" />
              </button>
              <span className="ml-1 text-[11px] text-slate-400 dark:text-slate-500">
                {toNaira((cartQty * product.price))}
              </span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => handleAdd(1)}
              disabled={adding || !product.available || maxAdd < 1}
              className="flex items-center gap-1.5 h-9 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-400 text-white text-xs font-extrabold transition-colors"
            >
              <ShoppingCart className="w-4 h-4" />
              Add
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
