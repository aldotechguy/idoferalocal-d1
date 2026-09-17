import React from 'react';
import { Check, Camera } from 'lucide-react';
import type { MallOrder } from '../../types/mall';

function toNaira(kobo: number): string {
  const naira = kobo / 100;
  return '₦' + Number(naira.toFixed(2)).toLocaleString('en-NG');
}

interface Props {
  order: MallOrder;
  onClose: () => void;
}

export const MallReceipt: React.FC<Props> = ({ order, onClose }) => {
  const [printing, setPrinting] = React.useState(false);

  const handlePrint = async () => {
    setPrinting(true);
    await new Promise((r) => setTimeout(r, 50));
    window.print();
    setPrinting(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center p-4 bg-emerald-50 dark:bg-emerald-950/30 rounded-2xl border border-emerald-200 dark:border-emerald-800">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-500 rounded-full">
            <Check className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-extrabold text-emerald-700 dark:text-emerald-300">Order Placed</p>
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400">{order.orderNo}</p>
          </div>
        </div>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-500 dark:text-slate-400">Order</span>
          <span className="font-bold text-slate-900 dark:text-white font-mono text-xs">{order.orderNo}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500 dark:text-slate-400">Delivery</span>
          <span className="font-bold text-slate-900 dark:text-white">{order.quoteRequired ? 'Staff quote pending' : toNaira(order.deliveryFeeKobo ?? 0)}</span>
        </div>
        {!order.quoteRequired && order.totalKobo != null && (
          <div className="flex justify-between">
            <span className="font-bold text-slate-700 dark:text-slate-300">Total</span>
            <span className="font-black text-slate-900 dark:text-white">{toNaira(order.totalKobo)}</span>
          </div>
        )}
        {order.customerName && (
          <div className="flex justify-between">
            <span className="text-slate-500 dark:text-slate-400">Customer</span>
            <span className="font-semibold text-slate-900 dark:text-white truncate">{order.customerName}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-slate-500 dark:text-slate-400">Status</span>
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-md">
            {order.status}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500 dark:text-slate-400">Items</span>
          <span className="font-semibold text-slate-900 dark:text-white">{order.items.length}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500 dark:text-slate-400">Subtotal</span>
          <span className="font-bold text-slate-900 dark:text-white">{toNaira(order.subtotalKobo)}</span>
        </div>
        {order.paidKobo != null && (
          <div className="flex justify-between">
            <span className="text-slate-500 dark:text-slate-400">Paid</span>
            <span className="font-bold text-emerald-600 dark:text-emerald-400">{toNaira(order.paidKobo)}</span>
          </div>
        )}
      </div>

      <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-3 border border-slate-200 dark:border-slate-700/60 max-h-44 overflow-y-auto">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">Items</p>
        <div className="space-y-1.5 text-xs">
          {order.items.map((item) => (
            <div key={item.productId} className="flex justify-between gap-2">
              <span className="text-slate-600 dark:text-slate-400 truncate">
                {item.qty}× {item.name}
              </span>
              <span className="font-semibold text-slate-900 dark:text-white shrink-0">
                {toNaira(item.qty * item.price)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handlePrint}
          disabled={printing}
          className="flex-1 h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-extrabold hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          <Camera className="w-4 h-4" />
          {printing ? 'Printing…' : 'Print / Save PDF'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex-1 h-10 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-extrabold transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
};
