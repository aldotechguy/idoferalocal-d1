import React, { useState, useMemo } from 'react';
import {
  Search,
  X,
  Package,
  Receipt,
  Users,
  Building2,
  ShoppingBag,
  ArrowRight,
  Eye,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Tag,
  Phone,
  Mail,
  Calendar,
  CreditCard,
  Layers,
  Database,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { NairaSign } from '../common/NairaSign';
import { Product, Sale, Customer, Supplier, PurchaseOrder, Expense } from '../../types';

interface SearchResultsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialQuery: string;
  onNavigate: (page: string) => void;
  onSelectSale: (sale: Sale) => void;
}

type TabCategory = 'all' | 'products' | 'sales' | 'customers' | 'suppliers' | 'purchases' | 'expenses';

export const SearchResultsModal: React.FC<SearchResultsModalProps> = ({
  isOpen,
  onClose,
  initialQuery,
  onNavigate,
  onSelectSale,
}) => {
  const {
    products,
    sales,
    customers,
    suppliers,
    purchases,
    expenses,
    settings,
  } = useApp();

  const [query, setQuery] = useState(initialQuery);
  const [activeTab, setActiveTab] = useState<TabCategory>('all');

  // Keep query in sync when initialQuery changes upon opening
  React.useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery, isOpen]);

  const cleanQuery = query.trim().toLowerCase();

  // Search logic across all entities
  const matchingProducts = useMemo(() => {
    if (!cleanQuery) return [];
    return products.filter((p) => {
      if (!p) return false;
      return (
        (p.name || '').toLowerCase().includes(cleanQuery) ||
        (p.sku || '').toLowerCase().includes(cleanQuery) ||
        (p.barcode || '').toLowerCase().includes(cleanQuery) ||
        (p.category || '').toLowerCase().includes(cleanQuery) ||
        (p.brand || '').toLowerCase().includes(cleanQuery) ||
        (p.supplierName || '').toLowerCase().includes(cleanQuery) ||
        (p.description && p.description.toLowerCase().includes(cleanQuery))
      );
    });
  }, [products, cleanQuery]);

  const matchingSales = useMemo(() => {
    if (!cleanQuery) return [];
    return sales.filter((s) => {
      if (!s) return false;
      const matchInvoice = (s.invoiceNo || '').toLowerCase().includes(cleanQuery);
      const matchCustomer = (s.customerName || '').toLowerCase().includes(cleanQuery);
      const matchUser = (s.createdBy || '').toLowerCase().includes(cleanQuery);
      const matchPayment = (s.paymentMethod || '').toLowerCase().includes(cleanQuery);
      const matchStatus = (s.status || '').toLowerCase().includes(cleanQuery);
      const matchItems = (s.items || []).some(
        (i) =>
          (i.productName || '').toLowerCase().includes(cleanQuery) ||
          (i.sku || '').toLowerCase().includes(cleanQuery)
      );
      return matchInvoice || matchCustomer || matchUser || matchPayment || matchStatus || matchItems;
    });
  }, [sales, cleanQuery]);

  const matchingCustomers = useMemo(() => {
    if (!cleanQuery) return [];
    return customers.filter((c) => {
      if (!c) return false;
      return (
        (c.name || '').toLowerCase().includes(cleanQuery) ||
        (c.phone || '').toLowerCase().includes(cleanQuery) ||
        (c.email || '').toLowerCase().includes(cleanQuery) ||
        (c.address && c.address.toLowerCase().includes(cleanQuery))
      );
    });
  }, [customers, cleanQuery]);

  const matchingSuppliers = useMemo(() => {
    if (!cleanQuery) return [];
    return suppliers.filter((sup) => {
      if (!sup) return false;
      return (
        (sup.name || '').toLowerCase().includes(cleanQuery) ||
        (sup.contactPerson || '').toLowerCase().includes(cleanQuery) ||
        (sup.email || '').toLowerCase().includes(cleanQuery) ||
        (sup.phone || '').toLowerCase().includes(cleanQuery)
      );
    });
  }, [suppliers, cleanQuery]);

  const matchingPurchases = useMemo(() => {
    if (!cleanQuery) return [];
    return purchases.filter((po) => {
      if (!po) return false;
      const matchPo = (po.poNumber || '').toLowerCase().includes(cleanQuery);
      const matchSupplier = (po.supplierName || '').toLowerCase().includes(cleanQuery);
      const matchUser = (po.createdBy || '').toLowerCase().includes(cleanQuery);
      const matchItems = (po.items || []).some((i) => (i.productName || '').toLowerCase().includes(cleanQuery));
      return matchPo || matchSupplier || matchUser || matchItems;
    });
  }, [purchases, cleanQuery]);

  const matchingExpenses = useMemo(() => {
    if (!cleanQuery) return [];
    return expenses.filter((e) => {
      if (!e) return false;
      return (
        (e.title || '').toLowerCase().includes(cleanQuery) ||
        (e.category || '').toLowerCase().includes(cleanQuery) ||
        (e.paidBy || '').toLowerCase().includes(cleanQuery) ||
        (e.paymentMethod || '').toLowerCase().includes(cleanQuery) ||
        (e.description && e.description.toLowerCase().includes(cleanQuery))
      );
    });
  }, [expenses, cleanQuery]);

  const totalResultsCount =
    matchingProducts.length +
    matchingSales.length +
    matchingCustomers.length +
    matchingSuppliers.length +
    matchingPurchases.length +
    matchingExpenses.length;

  if (!isOpen) return null;

  const handleActionClick = (targetPage: string) => {
    onNavigate(targetPage);
    onClose();
  };

  const highlightMatch = (text: string) => {
    if (!cleanQuery || !text) return text;
    const index = text.toLowerCase().indexOf(cleanQuery);
    if (index === -1) return text;

    return (
      <>
        {text.substring(0, index)}
        <mark className="bg-amber-200 dark:bg-amber-900/80 text-amber-900 dark:text-amber-100 rounded-xs px-0.5 font-bold">
          {text.substring(index, index + cleanQuery.length)}
        </mark>
        {text.substring(index + cleanQuery.length)}
      </>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 md:p-6 overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl sm:rounded-3xl shadow-2xl max-w-6xl w-full flex flex-col h-[94vh] sm:h-[90vh] max-h-[920px] overflow-hidden my-auto">
        
        {/* Top Header & Search Bar */}
        <div className="p-4 sm:p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-slate-900 dark:text-white font-black text-lg sm:text-xl tracking-tight">
              <div className="p-2 bg-blue-600 text-white rounded-xl shadow-xs">
                <Search className="w-5 h-5" />
              </div>
              <span>Database Search Scan</span>
              {totalResultsCount > 0 && (
                <span className="ml-2 px-2.5 py-0.5 bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-extrabold text-xs rounded-full">
                  {totalResultsCount} {totalResultsCount === 1 ? 'match' : 'matches'}
                </span>
              )}
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Search Input Box */}
          <div className="relative">
            <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type product name, SKU, invoice #, customer name, phone, supplier..."
              autoFocus
              className="w-full pl-12 pr-10 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:border-blue-500 dark:focus:border-blue-400 text-slate-900 dark:text-slate-100 text-sm font-medium rounded-2xl shadow-xs focus:outline-none transition-all"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Filter Category Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {[
              { id: 'all', label: 'All Results', count: totalResultsCount, icon: Layers },
              { id: 'products', label: 'Products', count: matchingProducts.length, icon: Package },
              { id: 'sales', label: 'Invoices & Sales', count: matchingSales.length, icon: Receipt },
              { id: 'customers', label: 'Customers', count: matchingCustomers.length, icon: Users },
              { id: 'suppliers', label: 'Suppliers', count: matchingSuppliers.length, icon: Building2 },
              { id: 'purchases', label: 'Purchases', count: matchingPurchases.length, icon: ShoppingBag },
              { id: 'expenses', label: 'Expenses', count: matchingExpenses.length, icon: NairaSign },
            ].map((tab) => {
              const TabIcon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as TabCategory)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-white dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/80 border border-slate-200/80 dark:border-slate-700/80'
                  }`}
                >
                  <TabIcon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-md text-[10px] font-extrabold ${
                      isActive
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Results Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {totalResultsCount === 0 ? (
            <div className="text-center py-16 space-y-3">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto">
                <Search className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {cleanQuery ? `No matching records found for "${query}"` : 'Type to start scanning database'}
              </h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Try searching by product SKU, customer phone number, invoice ID (e.g. INV-1001), or supplier company name.
              </p>
            </div>
          ) : (
            <>
              {/* PRODUCTS SECTION */}
              {(activeTab === 'all' || activeTab === 'products') && matchingProducts.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Package className="w-4 h-4 text-blue-600" />
                      <span>Products ({matchingProducts.length})</span>
                    </h3>
                    <button
                      onClick={() => handleActionClick('products')}
                      className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                    >
                      <span>View Products Page</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {matchingProducts.map((p) => (
                      <div
                        key={p.id}
                        className="p-3.5 bg-slate-50/70 dark:bg-slate-800/50 hover:bg-slate-100/80 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 rounded-2xl transition-all flex items-start gap-3 group"
                      >
                        {p.images && p.images[0] ? (
                          <img
                            src={p.images?.[0] || 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300&auto=format&fit=crop&q=60'}
                            alt={p.name}
                            referrerPolicy="no-referrer"
                            className="w-14 h-14 rounded-xl object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                          />
                        ) : (
                          <div className="w-14 h-14 rounded-xl bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-lg shrink-0">
                            <Package className="w-7 h-7" />
                          </div>
                        )}

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                              {highlightMatch(p.name)}
                            </h4>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold shrink-0 ${
                                p.currentStock <= 0
                                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                                  : p.currentStock <= p.minimumStockLevel
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                  : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              }`}
                            >
                              {p.currentStock <= 0
                                ? 'Out of Stock'
                                : p.currentStock <= p.minimumStockLevel
                                ? `Low: ${p.currentStock} ${p.unit}`
                                : `Stock: ${p.currentStock} ${p.unit}`}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 mt-1 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
                            <span className="font-mono text-[11px] bg-slate-200/60 dark:bg-slate-700/60 px-1.5 py-0.2 rounded-md">
                              SKU: {highlightMatch(p.sku)}
                            </span>
                            <span>•</span>
                            <span>{highlightMatch(p.category)}</span>
                            {p.brand && (
                              <>
                                <span>•</span>
                                <span>{highlightMatch(p.brand)}</span>
                              </>
                            )}
                          </div>

                          <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-200/50 dark:border-slate-700/50">
                            <div className="text-xs font-black text-slate-900 dark:text-white">
                              {settings.currencySymbol}
                              {p.retailPrice.toLocaleString()}{' '}
                              <span className="text-[10px] text-slate-400 font-medium">
                                (Wholesale: {settings.currencySymbol}{p.wholesalePrice.toLocaleString()})
                              </span>
                            </div>

                            <button
                              onClick={() => handleActionClick('pos')}
                              className="px-2.5 py-1 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-1 shadow-xs"
                            >
                              <span>POS Cart</span>
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* SALES & INVOICES SECTION */}
              {(activeTab === 'all' || activeTab === 'sales') && matchingSales.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Receipt className="w-4 h-4 text-emerald-600" />
                      <span>Sales & Invoices ({matchingSales.length})</span>
                    </h3>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {matchingSales.map((s) => (
                      <div
                        key={s.id}
                        className="p-3.5 bg-slate-50/70 dark:bg-slate-800/50 hover:bg-slate-100/80 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 rounded-2xl transition-all space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-xs text-blue-600 dark:text-blue-400">
                              {highlightMatch(s.invoiceNo)}
                            </span>
                            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                              {highlightMatch(s.customerName)}
                            </span>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                              s.status === 'Completed'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                : s.status === 'Refunded'
                                ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                                : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            }`}
                          >
                            {s.status}
                          </span>
                        </div>

                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                          Items: {s.items.map((i) => `${i.quantity}x ${i.productName}`).join(', ')}
                        </p>

                        <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-200/50 dark:border-slate-700/50">
                          <div>
                            <span className="text-slate-400">Total: </span>
                            <span className="font-black text-slate-900 dark:text-white">
                              {settings.currencySymbol}
                              {s.totalAmount.toLocaleString()}
                            </span>
                          </div>

                          <button
                            onClick={() => {
                              onSelectSale(s);
                              onClose();
                            }}
                            className="px-2.5 py-1 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors flex items-center gap-1 shadow-xs"
                          >
                            <Eye className="w-3 h-3" />
                            <span>View Receipt</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* CUSTOMERS SECTION */}
              {(activeTab === 'all' || activeTab === 'customers') && matchingCustomers.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-purple-600" />
                      <span>Customers ({matchingCustomers.length})</span>
                    </h3>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {matchingCustomers.map((c) => (
                      <div
                        key={c.id}
                        className="p-3.5 bg-slate-50/70 dark:bg-slate-800/50 hover:bg-slate-100/80 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 rounded-2xl transition-all flex items-center justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                            {highlightMatch(c.name)}
                          </h4>
                          <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                            <span className="flex items-center gap-1">
                              <Phone className="w-3 h-3" />
                              {highlightMatch(c.phone)}
                            </span>
                            <span className="flex items-center gap-1">
                              <Mail className="w-3 h-3" />
                              {highlightMatch(c.email)}
                            </span>
                          </div>
                        </div>

                        <button
                          onClick={() => handleActionClick('customers')}
                          className="px-2.5 py-1 text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors shrink-0"
                        >
                          View
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* SUPPLIERS SECTION */}
              {(activeTab === 'all' || activeTab === 'suppliers') && matchingSuppliers.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Building2 className="w-4 h-4 text-amber-600" />
                      <span>Suppliers ({matchingSuppliers.length})</span>
                    </h3>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {matchingSuppliers.map((sup) => (
                      <div
                        key={sup.id}
                        className="p-3.5 bg-slate-50/70 dark:bg-slate-800/50 hover:bg-slate-100/80 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 rounded-2xl transition-all flex items-center justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                            {highlightMatch(sup.name)}
                          </h4>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Contact: {highlightMatch(sup.contactPerson)} • {highlightMatch(sup.phone)}
                          </p>
                        </div>

                        <button
                          onClick={() => handleActionClick('suppliers')}
                          className="px-2.5 py-1 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors shrink-0"
                        >
                          View
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* PURCHASES & EXPENSES SECTION */}
              {(activeTab === 'all' || activeTab === 'purchases' || activeTab === 'expenses') &&
                (matchingPurchases.length > 0 || matchingExpenses.length > 0) && (
                  <div className="space-y-3">
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <ShoppingBag className="w-4 h-4 text-indigo-600" />
                      <span>Purchases & Expenses ({matchingPurchases.length + matchingExpenses.length})</span>
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {matchingPurchases.map((po) => (
                        <div
                          key={po.id}
                          className="p-3.5 bg-slate-50/70 dark:bg-slate-800/50 hover:bg-slate-100/80 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 rounded-2xl transition-all flex items-center justify-between gap-2"
                        >
                          <div>
                            <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">
                              {highlightMatch(po.poNumber)}
                            </span>
                            <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
                              Supplier: {highlightMatch(po.supplierName)}
                            </p>
                            <p className="text-[11px] text-slate-400">
                              Amount: {settings.currencySymbol}
                              {po.totalAmount.toLocaleString()}
                            </p>
                          </div>
                          <button
                            onClick={() => handleActionClick('purchases')}
                            className="px-2.5 py-1 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shrink-0"
                          >
                            View
                          </button>
                        </div>
                      ))}

                      {matchingExpenses.map((exp) => (
                        <div
                          key={exp.id}
                          className="p-3.5 bg-slate-50/70 dark:bg-slate-800/50 hover:bg-slate-100/80 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 rounded-2xl transition-all flex items-center justify-between gap-2"
                        >
                          <div>
                            <span className="text-xs font-bold text-slate-900 dark:text-white">
                              {highlightMatch(exp.title)}
                            </span>
                            <p className="text-xs text-slate-500">
                              Category: {highlightMatch(exp.category)} • Paid by: {highlightMatch(exp.paidBy)}
                            </p>
                            <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400">
                              Amount: {settings.currencySymbol}
                              {exp.amount.toLocaleString()}
                            </p>
                          </div>
                          <button
                            onClick={() => handleActionClick('expenses')}
                            className="px-2.5 py-1 text-xs font-bold bg-slate-700 hover:bg-slate-800 text-white rounded-lg shrink-0"
                          >
                            View
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <Database className="w-3.5 h-3.5 text-blue-600" />
            <span>Scanning live database index</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 font-bold bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl transition-colors"
          >
            Close Search
          </button>
        </div>
      </div>
    </div>
  );
};
