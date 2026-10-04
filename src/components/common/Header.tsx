import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Bell,
  Search,
  Menu,
  Sun,
  Moon,
  ShieldAlert,
  Check,
  UserPlus,
  Settings,
  Package,
  Receipt,
  Users,
  Building2,
  X,
  ArrowRight,
  LogOut,
  KeyRound,
  Lock,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useApp } from '../../context/AppContext';
import { useCloudSync } from '../../hooks/useCloudSync';
import { UserRole, Sale, UserProfile } from '../../types';
import { NairaSign } from './NairaSign';
import { UserModal } from '../modals/UserModal';
import { SearchResultsModal } from '../modals/SearchResultsModal';
import { ReceiptModal } from './ReceiptModal';
import { ConfirmModal } from '../common/ConfirmModal';
import { D1NetworkHealthBadge } from './D1NetworkHealthBadge';

interface HeaderProps {
  onMobileMenuToggle: () => void;
  onNavigate: (page: string) => void;
  activePage: string;
}

export const Header: React.FC<HeaderProps> = ({
  onMobileMenuToggle,
  onNavigate,
}) => {
  const { currentUser, users, isSuperAdmin, isPrivacyMode, switchUser, switchDemoRole, logout, lock, hasPermission } = useAuth();
  const { mode, toggleTheme } = useTheme();
  const { notifications, markNotificationRead, clearNotifications, settings, products, sales, customers, suppliers, expenses } = useApp();
  const {
    isOnline,
    isSyncing,
    d1Health,
    isCheckingHealth,
    pingD1Health,
    triggerSync,
    hasDriveUnsynced,
    unsyncedRecordsCount,
  } = useCloudSync();
  const [showNotifPopover, setShowNotifPopover] = useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [showConfirmClearNotifs, setShowConfirmClearNotifs] = useState(false);
  // Sign Out ends the Cloudflare Access session too, so it gets a confirmation;
  // Lock stays one-tap because that is the whole point of it.
  const [showConfirmSignOut, setShowConfirmSignOut] = useState(false);
  
  // Search States
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [showSearchResultsModal, setShowSearchResultsModal] = useState(false);
  const [selectedSaleForReceipt, setSelectedSaleForReceipt] = useState<Sale | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Account Switching Password Protection States
  const [targetUserForSwitch, setTargetUserForSwitch] = useState<UserProfile | null>(null);
  const [showSwitchPasswordModal, setShowSwitchPasswordModal] = useState(false);
  const [switchPassword, setSwitchPassword] = useState('');
  const [showSwitchPasswordText, setShowSwitchPasswordText] = useState(false);
  const [switchPasswordError, setSwitchPasswordError] = useState('');

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleRoleSelect = (role: UserRole) => {
    if (currentUser?.role === 'Sales Staff') return;
    switchDemoRole(role);
  };

  const handleInitiateSwitchUser = (targetUser: UserProfile) => {
    if (targetUser.id === currentUser?.id) {
      setShowUserDropdown(false);
      return;
    }
    if (currentUser?.role === 'Sales Staff') {
      setTargetUserForSwitch(targetUser);
      setSwitchPassword('');
      setSwitchPasswordError('');
      setShowSwitchPasswordModal(true);
      setShowUserDropdown(false);
    } else {
      switchUser(targetUser.id);
      setShowUserDropdown(false);
    }
  };

  const handleConfirmSwitchUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUserForSwitch) return;

    if (!switchPassword) {
      setSwitchPasswordError('Please enter the password for this account.');
      return;
    }

    if (targetUserForSwitch.password && targetUserForSwitch.password !== switchPassword) {
      setSwitchPasswordError(`Incorrect password entered for ${targetUserForSwitch.displayName}.`);
      return;
    }

    switchUser(targetUserForSwitch.id);
    setShowSwitchPasswordModal(false);
    setTargetUserForSwitch(null);
    setSwitchPassword('');
    setSwitchPasswordError('');
  };

  // Global Keyboard Shortcut (Cmd+K or Ctrl+K)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowSearchResultsModal(true);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Mobile placeholder swap: short prompt on phones so it never truncates mid-word.
  // data-* attributes above are the source of truth; this only swaps the live attribute.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const apply = () => {
      const el = searchInputRef.current;
      if (!el) return;
      el.placeholder = mq.matches
        ? (el.dataset.mobilePlaceholder || 'Search…')
        : (el.dataset.desktopPlaceholder || el.placeholder);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const cleanQuery = searchQuery.trim().toLowerCase();

  // Generate real-time prediction items for auto-complete
  const predictions = useMemo(() => {
    if (!cleanQuery) return [];

    // Null-safe dashboard search. These fields are typed as required, but
    // imported/legacy rows routinely carry null, and one bad record used to
    // throw inside this memo — crashing the whole header (Cmd+K included) on
    // every keystroke. String(undefined) would match 'undefined', so an absent
    // value is treated as an empty string.
    const matches = (value: unknown) => {
      if (value === null || value === undefined) return false;
      return String(value).toLowerCase().includes(cleanQuery);
    };
    const matchesAll = (values: unknown[]) => values.some(matches);

    const list: {
      id: string;
      typeLabel: string;
      title: string;
      subtitle: string;
      badge?: string;
      badgeColor?: string;
      icon: React.ElementType;
      onSelect: () => void;
    }[] = [];

    // 1. Products (up to 4)
    products
      .filter((p) => matchesAll([p.name, p.sku, p.barcode, p.category, p.brand]))
      .slice(0, 4)
      .forEach((p) => {
        list.push({
          id: `prod-${p.id}`,
          typeLabel: 'Product',
          title: p.name,
          subtitle: `SKU: ${p.sku} • ${p.category} • ${settings.currencySymbol}${p.retailPrice}`,
          badge: `${p.currentStock} ${p.unit}`,
          badgeColor:
            p.currentStock <= p.minimumStockLevel
              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
          icon: Package,
          onSelect: () => {
            onNavigate('products');
            setIsSearchFocused(false);
          },
        });
      });

    // 2. Sales & Invoices (up to 3)
    sales
      .filter((s) =>
        matches(s.invoiceNo) || matches(s.customerName) ||
        (Array.isArray(s.items) && s.items.some((i) => matches(i.productName))))
      .slice(0, 3)
      .forEach((s) => {
        list.push({
          id: `sale-${s.id}`,
          typeLabel: 'Invoice',
          title: `${s.invoiceNo} — ${s.customerName}`,
          subtitle: `${s.items.length} items • ${settings.currencySymbol}${s.totalAmount} • ${s.paymentMethod}`,
          badge: s.status,
          badgeColor:
            s.status === 'Completed'
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
              : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
          icon: Receipt,
          onSelect: () => {
            setSelectedSaleForReceipt(s);
            setIsSearchFocused(false);
          },
        });
      });

    // 3. Customers (up to 2)
    customers
      .filter((c) => matchesAll([c.name, c.phone, c.email]))
      .slice(0, 2)
      .forEach((c) => {
        list.push({
          id: `cust-${c.id}`,
          typeLabel: 'Customer',
          title: c.name,
          subtitle: isPrivacyMode ? 'Contact Masked • Privacy Mode' : `${c.phone} • ${c.email}`,
          badge: isPrivacyMode
            ? 'Protected'
            : c.outstandingBalance > 0
            ? `Due: ${settings.currencySymbol}${c.outstandingBalance}`
            : 'Active',
          badgeColor: isPrivacyMode
            ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
            : c.outstandingBalance > 0
            ? 'bg-rose-100 text-rose-800'
            : 'bg-blue-100 text-blue-800',
          icon: Users,
          onSelect: () => {
            onNavigate('customers');
            setIsSearchFocused(false);
          },
        });
      });

    // 4. Suppliers (up to 2) - Contact masked in Privacy Mode
    suppliers
      .filter((sup) => matchesAll([sup.name, sup.contactPerson, sup.phone]))
      .slice(0, 2)
      .forEach((sup) => {
        list.push({
          id: `sup-${sup.id}`,
          typeLabel: 'Supplier',
          title: sup.name,
          subtitle: isPrivacyMode ? 'Contact • Privacy Mode' : `Contact: ${sup.contactPerson} • ${sup.phone}`,
          icon: Building2,
          onSelect: () => {
            onNavigate('suppliers');
            setIsSearchFocused(false);
          },
        });
      });

    // 5. Expenses (up to 2) - Amount masked in Privacy Mode
    expenses
      .filter((e) => matchesAll([e.title, e.category]))
      .slice(0, 2)
      .forEach((e) => {
        list.push({
          id: `exp-${e.id}`,
          typeLabel: 'Expense',
          title: e.title,
          subtitle: isPrivacyMode ? `${e.category} • •••` : `${e.category} • ${settings.currencySymbol}${e.amount}`,
          icon: NairaSign,
          onSelect: () => {
            onNavigate('expenses');
            setIsSearchFocused(false);
          },
        });
      });

    return list;
  }, [cleanQuery, products, sales, customers, suppliers, expenses, settings, onNavigate, isPrivacyMode]);

  const handleOpenSearchModal = () => {
    setShowSearchResultsModal(true);
    setIsSearchFocused(false);
  };

  return (
    <header className="app-header sticky top-0 z-30 px-3 sm:px-4 lg:px-8 pt-3 pb-2 sm:py-3 transition-all duration-200" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
      <div className="app-header-layout flex flex-wrap items-center gap-x-3 gap-y-2 sm:gap-4 sm:flex-nowrap">
        {/* Row 1 — hamburger + compact status cluster (mobile); spacer keeps search full-width below */}
        {/* Left Section (Mobile Hamburger only on non-desktop to maximize search bar real estate) */}
        <div className="flex items-center lg:hidden shrink-0">
          <button
            onClick={onMobileMenuToggle}
            className="p-2 text-slate-600 dark:text-slate-300 liquid-glass-pill rounded-xl transition-all cursor-pointer"
            title="Toggle Menu"
              aria-label="Open navigation menu"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>

        {/* Global search — own full-width row on mobile (order-3 basis-full), inline on sm+ */}
        <div className="order-3 basis-full sm:order-none sm:basis-auto flex flex-1 min-w-0 sm:min-w-[220px] max-w-3xl sm:mx-3 lg:mx-0 relative">
          <div className="relative w-full">
            <Search className="w-4 h-4 absolute left-3 sm:left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              ref={searchInputRef}
              id="global_search_input"
              name="search"
              type="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Search products, invoices, customers…" data-desktop-placeholder="Search products, invoices, customers… (Ctrl/⌘ K)" data-mobile-placeholder="Search products, invoices…"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSelectedIndex(-1);
                setIsSearchFocused(true);
              }}
              onFocus={() => setIsSearchFocused(true)}
              role="combobox"
              aria-label="Search products, invoices, customers and suppliers"
              aria-expanded={isSearchFocused && cleanQuery.length > 0}
              aria-controls="staff-search-results"
              aria-autocomplete="list"
              aria-activedescendant={selectedIndex >= 0 ? `staff-search-option-${selectedIndex}` : undefined}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setIsSearchFocused(false); return; }
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setSelectedIndex((prev) => (prev < predictions.length - 1 ? prev + 1 : 0));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setSelectedIndex((prev) => (prev > 0 ? prev - 1 : predictions.length - 1));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  if (selectedIndex >= 0 && predictions[selectedIndex]) {
                    predictions[selectedIndex].onSelect();
                  } else {
                    handleOpenSearchModal();
                  }
                } else if (e.key === 'Escape') {
                  setIsSearchFocused(false);
                }
              }}
              className="w-full min-h-[44px] pl-9 sm:pl-10 pr-10 sm:pr-16 py-2 sm:py-2 bg-white/65 dark:bg-slate-900/65 backdrop-blur-md border border-white/60 dark:border-white/10 focus:border-amber-500 text-slate-900 dark:text-slate-100 text-base sm:text-sm rounded-xl focus:outline-none transition-all shadow-xs"
            />

            {/* Right Action Icons in Input */}
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {searchQuery && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedIndex(-1);
                  }}
                  className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <kbd className="hidden lg:inline-block px-1.5 py-0.5 text-[10px] font-mono text-slate-400 bg-white/50 dark:bg-slate-800/60 rounded-md border border-slate-200/50 dark:border-slate-700/50">
                Ctrl/⌘ K
              </kbd>
            </div>
          </div>

          {/* Auto-Complete Prediction Dropdown */}
          {isSearchFocused && cleanQuery.length > 0 && (
            <>
              <div
                className="fixed inset-0 z-40 bg-slate-950/20 sm:bg-transparent"
                onClick={() => setIsSearchFocused(false)}
              />
              <div id="staff-search-results" role="listbox" className="liquid-glass-elevated rounded-2xl z-50 overflow-hidden divide-y divide-slate-100/60 dark:divide-slate-800/60 animate-in fade-in duration-150 fixed left-3 right-3 mt-2 max-h-[60dvh] overflow-y-auto overscroll-contain sm:absolute sm:left-0 sm:right-0 sm:top-full sm:max-h-72">
                {predictions.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-500 space-y-1">
                    <p className="font-bold">No quick predictions for "{searchQuery}"</p>
                    <button
                      onClick={handleOpenSearchModal}
                      className="text-blue-600 dark:text-blue-400 hover:underline font-bold"
                    >
                      Press Enter to run full database scan
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="px-3 py-1.5 bg-slate-50/80 dark:bg-slate-800/50 flex items-center justify-between text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      <span>Auto-complete Predictions</span>
                      <span>{predictions.length} found</span>
                    </div>

                    <div className="max-h-72 overflow-y-auto">
                      {predictions.map((p, idx) => {
                        const Icon = p.icon;
                        const isSelected = selectedIndex === idx;
                        return (
                          <div
                            key={p.id}
                            id={`staff-search-option-${idx}`}
                            role="option"
                            aria-selected={isSelected}
                            onClick={() => p.onSelect()}
                            onMouseEnter={() => setSelectedIndex(idx)}
                            className={`p-3 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-blue-50/90 dark:bg-blue-950/80 text-blue-900 dark:text-blue-100'
                                : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400 shrink-0">
                                <Icon className="w-4 h-4" />
                              </div>
                              <div className="min-w-0 text-left">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-xs text-slate-900 dark:text-white truncate">
                                    {p.title}
                                  </span>
                                  <span className="text-[9px] font-black uppercase px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 shrink-0">
                                    {p.typeLabel}
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                  {p.subtitle}
                                </p>
                              </div>
                            </div>

                            {p.badge && (
                              <span
                                className={`px-2 py-0.5 text-[10px] font-extrabold rounded-full shrink-0 ${
                                  p.badgeColor || 'bg-slate-100 text-slate-700'
                                }`}
                              >
                                {p.badge}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Full Scan Action Button */}
                    <button
                      onClick={handleOpenSearchModal}
                      className="w-full p-2.5 bg-slate-50 dark:bg-slate-800/80 hover:bg-blue-50 dark:hover:bg-blue-950/80 text-blue-600 dark:text-blue-400 font-extrabold text-xs flex items-center justify-between px-4 transition-colors"
                    >
                      <div className="flex items-center gap-1.5">
                        <Search className="w-3.5 h-3.5" />
                        <span>View all matching database results</span>
                      </div>
                      <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md">
                        Enter ↵
                      </kbd>
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* Right Action Icons - row 1 right cluster on mobile, inline on sm+ */}
        <div className="app-header-actions ml-auto sm:ml-0 flex items-center gap-1 sm:gap-2 sm:gap-2.5 shrink-0">
          {/* Cloudflare D1 Network Health Indicator */}
          <D1NetworkHealthBadge
            health={d1Health}
            isChecking={isCheckingHealth}
            unsyncedCount={unsyncedRecordsCount}
            onPing={pingD1Health}
            isSyncing={isSyncing}
            onSync={triggerSync}
          />

          {/* Theme Toggle Button (hidden on narrow phones — the same switch lives in the profile sheet) */}
          <button
            type="button"
            onClick={toggleTheme}
            className="hidden min-[420px]:flex p-2 text-slate-600 dark:text-slate-300 liquid-glass-pill rounded-xl transition-all items-center gap-1.5 cursor-pointer"
            title={`Current theme: ${mode.toUpperCase()}. Click to switch to ${mode === 'dark' ? 'Light' : 'Dark'} mode`}
            aria-label="Toggle color theme"
          >
            {mode === 'dark' ? (
              <>
                <Sun className="w-4 h-4 text-amber-400 fill-amber-400/20" />
                <span className="hidden md:inline text-xs font-extrabold text-amber-400">Light</span>
              </>
            ) : (
              <>
                <Moon className="w-4 h-4 text-slate-700 dark:text-slate-200" />
                <span className="hidden md:inline text-xs font-extrabold text-slate-700 dark:text-slate-300">Dark</span>
              </>
            )}
          </button>

          {/* Notifications Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowNotifPopover(!showNotifPopover)}
              className="relative p-2 sm:p-2 text-slate-600 dark:text-slate-300 liquid-glass-pill rounded-xl transition-all cursor-pointer header-icon-btn"
              title="Notifications"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 bg-rose-500 text-white rounded-full text-[10px] font-bold flex items-center justify-center animate-pulse">
                  {unreadCount}
                </span>
              )}
            </button>

            {showNotifPopover && (
              <>
                <div className="fixed inset-0 z-40 bg-slate-950/40 sm:bg-transparent" onClick={() => setShowNotifPopover(false)} onTouchStart={() => setShowNotifPopover(false)} />
                <div className="liquid-glass-elevated rounded-t-2xl sm:rounded-2xl z-50 p-4 fixed left-2 right-2 bottom-2 top-auto max-h-[78dvh] overflow-y-auto overscroll-contain sm:absolute sm:left-auto sm:right-0 sm:bottom-auto sm:mt-2 sm:top-full sm:max-h-[80vh] w-auto sm:w-96 max-w-[calc(100vw-1rem)]" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4 text-blue-600" />
                      <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                        Notifications
                      </h4>
                    </div>
                    {notifications.length > 0 && (
                      <button
                        onClick={() => {
                          setShowConfirmClearNotifs(true);
                          setShowNotifPopover(false);
                        }}
                        className="text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                      >
                        Clear all
                      </button>
                    )}
                  </div>

                  <div className="max-h-72 overflow-y-auto mt-2 divide-y divide-slate-100 dark:divide-slate-800">
                    {notifications.length === 0 ? (
                      <p className="text-center text-xs text-slate-500 py-6">
                        No new notifications
                      </p>
                    ) : (
                      notifications.map((n, idx) => (
                        <div
                          key={`${n.id}-${idx}`}
                          onClick={() => markNotificationRead(n.id)}
                          className={`py-3 px-2 rounded-xl transition-colors cursor-pointer ${
                            !n.read ? 'bg-blue-50/60 dark:bg-blue-950/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                          }`}
                        >
                          <div className="flex justify-between items-start gap-2">
                            <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                              {n.title}
                            </p>
                            <span className="text-[10px] text-slate-400 whitespace-nowrap">
                              {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                            {n.message}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* User Profile Avatar & Staff Management Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowUserDropdown(!showUserDropdown)}
              className="flex items-center gap-2 pl-2 border-l border-slate-200 dark:border-slate-800 cursor-pointer rounded-xl hover:opacity-90 transition-all focus:outline-none"
              title={`${currentUser?.displayName} (${currentUser?.role}) - Click to switch active staff or manage users`}
            >
              {currentUser?.avatarUrl ? (
                <img
                  src={currentUser.avatarUrl}
                  alt={currentUser.displayName}
                  referrerPolicy="no-referrer"
                  className="w-8.5 h-8.5 rounded-xl object-cover ring-2 ring-blue-500/80 dark:ring-blue-400/80 shadow-xs"
                />
              ) : (
                <div className="w-8.5 h-8.5 rounded-xl bg-blue-600 flex items-center justify-center font-bold text-xs text-white shadow-xs">
                  {currentUser?.displayName.charAt(0) || 'U'}
                </div>
              )}
            </button>

            {showUserDropdown && (
              <>
                <div className="fixed inset-0 z-40 bg-slate-950/40 sm:bg-transparent" onClick={() => setShowUserDropdown(false)} onTouchStart={() => setShowUserDropdown(false)} />
                <div className="liquid-glass-elevated rounded-t-2xl sm:rounded-2xl z-50 p-3 space-y-3 fixed left-2 right-2 bottom-2 top-auto max-h-[78dvh] overflow-y-auto overscroll-contain sm:absolute sm:left-auto sm:right-0 sm:bottom-auto sm:mt-2 sm:top-full w-auto sm:w-72 max-w-[calc(100vw-1rem)] text-slate-900 dark:text-white animate-in fade-in zoom-in-95 duration-150" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
                  {/* Current Active Account Header */}
                  <div className="p-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-100 dark:border-slate-800 flex items-center gap-3">
                    {currentUser?.avatarUrl ? (
                      <img
                        src={currentUser.avatarUrl}
                        alt={currentUser.displayName}
                        referrerPolicy="no-referrer"
                        className="w-9 h-9 rounded-xl object-cover ring-2 ring-blue-500"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-xl bg-blue-600 text-white font-bold flex items-center justify-center text-sm">
                        {currentUser?.displayName.charAt(0)}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-black truncate">{currentUser?.displayName}</p>
                      <p className="text-[10px] text-slate-400 truncate">
                        {currentUser?.username ? `@${currentUser.username} • ` : ''}{currentUser?.email}
                      </p>
                      <span className="inline-block mt-0.5 text-[9px] font-extrabold px-1.5 py-0.2 rounded bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 uppercase">
                        {currentUser?.role}
                      </span>
                    </div>
                  </div>

                  {/* Switch Registered Users Section (Super-User Only) */}
                  {isSuperAdmin ? (
                    <>
                      <div>
                        <p className="text-[10px] uppercase font-extrabold text-slate-400 px-2 pb-1.5 flex items-center justify-between">
                          <span>Switch Active Staff</span>
                          <span className="text-slate-400 font-mono">({users.length})</span>
                        </p>
                        <div className="max-h-36 overflow-y-auto space-y-1 pr-1 scrollbar-thin">
                          {users.map((u) => {
                            const isSelected = currentUser?.id === u.id;
                            return (
                              <button
                                key={u.id}
                                onClick={() => handleInitiateSwitchUser(u)}
                                className={`w-full flex items-center justify-between p-2 rounded-xl text-xs font-medium transition-colors ${
                                  isSelected
                                    ? 'bg-blue-50 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400 font-bold'
                                    : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className="w-6 h-6 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-700 dark:text-slate-200 shrink-0">
                                    {u.displayName.charAt(0)}
                                  </div>
                                  <div className="text-left min-w-0">
                                    <p className="leading-tight truncate font-bold text-[11px]">{u.displayName}</p>
                                    <p className="text-[9px] text-slate-400 truncate">
                                      {u.username ? `@${u.username} • ` : ''}{u.role}
                                    </p>
                                  </div>
                                </div>
                                {isSelected && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Change Current Role */}
                      {currentUser?.role !== 'Sales Staff' && (
                        <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                          <p className="text-[10px] uppercase font-extrabold text-slate-400 px-2 pb-1">
                            Quick Change Role
                          </p>
                          <div className="grid grid-cols-3 gap-1">
                            {(['Administrator', 'Sales Staff', 'Accountant'] as UserRole[]).map((r) => (
                              <button
                                key={r}
                                onClick={() => handleRoleSelect(r)}
                                className={`py-1 px-1.5 text-[10px] font-bold rounded-lg text-center transition-colors ${
                                  currentUser?.role === r
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                                }`}
                              >
                                {r ? r.split(' ')[0] : 'Role'}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
                      <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 leading-tight">
                        🔒 Auto account switching is strictly restricted to the Super-User session.
                      </p>
                    </div>
                  )}

                  {/* Manage Staff & Sign Out Buttons */}
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
                    <button
                      onClick={toggleTheme}
                      className="w-full flex items-center justify-center gap-2 py-2 min-h-[44px] bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/60 text-amber-700 dark:text-amber-300 font-bold rounded-xl text-xs transition-colors border border-amber-200/60 dark:border-amber-900/50 min-[420px]:hidden"
                      title="Toggle color theme"
                    >
                      {mode === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                      <span>Switch to {mode === 'dark' ? 'Light' : 'Dark'} mode</span>
                    </button>

                    <button
                      onClick={() => {
                        setShowUserDropdown(false);
                        onNavigate('settings');
                      }}
                      className="w-full flex items-center justify-center gap-2 py-2 min-h-[44px] bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/80 text-indigo-600 dark:text-indigo-400 font-bold rounded-xl text-xs transition-colors"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      <span>Change / Reset My Password</span>
                    </button>

                    {currentUser?.role === 'Administrator' && (
                      <div className="flex gap-2">
                        {isSuperAdmin && (
                          <button
                            onClick={() => {
                              setShowUserDropdown(false);
                              setIsUserModalOpen(true);
                            }}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900 text-blue-600 dark:text-blue-400 font-bold rounded-xl text-xs transition-colors"
                          >
                            <UserPlus className="w-3.5 h-3.5" />
                            <span>+ Add User</span>
                          </button>
                        )}

                        <button
                          onClick={() => {
                            setShowUserDropdown(false);
                            onNavigate('settings');
                          }}
                          className={`${isSuperAdmin ? '' : 'w-full'} flex items-center justify-center p-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-xs transition-colors gap-1.5`}
                          title="Manage users in Settings"
                        >
                          <Settings className="w-4 h-4" />
                          <span>User Accounts Settings</span>
                        </button>
                      </div>
                    )}

                    {/* Lock and Sign Out are DIFFERENT actions and used to be one
                        button labelled "Sign Out / Lock Workspace" that only ever
                        signed out. Lock is a SCREEN lock: it hides the workspace for
                        a passer-by at zero cost, and the same operator returns with
                        no OTP. Sign Out ends the Access session too, so the terminal
                        is actually secured. */}
                    <button
                      onClick={() => {
                        setShowUserDropdown(false);
                        void lock();
                      }}
                      className="w-full flex items-center justify-center gap-2 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl text-xs transition-colors border border-slate-200/70 dark:border-slate-700"
                      title="Hide the workspace and return to the Mall. You stay signed in, so you can reopen it instantly. Does NOT protect the terminal from the next person — use Sign Out for that."
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>Lock Workspace</span>
                    </button>

                    <button
                      onClick={() => {
                        setShowUserDropdown(false);
                        setShowConfirmSignOut(true);
                      }}
                      className="w-full flex items-center justify-center gap-2 py-2 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 font-bold rounded-xl text-xs transition-colors border border-rose-200/50 dark:border-rose-900/50"
                      title="End this session and require a fresh login (including Cloudflare Access)"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* User Management Modal */}
      <UserModal
        isOpen={isUserModalOpen}
        onClose={() => setIsUserModalOpen(false)}
        userToEdit={null}
      />

      {/* Search Results Database Scan Modal */}
      <SearchResultsModal
        isOpen={showSearchResultsModal}
        onClose={() => setShowSearchResultsModal(false)}
        initialQuery={searchQuery}
        onNavigate={onNavigate}
        onSelectSale={(s) => setSelectedSaleForReceipt(s)}
      />

      {/* Transaction Receipt Modal */}
      <ReceiptModal
        sale={selectedSaleForReceipt}
        onClose={() => setSelectedSaleForReceipt(null)}
      />

      {/* Sign Out Confirmation. Both actions end the Access session and return to
          the Mall; Sign Out is confirmed because it is the one that also destroys
          the app session, so returning afterwards is a clean start rather than a
          resume. Lock stays one-tap. */}
      <ConfirmModal
        isOpen={showConfirmSignOut}
        title="Sign Out of the Workspace"
        message="This ends your session AND your Cloudflare Access login, so nobody else can open the workspace from this device without a fresh verification. To open it again you will need to hold the Mall's Cart button for 3 seconds and verify once more. To simply hide the workspace while you stay signed in, use Lock Workspace instead."
        confirmText="Sign Out"
        variant="warning"
        onClose={() => setShowConfirmSignOut(false)}
        onConfirm={() => {
          setShowConfirmSignOut(false);
          void logout();
        }}
      />

      {/* Clear Notifications Confirmation Modal */}
      <ConfirmModal
        isOpen={showConfirmClearNotifs}
        title="Clear All Notifications"
        message="Are you sure you want to clear all notifications from your feed?"
        confirmText="Clear Notifications"
        variant="warning"
        onClose={() => setShowConfirmClearNotifs(false)}
        onConfirm={() => {
          clearNotifications();
          setShowConfirmClearNotifs(false);
          setShowNotifPopover(false);
        }}
      />

      {/* Account Switching Password Verification Modal for Sales Staff */}
      {showSwitchPasswordModal && targetUserForSwitch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-5 animate-in zoom-in-95 duration-200 text-slate-900 dark:text-white my-auto max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-blue-100 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400 rounded-2xl">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                    Password Required
                  </h3>
                  <p className="text-xs text-slate-500">
                    Sales Staff security authentication
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowSwitchPasswordModal(false);
                  setTargetUserForSwitch(null);
                }}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-100 dark:border-slate-800 flex items-center gap-3">
              {targetUserForSwitch.avatarUrl ? (
                <img
                  src={targetUserForSwitch.avatarUrl}
                  alt={targetUserForSwitch.displayName}
                  referrerPolicy="no-referrer"
                  className="w-10 h-10 rounded-xl object-cover ring-2 ring-blue-500"
                />
              ) : (
                <div className="w-10 h-10 rounded-xl bg-blue-600 text-white font-bold flex items-center justify-center text-sm">
                  {targetUserForSwitch.displayName.charAt(0)}
                </div>
              )}
              <div>
                <p className="text-xs font-black text-slate-900 dark:text-white">{targetUserForSwitch.displayName}</p>
                <p className="text-[11px] text-slate-500">
                  {targetUserForSwitch.username ? `@${targetUserForSwitch.username} • ` : ''}{targetUserForSwitch.email}
                </p>
                <span className="inline-block mt-0.5 text-[9px] font-extrabold px-1.5 py-0.2 rounded bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 uppercase">
                  {targetUserForSwitch.role}
                </span>
              </div>
            </div>

            <form onSubmit={handleConfirmSwitchUser} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Enter Password for {targetUserForSwitch.displayName}
                </label>
                <div className="relative">
                  <input
                    type={showSwitchPasswordText ? 'text' : 'password'}
                    value={switchPassword}
                    onChange={(e) => {
                      setSwitchPassword(e.target.value);
                      setSwitchPasswordError('');
                    }}
                    placeholder="Enter account password..."
                    autoFocus
                    className="w-full pl-3.5 pr-10 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSwitchPasswordText(!showSwitchPasswordText)}
                    className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    {showSwitchPasswordText ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {switchPasswordError && (
                  <p className="mt-1.5 text-xs text-rose-500 font-medium flex items-center gap-1">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                    <span>{switchPasswordError}</span>
                  </p>
                )}
              </div>

              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowSwitchPasswordModal(false);
                    setTargetUserForSwitch(null);
                  }}
                  className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-xs transition-colors"
                >
                  Authenticate & Switch
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </header>
  );
};
