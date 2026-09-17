import './mallTheme.css';
import React from 'react';
import { RefreshCw } from 'lucide-react';
import { useMall } from '../context/MallContext';
import { useRoute, useNavigateMall } from '../hooks/useRoute';
import { MallTopStrip } from './MallTopStrip';
import { MallHeader } from './MallHeader';
import { MallCategoryNav } from './MallCategoryNav';
import { MallHome } from './MallHome';
import { MallBrowseGrid, fetchSearch, fetchCategory } from './MallBrowseGrid';
import { MallBottomNav, MallFooter } from './MallFooter';
import { MallCartDrawer } from '../components/mall/MallCartDrawer';
import { AsyncState } from '../components/common/AsyncState';
import { AccessibleOverlay } from '../components/common/AccessibleOverlay';

const MallProductPage = React.lazy(() => import('./MallProductPage').then((m) => ({ default: m.MallProductPage })));
const MallCheckout = React.lazy(() => import('./MallCheckout').then((m) => ({ default: m.MallCheckout })));
const MallOrders = React.lazy(() => import('./MallOrders').then((m) => ({ default: m.MallOrders })));
const MallOrderSuccess = React.lazy(() => import('./MallOrders').then((m) => ({ default: m.MallOrderSuccess })));

export const MallSite: React.FC = () => {
  const route = useRoute();
  const go = useNavigateMall();
  const { products, loading, error, clearError, refreshProducts } = useMall();
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
  React.useEffect(() => {
    const label = route.surface === 'mall' ? ({ home: 'Packaging & Everyday Goods', category: route.param || 'Category', search: route.param ? `Search: ${route.param}` : 'Search', product: 'Product', checkout: 'Checkout', orders: 'Track Orders', success: 'Order Placed' }[route.page]) : 'Mall';
    document.title = `${label} — IdoferaMall`;
  }, [route]);

  const cats = (products?.categories ?? []).map((c) => (typeof c === 'string' ? c : c.name)).filter(Boolean);
  const searchQ = route.surface === 'mall' && route.page === 'search' ? (route.param || query) : '';

  return (
    <div className="mall-shell min-h-screen text-slate-900 font-sans">
      <MallTopStrip />
      <MallHeader query={query} setQuery={setQuery} onMenu={() => setMenuOpen(true)} />
      <MallCategoryNav categories={cats} active={route.surface === 'mall' && route.page === 'category' ? route.param : undefined} />
      <main id="main-content" tabIndex={-1} className="max-w-7xl mx-auto px-3 sm:px-4 py-4 pb-24 md:pb-8">
        {loading && !products ? (
          <div className="flex items-center justify-center py-20 gap-2 text-sm font-bold text-slate-400">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading mall…
          </div>
        ) : error && !products ? (
          <AsyncState title="We couldn't load the mall" message={error} onRetry={() => { clearError(); refreshProducts(); }} />
        ) : route.surface === 'mall' && route.page === 'category' ? (
          <MallBrowseGrid title={route.param || 'Category'} sub="Browse this category" fetchKey={`cat:${route.param}`} fetchFn={fetchCategory(route.param || '')} />
        ) : route.surface === 'mall' && route.page === 'search' ? (
          <MallBrowseGrid title={searchQ ? `Results for "${searchQ}"` : 'Search the Mall'} sub="Products, brands and categories" fetchKey={`search:${searchQ}`} fetchFn={fetchSearch(searchQ)} emptyTitle="No matches" />
        ) : route.surface === 'mall' && route.page === 'product' ? (
          <React.Suspense fallback={<AsyncState title="Loading product…" busy />}><MallProductPage id={route.param || ''} /></React.Suspense>
        ) : route.surface === 'mall' && route.page === 'checkout' ? (
          <React.Suspense fallback={<AsyncState title="Loading checkout…" busy />}><MallCheckout /></React.Suspense>
        ) : route.surface === 'mall' && route.page === 'orders' ? (
          <React.Suspense fallback={<AsyncState title="Loading orders…" busy />}><MallOrders /></React.Suspense>
        ) : route.surface === 'mall' && route.page === 'success' ? (
          <React.Suspense fallback={<AsyncState title="Loading order…" busy />}><MallOrderSuccess /></React.Suspense>
        ) : (
          <MallHome />
        )}
      </main>
      <MallFooter />
      <MallBottomNav />
      <AccessibleOverlay open={menuOpen} onClose={() => setMenuOpen(false)} kind="drawer" placement="left" title="Categories" className="max-w-72 lg:hidden">
            <button type="button" onClick={() => { setMenuOpen(false); go('/'); }} className="w-full text-left px-3 py-2.5 rounded-xl font-bold hover:bg-slate-100 dark:hover:bg-slate-800">All Products</button>
            {cats.map((c) => (
              <button key={c} type="button" onClick={() => { setMenuOpen(false); go(`/category/${encodeURIComponent(c)}`); }} className="w-full text-left px-3 py-2.5 rounded-xl font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">{c}</button>
            ))}
            <button type="button" onClick={() => { setMenuOpen(false); go('/orders'); }} className="mt-2 w-full h-11 rounded-xl bg-blue-600 text-white text-sm font-extrabold">Track My Order</button>
      </AccessibleOverlay>
      <MallCartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
    </div>
  );
};
