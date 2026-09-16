import React from 'react';
import { X, ShoppingCart, Package } from 'lucide-react';
import { useMall } from '../../context/MallContext';
import { MallCartItemRow } from './MallCartItemRow';
import type { MallCartItem } from '../../types/mall';

function toNaira(kobo: number): string {
  const naira = kobo / 100;
  return '₦' + Number(naira.toFixed(2)).toLocaleString('en-NG');
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export const MallCartDrawer: React.FC<Props> = ({ open, onClose }) => {
  const { cart, checkout, setView } = useMall();
  const [checkingout, setCheckingout] = React.useState(false);

  const items: MallCartItem[] = cart?.items ?? [];
  const subtotal = cart?.subtotalKobo ?? 0;
  const itemCount = items.reduce((acc, i) => acc + i.qty, 0);

  const handleCheckout = React.useCallback(() => {
    setView('checkout');
    onClose();
  }, [setView, onClose]);


  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-40 lg:z-50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="fixed top-0 right-0 z-50 lg:z-[60] h-full w-full max-w-md bg-white dark:bg-slate-900 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Shopping cart"
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-600 rounded-lg">
              <ShoppingCart className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">Your Cart</h2>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                {itemCount} {itemCount === 1 ? 'item' : 'items'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Close cart"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <div className="p-4 bg-slate-100 dark:bg-slate-800 rounded-2xl mb-3">
                <Package className="w-8 h-8 text-slate-300 dark:text-slate-600" />
              </div>
              <p className="text-sm font-bold text-slate-700 dark:text-slate-300">Your cart is empty</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                Add items from the catalog to get started.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-4 h-9 px-4 rounded-lg bg-blue-600 text-white text-xs font-extrabold hover:bg-blue-500 transition-colors"
              >
                Back to catalog
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <MallCartItemRow key={item.productId} item={item} />
              ))}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <div className="border-t border-slate-200 dark:border-slate-800 p-4 space-y-3 bg-white dark:bg-slate-900">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500 dark:text-slate-400">Subtotal</span>
              <span className="text-base font-extrabold text-slate-900 dark:text-white">
                {toNaira(subtotal)}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Plus any applicable fees at checkout. Prices are in Naira.
            </p>
            <button
              type="button"
              onClick={handleCheckout}
              disabled={checkingout || items.length === 0}
              className="w-full h-11 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-400 text-white text-sm font-extrabold transition-colors flex items-center justify-center gap-2"
            >
              {checkingout ? (
                <span className="animate-pulse">Processing…</span>
              ) : (
                <>
                  Proceed to Checkout
                  <ShoppingCart className="w-4 h-4" />
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setView('catalog')}
              className="w-full h-9 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              Continue Shopping
            </button>
          </div>
        )}
      </div>
    </>
  );
};
