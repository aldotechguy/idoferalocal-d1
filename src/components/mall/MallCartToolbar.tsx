import React from 'react';
import { ShoppingCart } from 'lucide-react';
import { useMall } from '../../context/MallContext';
import { useToast } from '../../context/ToastContext';

export const MallCartToolbar: React.FC = () => {
  const { cart, setView } = useMall();
  const toast = useToast();
  const itemCount = cart?.items.reduce((acc, i) => acc + i.qty, 0) ?? 0;

  const openCart = () => {
    if (!cart || cart.items.length === 0) {
      toast.showToast({ title: 'Cart is empty', message: 'Add items from the catalog first.', type: 'info' });
      setView('catalog');
      return;
    }
    setView('cart');
  };

  return (
    <button
      type="button"
      onClick={openCart}
      className="relative flex items-center gap-1.5 h-9 px-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-sm font-bold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
    >
      <ShoppingCart className="w-4 h-4" />
      <span className="hidden sm:inline">Cart</span>
      {itemCount > 0 && (
        <span className="flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-blue-600 text-white text-[10px] font-extrabold">
          {itemCount.toLocaleString('en-NG')}
        </span>
      )}
    </button>
  );
};
