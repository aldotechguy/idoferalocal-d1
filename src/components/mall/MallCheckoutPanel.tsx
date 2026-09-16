import React from 'react';
import { X, ShoppingCart } from 'lucide-react';
import { useMall } from '../../context/MallContext';
import { MallReceipt } from './MallReceipt';
import { CheckoutBody } from './MallCheckoutBody';
import type { MallCartItem } from '../../types/mall';

function toNaira(kobo: number): string {
  const naira = kobo / 100;
  return '₦' + Number(naira.toFixed(2)).toLocaleString('en-NG');
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export const MallCheckoutPanel: React.FC<Props> = ({ open, onClose }) => {
  const { cart, checkout, order, view, setView } = useMall();
  const [customerName, setCustomerName] = React.useState('Walk-in customer');
  const [paidKobo, setPaidKobo] = React.useState<number | undefined>();
  const [submitting, setSubmitting] = React.useState(false);

  const items: MallCartItem[] = cart?.items ?? [];
  const subtotal = cart?.subtotalKobo ?? 0;
  const itemCount = items.reduce((a, i) => a + i.qty, 0);
  const paid = paidKobo ?? subtotal;
  const showReceipt = view === 'receipt' && order;

  const handleBack = () => {
    setView('cart');
    onClose();
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await checkout({ customerName: customerName.trim() || 'Walk-in customer', paidKobo });
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-40 lg:z-50" onClick={onClose} aria-hidden="true" />
      <div
        className="fixed top-0 right-0 z-50 lg:z-[60] h-full w-full max-w-md bg-white dark:bg-slate-900 shadow-2xl overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-label={showReceipt ? 'Order receipt' : 'Checkout'}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-600 rounded-lg">
              <ShoppingCart className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">
                {showReceipt ? 'Order Complete' : 'Checkout'}
              </h2>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                {showReceipt ? (order?.orderNo ?? '') : `${itemCount} items · ${toNaira(subtotal)}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={showReceipt ? onClose : handleBack}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label={showReceipt ? 'Close' : 'Go back'}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {showReceipt ? (
            <MallReceipt order={order!} onClose={onClose} />
          ) : (
            <CheckoutBody
              items={items}
              subtotal={subtotal}
              customerName={customerName}
              setCustomerName={setCustomerName}
              paid={paid}
              setPaid={setPaidKobo}
              submitting={submitting}
              onSubmit={handleSubmit}
            />
          )}
        </div>
      </div>
    </>
  );
};
