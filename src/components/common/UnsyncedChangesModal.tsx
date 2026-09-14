import React, { useState } from 'react';
import {
  X,
  Trash2,
  Search,
  CloudUpload,
  RefreshCw,
  AlertCircle,
  Filter,
  Layers,
  ShoppingBag,
  Package,
  Users,
  Truck,
  MessageSquare,
  DollarSign,
  Building2,
  FileText,
  Clock,
  Check,
  EyeOff,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { useCloudSync } from '../../hooks/useCloudSync';
import {
  decrementUnsyncedLocalChangesCount,
  isItemUnsynced,
  removeItemUnsyncedKey,
  removeCategoryUnsyncedKeys,
  dismissItemFromUnsynced,
} from '../../services/googleDriveService';

interface UnsyncedChangesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type CategoryType =
  | 'all'
  | 'sales'
  | 'products'
  | 'customers'
  | 'deliveries'
  | 'whatsapp'
  | 'expenses'
  | 'suppliers'
  | 'purchases'
  | 'heldOrders'
  | 'moneyMovements';

interface SyncItem {
  id: string;
  category: CategoryType;
  categoryLabel: string;
  title: string;
  subtitle: string;
  amount?: string;
  date: string;
  originalItem: any;
}

export const UnsyncedChangesModal: React.FC<UnsyncedChangesModalProps> = ({ isOpen, onClose }) => {
  const {
    sales,
    products,
    customers,
    deliveryOrders,
    whatsAppPreOrders,
    expenses,
    suppliers,
    purchases,
    heldOrders,
    moneyMovements,
    deleteSale,
    deleteProduct,
    deleteCustomer,
    deleteDeliveryOrder,
    deleteWhatsAppPreOrder,
    deleteExpense,
    deleteSupplier,
    deletePurchaseOrder,
    deleteHeldOrder,
    deleteMoneyMovement,
    settings,
  } = useApp();

  const { showToast } = useToast();
  const { triggerSync, triggerDriveSync, isSyncing, unsyncedRecordsCount } = useCloudSync();

  const [activeCategory, setActiveCategory] = useState<CategoryType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [bulkDeletingCategory, setBulkDeletingCategory] = useState<CategoryType | null>(null);
  const [deleteMode, setDeleteMode] = useState<'dismiss' | 'permanent'>('dismiss');

  if (!isOpen) return null;

  const currency = settings.currencySymbol || '₦';

  // Format records into printable SyncItems
  const allItems: SyncItem[] = [];

  sales.forEach((s) => {
    allItems.push({
      id: s.id,
      category: 'sales',
      categoryLabel: 'Sales Record',
      title: s.invoiceNo || `Sale #${s.id.slice(-6)}`,
      subtitle: `${s.customerName || 'Walk-in Customer'} • ${s.items?.length || 0} item(s) • ${s.paymentMethod}`,
      amount: `${currency}${(s.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      date: s.createdAt ? new Date(s.createdAt).toLocaleString() : 'Recent',
      originalItem: s,
    });
  });

  products.forEach((p) => {
    allItems.push({
      id: p.id,
      category: 'products',
      categoryLabel: 'Product Item',
      title: p.name,
      subtitle: `SKU: ${p.sku || 'N/A'} • Category: ${p.category || 'General'} • Stock: ${p.stockQuantity}`,
      amount: `${currency}${(p.sellingPrice || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      date: p.updatedAt ? new Date(p.updatedAt).toLocaleString() : p.createdAt ? new Date(p.createdAt).toLocaleString() : 'Recent',
      originalItem: p,
    });
  });

  customers.forEach((c) => {
    allItems.push({
      id: c.id,
      category: 'customers',
      categoryLabel: 'Customer',
      title: c.fullName || c.name,
      subtitle: `${c.phone || 'No Phone'} • ${c.email || 'No Email'} • ${c.customerType || 'Retail'}`,
      amount: c.outstandingBalance ? `${currency}${(Number(c.outstandingBalance) || 0).toFixed(2)} debt` : undefined,
      date: c.createdAt ? new Date(c.createdAt).toLocaleString() : 'Recent',
      originalItem: c,
    });
  });

  deliveryOrders.forEach((d) => {
    allItems.push({
      id: d.id,
      category: 'deliveries',
      categoryLabel: 'Delivery Order',
      title: d.deliveryNo || `Delivery #${d.id.slice(-6)}`,
      subtitle: `To: ${d.recipientName || 'N/A'} • Phone: ${d.recipientPhone || 'N/A'} • Status: ${d.status}`,
      amount: `${currency}${(d.grandTotal || d.orderTotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      date: d.createdAt ? new Date(d.createdAt).toLocaleString() : 'Recent',
      originalItem: d,
    });
  });

  whatsAppPreOrders.forEach((w) => {
    allItems.push({
      id: w.id,
      category: 'whatsapp',
      categoryLabel: 'WhatsApp Pre-Order',
      title: w.preOrderNo || `PreOrder #${w.id.slice(-6)}`,
      subtitle: `Customer: ${w.customerName || 'N/A'} • Status: ${w.status}`,
      amount: `${currency}${(w.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      date: w.createdAt ? new Date(w.createdAt).toLocaleString() : 'Recent',
      originalItem: w,
    });
  });

  expenses.forEach((e) => {
    allItems.push({
      id: e.id,
      category: 'expenses',
      categoryLabel: 'Expense Record',
      title: e.title || e.category,
      subtitle: `Category: ${e.category} • Recorded by: ${e.recordedBy || 'Staff'}`,
      amount: `${currency}${(e.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      date: e.createdAt ? new Date(e.createdAt).toLocaleString() : e.date || 'Recent',
      originalItem: e,
    });
  });

  suppliers.forEach((sp) => {
    allItems.push({
      id: sp.id,
      category: 'suppliers',
      categoryLabel: 'Supplier',
      title: sp.name || sp.companyName,
      subtitle: `Contact: ${sp.contactPerson || 'N/A'} • Phone: ${sp.phone || 'N/A'}`,
      amount: sp.outstandingBalance ? `${currency}${(Number(sp.outstandingBalance) || 0).toFixed(2)} balance` : undefined,
      date: sp.createdAt ? new Date(sp.createdAt).toLocaleString() : 'Recent',
      originalItem: sp,
    });
  });

  purchases.forEach((po) => {
    allItems.push({
      id: po.id,
      category: 'purchases',
      categoryLabel: 'Purchase Order',
      title: po.poNumber || `PO #${po.id.slice(-6)}`,
      subtitle: `Supplier: ${po.supplierName || 'N/A'} • Status: ${po.status}`,
      amount: `${currency}${(po.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      date: po.createdAt ? new Date(po.createdAt).toLocaleString() : 'Recent',
      originalItem: po,
    });
  });

  heldOrders.forEach((h) => {
    allItems.push({
      id: h.id,
      category: 'heldOrders',
      categoryLabel: 'Held Order (Cart)',
      title: h.name || `Held Order #${h.id.slice(-6)}`,
      subtitle: `${h.items?.length || 0} items in held cart`,
      amount: `${currency}${h.items?.reduce((acc, i) => acc + (i.price * i.quantity), 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      date: h.date ? new Date(h.date).toLocaleString() : 'Recent',
      originalItem: h,
    });
  });

  moneyMovements.forEach((m) => {
    allItems.push({
      id: m.id,
      category: 'moneyMovements',
      categoryLabel: 'Money Movement',
      title: m.description || `${m.type} (${m.sourceAccount} → ${m.destinationAccount})`,
      subtitle: `${m.type}${m.subtype ? ` • ${m.subtype}` : ''} • ${m.sourceAccount} → ${m.destinationAccount}`,
      amount: `${currency}${(Number(m.amount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      date: m.date ? new Date(m.date).toLocaleString() : 'Recent',
      originalItem: m,
    });
  });

  // Filter for UNSYNCED items only: local records pending D1 sync (explicit keys).
  const unsyncedAllItems = allItems.filter((item) => isItemUnsynced(item.category, item.id));

  // Calculate counts per category based on unsynced items
  const categoryCounts = {
    all: unsyncedAllItems.length,
    sales: unsyncedAllItems.filter((i) => i.category === 'sales').length,
    products: unsyncedAllItems.filter((i) => i.category === 'products').length,
    customers: unsyncedAllItems.filter((i) => i.category === 'customers').length,
    deliveries: unsyncedAllItems.filter((i) => i.category === 'deliveries').length,
    whatsapp: unsyncedAllItems.filter((i) => i.category === 'whatsapp').length,
    expenses: unsyncedAllItems.filter((i) => i.category === 'expenses').length,
    suppliers: unsyncedAllItems.filter((i) => i.category === 'suppliers').length,
    purchases: unsyncedAllItems.filter((i) => i.category === 'purchases').length,
    heldOrders: unsyncedAllItems.filter((i) => i.category === 'heldOrders').length,
    moneyMovements: unsyncedAllItems.filter((i) => i.category === 'moneyMovements').length,
  };

  // Filter unsynced items by active category and search query
  const filteredItems = unsyncedAllItems.filter((item) => {
    const matchesCategory = activeCategory === 'all' || item.category === activeCategory;
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      item.title.toLowerCase().includes(q) ||
      item.subtitle.toLowerCase().includes(q) ||
      item.categoryLabel.toLowerCase().includes(q) ||
      (item.amount && item.amount.toLowerCase().includes(q));

    return matchesCategory && matchesSearch;
  });

  // Dismiss item from unsynced list (keeps database record intact)
  const handleDismissItem = (item: SyncItem) => {
    try {
      dismissItemFromUnsynced(item.category, item.id);
      showToast({
        title: 'Unsynced Flag Cleared',
        message: `Dismissed ${item.categoryLabel} "${item.title}" from pending sync list. Database record preserved.`,
        type: 'info',
      });
    } catch (err: any) {
      showToast({
        title: 'Action Failed',
        message: err?.message || 'Error dismissing item.',
        type: 'error',
      });
    } finally {
      setDeletingId(null);
    }
  };

  // Execute single item permanent deletion (removes from database)
  const handlePermanentDeleteItem = (item: SyncItem) => {
    try {
      switch (item.category) {
        case 'sales':
          deleteSale(item.id);
          break;
        case 'products':
          deleteProduct(item.id);
          break;
        case 'customers':
          deleteCustomer(item.id);
          break;
        case 'deliveries':
          deleteDeliveryOrder(item.id);
          break;
        case 'whatsapp':
          deleteWhatsAppPreOrder(item.id);
          break;
        case 'expenses':
          deleteExpense(item.id);
          break;
        case 'suppliers':
          deleteSupplier(item.id);
          break;
        case 'purchases':
          deletePurchaseOrder(item.id, 'User');
          break;
        case 'heldOrders':
          deleteHeldOrder(item.id);
          break;
        case 'moneyMovements':
          deleteMoneyMovement(item.id);
          break;
      }

      removeItemUnsyncedKey(item.category, item.id);

      showToast({
        title: 'Record Permanently Deleted',
        message: `Deleted ${item.categoryLabel} "${item.title}" from database and local storage.`,
        type: 'info',
      });
    } catch (err: any) {
      showToast({
        title: 'Deletion Failed',
        message: err?.message || 'Error removing item.',
        type: 'error',
      });
    } finally {
      setDeletingId(null);
    }
  };

  // Execute bulk action
  const handleBulkAction = (category: CategoryType, mode: 'dismiss' | 'permanent') => {
    const itemsToProcess = unsyncedAllItems.filter((i) => category === 'all' || i.category === category);
    if (itemsToProcess.length === 0) return;

    if (mode === 'dismiss') {
      if (category === 'all') {
        itemsToProcess.forEach((item) => dismissItemFromUnsynced(item.category, item.id));
      } else {
        removeCategoryUnsyncedKeys(category);
        itemsToProcess.forEach((item) => dismissItemFromUnsynced(item.category, item.id));
      }
      showToast({
        title: 'Sync Queue Cleared',
        message: `Dismissed ${itemsToProcess.length} record(s) from pending sync list. Database records preserved.`,
        type: 'info',
      });
    } else {
      let count = 0;
      itemsToProcess.forEach((item) => {
        try {
          switch (item.category) {
            case 'sales':
              deleteSale(item.id);
              break;
            case 'products':
              deleteProduct(item.id);
              break;
            case 'customers':
              deleteCustomer(item.id);
              break;
            case 'deliveries':
              deleteDeliveryOrder(item.id);
              break;
            case 'whatsapp':
              deleteWhatsAppPreOrder(item.id);
              break;
            case 'expenses':
              deleteExpense(item.id);
              break;
            case 'suppliers':
              deleteSupplier(item.id);
              break;
            case 'purchases':
              deletePurchaseOrder(item.id, 'User');
              break;
            case 'heldOrders':
              deleteHeldOrder(item.id);
              break;
            case 'moneyMovements':
              deleteMoneyMovement(item.id);
              break;
          }
          removeItemUnsyncedKey(item.category, item.id);
          count++;
        } catch (e) {
          console.warn('Error deleting item during bulk clear:', e);
        }
      });

      decrementUnsyncedLocalChangesCount(count);

      showToast({
        title: 'Records Permanently Deleted',
        message: `Removed ${count} record(s) from database and local storage.`,
        type: 'info',
      });
    }

    setBulkDeletingCategory(null);
  };

  const categoriesList: { id: CategoryType; label: string; icon: any }[] = [
    { id: 'all', label: 'All Records', icon: Layers },
    { id: 'sales', label: 'Sales', icon: ShoppingBag },
    { id: 'products', label: 'Products', icon: Package },
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'deliveries', label: 'Deliveries', icon: Truck },
    { id: 'whatsapp', label: 'WhatsApp Orders', icon: MessageSquare },
    { id: 'expenses', label: 'Expenses', icon: DollarSign },
    { id: 'suppliers', label: 'Suppliers', icon: Building2 },
    { id: 'purchases', label: 'Purchases', icon: FileText },
    { id: 'heldOrders', label: 'Held Orders', icon: Clock },
    { id: 'moneyMovements', label: 'Treasury / Cash', icon: DollarSign },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200/80 dark:border-slate-800 flex flex-col max-h-[90vh] overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between p-5 md:p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-2xl border border-amber-500/20">
              <CloudUpload className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg md:text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
                Unsynced Local Changes Summary
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Review records pending cloud backup. Dismiss items from sync queue or manage database records.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 bg-white dark:bg-slate-800 rounded-xl border border-slate-200/60 dark:border-slate-700 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sync Activation Status Banner */}
        <div className="px-6 py-3 bg-emerald-500/5 dark:bg-emerald-950/20 border-b border-emerald-500/20 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
            <AlertCircle className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>
              <strong>{unsyncedRecordsCount}</strong> local change(s) ready to push directly to <strong>Cloudflare D1</strong> (<code>3e95a550-a091-490b-819d-f0acb7ea8dd8</code>).
            </span>
          </div>

          <div className="flex items-center gap-2 font-mono text-[11px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20">
            <span>Direct D1 Push Active</span>
          </div>
        </div>

        {/* Search & Category Filter Bar */}
        <div className="p-4 md:px-6 md:pt-4 border-b border-slate-100 dark:border-slate-800 space-y-3 bg-white dark:bg-slate-900">
          <div className="flex flex-wrap md:flex-nowrap items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search unsynced records by title, SKU, customer, or amount..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 text-xs bg-slate-100/80 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-amber-500/40"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Bulk Action Options */}
            {categoryCounts[activeCategory] > 0 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDeleteMode('dismiss');
                    setBulkDeletingCategory(activeCategory);
                  }}
                  className="px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shrink-0"
                  title="Dismiss from sync queue without deleting database records"
                >
                  <EyeOff className="w-3.5 h-3.5 text-amber-500" />
                  <span>Dismiss All ({categoryCounts[activeCategory]})</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setDeleteMode('permanent');
                    setBulkDeletingCategory(activeCategory);
                  }}
                  className="px-3 py-2 text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 border border-rose-200 dark:border-rose-900/60 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shrink-0"
                  title="Permanently delete records from database"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Records ({categoryCounts[activeCategory]})</span>
                </button>
              </div>
            )}
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs">
            {categoriesList.map((cat) => {
              const Icon = cat.icon;
              const count = categoryCounts[cat.id];
              const isActive = activeCategory === cat.id;

              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`px-3 py-1.5 rounded-xl font-bold transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                    isActive
                      ? 'bg-amber-500 text-white shadow-xs'
                      : 'bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700/80'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{cat.label}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                      isActive
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Record Items List */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-3 bg-slate-50/30 dark:bg-slate-900/30">
          {filteredItems.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              <div className="inline-flex p-4 rounded-3xl bg-slate-100 dark:bg-slate-800 text-slate-400">
                <Layers className="w-8 h-8" />
              </div>
              <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                No local changes found
              </p>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                {searchQuery
                  ? `No records matching "${searchQuery}". Try clearing your search or switching categories.`
                  : 'All local records are synced or no records exist in this category.'}
              </p>
            </div>
          ) : (
            filteredItems.map((item) => (
              <div
                key={`${item.category}-${item.id}`}
                className="p-4 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl shadow-2xs hover:border-slate-300 dark:hover:border-slate-700 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20">
                      {item.categoryLabel}
                    </span>
                    <span className="text-xs text-slate-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {item.date}
                    </span>
                  </div>

                  <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                    {item.title}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {item.subtitle}
                  </p>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100 dark:border-slate-800">
                  {item.amount && (
                    <span className="text-xs font-black text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg">
                      {item.amount}
                    </span>
                  )}

                  {deletingId === item.id ? (
                    <div className="flex items-center gap-1.5 animate-in fade-in bg-rose-50 dark:bg-rose-950/60 p-1.5 rounded-xl border border-rose-200 dark:border-rose-900/60">
                      <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                        Delete record?
                      </span>
                      <button
                        type="button"
                        onClick={() => handlePermanentDeleteItem(item)}
                        className="p-1.5 bg-rose-600 text-white rounded-lg hover:bg-rose-700 text-xs font-bold cursor-pointer transition-colors"
                        title="Permanently delete from database"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingId(null)}
                        className="p-1.5 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-bold cursor-pointer transition-colors"
                        title="Cancel"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      {/* Dismiss from sync queue button */}
                      <button
                        type="button"
                        onClick={() => handleDismissItem(item)}
                        className="p-2 text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 rounded-xl transition-colors cursor-pointer"
                        title="Dismiss from sync list (keep in database)"
                      >
                        <EyeOff className="w-4 h-4" />
                      </button>

                      {/* Delete from database button */}
                      <button
                        type="button"
                        onClick={() => setDeletingId(item.id)}
                        className="p-2 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-xl transition-colors cursor-pointer"
                        title="Permanently delete from database"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 md:px-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Showing <strong>{filteredItems.length}</strong> of <strong>{allItems.length}</strong> total local change(s).
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>

      </div>

      {/* Bulk Action Confirmation Modal */}
      {bulkDeletingCategory && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <div className={`flex items-center gap-3 ${deleteMode === 'dismiss' ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}>
              <div className={`p-3 rounded-2xl ${deleteMode === 'dismiss' ? 'bg-amber-500/10' : 'bg-rose-500/10'}`}>
                {deleteMode === 'dismiss' ? <EyeOff className="w-6 h-6" /> : <Trash2 className="w-6 h-6" />}
              </div>
              <h3 className="text-base font-black">
                {deleteMode === 'dismiss'
                  ? `Dismiss All ${bulkDeletingCategory === 'all' ? 'Unsynced' : bulkDeletingCategory.toUpperCase()} Items?`
                  : `Permanently Delete All ${bulkDeletingCategory === 'all' ? 'Unsynced' : bulkDeletingCategory.toUpperCase()} Records?`}
              </h3>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {deleteMode === 'dismiss'
                ? `This will remove ${categoryCounts[bulkDeletingCategory]} record(s) from the pending sync inspection queue. Your database records (including customers, sales, products) will remain safely intact in the application.`
                : `Are you sure you want to permanently delete all ${categoryCounts[bulkDeletingCategory]} local record(s) in this category? This will delete the actual records from the database.`}
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setBulkDeletingCategory(null)}
                className="px-4 py-2 text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={() => handleBulkAction(bulkDeletingCategory, deleteMode)}
                className={`px-4 py-2 text-xs font-bold rounded-xl cursor-pointer text-white ${
                  deleteMode === 'dismiss' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {deleteMode === 'dismiss' ? 'Dismiss from Sync Queue' : 'Permanently Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
