import React, { Suspense, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Header } from '../components/common/Header';
import { Sidebar } from '../components/common/Sidebar';
import { LoginView } from '../components/auth/LoginView';
import { PWAInstallBanner } from '../components/common/PWAInstallBanner';
import { navigateStaff, useRoute } from '../hooks/useRoute';
import { useApp } from '../context/AppContext';

const DashboardView = React.lazy(() => import('../components/dashboard/DashboardView').then((m) => ({ default: m.DashboardView })));
const PosView = React.lazy(() => import('../components/pos/PosView').then((m) => ({ default: m.PosView })));
const CustomersView = React.lazy(() => import('../components/customers/CustomersView').then((m) => ({ default: m.CustomersView })));
const ReportsView = React.lazy(() => import('../components/reports/ReportsView').then((m) => ({ default: m.ReportsView })));
const FinanceHubView = React.lazy(() => import('../components/finance/FinanceHubView').then((m) => ({ default: m.FinanceHubView })));
const SalesOrdersHubView = React.lazy(() => import('../components/sales/SalesOrdersHubView').then((m) => ({ default: m.SalesOrdersHubView })));
const ProductsStockHubView = React.lazy(() => import('../components/products/ProductsStockHubView').then((m) => ({ default: m.ProductsStockHubView })));
const PurchasesSuppliersHubView = React.lazy(() => import('../components/purchases/PurchasesSuppliersHubView').then((m) => ({ default: m.PurchasesSuppliersHubView })));
const SettingsHubView = React.lazy(() => import('../components/settings/SettingsHubView').then((m) => ({ default: m.SettingsHubView })));

const PAGE_TITLES: Record<string, string> = { dashboard: 'Dashboard', pos: 'Point of Sale', sales: 'Sales & Orders', 'sales-orders': 'Sales & Orders', 'mall-orders': 'Mall Orders', deliveries: 'Deliveries', products: 'Products & Stock', 'products-stock': 'Products & Stock', inventory: 'Inventory', pricing: 'Pricing', archive: 'Archive', customers: 'Customers', purchases: 'Purchases', 'purchases-suppliers': 'Purchases', suppliers: 'Suppliers', expenses: 'Finance & Expenses', finance: 'Finance', 'money-movement': 'Money Movement', 'investment-planner': 'Investment Planner', reports: 'Reports', settings: 'Settings', 'settings-tools': 'Settings', import: 'Import', ai: 'AI Assistant' };

/**
 * Shown when Cloudflare Access confirmed the person but no active roster
 * account matches them. This screen — not the LoginView — owns the moment:
 * SSO never provisions accounts, so there is no form to show, only the
 * confirmed email and what to do next.
 */
const AccessNotice: React.FC<{ email: string }> = ({ email }) => (
  <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-slate-100 flex flex-col justify-center items-center p-4">
    <div className="w-full max-w-md space-y-6">
      <div className="text-center space-y-2">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-500 via-orange-500 to-rose-500 text-white font-extrabold text-2xl shadow-xl shadow-orange-500/30 mb-1 ring-4 ring-orange-500/20">
          <ShieldAlert className="w-7 h-7" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
          Access <span className="text-amber-400">Confirmed</span>
        </h1>
        <p className="text-xs text-slate-400 font-medium">
          Your organization verified <strong className="font-bold text-amber-200">{email}</strong>, but no
          active Idofera account matches that address. SSO never creates accounts — ask an Administrator to
          add you, then return here.
        </p>
      </div>
      <div className="bg-slate-900/90 border border-slate-800 backdrop-blur-xl rounded-3xl p-6 sm:p-8 shadow-2xl space-y-4">
        <a
          href="/"
          className="block w-full py-2.5 text-center bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl transition-colors"
        >
          Back to the storefront
        </a>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="block w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl transition-colors"
        >
          I was just added — check again
        </button>
      </div>
    </div>
  </div>
);

