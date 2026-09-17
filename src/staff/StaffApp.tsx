import React, { Suspense, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Header } from '../components/common/Header';
import { Sidebar } from '../components/common/Sidebar';
import { LoginView } from '../components/auth/LoginView';
import { PWAInstallBanner } from '../components/common/PWAInstallBanner';
import { navigateStaff, useRoute } from '../hooks/useRoute';

const DashboardView = React.lazy(() => import('../components/dashboard/DashboardView').then((m) => ({ default: m.DashboardView })));
const PosView = React.lazy(() => import('../components/pos/PosView').then((m) => ({ default: m.PosView })));
const CustomersView = React.lazy(() => import('../components/customers/CustomersView').then((m) => ({ default: m.CustomersView })));
const ReportsView = React.lazy(() => import('../components/reports/ReportsView').then((m) => ({ default: m.ReportsView })));
const FinanceHubView = React.lazy(() => import('../components/finance/FinanceHubView').then((m) => ({ default: m.FinanceHubView })));
const SalesOrdersHubView = React.lazy(() => import('../components/sales/SalesOrdersHubView').then((m) => ({ default: m.SalesOrdersHubView })));
const ProductsStockHubView = React.lazy(() => import('../components/products/ProductsStockHubView').then((m) => ({ default: m.ProductsStockHubView })));
const PurchasesSuppliersHubView = React.lazy(() => import('../components/purchases/PurchasesSuppliersHubView').then((m) => ({ default: m.PurchasesSuppliersHubView })));
const SettingsHubView = React.lazy(() => import('../components/settings/SettingsHubView').then((m) => ({ default: m.SettingsHubView })));

const PAGE_TITLES: Record<string, string> = { dashboard: 'Dashboard', pos: 'Point of Sale', sales: 'Sales & Orders', 'sales-orders': 'Sales & Orders', 'whatsapp-orders': 'WhatsApp Orders', deliveries: 'Deliveries', products: 'Products & Stock', 'products-stock': 'Products & Stock', inventory: 'Inventory', pricing: 'Pricing', archive: 'Archive', customers: 'Customers', purchases: 'Purchases', 'purchases-suppliers': 'Purchases', suppliers: 'Suppliers', expenses: 'Finance & Expenses', finance: 'Finance', 'money-movement': 'Money Movement', 'investment-planner': 'Investment Planner', reports: 'Reports', settings: 'Settings', 'settings-tools': 'Settings', import: 'Import', ai: 'AI Assistant' };

export const StaffApp: React.FC = () => {
  const { currentUser, hasPermission } = useAuth();
  const route = useRoute();
  const activePage = route.surface === 'staff' ? (route.staffPage || 'dashboard') : 'dashboard';
  const setActivePage = React.useCallback((page: string) => navigateStaff(page), []);
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
    if (route.surface === 'staff' && !route.staffPage) navigateStaff('dashboard', true);
  }, [activePage, route]);

  if (!currentUser) {
    return <LoginView />;
  }

  const pagePermissions: Record<string, any[]> = {
    dashboard: ['Administrator', 'Store Manager', 'Sales Staff', 'Accountant'],
    pos: ['Administrator', 'Store Manager', 'Sales Staff'],
    sales: ['Administrator', 'Store Manager', 'Sales Staff', 'Accountant'],
    'sales-orders': ['Administrator', 'Store Manager', 'Sales Staff', 'Accountant'],
    deliveries: ['Administrator', 'Store Manager', 'Sales Staff', 'Accountant'],
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
      case 'whatsapp-orders':
        return <SalesOrdersHubView initialTab="whatsapp-orders" onNavigate={setActivePage} />;
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