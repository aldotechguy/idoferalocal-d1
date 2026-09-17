import React from 'react';
import { ShoppingCart, Package } from 'lucide-react';
import { useMall } from '../../context/MallContext';
import { MallCartItemRow } from './MallCartItemRow';
import type { MallCartItem } from '../../types/mall';
import { AccessibleOverlay } from '../common/AccessibleOverlay';

function toNaira(kobo: number): string {
  const naira = kobo / 100;
  return '₦' + Number(naira.toFixed(2)).toLocaleString('en-NG');
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export const MallCartDrawer: React.FC<Props> = ({ open, onClose }) => {
  const { cart, setView } = useMall();

  const items: MallCartItem[] = cart?.items ?? [];
  const subtotal = cart?.subtotalKobo ?? 0;
  const itemCount = items.reduce((acc, i) => acc + i.qty, 0);

  const handleCheckout = React.useCallback(() => {
    setView('checkout');
    onClose();
  }, [setView, onClose]);


  return (
    <AccessibleOverlay open={open} onClose={onClose} kind="drawer" title="Your Cart" description={`${itemCount} ${itemCount === 1 ? 'unit' : 'units'}`} footer={items.length > 0 ? <div className="space-y-3">
      <div className="flex items-center justify-between text-sm"><span className="text-slate-500">Subtotal</span><span className="text-base font-extrabold">{toNaira(subtotal)}</span></div>
      <p className="text-xs text-slate-500">Final pickup or delivery details are confirmed at checkout.</p>
      <button type="button" onClick={handleCheckout} className="w-full h-11 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-extrabold flex items-center justify-center gap-2">Proceed to Checkout <ShoppingCart className="w-4 h-4" /></button>
      <button type="button" onClick={onClose} className="w-full h-10 rounded-lg bg-slate-100 dark:bg-slate-800 text-sm font-bold">Continue Shopping</button>
    </div> : undefined}>
        <div className="sr-only">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-600 rounded-lg">
              <ShoppingCart className="w-4 h-4 text-white" />
            </div>
          </div>
        </div>
        <div className="space-y-3" aria-live="polite">
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
    </AccessibleOverlay>
  );
};
