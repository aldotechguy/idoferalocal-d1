import React from 'react';
import { Trash2, Package } from 'lucide-react';
import { useMall } from '../context/MallContext';
import { formatNaira } from './mallUi';
import { MallQuantityControl } from './MallQuantityControl';

export const MallCartLines: React.FC = () => {
  const { cart, setCartQty } = useMall();
  const items = cart?.items ?? [];
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 py-10 text-center">
        <Package className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600" />
        <p className="mt-2 text-sm font-extrabold">Your cart is empty</p>
        <p className="text-xs text-slate-400 mt-1">Add items from the mall to get started.</p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
      {items.map((it) => (
        <div key={it.productId} className="flex gap-3 p-3">
          <span className="w-16 h-16 rounded-xl bg-slate-100 dark:bg-slate-800 overflow-hidden shrink-0 relative">
            {it.image ? <img src={it.image} alt={it.name} className="absolute inset-0 w-full h-full object-cover" /> : null}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold line-clamp-2 leading-snug">{it.name}</p>
            <p className="text-xs font-black mt-0.5">
              {formatNaira(it.price)}
              {it.listPrice != null && it.price < it.listPrice && <span className="ml-1.5 rounded-md bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 text-[10px] font-black text-emerald-600 dark:text-emerald-400">Wholesale</span>}
              <span className="ml-1 font-semibold text-slate-400">x {it.qty}</span>
            </p>
            <div className="mt-1.5 flex items-center gap-1.5">
              <MallQuantityControl value={it.qty} min={0} max={it.stock} onChange={(quantity) => setCartQty(it.productId, quantity)} compact label={`${it.name} quantity`} />
              <button type="button" onClick={() => setCartQty(it.productId, 0)} className="ml-auto p-1.5 text-slate-400 hover:text-rose-500" aria-label="Remove"><Trash2 className="w-4 h-4" /></button>
            </div>
          </div>
          <span className="text-[13px] font-black shrink-0">{formatNaira(it.qty * it.price)}</span>
        </div>
      ))}
    </div>
  );
};
