import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  ShoppingBag,
  Package,
  Users,
  Truck,
  Receipt,
  BarChart3,
  Settings,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';

interface SidebarProps {
  activePage: string;
  onNavigate: (page: string) => void;
  isMobileOpen: boolean;
  onMobileClose: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activePage,
  onNavigate,
  isMobileOpen,
  onMobileClose,
  isCollapsed: controlledCollapsed,
  onToggleCollapse: controlledToggle,
}) => {
  const { hasPermission } = useAuth();
  const { whatsAppPreOrders, deliveryOrders, treasuryBalances, settings } = useApp();

  // Desktop rail collapsed mode (internal state fallback if not controlled)
  const [internalCollapsed, setInternalCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('sidebar_rail_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const isCollapsed = controlledCollapsed !== undefined ? controlledCollapsed : internalCollapsed;
  // Mobile & tablet drawer (when isMobileOpen is true) must ALWAYS be the full drawn sidebar (never collapsed/icons only)
  const isEffectiveCollapsed = !isMobileOpen && isCollapsed;

  const toggleCollapsed = () => {
    if (controlledToggle) {
      controlledToggle();
      return;
    }
    setInternalCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('sidebar_rail_collapsed', String(next));
      } catch {}
      return next;
    });
  };

  // Pending counts for badges
  const pendingWhatsAppCount = whatsAppPreOrders.filter(
    (o) => o.status !== 'Completed' && o.status !== 'Cancelled'
  ).length;
  const pendingPickupCount = deliveryOrders
    ? deliveryOrders.filter((o) => !o.isPickupConfirmed && o.status !== 'Cancelled').length
    : 0;
  const totalPendingOrders = pendingWhatsAppCount + pendingPickupCount;

  // Active Hub matching logic
  const isHubActive = (hubId: string) => {
    switch (hubId) {
      case 'dashboard':
        return activePage === 'dashboard';
      case 'pos':
        return activePage === 'pos';
      case 'sales':
        return ['sales', 'sales-orders', 'whatsapp-orders', 'deliveries'].includes(activePage);
      case 'products':
        return ['products', 'products-stock', 'inventory', 'pricing', 'archive'].includes(activePage);
      case 'customers':
        return activePage === 'customers';
      case 'purchases':
        return ['purchases', 'purchases-suppliers', 'suppliers'].includes(activePage);
      case 'expenses':
        return ['expenses', 'finance', 'money-movement', 'investment-planner'].includes(activePage);
      case 'reports':
        return activePage === 'reports';
      case 'settings':
        return ['settings', 'settings-tools', 'import', 'ai'].includes(activePage);
      default:
        return activePage === hubId;
    }
  };

  // Consolidated 8 primary operational hubs + 1 settings hub
  const navHubs = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      subtitle: 'KPIs & Overview',
      icon: LayoutDashboard,
      roles: ['Administrator', 'Store Manager', 'Sales Staff', 'Accountant'],
    },
    {
      id: 'pos',
      label: 'Point of Sale (POS)',
      subtitle: 'Instant Checkout',
      icon: ShoppingCart,
      roles: ['Administrator', 'Store Manager', 'Sales Staff'],
    },
    {
      id: 'sales',
      label: 'Sales & Orders',
      subtitle: 'Sales, WhatsApp & Delivery',
      icon: ShoppingBag,
      roles: ['Administrator', 'Store Manager', 'Sales Staff', 'Accountant'],
      badge: totalPendingOrders > 0 ? `${totalPendingOrders} Active` : undefined,
      badgeColor: 'emerald',
    },
    {
      id: 'products',
      label: 'Products & Stock',
      subtitle: 'Catalog, Stock & Tiers',
      icon: Package,
      roles: ['Administrator', 'Store Manager', 'Sales Staff', 'Accountant'],
    },
    {
      id: 'customers',
      label: 'Customers',
      subtitle: 'Directory, Credit & Ledgers',
      icon: Users,
      roles: ['Administrator', 'Store Manager', 'Sales Staff', 'Accountant'],
    },
    {
      id: 'purchases',
      label: 'Purchases & Suppliers',
      subtitle: 'POs, GRN & Suppliers',
      icon: Truck,
      roles: ['Administrator', 'Store Manager', 'Accountant'],
    },
    {
      id: 'expenses',
      label: 'Finance & Expenses',
      subtitle: 'Expenses & Money Movement',
      icon: Receipt,
      roles: ['Administrator', 'Store Manager', 'Accountant'],
      badge: 'Liquid',
      badgeColor: 'blue',
    },
    {
      id: 'reports',
      label: 'Reports & Analytics',
      subtitle: 'Financials & P&L',
      icon: BarChart3,
      roles: ['Administrator', 'Store Manager', 'Accountant'],
    },
    {
      id: 'settings',
      label: 'Settings & Tools',
      subtitle: 'Users, Import & AI',
      icon: Settings,
      roles: ['Administrator', 'Store Manager', 'Sales Staff', 'Accountant'],
    },
  ];

  return (
    <>
      {/* Mobile backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-40 lg:hidden"
          onClick={onMobileClose}
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`app-sidebar fixed lg:sticky top-0 left-0 z-50 lg:z-30 h-screen bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between transition-all duration-300 ease-in-out shrink-0 ${
          isMobileOpen ? 'translate-x-0 w-72 sm:w-80 shadow-2xl' : '-translate-x-full lg:translate-x-0'
        } ${isEffectiveCollapsed ? 'lg:w-20' : 'lg:w-64'}`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="app-sidebar-brand flex items-center justify-between p-3.5 border-b border-slate-100 dark:border-slate-800/80">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="app-brand-mark w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-violet-600 flex items-center justify-center text-white font-bold text-sm shadow-md shadow-blue-500/20 shrink-0">
                I
              </div>
              {!isEffectiveCollapsed && (
                <div className="flex flex-col min-w-0">
                  <span className="font-bold text-base tracking-tight text-slate-900 dark:text-white leading-tight truncate">
                    Idofera<span className="app-brand-accent text-blue-600 dark:text-blue-400">Labs</span>
                  </span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider leading-tight truncate" title={settings?.storeName || 'Enterprise POS'}>
                    {settings?.storeName || 'Enterprise POS'}
                  </span>
                </div>
              )}
            </div>

            {/* Mobile close button */}
            <button
              onClick={onMobileClose}
              className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Close menu"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Desktop Rail collapse toggle */}
            <button
              onClick={toggleCollapsed}
              title={isEffectiveCollapsed ? 'Expand Sidebar' : 'Collapse to Rail'}
              className="hidden lg:flex items-center justify-center w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {isEffectiveCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
          </div>

          {/* Navigation Items (Clean 8 Hubs + Settings) */}
          <div className="app-sidebar-nav flex-1 overflow-y-auto px-2.5 py-3 space-y-1.5 scrollbar-thin">
            {!isEffectiveCollapsed && (
              <p className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 px-2.5 pb-1 tracking-wider">
                Operational Hubs
              </p>
            )}

            {navHubs.map((item) => {
              const isAllowed = hasPermission(item.roles as any);
              if (!isAllowed) return null;

              const Icon = item.icon;
              const isActive = isHubActive(item.id);

              return (
                <div key={item.id} className="relative group">
                  <button
                    onClick={() => {
                      onNavigate(item.id);
                      onMobileClose();
                    }}
                    title={isEffectiveCollapsed ? item.label : undefined}
                    className={`app-nav-item w-full flex items-center ${
                      isEffectiveCollapsed ? 'justify-center p-2.5' : 'justify-between px-3 py-2.5'
                    } rounded-xl text-xs font-semibold transition-all group ${
                      isActive
                        ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-slate-100'
                    }`}
                  >
                    <div className={`flex items-center ${isEffectiveCollapsed ? '' : 'gap-3'}`}>
                      <Icon
                        className={`w-4 h-4 transition-transform group-hover:scale-110 shrink-0 ${
                          isActive
                            ? 'text-white'
                            : 'text-slate-500 dark:text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400'
                        }`}
                      />
                      {!isEffectiveCollapsed && (
                        <div className="flex flex-col text-left">
                          <span className="leading-tight">{item.label}</span>
                          <span
                            className={`text-[10px] font-normal leading-tight ${
                              isActive ? 'text-blue-100' : 'text-slate-400 dark:text-slate-500'
                            }`}
                          >
                            {item.subtitle}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Badge on expanded mode */}
                    {!isEffectiveCollapsed && item.badge && (
                      <span
                        className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold shrink-0 ${
                          isActive
                            ? 'bg-white/20 text-white'
                            : item.badgeColor === 'emerald'
                            ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-200/50'
                            : 'bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 border border-blue-200/50'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}

                    {/* Dot indicator on collapsed mode if badge exists */}
                    {isEffectiveCollapsed && item.badge && (
                      <span
                        className={`absolute top-2 right-2 w-2 h-2 rounded-full ${
                          item.badgeColor === 'emerald' ? 'bg-emerald-500' : 'bg-blue-500'
                        }`}
                      />
                    )}
                  </button>

                  {/* Hover Tooltip when sidebar is collapsed */}
                  {isEffectiveCollapsed && (
                    <div className="hidden lg:group-hover:flex absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50 px-3 py-2 bg-slate-900 text-white rounded-xl shadow-xl border border-slate-800 flex-col whitespace-nowrap pointer-events-none">
                      <span className="text-xs font-bold">{item.label}</span>
                      <span className="text-[10px] text-slate-400">{item.subtitle}</span>
                      {item.badge && (
                        <span className="text-[10px] text-emerald-400 font-semibold mt-0.5">
                          {item.badge}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </aside>
    </>
  );
};