export const StaffApp: React.FC = () => {
  const { currentUser, hasPermission, loading, ssoEmail, ssoUnregistered } = useAuth();
  const route = useRoute();
  const activePage = route.surface === 'staff' ? (route.staffPage || 'dashboard') : 'dashboard';
  const setActivePage = React.useCallback((page: string) => navigateStaff(page), []);
  // "Repeat sale" is raised from a receipt on any page; the cart itself is
  // populated by PosView, so the workspace has to move to POS first.
  const { pendingRepeatSale } = useApp();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState<boolean>(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('sidebar_rail_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const handleToggleSidebarCollapse = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('sidebar_rail_collapsed', String(next));
      } catch {}
      return next;
    });
  };

  React.useEffect(() => {
    document.title = `${PAGE_TITLES[activePage] || 'Workspace'} — IdoferaLabs`;
    if (route.surface === 'staff' && route.staffPage === 'whatsapp-orders') {
      navigateStaff('mall-orders', true);
      return;
    }
    if (route.surface === 'staff' && (route.legacyPath || !route.staffPage)) {
      navigateStaff(route.staffPage || 'dashboard', true);
    }
  }, [activePage, route]);

  React.useEffect(() => {
    if (pendingRepeatSale && activePage !== 'pos') {
      navigateStaff('pos');
    }
  }, [pendingRepeatSale, activePage]);

  if (loading) return <div role="status" className="p-8 text-center">Checking staff access…</div>;
  // An Access-confirmed person without a roster account gets the notice, never
  // the sign-in form: there are no credentials to type, only an Administrator
  // who can provision the account. The password/Google LoginView remains for
  // local development and rollback (no Access identity there).
  if (!currentUser && ssoUnregistered && ssoEmail) {
    return <AccessNotice email={ssoEmail} />;
  }
  if (!currentUser) {
    return <LoginView />;
  }

  const pagePermissions: Record<string, any[]> = {
    dashboard: ['Administrator', 'Store Manager', 'Sales Staff', 'Accountant'],
    pos: ['Administrator', 'Store Manager', 'Sales Staff'],
    sales: ['Administrator', 'Store Manager', 'Sales Staff', 'Accountant'],
    'sales-orders': ['Administrator', 'Store Manager', 'Sales Staff', 'Accountant'],
    deliveries: ['Administrator', 'Store Manager', 'Sales Staff', 'Accountant'],
    'mall-orders': ['Administrator', 'Store Manager', 'Sales Staff', 'Accountant'],
    'whatsapp-orders': ['Administrator', 'Store Manager', 'Sales Staff', 'Accountant'],
    products: ['Administrator', 'Store Manager', 'Sales Staff', 'Accountant'],
    'products-stock': ['Administrator', 'Store Manager', 'Sales Staff', 'Accountant'],
    archive: ['Administrator', 'Store Manager', 'Sales Staff', 'Accountant'],
    pricing: ['Administrator', 'Store Manager', 'Accountant'],
    inventory: ['Administrator', 'Store Manager', 'Sales Staff', 'Accountant'],
    customers: ['Administrator', 'Store Manager', 'Sales Staff', 'Accountant'],
    suppliers: ['Administrator', 'Store Manager', 'Accountant'],
    purchases: ['Administrator', 'Store Manager', 'Accountant'],
    'purchases-suppliers': ['Administrator', 'Store Manager', 'Accountant'],
    expenses: ['Administrator', 'Store Manager', 'Accountant'],
    finance: ['Administrator', 'Store Manager', 'Accountant'],
    'money-movement': ['Administrator', 'Store Manager', 'Accountant'],
    'investment-planner': ['Administrator', 'Store Manager', 'Accountant'],
    reports: ['Administrator', 'Store Manager', 'Accountant'],
    import: ['Administrator', 'Store Manager'],
    ai: ['Administrator', 'Store Manager', 'Accountant'],
    settings: ['Administrator', 'Store Manager', 'Sales Staff', 'Accountant'],
    'settings-tools': ['Administrator', 'Store Manager', 'Sales Staff', 'Accountant'],
  };

  const allowedRoles = pagePermissions[activePage] || ['Administrator'];
  const isAuthorized = hasPermission(allowedRoles as any);

  const renderActiveView = () => {
    if (!isAuthorized) {
      return (
        <div className="p-12 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-xs max-w-lg mx-auto my-12 space-y-4">
          <h2 className="text-xl font-black text-slate-900 dark:text-white">Access Restricted</h2>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">Your role ({currentUser.role}) cannot access this page.</p>
          <button onClick={() => setActivePage('dashboard')} className="px-5 py-2.5 bg-blue-600 text-white text-xs font-bold rounded-xl">Return to Dashboard</button>
        </div>
      );
    }
    switch (activePage) {
      case 'dashboard':
        return <DashboardView onNavigate={setActivePage} />;
      case 'pos':
        return <PosView />;
      case 'sales':
      case 'sales-orders':
        return <SalesOrdersHubView initialTab="sales" onNavigate={setActivePage} />;
      case 'mall-orders':
      case 'whatsapp-orders':
        return <SalesOrdersHubView initialTab="mall-orders" onNavigate={setActivePage} />;
      case 'deliveries':
        return <SalesOrdersHubView initialTab="deliveries" onNavigate={setActivePage} />;
      case 'products':
      case 'products-stock':
        return <ProductsStockHubView initialTab="products" onNavigate={setActivePage} />;
      case 'inventory':
        return <ProductsStockHubView initialTab="inventory" onNavigate={setActivePage} />;
      case 'pricing':
        return <ProductsStockHubView initialTab="pricing" onNavigate={setActivePage} />;
      case 'archive':
        return <ProductsStockHubView initialTab="archive" onNavigate={setActivePage} />;
      case 'customers':
        return <CustomersView />;
      case 'purchases':
      case 'purchases-suppliers':
        return <PurchasesSuppliersHubView initialTab="purchases" />;
      case 'suppliers':
        return <PurchasesSuppliersHubView initialTab="suppliers" />;
      case 'expenses':
      case 'finance':
        return <FinanceHubView initialTab="expenses" onNavigate={setActivePage} />;
      case 'money-movement':
        return <FinanceHubView initialTab="money-movement" onNavigate={setActivePage} />;
      case 'investment-planner':
        return <FinanceHubView initialTab="investment-planner" onNavigate={setActivePage} />;
      case 'reports':
        return <ReportsView />;
      case 'settings':
      case 'settings-tools':
        return <SettingsHubView initialTab="settings" />;
      case 'import':
        return <SettingsHubView initialTab="import" />;
      case 'ai':
        return <SettingsHubView initialTab="ai" />;
      default:
        return <DashboardView onNavigate={setActivePage} />;
    }
  };

  return (
    <div className="app-shell min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans relative">
      <div className="flex flex-1 relative min-h-screen w-full">
        <Sidebar activePage={activePage} onNavigate={setActivePage} isMobileOpen={isMobileSidebarOpen} onMobileClose={() => setIsMobileSidebarOpen(false)} isCollapsed={isSidebarCollapsed} onToggleCollapse={handleToggleSidebarCollapse} />
        <div className="app-content flex-1 flex flex-col min-w-0">
          <Header onMobileMenuToggle={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)} onNavigate={setActivePage} activePage={activePage} />
          <main id="main-content" tabIndex={-1} className="app-main flex-1 p-4 sm:p-6 lg:p-8 max-w-[1600px] w-full mx-auto">
            <Suspense fallback={<div className="min-h-64 rounded-2xl bg-white/70 dark:bg-slate-900/70 animate-pulse" role="status" aria-label="Loading workspace" />}>
              {renderActiveView()}
            </Suspense>
          </main>
        </div>
      </div>
      <PWAInstallBanner />
    </div>
  );
};