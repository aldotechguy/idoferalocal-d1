import React from 'react';
import { Banknote, CheckCircle2, PackageCheck, RefreshCw, Search, XCircle } from 'lucide-react';
import { AccessibleOverlay } from '../common/AccessibleOverlay';
import { AsyncState } from '../common/AsyncState';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { staffMallClient, type StaffMallOrder } from '../../services/staffMallClient';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending review', confirmed: 'Confirmed', processing: 'Processing', packed: 'Packed',
  ready_for_pickup: 'Ready for pickup', out_for_delivery: 'Out for delivery', completed: 'Completed',
  cancelled: 'Cancelled', refunded: 'Refunded',
};
const money = (kobo: number) => `₦${(kobo / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const NEXT_ACTION: Record<string, { action: 'start-processing' | 'mark-packed' | 'mark-ready' | 'mark-out-for-delivery' | 'complete'; label: string }> = {
  confirmed: { action: 'start-processing', label: 'Start Processing' },
  processing: { action: 'mark-packed', label: 'Mark Packed' },
  packed: { action: 'mark-ready', label: 'Mark Ready for Pickup' },
  ready_for_pickup: { action: 'complete', label: 'Complete Pickup' },
  out_for_delivery: { action: 'complete', label: 'Mark Delivered' },
};

export const MallOrdersView: React.FC = () => {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const [orders, setOrders] = React.useState<StaffMallOrder[]>([]);
  const [selected, setSelected] = React.useState<StaffMallOrder | null>(null);
  const [status, setStatus] = React.useState('all');
  const [query, setQuery] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [paymentMethod, setPaymentMethod] = React.useState('Cash');
  const [reference, setReference] = React.useState('');
  const [cancelReason, setCancelReason] = React.useState('Customer requested cancellation');
  const [refundReason, setRefundReason] = React.useState('Customer refund');
  const [returnDecision, setReturnDecision] = React.useState('');
  const [quoteNaira, setQuoteNaira] = React.useState('');
  const [courier,setCourier]=React.useState('');
  const [returnReference,setReturnReference]=React.useState('');
  const [operations,setOperations]=React.useState<any>(null);
  const manager = ['Administrator','Store Manager','Accountant'].includes(currentUser?.role || '');

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await staffMallClient.list({ status, q: query.trim(), limit: 100 });
      setOrders(data.orders); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  }, [query, status]);

  React.useEffect(() => { load(); const timer=setInterval(load,60000); return ()=>clearInterval(timer); }, [load]);
  React.useEffect(()=>{ if(!manager) return; const refresh=()=>staffMallClient.operations().then(setOperations).catch(()=>setOperations(null)); refresh(); const timer=setInterval(refresh,60000); return ()=>clearInterval(timer); },[manager]);

  const open = async (order: StaffMallOrder) => {
    setReturnDecision(''); setReturnReference(''); setCourier(order.dispatch?.courier || ''); setSelected(order); setReference(order.payment.reference || '');
    setQuoteNaira(order.delivery.quoteConfirmed ? String(order.deliveryFeeKobo / 100) : '');
    try { setSelected((await staffMallClient.detail(order.id)).order); } catch (err) {
      showToast({ title: 'Order details failed', message: err instanceof Error ? err.message : String(err), type: 'error' });
    }
  };
  const act = async (operation: () => Promise<{ order: StaffMallOrder }>, success: string) => {
    setBusy(true);
    try {
      const result = await operation(); setSelected(result.order); await load();
      showToast({ title: success, message: result.order.orderNo, type: 'success' });
    } catch (err) { showToast({ title: 'Mall order action failed', message: err instanceof Error ? err.message : String(err), type: 'error' }); }
    finally { setBusy(false); }
  };
  const activeCount = orders.filter((order) => !['completed', 'cancelled', 'refunded'].includes(order.status)).length;

  return <div className="space-y-4">
    {manager && <section className="rounded-xl border p-4 space-y-2"><h2 className="font-bold">Operational readiness</h2>{operations ? <><p>{operations.readiness.ready ? 'Checks passing' : 'Action required before unattended operation'}</p><ul className="text-sm">{Object.entries(operations.readiness.checks).map(([key,value])=><li key={key}>{key}: {value?'OK':'Needs attention'}</li>)}</ul><p className="text-sm">Notifications: {operations.notifications.map((n:any)=>`${n.status}: ${n.count}`).join(', ') || 'No pending events'}</p>{['Administrator','Store Manager'].includes(currentUser?.role || '') && <button className="rounded border px-3 py-2" onClick={async()=>{try{await staffMallClient.retryNotifications();setOperations(await staffMallClient.operations());}catch(error){showToast({title:'Retry failed',message:String(error),type:'error'});}}}>Retry failed notifications</button>}</> : <p>Operational checks unavailable. Do not assume readiness.</p>}</section>}
    <div className="grid sm:grid-cols-3 gap-3">
      <div className="rounded-2xl border bg-white dark:bg-slate-900 p-4"><p className="text-xs font-bold text-slate-500">Actionable</p><p className="text-2xl font-black">{activeCount}</p></div>
      <div className="rounded-2xl border bg-white dark:bg-slate-900 p-4"><p className="text-xs font-bold text-slate-500">Awaiting payment</p><p className="text-2xl font-black">{orders.filter((o) => o.payment.status === 'pending').length}</p></div>
      <div className="rounded-2xl border bg-white dark:bg-slate-900 p-4"><p className="text-xs font-bold text-slate-500">Processing</p><p className="text-2xl font-black">{orders.filter((o) => o.status === 'processing').length}</p></div>
    </div>
    <div className="rounded-2xl border bg-white dark:bg-slate-900 p-3 flex flex-col sm:flex-row gap-2">
      <label className="flex-1 relative"><span className="sr-only">Search Mall orders</span><Search className="absolute left-3 top-3 w-4 h-4 text-slate-400"/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Order number, transfer reference, customer or phone" className="w-full h-10 pl-9 pr-3 rounded-xl border bg-transparent text-sm" /></label>
      <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 px-3 rounded-xl border bg-transparent text-sm font-bold"><option value="all">All statuses</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <button type="button" onClick={load} className="h-10 px-3 rounded-xl border inline-flex items-center justify-center gap-2 text-sm font-bold"><RefreshCw className="w-4 h-4"/> Refresh</button>
    </div>
    {loading ? <AsyncState busy title="Loading Mall orders" /> : error ? <AsyncState title="Mall orders unavailable" message={error} onRetry={load} /> : !orders.length ? <AsyncState title="No Mall orders found" message="New storefront orders will appear here." /> :
      <div className="rounded-2xl border bg-white dark:bg-slate-900 divide-y dark:divide-slate-800">{orders.map((order) => <button type="button" key={order.id} onClick={() => open(order)} className="w-full p-4 text-left flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/60">
        <div className="min-w-0"><p className="font-black font-mono text-sm">{order.orderNo}</p><p className="text-xs text-slate-500 truncate">{order.customerName} · {order.customerPhone} · {order.itemCount} items</p></div>
        <div className="text-right shrink-0"><p className="font-black text-sm">{money(order.totalKobo)}</p><p className="text-xs font-bold text-blue-600">{STATUS_LABELS[order.status] || order.status}</p></div>
      </button>)}</div>}

    <AccessibleOverlay open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.orderNo || 'Mall order'} description={selected ? `${selected.customerName} · ${selected.customerPhone}${selected.customerEmail ? ` · ${selected.customerEmail}` : ''}` : undefined} className="max-w-2xl">
      {selected && <div className="space-y-4">
        {!selected.linkedSaleId && selected.delivery.zone && selected.delivery.zone!=='pickup' && !selected.delivery.addressVerified && ['Administrator','Store Manager'].includes(currentUser?.role || '') && <button disabled={busy} className="rounded border p-3 text-sm" onClick={()=>act(()=>staffMallClient.reviewDelivery(selected.id),'Delivery serviceability verified')}>I verified this address is serviceable within the selected zone</button>}
        {!selected.linkedSaleId && selected.status!=='cancelled' && ['Administrator','Store Manager'].includes(currentUser?.role || '') && <button disabled={busy} className="rounded border p-3 text-sm text-rose-700" onClick={()=>act(()=>staffMallClient.rejectPayment(selected.id,cancelReason),'Payment rejected; order cancelled and stock released')}>Reject payment and cancel order</button>}
        {selected.status==='packed' && selected.delivery.zone!=='pickup' && <label className="block text-sm font-bold">Assigned courier<input value={courier} onChange={e=>setCourier(e.target.value)} maxLength={120} className="block w-full border rounded p-2" /></label>}
        {selected.dispatch && <p className="text-sm">Dispatch: {selected.dispatch.courier} - {selected.dispatch.status}</p>}
        {selected.linkedSaleId && ['Administrator','Accountant'].includes(currentUser?.role || '') && <label className="block text-sm">Goods-received reference (required to restock collected/dispatched goods)<input value={returnReference} onChange={e=>setReturnReference(e.target.value)} maxLength={120} className="block w-full border rounded p-2" /></label>}
        {selected.returnRecord && <p className="text-sm">Return: {selected.returnRecord.disposition} - {selected.returnRecord.receipt_reference}</p>}
        <details className="rounded border p-3"><summary className="font-bold">Order timeline</summary><ol className="space-y-2 mt-2">{selected.timeline?.map((event,index)=><li key={index} className="text-xs"><time>{new Date(event.createdAt).toLocaleString()}</time> - {event.action} ({event.actorId})<p>{event.details}</p></li>)}</ol></details>
        <div className="grid grid-cols-2 gap-2 text-sm"><div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3"><span className="text-xs text-slate-500">Order</span><p className="font-black">{STATUS_LABELS[selected.status] || selected.status}</p></div><div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3"><span className="text-xs text-slate-500">Payment</span><p className="font-black">{selected.payment.status} · {selected.payment.provider.replaceAll('_', ' ')}</p></div></div>
        <div className="space-y-2">{selected.items.map((item) => <div key={item.id} className="flex justify-between gap-3 text-sm"><span>{item.qty} × {item.name}</span><strong>{money(item.totalKobo)}</strong></div>)}</div>
        <div className="border-t pt-3 space-y-1"><div className="flex justify-between text-sm"><span>Subtotal</span><strong>{money(selected.subtotalKobo)}</strong></div><div className="flex justify-between text-sm"><span>Delivery fee</span><strong>{selected.delivery.quoteRequired && !selected.delivery.quoteConfirmed ? 'Quote required' : money(selected.deliveryFeeKobo)}</strong></div><div className="flex justify-between"><strong>Total</strong><strong>{selected.delivery.quoteRequired && !selected.delivery.quoteConfirmed ? 'Pending quote' : money(selected.totalKobo)}</strong></div></div>
        <div className="text-sm text-slate-600 dark:text-slate-300"><p><strong>Delivery zone:</strong> {selected.delivery.zoneLabel || 'Pickup'}</p>{selected.delivery.address && <p><strong>Address:</strong> {selected.delivery.address}</p>}</div>
        {!selected.linkedSaleId && selected.status !== 'cancelled' && <div className="space-y-3 border-t pt-4">
          {selected.delivery.quoteRequired && !selected.delivery.quoteConfirmed && ['Administrator', 'Store Manager'].includes(currentUser?.role || '') && <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2"><p className="text-xs font-bold text-amber-800 dark:text-amber-200">A delivery quote is required before confirmation or payment.</p><label className="text-xs font-bold">Delivery fee (₦)<input type="number" min="0" step="0.01" value={quoteNaira} onChange={(e) => setQuoteNaira(e.target.value)} className="mt-1 w-full h-10 px-3 rounded-xl border bg-white dark:bg-slate-900" /></label><button disabled={busy || !quoteNaira || Number(quoteNaira) < 0} onClick={() => act(() => staffMallClient.quoteDelivery(selected.id, Math.round(Number(quoteNaira) * 100)), 'Delivery quote saved')} className="w-full h-10 rounded-xl bg-amber-600 disabled:bg-slate-300 text-white font-bold">Save Delivery Quote</button></div>}
          {selected.status === 'pending' && <button disabled={busy || (selected.delivery.quoteRequired && !selected.delivery.quoteConfirmed)} onClick={() => act(() => staffMallClient.confirm(selected.id), 'Order confirmed')} className="w-full h-11 rounded-xl bg-blue-600 disabled:bg-slate-300 text-white font-bold inline-flex items-center justify-center gap-2"><CheckCircle2 className="w-4 h-4"/> Confirm Order</button>}
          <div className="grid sm:grid-cols-2 gap-2"><label className="text-xs font-bold">Tender<select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="mt-1 w-full h-10 px-3 rounded-xl border bg-transparent"><option>Cash</option><option>Card</option><option>Mobile Transfer</option><option>Bank Transfer</option></select></label><label className="text-xs font-bold">Reference<input value={reference} onChange={(e) => setReference(e.target.value)} className="mt-1 w-full h-10 px-3 rounded-xl border bg-transparent" /></label></div>
          <button disabled={busy || selected.status === 'pending'} onClick={() => act(() => paymentMethod === 'Bank Transfer' ? staffMallClient.verifyPayment(selected.id, { amountKobo: selected.totalKobo, reference }) : staffMallClient.collectPayment(selected.id, { paymentMethod, amountKobo: selected.totalKobo, reference }), 'Payment recorded and Sale created')} className="w-full h-11 rounded-xl bg-emerald-600 disabled:bg-slate-300 text-white font-bold inline-flex items-center justify-center gap-2"><Banknote className="w-4 h-4"/> {paymentMethod === 'Bank Transfer' ? 'Verify Transfer & Create Sale' : 'Collect Payment & Create Sale'}</button>
          {['Administrator', 'Store Manager'].includes(currentUser?.role || '') && <><label className="text-xs font-bold">Cancellation reason<input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="mt-1 w-full h-10 px-3 rounded-xl border bg-transparent" /></label><button disabled={busy} onClick={() => act(() => staffMallClient.cancel(selected.id, cancelReason), 'Order cancelled and stock restored')} className="w-full h-10 rounded-xl border border-rose-300 text-rose-700 font-bold inline-flex items-center justify-center gap-2"><XCircle className="w-4 h-4"/> Cancel Order</button></>}
        </div>}
        {selected.linkedSaleId && <div className="space-y-2"><div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 p-3 text-sm font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-2"><PackageCheck className="w-4 h-4"/> Sale created: {selected.linkedSaleId}</div>{NEXT_ACTION[selected.status] && (selected.status !== 'packed' || (selected.delivery.zone || 'pickup') === 'pickup') && <button disabled={busy} onClick={() => { const next = NEXT_ACTION[selected.status]; act(() => staffMallClient.transition(selected.id, next.action), next.label); }} className="w-full h-11 rounded-xl bg-blue-600 text-white font-bold">{NEXT_ACTION[selected.status].label}</button>}{selected.status === 'packed' && selected.delivery.zone !== 'pickup' && <button disabled={busy} onClick={() => act(() => staffMallClient.transition(selected.id, 'mark-out-for-delivery',courier), 'Order sent for delivery')} className="w-full h-10 rounded-xl border border-blue-300 text-blue-700 dark:text-blue-300 font-bold">Send Out for Delivery</button>}{selected.status !== 'refunded' && ['Administrator', 'Accountant'].includes(currentUser?.role || '') && <div className="pt-3 border-t space-y-2"><label className="text-xs font-bold">Refund reason<input value={refundReason} onChange={(e) => setRefundReason(e.target.value)} className="mt-1 w-full h-10 px-3 rounded-xl border bg-transparent" /></label><label className="text-xs font-bold">Stock disposition<select value={returnDecision} onChange={(e) => setReturnDecision(e.target.value)} className="mt-1 w-full h-10 px-3 rounded-xl border bg-transparent"><option value="">Choose explicitly</option><option value="returned">Goods physically returned or never dispatched - restock</option><option value="not_returned">Not returned or not resellable - do not restock</option></select></label><button disabled={busy || !returnDecision || !refundReason.trim()} onClick={() => act(() => staffMallClient.refund(selected.id, refundReason, returnDecision === 'returned',returnReference), 'Order refunded with the selected stock decision')} className="w-full h-10 rounded-xl border border-rose-300 text-rose-700 font-bold">Refund Sale</button></div>}</div>}
      </div>}
    </AccessibleOverlay>
  </div>;
};