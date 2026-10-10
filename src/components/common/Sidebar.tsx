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
  Sun,
  Moon,
  Eye,
  EyeOff,
  Lock,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useApp } from '../../context/AppContext';
import { staffMallClient } from '../../services/staffMallClient';

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
  const {
    currentUser,
    hasPermission,
    isPrivacyMode,
    enablePrivacyMode,
    disablePrivacyMode,
  } = useAuth();
  const { mode, toggleTheme } = useTheme();
  const { deliveryOrders, treasuryBalances, settings } = useApp();
  const [pendingMallCount, setPendingMallCount] = useState(0);

  useEffect(() => {
    let active = true;
    const refresh = () => staffMallClient.counts().then((data) => { if (active) setPendingMallCount(data.actionable); }).catch(() => {});
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  // Privacy Mode Password Deactivation Modal States
  const [showPrivacyUnlockModal, setShowPrivacyUnlockModal] = useState(false);
  const [privacyPassword, setPrivacyPassword] = useState('');
  const [showPrivacyPasswordText, setShowPrivacyPasswordText] = useState(false);
  const [privacyPasswordError, setPrivacyPasswordError] = useState('');
  const [isVerifyingPrivacyPassword, setIsVerifyingPrivacyPassword] = useState(false);

  const handlePrivacyToggleClick = () => {
    if (!isPrivacyMode) {
      enablePrivacyMode();
    } else {
      setPrivacyPassword('');
      setPrivacyPasswordError('');
      setShowPrivacyPasswordText(false);
      setShowPrivacyUnlockModal(true);
    }
  };

  const handleConfirmUnlockPrivacy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!privacyPassword) {
      setPrivacyPasswordError('Please enter your account password to deactivate Privacy Mode.');
      return;
    }
    setIsVerifyingPrivacyPassword(true);
    setPrivacyPasswordError('');
    try {
      const ok = await disablePrivacyMode(privacyPassword);
      if (!ok) {
        setPrivacyPasswordError(`Incorrect password for ${currentUser?.displayName || 'your account'}.`);
        return;
      }
      setShowPrivacyUnlockModal(false);
      setPrivacyPassword('');
      setPrivacyPasswordError('');
    } finally {
      setIsVerifyingPrivacyPassword(false);
    }
  };

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
  const pendingPickupCount = deliveryOrders
    ? deliveryOrders.filter((o) => !o.isPickupConfirmed && o.status !== 'Cancelled').length
    : 0;
  const totalPendingOrders = pendingMallCount + pendingPickupCount;

  // Active Hub matching logic
  const isHubActive = (hubId: string) => {
    switch (hubId) {
      case 'dashboard':
        return activePage === 'dashboard';
      case 'pos':
        return activePage === 'pos';
      case 'sales':
        return ['sales', 'sales-orders', 'mall-orders', 'whatsapp-orders', 'deliveries'].includes(activePage);
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
      subtitle: 'Sales, Mall & Delivery',
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
        aria-label="Primary navigation"
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
                    aria-current={isActive ? 'page' : undefined}
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

          {/* Bottom Controls: Privacy Toggle (Icon + State only) & Theme Toggle */}
          <div
            className={`border-t border-slate-100 dark:border-slate-800/80 p-2.5 ${
              isEffectiveCollapsed ? 'flex flex-col items-center gap-2' : 'grid grid-cols-2 gap-2'
            }`}
          >
            {/* Privacy Toggle Button: Icon + Current State only */}
            <button
              type="button"
              id="privacy-mode-toggle-btn"
              onClick={handlePrivacyToggleClick}
              title={
                isPrivacyMode
                  ? 'Privacy Mode is ON (Sensitive costs, profits & internal records are masked). Click to unlock with password.'
                  : 'Privacy Mode is OFF (All internal metrics visible). Click to instantly mask sensitive data for customer view.'
              }
              className={`w-full py-2 px-2.5 text-xs font-extrabold rounded-xl border transition-all cursor-pointer shadow-xs flex items-center justify-center gap-1.5 select-none ${
                isPrivacyMode
                  ? 'bg-amber-500/15 dark:bg-amber-500/20 border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/25'
                  : 'border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              {isPrivacyMode ? (
                <>
                  <EyeOff className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>ON</span>
                </>
              ) : (
                <>
                  <Eye className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
                  <span>OFF</span>
                </>
              )}
            </button>

            {/* Theme Toggle Button */}
            <button
              type="button"
              onClick={toggleTheme}
              className="w-full py-2 px-2.5 text-xs font-extrabold rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs select-none"
              title={`Current theme: ${mode.toUpperCase()}. Click to switch to ${mode === 'dark' ? 'Light' : 'Dark'} mode`}
              aria-label="Toggle color theme"
            >
              {mode === 'dark' ? (
                <>
                  <Sun className="w-4 h-4 text-amber-400 fill-amber-400/20 shrink-0" />
                  {!isEffectiveCollapsed && <span className="text-amber-400">Light</span>}
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-slate-700 dark:text-slate-200 shrink-0" />
                  {!isEffectiveCollapsed && <span>Dark</span>}
                </>
              )}
            </button>
          </div>
        </div>
      </aside>

      {/* Deactivate Privacy Mode Password Verification Modal */}
      {showPrivacyUnlockModal && currentUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-5 animate-in zoom-in-95 duration-200 text-slate-900 dark:text-white my-auto max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-100 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400 rounded-2xl">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                    Deactivate Privacy Mode
                  </h3>
                  <p className="text-xs text-slate-500">
                    Enter your password to reveal sensitive internal data
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowPrivacyUnlockModal(false);
                  setPrivacyPassword('');
                  setPrivacyPasswordError('');
                }}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-100 dark:border-slate-800 flex items-center gap-3">
              {currentUser.avatarUrl ? (
                <img
                  src={currentUser.avatarUrl}
                  alt={currentUser.displayName}
                  referrerPolicy="no-referrer"
                  className="w-10 h-10 rounded-xl object-cover ring-2 ring-amber-500"
                />
              ) : (
                <div className="w-10 h-10 rounded-xl bg-amber-600 text-white font-bold flex items-center justify-center text-sm">
                  {currentUser.displayName.charAt(0)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-black text-slate-900 dark:text-white truncate">
                  {currentUser.displayName}
                </p>
                <p className="text-[11px] text-slate-500 truncate">
                  {currentUser.username ? `@${currentUser.username} • ` : ''}
                  {currentUser.email}
                </p>
                <span className="inline-block mt-0.5 text-[9px] font-extrabold px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 uppercase">
                  {currentUser.role}
                </span>
              </div>
            </div>

            <form onSubmit={handleConfirmUnlockPrivacy} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Password for {currentUser.displayName}
                </label>
                <div className="relative">
                  <input
                    type={showPrivacyPasswordText ? 'text' : 'password'}
                    value={privacyPassword}
                    onChange={(e) => {
                      setPrivacyPassword(e.target.value);
                      setPrivacyPasswordError('');
                    }}
                    placeholder="Enter your account password..."
                    autoFocus
                    className="w-full pl-3.5 pr-10 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPrivacyPasswordText(!showPrivacyPasswordText)}
                    className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    {showPrivacyPasswordText ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {privacyPasswordError && (
                  <p className="mt-1.5 text-xs text-rose-500 font-medium flex items-center gap-1">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                    <span>{privacyPasswordError}</span>
                  </p>
                )}
              </div>

              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowPrivacyUnlockModal(false);
                    setPrivacyPassword('');
                    setPrivacyPasswordError('');
                  }}
                  className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-xs transition-colors cursor-pointer"
                >
                  Stay in Privacy Mode
                </button>
                <button
                  type="submit"
                  disabled={isVerifyingPrivacyPassword}
                  className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-xl text-xs shadow-xs transition-colors disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>{isVerifyingPrivacyPassword ? 'Verifying...' : 'Unlock & Reveal Data'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
