import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { AppProvider } from './context/AppContext';
import { ToastProvider } from './context/ToastContext';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { Header } from './components/common/Header';
import { Sidebar } from './components/common/Sidebar';
import { DashboardView } from './components/dashboard/DashboardView';
import { PosView } from './components/pos/PosView';
import { CustomersView } from './components/customers/CustomersView';
import { ReportsView } from './components/reports/ReportsView';
import { FinanceHubView } from './components/finance/FinanceHubView';
import { SalesOrdersHubView } from './components/sales/SalesOrdersHubView';
import { ProductsStockHubView } from './components/products/ProductsStockHubView';
import { PurchasesSuppliersHubView } from './components/purchases/PurchasesSuppliersHubView';
import { SettingsHubView } from './components/settings/SettingsHubView';
import { LoginView } from './components/auth/LoginView';
import { PWAInstallBanner } from './components/common/PWAInstallBanner';

const MainAppContent: React.FC = () => {
  const { currentUser, hasPermission } = useAuth();
  const [activePage, setActivePage] = useState<string>('dashboard');
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
          <div className="w-16 h-16 bg-rose-100 dark:bg-rose-950/80 text-rose-600 dark:text-rose-400 rounded-2xl flex items-center justify-center mx-auto">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-xl font-black text-slate-900 dark:text-white">
            Access Restricted
          </h2>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Your assigned role ({currentUser.role}) does not have permission to access the feature on this page.
          </p>
          <button
            onClick={() => setActivePage('dashboard')}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-md transition-all"
          >
            Return to Main Dashboard
          </button>
        </div>
      );
    }

    switch (activePage) {
      case 'dashboard':
        return <DashboardView onNavigate={setActivePage} />;

      // Point of Sale (Fast 1-click checkout)
      case 'pos':
        return <PosView />;

      // Sales & Orders Hub
      case 'sales':
      case 'sales-orders':
        return <SalesOrdersHubView initialTab="sales" onNavigate={setActivePage} />;
      case 'whatsapp-orders':
        return <SalesOrdersHubView initialTab="whatsapp-orders" onNavigate={setActivePage} />;
      case 'deliveries':
        return <SalesOrdersHubView initialTab="deliveries" onNavigate={setActivePage} />;

      // Products & Stock Hub
      case 'products':
      case 'products-stock':
        return <ProductsStockHubView initialTab="products" onNavigate={setActivePage} />;
      case 'inventory':
        return <ProductsStockHubView initialTab="inventory" onNavigate={setActivePage} />;
      case 'pricing':
        return <ProductsStockHubView initialTab="pricing" onNavigate={setActivePage} />;
      case 'archive':
        return <ProductsStockHubView initialTab="archive" onNavigate={setActivePage} />;

      // Customers Directory
      case 'customers':
        return <CustomersView />;

      // Purchases & Suppliers Hub
      case 'purchases':
      case 'purchases-suppliers':
        return <PurchasesSuppliersHubView initialTab="purchases" />;
      case 'suppliers':
        return <PurchasesSuppliersHubView initialTab="suppliers" />;

      // Finance & Expenses Hub (Tucking in Money Movement with Operating Expenses)
      case 'expenses':
      case 'finance':
        return <FinanceHubView initialTab="expenses" onNavigate={setActivePage} />;
      case 'money-movement':
        return <FinanceHubView initialTab="money-movement" onNavigate={setActivePage} />;
      case 'investment-planner':
        return <FinanceHubView initialTab="investment-planner" onNavigate={setActivePage} />;

      // Reports & Analytics
      case 'reports':
        return <ReportsView />;

      // Settings & Tools Hub
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
    <div className="app-shell min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors duration-200 relative">
      {/* Ambient Liquid Glass Mesh Under-Glow Orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10 select-none" aria-hidden="true">
        <div className="absolute -top-28 -left-20 w-[28rem] h-[28rem] rounded-full bg-amber-400/20 dark:bg-amber-500/12 blur-[100px] transform-gpu" />
        <div className="absolute top-1/4 right-0 w-[32rem] h-[32rem] rounded-full bg-sky-400/15 dark:bg-blue-600/10 blur-[130px] transform-gpu" />
        <div className="absolute top-2/3 left-1/4 w-[28rem] h-[28rem] rounded-full bg-emerald-400/12 dark:bg-emerald-500/8 blur-[110px] transform-gpu" />
        <div className="absolute -bottom-24 right-1/4 w-[30rem] h-[30rem] rounded-full bg-indigo-400/12 dark:bg-indigo-600/10 blur-[120px] transform-gpu" />
      </div>

      <div className="flex flex-1 relative min-h-screen w-full">
        {/* Sidebar */}
        <Sidebar
          activePage={activePage}
          onNavigate={setActivePage}
          isMobileOpen={isMobileSidebarOpen}
          onMobileClose={() => setIsMobileSidebarOpen(false)}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={handleToggleSidebarCollapse}
        />

        {/* Main Content Area */}
        <div className="app-content flex-1 flex flex-col min-w-0">
          <Header
            onMobileMenuToggle={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
            onNavigate={setActivePage}
            activePage={activePage}
          />

          <main className="app-main flex-1 p-4 sm:p-6 lg:p-8 max-w-[1600px] w-full mx-auto">
            {renderActiveView()}
          </main>
        </div>
      </div>

      {/* PWA 1-Click Install Pop-up & Offline Alert Bar */}
      <PWAInstallBanner />
    </div>
  );
};

export default function App() {
  useEffect(() => {
    const handleRejection = (event: PromiseRejectionEvent) => {
      console.warn('Handled async promise rejection safely:', event.reason);
      event.preventDefault();
    };
    window.addEventListener('unhandledrejection', handleRejection);
    return () => {
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <AppProvider>
              <MainAppContent />
            </AppProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
