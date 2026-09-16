import React from 'react';
import { User, Zap, Check } from 'lucide-react';
import { useNavigateMall } from '../hooks/useRoute';
import { formatNaira } from './mallUi';
import { MallCartLines } from './MallCartLines';
import { useBuyerForm, validateBuyer, persistBuyer, useCheckoutSubmit } from './useBuyerForm';

const input = 'w-full h-11 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/60';
const label = 'block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1';

export const MallCheckout: React.FC = () => {
  const go = useNavigateMall();
  const f = useBuyerForm();
  const c = useCheckoutSubmit();
  const items = c.cart?.items ?? [];
  const subtotal = c.cart?.subtotalKobo ?? 0;
  const submit = async () => {
    const v = validateBuyer(f.name, f.phone);
    if (!items.length) { c.setErr('Your cart is empty.'); return; }
    if (v) { c.setErr(v); return; }
    c.setErr(''); c.setBusy(true);
    try {
      persistBuyer(f.mode, f.save, f.name, f.phone, f.address);
      const ok = await c.checkout({ customerName: f.name.trim(), customerPhone: f.phone.trim(), deliveryAddress: f.address.trim(), paymentMethod: f.pay });
      if (ok) go('/order-success');
    } finally { c.setBusy(false); }
  };
  return (
    <div className="grid lg:grid-cols-5 gap-4">
      <div className="lg:col-span-3 space-y-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <h1 className="text-lg font-black">Checkout</h1>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => f.setMode('guest')} className={`rounded-xl border p-3 text-left ${f.mode === 'guest' ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40' : 'border-slate-200 dark:border-slate-700'}`}>
              <Zap className="w-4 h-4 text-amber-500" />
              <span className="block mt-1 text-sm font-extrabold">Guest</span>
              <span className="block text-[11px] text-slate-400">Fast, no details saved</span>
            </button>
            <button type="button" onClick={() => f.setMode('saved')} className={`rounded-xl border p-3 text-left ${f.mode === 'saved' ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40' : 'border-slate-200 dark:border-slate-700'}`}>
              <User className="w-4 h-4 text-blue-500" />
              <span className="block mt-1 text-sm font-extrabold">Buyer Account</span>
              <span className="block text-[11px] text-slate-400">Save details on device</span>
            </button>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
          <div><label className={label}>Full name</label><input value={f.name} onChange={(e) => f.setName(e.target.value)} placeholder="e.g. Mfoniso Okon" className={input} /></div>
          <div><label className={label}>Phone number</label><input value={f.phone} onChange={(e) => f.setPhone(e.target.value)} placeholder="0803…" className={input} /></div>
          <div><label className={label}>Pickup / delivery note</label><input value={f.address} onChange={(e) => f.setAddress(e.target.value)} placeholder="Pickup in Uyo or delivery address" className={input} /></div>
          {c.err && <p className="text-xs font-bold text-rose-500">{c.err}</p>}
        </div>
      </div>
      <div className="lg:col-span-2">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
          <h2 className="text-sm font-black">Order Summary</h2>
          <MallCartLines />
          <div className="flex justify-between text-sm"><span className="text-slate-500">Subtotal</span><span className="font-black">{formatNaira(subtotal)}</span></div>
          <button type="button" onClick={submit} disabled={c.busy || !items.length} className="w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-200 text-white text-sm font-extrabold flex items-center justify-center gap-2">
            {c.busy ? 'Placing order…' : <><Check className="w-4 h-4" /> Place Order</>}
          </button>
        </div>
      </div>
    </div>
  );
};
