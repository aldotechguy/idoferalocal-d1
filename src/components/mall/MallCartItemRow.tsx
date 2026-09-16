import React from 'react';
import { Minus, Plus, Trash2, Package } from 'lucide-react';
import { useMall } from '../../context/MallContext';
import type { MallCartItem } from '../../types/mall';

function toNaira(kobo: number): string {
  const naira = kobo / 100;
  return '₦' + Number(naira.toFixed(2)).toLocaleString('en-NG');
}

interface Props {
  item: MallCartItem;
}

export const MallCartItemRow: React.FC<Props> = ({ item }) => {
  const { setCartQty, removeFromCart } = useMall();
  const [changing, setChanging] = React.useState(false);
  const lineTotal = item.qty * item.price;

  const setQty = React.useCallback(async (next: number) => {
    if (next === item.qty) return;
    setChanging(true);
    try {
      await setCartQty(item.productId, next);
    } finally {
      setChanging(false);
    }
  }, [item.productId, item.qty, setCartQty]);

  return (
    <div className="flex gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60">
      <div className="relative w-16 h-16 shrink-0 rounded-lg bg-slate-200 dark:bg-slate-700 overflow-hidden">
        {item.image ? (
          <img src={item.image} alt={item.name} className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-slate-400">
            <Package className="w-5 h-5" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{item.name}</p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
          {item.unit} · {toNaira(item.price)} each
        </p>
        <p className="text-xs font-bold text-blue-600 dark:text-blue-400 mt-1">{toNaira(lineTotal)}</p>

        <div className="flex items-center gap-1.5 mt-2">
          <button
            type="button"
            onClick={() => setQty(item.qty - 1)}
            disabled={changing || item.qty <= 0}
            className="w-7 h-7 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 flex items-center justify-center text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label="Decrease quantity"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span className="w-6 text-center text-sm font-extrabold text-slate-900 dark:text-white">
            {item.qty}
          </span>
          <button
            type="button"
            onClick={() => setQty(item.qty + 1)}
            disabled={changing || item.qty >= 99}
            className="w-7 h-7 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 flex items-center justify-center text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label="Increase quantity"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => removeFromCart(item.productId)}
            disabled={changing || item.qty === 0}
            className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-40 transition-colors"
            aria-label="Remove item"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
