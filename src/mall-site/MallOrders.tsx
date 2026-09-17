import React from 'react';
import { Check, Search, Copy } from 'lucide-react';
import { useMall } from '../context/MallContext';
import { mallClient, getBuyerProfile } from '../services/mallClient';
import type { MallOrderLookup } from '../types/mall';
import { useNavigateMall } from '../hooks/useRoute';
import { formatNaira } from './mallUi';

export const MallOrderSuccess: React.FC = () => {
  const { order, newSession } = useMall();
  const go = useNavigateMall();
  const [copied, setCopied] = React.useState(false);
  if (!order) {
    return (
      <div className="text-center py-16 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <p className="text-sm font-extrabold">No recent order</p>
        <button type="button" onClick={() => go('/')} className="mt-3 h-10 px-5 rounded-xl bg-blue-600 text-white text-sm font-extrabold">Back to Mall</button>
      </div>
    );
  }
  return (
    <div className="max-w-lg mx-auto text-center rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8">
      <span className="mx-auto w-14 h-14 rounded-full bg-emerald-500 flex items-center justify-center"><Check className="w-7 h-7 text-white" /></span>
      <h1 className="mt-3 text-xl font-black">Order placed!</h1>
      <p className="text-sm text-slate-500 font-semibold">{order.orderNo} • {order.status}</p>
      <button type="button" onClick={async () => { await navigator.clipboard.writeText(order.orderNo); setCopied(true); }} className="mt-2 min-h-10 px-3 rounded-xl border inline-flex items-center gap-2 text-sm font-bold"><Copy className="w-4 h-4" /> {copied ? 'Copied' : 'Copy order number'}</button>
      <div className="mt-4 rounded-xl bg-slate-50 p-3 text-left text-sm">
        <div className="flex justify-between"><span className="text-slate-500">Items</span><strong>{order.items.reduce((sum, item) => sum + item.qty, 0)}</strong></div>
        <div className="mt-1 flex justify-between"><span className="text-slate-500">Delivery</span><strong>{order.quoteRequired ? 'Staff quote pending' : formatNaira(order.deliveryFeeKobo ?? 0)}</strong></div>
        {!order.quoteRequired && <div className="mt-1 flex justify-between"><span className="text-slate-500">Total</span><strong>{formatNaira(order.totalKobo ?? order.subtotalKobo)}</strong></div>}
        {order.customerName && <div className="mt-1 flex justify-between"><span className="text-slate-500">Customer</span><strong>{order.customerName}</strong></div>}
      </div>
      <p className="mt-3 text-xs text-slate-500">{order.quoteRequired ? 'Staff will confirm your delivery fee before the order can be confirmed or paid.' : 'Payment is confirmed by staff during fulfilment.'}</p>
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={() => { newSession(); go('/'); }} className="flex-1 h-11 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-extrabold">Continue Shopping</button>
        <button type="button" onClick={() => go('/orders')} className="flex-1 h-11 rounded-xl bg-blue-600 text-white text-sm font-extrabold">Track Order</button>
      </div>
    </div>
  );
};

export const MallOrders: React.FC = () => {
  const [phone, setPhone] = React.useState('');
  const [rows, setRows] = React.useState<MallOrderLookup[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  React.useEffect(() => {
    const b = getBuyerProfile();
    if (b?.phone) { setPhone(b.phone); lookup(b.phone); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const lookup = async (p: string) => {
    if (p.replace(/\D/g, '').length < 7) { setErr('Enter the phone number used at checkout.'); return; }
    setErr(''); setBusy(true);
    try {
      const r = await mallClient.ordersByPhone(p);
      setRows(r.orders);
      if (!r.orders.length) setErr('No orders found for that phone number yet.');
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };
  return (
    <div className="max-w-xl mx-auto space-y-4">
      <div className="liquid-glass rounded-2xl text-slate-900 p-4">
        <h1 className="text-lg font-black">Track My Orders</h1>
        <p className="text-xs text-slate-400">Enter the phone number used at checkout.</p>
        <form onSubmit={(event) => { event.preventDefault(); lookup(phone); }} className="mt-3 flex gap-2">
          <label htmlFor="order-phone" className="sr-only">Checkout phone number</label>
          <input id="order-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0803…" className="flex-1 h-11 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
          <button type="submit" disabled={busy} className="h-11 px-4 rounded-xl bg-blue-600 text-white text-sm font-extrabold disabled:opacity-50 flex items-center gap-1.5"><Search className="w-4 h-4" /> {busy ? 'Finding…' : 'Find'}</button>
        </form>
        {err && <p className="mt-2 text-sm font-bold text-rose-600" role="alert">{err}</p>}
      </div>
      {rows.length > 0 && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((o) => (
            <div key={o.orderNo} className="p-3.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-black font-mono truncate">{o.orderNo}</p>
                <p className="text-[11px] text-slate-400 font-semibold">{o.itemCount} items • {o.createdAt ? new Date(o.createdAt).toLocaleDateString() : ''}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-black">{formatNaira(o.totalKobo)}</p>
                <span className="text-xs font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300">{o.status}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
