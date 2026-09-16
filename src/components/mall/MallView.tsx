import React from 'react';
import { Package, Truck, ShoppingCart, Receipt, RefreshCw } from 'lucide-react';
import { MallCatalogGrid } from './MallCatalogGrid';
import { MallCartDrawer } from './MallCartDrawer';
import { MallCheckoutPanel } from './MallCheckoutPanel';
import { useMall } from '../../context/MallContext';

export const MallView: React.FC = () => {
  const { loading, view, setView, products, cart, refreshProducts, newSession } = useMall();
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [checkoutOpen, setCheckoutOpen] = React.useState(false);

  React.useEffect(() => {
    if (!loading) {
      if (view === 'cart' || view === 'checkout') {
        setDrawerOpen(false);
        setCheckoutOpen(true);
      } else {
        setCheckoutOpen(false);
      }
    }
  }, [view, loading]);

  const handleCartClick = () => {
    setDrawerOpen(true);
    setView('cart');
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Loading mall…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-600 rounded-xl">
            <Package className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-900 dark:text-white tracking-tight">Mall Outlet</h1>
            <p className="text-xs text-slate-400 dark:text-slate-500">Browse, cart, and checkout from the outlet catalog.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refreshProducts}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          <button
            type="button"
            onClick={newSession}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            <Receipt className="w-3.5 h-3.5" />
            New Session
          </button>
          <button
            type="button"
            onClick={handleCartClick}
            className="relative flex items-center gap-1.5 h-9 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-extrabold transition-colors"
          >
            <ShoppingCart className="w-4 h-4" />
            Cart
            {cart && cart.items.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 h-4.5 w-4.5 rounded-full bg-rose-500 text-white text-[10px] font-black flex items-center justify-center shadow-sm">
                {cart.items.reduce((a, i) => a + i.qty, 0)}
              </span>
            )}
          </button>
        </div>
      </div>

      {view === 'catalog' || view === 'receipt' ? (
        <MallCatalogGrid products={products} />
      ) : null}

      <MallCartDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <MallCheckoutPanel open={checkoutOpen} onClose={() => setCheckoutOpen(false)} />
    </div>
  );
};
