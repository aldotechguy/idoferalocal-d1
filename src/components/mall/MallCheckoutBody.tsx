import React from 'react';
import { ShoppingCart } from 'lucide-react';
import type { MallCartItem } from '../../types/mall';

function toNaira(kobo: number): string {
  const naira = kobo / 100;
  return '₦' + Number(naira.toFixed(2)).toLocaleString('en-NG');
}

interface Props {
  items: MallCartItem[];
  subtotal: number;
  customerName: string;
  setCustomerName: (v: string) => void;
  submitting: boolean;
  onSubmit: () => void;
}

export const CheckoutBody: React.FC<Props> = ({
  items,
  subtotal,
  customerName,
  setCustomerName,
  submitting,
  onSubmit,
}) => (
  <>
    <ItemList items={items} />
    <CustomerField value={customerName} onChange={setCustomerName} />
    <OrderTotal subtotal={subtotal} />
    <SubmitButton submitting={submitting} onSubmit={onSubmit} hasItems={items.length > 0} />
    <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center">Payment is confirmed by staff during fulfilment.</p>
  </>
);

const ItemList: React.FC<{ items: MallCartItem[] }> = ({ items }) => (
  <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-3 border border-slate-200 dark:border-slate-700/60 max-h-44 overflow-y-auto">
    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
      {items.length} item({items.length === 1 ? '' : 's'})
    </p>
    <div className="space-y-1.5 text-xs">
      {items.map((item) => (
        <div key={item.productId} className="flex justify-between gap-2">
          <span className="text-slate-600 dark:text-slate-400 truncate">{item.qty}× {item.name}</span>
          <span className="font-semibold text-slate-900 dark:text-white shrink-0">{toNaira(item.qty * item.price)}</span>
        </div>
      ))}
    </div>
  </div>
);

const CustomerField: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => (
  <div>
    <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
      Customer name
    </label>
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
      placeholder="Walk-in customer"
    />
  </div>
);

const OrderTotal: React.FC<{ subtotal: number }> = ({ subtotal }) => (
  <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-1.5 text-sm mt-2">
      <div className="flex justify-between">
        <span className="text-slate-500 dark:text-slate-400">Subtotal</span>
        <span className="font-bold text-slate-900 dark:text-white">{toNaira(subtotal)}</span>
      </div>
  </div>
);

const SubmitButton: React.FC<{ submitting: boolean; onSubmit: () => void; hasItems: boolean }> = ({
  submitting,
  onSubmit,
  hasItems,
}) => (
  <button
    type="button"
    onClick={onSubmit}
    disabled={submitting || !hasItems}
    className="w-full h-11 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-400 text-white text-sm font-extrabold transition-colors flex items-center justify-center gap-2"
  >
    {submitting ? (
      <span className="animate-pulse">Placing order…</span>
    ) : (
      <>
        <ShoppingCart className="w-4 h-4" />
        Place Order
      </>
    )}
  </button>
);
