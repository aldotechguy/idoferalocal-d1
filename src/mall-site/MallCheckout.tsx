import React from 'react';
import { User, Zap, Check } from 'lucide-react';
import { useNavigateMall } from '../hooks/useRoute';
import { formatNaira } from './mallUi';
import { MallCartLines } from './MallCartLines';
import { useBuyerForm, validateBuyer, persistBuyer, useCheckoutSubmit } from './useBuyerForm';
import { FormField } from '../components/common/FormField';
import { MALL_DELIVERY_ZONES, mallDeliveryFeeKobo } from '../shared/mallDelivery';

const input = 'w-full h-11 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/60';
export const MallCheckout: React.FC = () => {
  const go = useNavigateMall();
  const f = useBuyerForm();
  const c = useCheckoutSubmit();
  const items = c.cart?.items ?? [];
  const subtotal = c.cart?.subtotalKobo ?? 0;
  const deliveryFee = mallDeliveryFeeKobo(f.deliveryZone);
  const [fieldErrors, setFieldErrors] = React.useState<{ name?: string; phone?: string; address?: string }>({});
  const submit = async () => {
    const v = validateBuyer(f.name, f.phone);
    if (!items.length) { c.setErr('Your cart is empty.'); return; }
    if (v) {
      setFieldErrors({ name: !f.name.trim() ? 'Please enter your full name.' : undefined, phone: f.phone.replace(/\D/g, '').length < 7 ? 'Enter a valid phone number.' : undefined });
      c.setErr(v); return;
    }
    if (f.deliveryZone !== 'pickup' && !f.address.trim()) {
      setFieldErrors({ address: 'Enter the delivery address for this zone.' });
      c.setErr('Enter a delivery address.'); return;
    }
    setFieldErrors({});
    c.setErr(''); c.setBusy(true);
    try {
      persistBuyer(f.mode, f.save, f.name, f.phone, f.address);
      const ok = await c.checkout({ customerName: f.name.trim(), customerPhone: f.phone.trim(), deliveryAddress: f.address.trim(), deliveryZone: f.deliveryZone, paymentMethod: f.pay });
      if (ok) go('/order-success');
    } finally { c.setBusy(false); }
  };
  return (
    <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="grid lg:grid-cols-5 gap-4">
      <div className="lg:col-span-3 space-y-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <h1 className="text-lg font-black">Checkout</h1>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => f.setMode('guest')} className={`rounded-xl border p-3 text-left ${f.mode === 'guest' ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40' : 'border-slate-200 dark:border-slate-700'}`}>
              <Zap className="w-4 h-4 text-amber-500" />
              <span className="block mt-1 text-sm font-extrabold">Guest</span>
              <span className="block text-xs text-slate-500">Use details once</span>
            </button>
            <button type="button" onClick={() => f.setMode('saved')} className={`rounded-xl border p-3 text-left ${f.mode === 'saved' ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40' : 'border-slate-200 dark:border-slate-700'}`}>
              <User className="w-4 h-4 text-blue-500" />
              <span className="block mt-1 text-sm font-extrabold">Remembered details</span>
              <span className="block text-xs text-slate-500">Remember on this device</span>
            </button>
          </div>
        </div>
        <div className="lg:sticky lg:top-24 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
          <FormField label="Full name" required error={fieldErrors.name}><input name="name" autoComplete="name" value={f.name} onChange={(e) => f.setName(e.target.value)} placeholder="e.g. Mfoniso Okon" className={input} /></FormField>
          <FormField label="Phone number" required error={fieldErrors.phone}><input name="phone" type="tel" inputMode="tel" autoComplete="tel" value={f.phone} onChange={(e) => f.setPhone(e.target.value)} placeholder="0803…" className={input} /></FormField>
          <fieldset>
            <legend className="text-sm font-black">Delivery zone</legend>
            <div className="mt-2 grid sm:grid-cols-2 gap-2">{MALL_DELIVERY_ZONES.map((zone) => <label key={zone.id} className={`min-h-12 rounded-xl border p-3 text-sm font-bold flex items-center gap-2 ${f.deliveryZone === zone.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40' : 'border-slate-200 dark:border-slate-700'}`}><input type="radio" name="deliveryZone" value={zone.id} checked={f.deliveryZone === zone.id} onChange={() => f.setDeliveryZone(zone.id)} /><span>{zone.label}<small className="block text-slate-500">{zone.feeKobo == null ? 'Staff quote' : formatNaira(zone.feeKobo)}</small></span></label>)}</div>
          </fieldset>
          <FormField label={f.deliveryZone === 'pickup' ? 'Pickup note (optional)' : 'Delivery address'} required={f.deliveryZone !== 'pickup'} error={fieldErrors.address} hint={f.deliveryZone === 'other' ? 'Staff will confirm the delivery fee before payment.' : undefined}><input name="address" autoComplete="street-address" value={f.address} onChange={(e) => f.setAddress(e.target.value)} placeholder={f.deliveryZone === 'pickup' ? 'Optional pickup instructions' : 'Enter the full delivery address'} className={input} /></FormField>
          <label className="min-h-10 flex items-center gap-2 text-sm font-semibold text-slate-600"><input type="checkbox" checked={f.save} onChange={(e) => f.setSave(e.target.checked)} /> Remember my details on this device</label>
          {c.err && <p className="text-sm font-bold text-rose-600" role="alert">{c.err}</p>}
        </div>
        <fieldset className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <legend className="px-1 text-sm font-black">Payment method</legend>
          <div className="mt-2 grid sm:grid-cols-2 gap-2">
            <label className={`min-h-12 rounded-xl border p-3 text-sm font-bold flex items-center gap-2 ${f.pay === 'pay_on_pickup' ? 'border-amber-500 bg-amber-50' : 'border-slate-200'}`}><input type="radio" name="payment" value="pay_on_pickup" checked={f.pay === 'pay_on_pickup'} onChange={() => f.setPay('pay_on_pickup')} /> Pay on pickup</label>
            <label className={`min-h-12 rounded-xl border p-3 text-sm font-bold flex items-center gap-2 ${f.pay === 'bank_transfer' ? 'border-amber-500 bg-amber-50' : 'border-slate-200'}`}><input type="radio" name="payment" value="bank_transfer" checked={f.pay === 'bank_transfer'} onChange={() => f.setPay('bank_transfer')} /> Bank transfer</label>
          </div>
        </fieldset>
      </div>
      <div className="lg:col-span-2">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
          <h2 className="text-sm font-black">Order Summary</h2>
          <MallCartLines />
          <div className="flex justify-between text-sm"><span className="text-slate-500">Subtotal</span><span className="font-black">{formatNaira(subtotal)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-slate-500">Delivery</span><span className="font-black">{deliveryFee == null ? 'Staff quote' : formatNaira(deliveryFee)}</span></div>
          {deliveryFee != null && <div className="flex justify-between text-sm border-t pt-2"><span className="font-bold">Total</span><span className="font-black">{formatNaira(subtotal + deliveryFee)}</span></div>}
          <p className="text-xs text-slate-500">Fixed-zone fees are calculated securely at checkout. Other locations are confirmed by staff before payment.</p>
          <button type="submit" disabled={c.busy || !items.length} className="w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-200 text-white text-sm font-extrabold flex items-center justify-center gap-2">
            {c.busy ? 'Placing order…' : <><Check className="w-4 h-4" /> Place Order</>}
          </button>
        </div>
      </div>
    </form>
  );
};
