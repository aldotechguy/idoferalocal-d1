import './mallTheme.css';
import React from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useMall } from '../context/MallContext';
import { useRoute, useNavigateMall } from '../hooks/useRoute';
import { MallTopStrip } from './MallTopStrip';
import { MallHeader } from './MallHeader';
import { MallCategoryNav } from './MallCategoryNav';
import { MallHome } from './MallHome';
import { MallBrowseGrid, fetchSearch, fetchCategory } from './MallBrowseGrid';
import { MallProductPage } from './MallProductPage';
import { MallCheckout } from './MallCheckout';
import { MallOrderSuccess, MallOrders } from './MallOrders';
import { MallBottomNav, MallFooter } from './MallFooter';
import { MallCartDrawer } from '../components/mall/MallCartDrawer';

export const MallSite: React.FC = () => {
  const route = useRoute();
  const go = useNavigateMall();
  const { products, loading, refreshProducts } = useMall();
  const [query, setQuery] = React.useState('');
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [cartOpen, setCartOpen] = React.useState(false);

  React.useEffect(() => {
    refreshProducts();
    document.title = 'IdoferaMall — Packaging & Everyday Goods';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  React.useEffect(() => {
    if (route.surface === 'mall' && route.page === 'search') setQuery(route.param || '');
  }, [route]);

  const cats = (products?.categories ?? []).map((c) => (typeof c === 'string' ? c : c.name)).filter(Boolean);
  const searchQ = route.surface === 'mall' && route.page === 'search' ? (route.param || query) : '';

  return (
    <div className="mall-shell min-h-screen text-slate-900 font-sans">
      <MallTopStrip />
      <MallHeader query={query} setQuery={setQuery} onMenu={() => setMenuOpen(true)} />
      <MallCategoryNav categories={cats} active={route.surface === 'mall' && route.page === 'category' ? route.param : undefined} />
      <main className="max-w-7xl mx-auto px-3 sm:px-4 py-4 pb-24 md:pb-8">
        {loading && !products ? (
          <div className="flex items-center justify-center py-20 gap-2 text-sm font-bold text-slate-400">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading mall…
          </div>
        ) : route.surface === 'mall' && route.page === 'category' ? (
          <MallBrowseGrid title={route.param || 'Category'} sub="Browse this category" fetchKey={`cat:${route.param}`} fetchFn={fetchCategory(route.param || '')} />
        ) : route.surface === 'mall' && route.page === 'search' ? (
          <MallBrowseGrid title={searchQ ? `Results for "${searchQ}"` : 'Search the Mall'} sub="Products, brands and categories" fetchKey={`search:${searchQ}`} fetchFn={fetchSearch(searchQ)} emptyTitle="No matches" />
        ) : route.surface === 'mall' && route.page === 'product' ? (
          <MallProductPage id={route.param || ''} />
        ) : route.surface === 'mall' && route.page === 'checkout' ? (
          <MallCheckout />
        ) : route.surface === 'mall' && route.page === 'orders' ? (
          <MallOrders />
        ) : route.surface === 'mall' && route.page === 'success' ? (
          <MallOrderSuccess />
        ) : (
          <MallHome />
        )}
      </main>
      <MallFooter />
      <MallBottomNav />
      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMenuOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-72 max-w-[85vw] bg-white dark:bg-slate-900 shadow-2xl p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <span className="font-black">Categories</span>
              <button type="button" onClick={() => setMenuOpen(false)} aria-label="Close" className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"><X className="w-5 h-5" /></button>
            </div>
            <button type="button" onClick={() => { setMenuOpen(false); go('/'); }} className="w-full text-left px-3 py-2.5 rounded-xl font-bold hover:bg-slate-100 dark:hover:bg-slate-800">All Products</button>
            {cats.map((c) => (
              <button key={c} type="button" onClick={() => { setMenuOpen(false); go(`/category/${encodeURIComponent(c)}`); }} className="w-full text-left px-3 py-2.5 rounded-xl font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">{c}</button>
            ))}
            <button type="button" onClick={() => { setMenuOpen(false); go('/orders'); }} className="mt-2 w-full h-11 rounded-xl bg-blue-600 text-white text-sm font-extrabold">Track My Order</button>
          </div>
        </div>
      )}
      <MallCartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
    </div>
  );
};
