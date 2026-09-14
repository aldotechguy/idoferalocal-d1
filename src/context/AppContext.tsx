import React, { createContext, useContext, useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from './AuthContext';
import {
  Product,
  Customer,
  Supplier,
  Sale,
  PurchaseOrder,
  ReceivingHistoryEntry,
  Expense,
  NotificationItem,
  AuditLog,
  StockMovement,
  PricingHistory,
  StoreSettings,
  SaleItem,
  PaymentMethod,
  WhatsAppPreOrder,
  PreOrderStatus,
  DeliveryOrder,
  DeliveryStatus,
  LiquidAccountType,
  MoneyMovementType,
  OwnerWithdrawalSubtype,
  RecordOwnerWithdrawalParams,
  RecordOwnerRepaymentParams,
  TransferFundsParams,
  MoneyMovement,
  TreasuryBalances,
} from '../types';
import {
  INITIAL_PRODUCTS,
  INITIAL_CUSTOMERS,
  INITIAL_SUPPLIERS,
  INITIAL_SALES,
  INITIAL_PURCHASES,
  INITIAL_EXPENSES,
  INITIAL_NOTIFICATIONS,
  INITIAL_AUDIT_LOGS,
  INITIAL_STOCK_MOVEMENTS,
  INITIAL_PRICING_HISTORY,
  INITIAL_SETTINGS,
  INITIAL_WHATSAPP_PREORDERS,
  INITIAL_DELIVERY_ORDERS,
  INITIAL_MONEY_MOVEMENTS,
} from '../data/initialData';
import { saveDocument, removeDocument } from '../firebase/services';
import { subscribeTabSync, markIdDeleted } from '../firebase/syncManager';
import { useToast } from './ToastContext';
import { getAllItems, putManyItems, replaceStoreItems, putItem, clearStore, deleteItem, writeD1SnapshotToIndexedDB } from '../db/indexedDB';
import { initializeD1Storage, queueD1Snapshot, pullLatestFromD1, type D1Snapshot } from '../services/d1StorageService';
import { removeLegacyBusinessStorage, safeSetLocalStorage } from '../utils/localStorage';

const isAutoSyncLog = (log: any): boolean => {
  if (!log) return false;
  const performedBy = String(log.performedBy || '').toLowerCase();
  const action = String(log.action || '').toUpperCase();
  const id = String(log.id || '');
  return (
    performedBy === 'system auto-sync' ||
    performedBy.includes('auto-sync') ||
    action === 'AUTO_RESOLVE_CONFLICT' ||
    id.startsWith('audit-auto-')
  );
};

export const sanitizeMoneyMovement = (m: any): MoneyMovement | null => {
  if (!m || typeof m !== 'object') return null;
  let src = m.sourceAccount;
  let dst = m.destinationAccount;
  let amt = typeof m.amount === 'number' ? m.amount : parseFloat(m.amount);
  let sub = m.subtype;
  let ref = m.referenceNo;
  let perf = m.performedBy;
  let nts = m.notes;
  let date = m.date;

  // Handle case where sourceAccount or destinationAccount was accidentally passed or stored as an object
  if (src && typeof src === 'object') {
    if (isNaN(amt) || amt === undefined || amt === null) {
      amt = typeof src.amount === 'number' ? src.amount : parseFloat(src.amount);
    }
    if (!sub && src.subtype) sub = src.subtype;
    if (!ref && src.referenceNo) ref = src.referenceNo;
    if (!perf && src.performedBy) perf = src.performedBy;
    if (!nts && src.notes) nts = src.notes;
    if (!date && src.date) date = src.date;
    src = src.sourceAccount;
  }

  if (dst && typeof dst === 'object') {
    if (isNaN(amt) || amt === undefined || amt === null) {
      amt = typeof dst.amount === 'number' ? dst.amount : parseFloat(dst.amount);
    }
    if (!ref && dst.referenceNo) ref = dst.referenceNo;
    if (!perf && dst.performedBy) perf = dst.performedBy;
    if (!nts && dst.notes) nts = dst.notes;
    if (!date && dst.date) date = dst.date;
    dst = dst.destinationAccount;
  }

  if (isNaN(amt) || amt === undefined || amt === null) {
    amt = 0;
  }

  const validAccounts: LiquidAccountType[] = ['Biz Account', 'Physical Cash'];
  const validSrc = validAccounts.includes(src) ? (src as LiquidAccountType) : undefined;
  const validDst = validAccounts.includes(dst) ? (dst as LiquidAccountType) : undefined;

  return {
    ...m,
    id: m.id || `mm-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    date: date || m.createdAt || new Date().toISOString(),
    type: m.type || 'Balance Adjustment',
    sourceAccount: validSrc,
    destinationAccount: validDst,
    amount: amt,
    subtype: typeof sub === 'string' ? sub : undefined,
    referenceNo: typeof ref === 'string' ? ref : undefined,
    performedBy: typeof perf === 'string' ? perf : 'Staff',
    notes: typeof nts === 'string' ? nts : undefined,
    createdAt: m.createdAt || date || new Date().toISOString(),
  };
};

export const sanitizeMoneyMovements = (list: any[]): MoneyMovement[] => {
  if (!Array.isArray(list)) return [];
  return list.map(sanitizeMoneyMovement).filter(Boolean) as MoneyMovement[];
};


interface AppContextType {
  products: Product[];
  customers: Customer[];
  suppliers: Supplier[];
  sales: Sale[];
  purchases: PurchaseOrder[];
  expenses: Expense[];
  notifications: NotificationItem[];
  auditLogs: AuditLog[];
  stockMovements: StockMovement[];
  pricingHistory: PricingHistory[];
  settings: StoreSettings;
  heldOrders: { id: string; name: string; items: SaleItem[]; customerId?: string; date: string }[];

  // Product actions
  addProduct: (p: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateProduct: (id: string, p: Partial<Product>, reason?: string) => void;
  deleteProduct: (id: string) => void;
  archiveProduct: (id: string) => void;
  unarchiveProduct: (id: string) => void;
  deduplicateProductsBySku: () => number;
  bulkImportProducts: (imported: Partial<Product>[]) => void;
  bulkImportCustomers: (imported: Partial<Customer>[]) => void;
  bulkImportSuppliers: (imported: Partial<Supplier>[]) => void;
  bulkImportSales: (imported: Partial<Sale>[]) => void;
  bulkImportWhatsAppPreOrders: (imported: Partial<WhatsAppPreOrder>[]) => void;

  // Pricing actions
  changeProductPrice: (
    productId: string,
    newPrice: number,
    priceType: 'Retail' | 'Wholesale' | 'Dealer' | 'Promotional',
    reason: string,
    performedBy: string
  ) => void;

  // Inventory actions
  adjustStock: (
    productId: string,
    qtyChange: number,
    type: StockMovement['type'],
    notes: string,
    performedBy: string
  ) => void;

  // Sales actions
  processSale: (
    items: SaleItem[],
    customer: Customer | null,
    discount: number,
    tax: number,
    paymentMethod: PaymentMethod,
    paidAmount: number,
    type: 'Retail' | 'Wholesale',
    performedBy: string,
    notes?: string,
    customCreatedAt?: string,
    deliveryFee?: number,
    orderTakenBy?: string,
    convertedBy?: string,
    customInvoiceNo?: string
  ) => Sale;
  generateUniqueInvoiceNo: (salesList?: Sale[], whatsappList?: WhatsAppPreOrder[]) => string;
  holdOrder: (name: string, items: SaleItem[], customerId?: string) => void;
  restoreHeldOrder: (id: string) => void;
  deleteHeldOrder: (id: string) => void;
  deleteHeldOrderItem: (heldOrderId: string, productId: string) => void;
  clearAllHeldOrders: () => void;
  refundSale: (saleId: string, reason: string, performedBy: string) => void;
  updateSale: (saleId: string, updates: Partial<Sale>, performedBy?: string, isSuperAdminOverride?: boolean) => void;
  deleteSale: (saleId: string, performedBy?: string) => void;
  reconcileHistoricalDeliveryExpenses: (salesList?: Sale[], expensesList?: Expense[]) => { fixedCount: number };
  purgeHistoricalMoneyMovements: () => { purgedCount: number };

  // Customer actions
  addCustomer: (c: Omit<Customer, 'id' | 'createdAt' | 'purchaseHistoryCount' | 'outstandingBalance' | 'loyaltyPoints' | 'lifetimeValue'>) => Customer;
  updateCustomer: (id: string, updates: Partial<Customer>) => void;
  updateCustomerBalance: (
    id: string,
    amountChange: number,
    paymentDetails?: { paymentMethod?: PaymentMethod; paymentNote?: string; performedBy?: string }
  ) => void;
  deleteCustomer: (id: string) => void;

  // Supplier actions
  addSupplier: (s: Omit<Supplier, 'id' | 'createdAt' | 'productsCount' | 'outstandingBalance'>) => void;
  updateSupplier: (id: string, updates: Partial<Supplier>) => void;
  deleteSupplier: (id: string) => void;

  // Purchase actions
  addPurchaseOrder: (po: Omit<PurchaseOrder, 'id' | 'createdAt'>) => void;
  receivePurchaseOrder: (poId: string, performedBy: string) => void;
  receiveAndInspectPO: (
    poId: string,
    inspectionData: {
      items: {
        productId: string;
        receivingQty: number;
        acceptedQty: number;
        damagedQty: number;
        unitCost?: number;
        customRetailPrice?: number;
        updateCatalogCost?: boolean;
        updateCatalogRetail?: boolean;
        conditionNotes?: string;
      }[];
      inspectionStatus: 'Passed' | 'Passed with Exceptions' | 'Failed';
      inspectorName: string;
      generalNotes?: string;
      deliveryFee?: number;
      deliveryFeePaymentMethod?: PaymentMethod;
    }
  ) => void;
  updatePOPayment: (
    poId: string,
    paymentData: {
      additionalPaidAmount: number;
      paymentMethod: PaymentMethod;
      notes?: string;
      performedBy: string;
    }
  ) => void;
  updatePurchaseOrder: (poId: string, updates: Partial<PurchaseOrder>, performedBy: string) => void;
  deletePurchaseOrder: (poId: string, performedBy: string) => void;

  // Expense actions
  addExpense: (exp: Omit<Expense, 'id' | 'createdAt'>) => void;
  deleteExpense: (id: string) => void;

  // WhatsApp Pre-Orders actions
  whatsAppPreOrders: WhatsAppPreOrder[];
  addWhatsAppPreOrder: (preOrder: Omit<WhatsAppPreOrder, 'id' | 'preOrderNo' | 'createdAt' | 'updatedAt'>) => WhatsAppPreOrder;
  updateWhatsAppPreOrderStatus: (id: string, status: PreOrderStatus, depositAmount?: number) => void;
  updateWhatsAppPreOrder: (id: string, updatedData: Partial<WhatsAppPreOrder>, updatedBy?: string) => void;
  convertPreOrderToSale: (
    preOrderId: string,
    paymentMethod: PaymentMethod,
    performedBy: string,
    notes?: string,
    attributedSalesperson?: string
  ) => Sale;
  deleteWhatsAppPreOrder: (id: string) => void;

  // Delivery Product Orders actions
  deliveryOrders: DeliveryOrder[];
  addDeliveryOrder: (del: Omit<DeliveryOrder, 'id' | 'deliveryNo' | 'createdAt' | 'updatedAt'>) => DeliveryOrder;
  confirmDeliveryPickup: (deliveryOrderId: string, performedBy: string, courierNotes?: string) => void;
  updateDeliveryOrderStatus: (deliveryOrderId: string, newStatus: DeliveryStatus, performedBy?: string) => void;
  updateDeliveryPickup: (deliveryOrderId: string, updates: Partial<DeliveryOrder>, performedBy?: string) => void;
  deleteDeliveryOrder: (id: string, performedBy?: string) => void;

  // Notification actions
  addNotification: (notif: Omit<NotificationItem, 'id' | 'read' | 'createdAt'>) => void;
  markNotificationRead: (id: string) => void;
  deleteNotification: (id: string) => void;
  clearNotifications: () => void;

  // Settings
  updateSettings: (newSettings: Partial<StoreSettings>) => void;

  // Money Movement & Treasury
  moneyMovements: MoneyMovement[];
  treasuryBalances: TreasuryBalances;
  addMoneyMovement: (movement: Omit<MoneyMovement, 'id' | 'createdAt'>) => MoneyMovement;
  deleteMoneyMovement: (id: string, performedBy?: string) => void;
  setInitialLiquidBalances: (bizBalance: number, cashBalance: number, performedBy: string, notes?: string) => void;
  transferBetweenAccounts: (
    paramsOrFrom: TransferFundsParams | LiquidAccountType,
    to?: LiquidAccountType,
    amount?: number,
    notes?: string,
    performedBy?: string
  ) => void;
  recordOwnerWithdrawal: (
    paramsOrSource: RecordOwnerWithdrawalParams | LiquidAccountType,
    amount?: number,
    subtype?: OwnerWithdrawalSubtype,
    notes?: string,
    performedBy?: string
  ) => void;
  recordOwnerRepayment: (
    paramsOrDestination: RecordOwnerRepaymentParams | LiquidAccountType,
    amount?: number,
    notes?: string,
    performedBy?: string
  ) => void;
  recalibrateLiquidBalance: (
    account: LiquidAccountType,
    newActualBalance: number,
    notes: string,
    performedBy: string
  ) => void;

  // D1 Cloud synchronization
  pullFromD1: (showNotification?: boolean) => Promise<boolean>;

  // Audit
  logAudit: (action: string, entity: string, entityId: string | undefined, performedBy: string, details: string) => void;
  clearAuditLogs: () => void;
}

const generateUniqueId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000000)}-${Math.random().toString(36).substring(2, 7)}`;

const sanitizeUniqueIds = <T extends { id: string }>(items: T[], prefix: string): T[] => {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  return items.map((item, idx) => {
    let id = item?.id;
    if (!id || seen.has(id)) {
      id = `${prefix}-${Date.now()}-${idx}-${Math.floor(Math.random() * 1000000)}-${Math.random().toString(36).substring(2, 7)}`;
    }
    seen.add(id);
    return { ...item, id };
  });
};

const sanitizeStoreSettings = (s?: Partial<StoreSettings> | null): StoreSettings => {
  const merged: StoreSettings = { ...INITIAL_SETTINGS, ...(s || {}) };

  if (!merged.storeName || merged.storeName === 'My Store' || merged.storeName.includes('IdoferaLabs') || merged.storeName === 'Idofera Labs') {
    merged.storeName = 'Idofera Packaging';
  }
  if (!merged.address || merged.address.includes('Lagos') || merged.address.includes('742 Packaging Way') || merged.address.includes('Industrial Estate')) {
    merged.address = '16 Atakpo Street, off Nwaniba Road, Uyo';
  }
  if (!merged.phone || merged.phone.includes('+234 801 234 5678') || merged.phone === '+1234567890') {
    merged.phone = '+234 806 376 6861';
  }
  if (!merged.receiptHeader || merged.receiptHeader.includes('IdoferaLabs') || merged.receiptHeader.includes('My Store')) {
    merged.receiptHeader = 'Thank you for shopping at Idofera Packaging!';
  }
  if (!merged.receiptFooter || merged.receiptFooter.includes('14 days')) {
    merged.receiptFooter = 'Goods sold in good condition are subject to standard return policy within 2 working days.';
  }
  if (merged.currencySymbol === '$') merged.currencySymbol = '₦';
  if (merged.currencyCode === 'USD') merged.currencyCode = 'NGN';
  if (merged.taxRatePct === undefined || merged.taxRatePct === 7.5) {
    merged.taxRatePct = 0;
  }
  if (!merged.defaultMinWholesaleQty || merged.defaultMinWholesaleQty === 10) {
    merged.defaultMinWholesaleQty = 25;
  }

  return merged;
};

const AppContext = createContext<AppContextType | undefined>(undefined);

const sortRecordsLifo = <T extends { id?: unknown; createdAt?: string; date?: string }>(records: T[]): T[] =>
  [...records].sort((a, b) => {
    const aTime = Date.parse(a.createdAt || a.date || '');
    const bTime = Date.parse(b.createdAt || b.date || '');
    const timestampOrder = (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    if (timestampOrder !== 0) return timestampOrder;
    return String(b.id || '').localeCompare(String(a.id || ''), undefined, { numeric: true });
  });

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser } = useAuth();
  const isClearedBoot = typeof window !== 'undefined' && localStorage.getItem('idofera_cleared_empty') === 'true';
  const isInitialBootRef = useRef(false);
  const [isStorageReady, setIsStorageReady] = useState(false);
  const [isD1Ready, setIsD1Ready] = useState(false);
  const d1InitializedForUserRef = useRef<string | null>(null);
  const isApplyingD1Ref = useRef(false);

  const [products, setProducts] = useState<Product[]>(() => {
    const saved = localStorage.getItem('idofera_products');
    const items = saved ? JSON.parse(saved) : (isClearedBoot ? [] : INITIAL_PRODUCTS);
    return sanitizeUniqueIds(items, 'prod');
  });

  const [customers, setCustomers] = useState<Customer[]>(() => {
    const saved = localStorage.getItem('idofera_customers');
    const items = saved ? JSON.parse(saved) : (isClearedBoot ? [] : INITIAL_CUSTOMERS);
    return sanitizeUniqueIds(items, 'cust');
  });

  const [suppliers, setSuppliers] = useState<Supplier[]>(() => {
    const saved = localStorage.getItem('idofera_suppliers');
    const items = saved ? JSON.parse(saved) : (isClearedBoot ? [] : INITIAL_SUPPLIERS);
    return sanitizeUniqueIds(items, 'sup');
  });

  const [sales, setSales] = useState<Sale[]>(() => {
    const saved = localStorage.getItem('idofera_sales');
    const items = saved ? JSON.parse(saved) : (isClearedBoot ? [] : INITIAL_SALES);
    return sanitizeUniqueIds(items, 'sale');
  });

  const [purchases, setPurchases] = useState<PurchaseOrder[]>(() => {
    const saved = localStorage.getItem('idofera_purchases');
    const items = saved ? JSON.parse(saved) : (isClearedBoot ? [] : INITIAL_PURCHASES);
    return sanitizeUniqueIds(items, 'po');
  });

  const [expenses, setExpenses] = useState<Expense[]>(() => {
    const saved = localStorage.getItem('idofera_expenses');
    const items = saved ? JSON.parse(saved) : (isClearedBoot ? [] : INITIAL_EXPENSES);
    return sanitizeUniqueIds(items, 'exp');
  });

  const [notifications, setNotifications] = useState<NotificationItem[]>(() => {
    const saved = localStorage.getItem('idofera_notifications');
    const items = saved ? JSON.parse(saved) : (isClearedBoot ? [] : INITIAL_NOTIFICATIONS);
    return sanitizeUniqueIds(items, 'notif');
  });

  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(() => {
    const saved = localStorage.getItem('idofera_auditLogs');
    const items = saved ? JSON.parse(saved) : (isClearedBoot ? [] : INITIAL_AUDIT_LOGS);
    const sanitized = sanitizeUniqueIds(items, 'audit');
    return sanitized.filter((log) => !isAutoSyncLog(log));
  });

  const [stockMovements, setStockMovements] = useState<StockMovement[]>(() => {
    const saved = localStorage.getItem('idofera_stockMovements');
    const items = saved ? JSON.parse(saved) : (isClearedBoot ? [] : INITIAL_STOCK_MOVEMENTS);
    return sanitizeUniqueIds(items, 'mv');
  });

  const [pricingHistory, setPricingHistory] = useState<PricingHistory[]>(() => {
    const saved = localStorage.getItem('idofera_pricingHistory');
    const items = saved ? JSON.parse(saved) : (isClearedBoot ? [] : INITIAL_PRICING_HISTORY);
    return sanitizeUniqueIds(items, 'ph');
  });

  const [settings, setSettings] = useState<StoreSettings>(() => {
    const saved = localStorage.getItem('idofera_settings');
    if (saved) {
      try {
        return sanitizeStoreSettings(JSON.parse(saved));
      } catch (e) {
        return sanitizeStoreSettings(INITIAL_SETTINGS);
      }
    }
    return sanitizeStoreSettings(INITIAL_SETTINGS);
  });

  const [heldOrders, setHeldOrders] = useState<{ id: string; name: string; items: SaleItem[]; customerId?: string; date: string }[]>(() => {
    const saved = localStorage.getItem('idofera_heldOrders');
    return saved ? JSON.parse(saved) : [];
  });

  const [whatsAppPreOrders, setWhatsAppPreOrders] = useState<WhatsAppPreOrder[]>(() => {
    const saved = localStorage.getItem('idofera_whatsAppPreOrders');
    return saved ? JSON.parse(saved) : (isClearedBoot ? [] : INITIAL_WHATSAPP_PREORDERS);
  });

  const [deliveryOrders, setDeliveryOrders] = useState<DeliveryOrder[]>(() => {
    const saved = localStorage.getItem('idofera_deliveryOrders');
    return saved ? JSON.parse(saved) : (isClearedBoot ? [] : INITIAL_DELIVERY_ORDERS);
  });

  const [moneyMovements, setMoneyMovements] = useState<MoneyMovement[]>(() => {
    const saved = localStorage.getItem('idofera_moneyMovements');
    const raw = saved ? JSON.parse(saved) : (isClearedBoot ? [] : INITIAL_MONEY_MOVEMENTS);
    return sanitizeMoneyMovements(raw);
  });

  const treasuryBalances = useMemo<TreasuryBalances>(() => {
    let biz = 0;
    let cash = 0;
    let ownerDrawings = 0;
    let ownerLoans = 0;

    moneyMovements.forEach((mv) => {
      const amt = Number(mv.amount) || 0;
      if (mv.destinationAccount === 'Biz Account') {
        biz += amt;
      } else if (mv.destinationAccount === 'Physical Cash') {
        cash += amt;
      }

      if (mv.sourceAccount === 'Biz Account') {
        biz -= amt;
      } else if (mv.sourceAccount === 'Physical Cash') {
        cash -= amt;
      }

      if (mv.type === 'Owner Drawing') {
        ownerDrawings += amt;
        if (mv.subtype === 'Owner Loan') {
          ownerLoans += amt;
        }
      } else if (mv.type === 'Owner Repayment') {
        ownerLoans = Math.max(0, ownerLoans - amt);
      }
    });

    return {
      bizAccountBalance: Number(biz.toFixed(2)),
      physicalCashBalance: Number(cash.toFixed(2)),
      totalLiquidCash: Number((biz + cash).toFixed(2)),
      totalOwnerDrawings: Number(ownerDrawings.toFixed(2)),
      totalOwnerLoans: Number(ownerLoans.toFixed(2)),
    };
  }, [moneyMovements]);

  const applyCloudData = React.useCallback((cloudData: Record<string, any[]>) => {
    if (!cloudData) return;
    if (cloudData.products) setProducts(cloudData.products);
    if (cloudData.customers) setCustomers(cloudData.customers);
    if (cloudData.suppliers) setSuppliers(cloudData.suppliers);
    if (cloudData.sales) setSales(cloudData.sales);
    if (cloudData.purchases) setPurchases(cloudData.purchases);
    if (cloudData.expenses) setExpenses(cloudData.expenses);
    if (cloudData.notifications) setNotifications(cloudData.notifications);
    if (cloudData.auditLogs) {
      setAuditLogs(cloudData.auditLogs.filter((l) => !isAutoSyncLog(l)));
    }
    if (cloudData.stockMovements) setStockMovements(cloudData.stockMovements);
    if (cloudData.pricingHistory) setPricingHistory(cloudData.pricingHistory);
    if (cloudData.settings && cloudData.settings.length > 0) setSettings(sanitizeStoreSettings(cloudData.settings[0]));
    if (cloudData.heldOrders) setHeldOrders(cloudData.heldOrders);
    if (cloudData.whatsAppPreOrders) setWhatsAppPreOrders(cloudData.whatsAppPreOrders);
    if (cloudData.deliveryOrders) setDeliveryOrders(cloudData.deliveryOrders);
    if (cloudData.moneyMovements) setMoneyMovements(sanitizeMoneyMovements(cloudData.moneyMovements));
  }, []);

  useEffect(() => {
    const handleDbRestored = (e: any) => {
      if (e.detail) {
        applyCloudData(e.detail);
      }
    };

    window.addEventListener('idofera_db_restored', handleDbRestored);

    const unsubTab = subscribeTabSync(async ({ storeName }) => {
      try {
        const items = await getAllItems<any>(storeName as any);
        applyCloudData({ [storeName]: items });
      } catch (err) {
        console.warn(`Error handling tab sync for ${storeName}:`, err);
      }
    });
    return () => {
      window.removeEventListener('idofera_db_restored', handleDbRestored);
      unsubTab();
    };
  }, [applyCloudData]);

  // Initial boot: Load from IndexedDB if available, or seed IndexedDB with initial dataset
  useEffect(() => {
    let isMounted = true;
    async function initIndexedDBStorage() {
      try {
        const isCleared = localStorage.getItem('idofera_cleared_empty') === 'true';

        const [
          idbProds,
          idbCusts,
          idbSups,
          idbSales,
          idbPurch,
          idbExps,
          idbNotifs,
          idbAudit,
          idbMovements,
          idbPricing,
          idbSettings,
          idbHeld,
          idbPreOrders,
          idbDeliveries,
          idbMoneyMovements,
        ] = await Promise.all([
          getAllItems<Product>('products'),
          getAllItems<Customer>('customers'),
          getAllItems<Supplier>('suppliers'),
          getAllItems<Sale>('sales'),
          getAllItems<PurchaseOrder>('purchases'),
          getAllItems<Expense>('expenses'),
          getAllItems<NotificationItem>('notifications'),
          getAllItems<AuditLog>('auditLogs'),
          getAllItems<StockMovement>('stockMovements'),
          getAllItems<PricingHistory>('pricingHistory'),
          getAllItems<StoreSettings>('settings'),
          getAllItems<{ id: string; name: string; items: SaleItem[]; customerId?: string; date: string }>('heldOrders'),
          getAllItems<WhatsAppPreOrder>('whatsAppPreOrders'),
          getAllItems<DeliveryOrder>('deliveryOrders'),
          getAllItems<MoneyMovement>('moneyMovements'),
        ]);

        if (!isMounted) return;

        if (idbProds && idbProds.length > 0) setProducts(idbProds);
        else if (isCleared) setProducts([]);
        else await putManyItems('products', products);

        if (idbCusts && idbCusts.length > 0) setCustomers(idbCusts);
        else if (isCleared) setCustomers([]);
        else await putManyItems('customers', customers);

        if (idbSups && idbSups.length > 0) setSuppliers(idbSups);
        else if (isCleared) setSuppliers([]);
        else await putManyItems('suppliers', suppliers);

        if (idbSales && idbSales.length > 0) setSales(idbSales);
        else if (isCleared) setSales([]);
        else await putManyItems('sales', sales);

        if (idbPurch && idbPurch.length > 0) setPurchases(idbPurch);
        else if (isCleared) setPurchases([]);
        else await putManyItems('purchases', purchases);

        if (idbExps && idbExps.length > 0) setExpenses(idbExps);
        else if (isCleared) setExpenses([]);
        else await putManyItems('expenses', expenses);

        if (idbNotifs && idbNotifs.length > 0) setNotifications(idbNotifs);
        else if (isCleared) setNotifications([]);
        else await putManyItems('notifications', notifications);

        if (idbAudit && idbAudit.length > 0) {
          setAuditLogs(idbAudit.filter((l) => !isAutoSyncLog(l)));
        } else if (isCleared) {
          setAuditLogs([]);
        } else {
          await putManyItems('auditLogs', auditLogs.filter((l) => !isAutoSyncLog(l)));
        }

        if (idbMovements && idbMovements.length > 0) setStockMovements(idbMovements);
        else if (isCleared) setStockMovements([]);
        else await putManyItems('stockMovements', stockMovements);

        if (idbPricing && idbPricing.length > 0) setPricingHistory(idbPricing);
        else if (isCleared) setPricingHistory([]);
        else await putManyItems('pricingHistory', pricingHistory);

        if (idbSettings && idbSettings.length > 0) {
          const sanitized = sanitizeStoreSettings(idbSettings[0]);
          setSettings(sanitized);
          await putItem('settings', { ...sanitized, id: 'store_settings' });
        } else {
          const sanitized = sanitizeStoreSettings(settings);
          setSettings(sanitized);
          await putItem('settings', { ...sanitized, id: 'store_settings' });
        }

        if (idbHeld && idbHeld.length > 0) setHeldOrders(idbHeld);
        else if (isCleared) setHeldOrders([]);
        else if (heldOrders.length > 0) await putManyItems('heldOrders', heldOrders);

        if (idbPreOrders && idbPreOrders.length > 0) setWhatsAppPreOrders(idbPreOrders);
        else if (isCleared) setWhatsAppPreOrders([]);
        else await putManyItems('whatsAppPreOrders', whatsAppPreOrders);

        if (idbDeliveries && idbDeliveries.length > 0) setDeliveryOrders(idbDeliveries);
        else if (isCleared) setDeliveryOrders([]);
        else await putManyItems('deliveryOrders', deliveryOrders);

        if (idbMoneyMovements && idbMoneyMovements.length > 0) {
          const loadedSales = (idbSales && idbSales.length > 0) ? idbSales : sales;
          const histSaleIds = new Set(
            loadedSales
              .filter((s: any) => Boolean(
                s.isHistorical ||
                (typeof s.id === 'string' && s.id.startsWith('sale-imp-')) ||
                (typeof s.notes === 'string' &&
                  (s.notes.includes('Historical') || s.notes.includes('Past Entry') || s.notes.includes('Import Wizard')))
              ))
              .map((s: any) => s.id)
          );

          const cleanedMovements = sanitizeMoneyMovements(idbMoneyMovements).filter((m) => {
            if (typeof m.id === 'string' && m.id.startsWith('mm-hist-')) return false;
            if (typeof m.referenceNo === 'string' && m.referenceNo.includes('Historical')) return false;
            if (typeof m.notes === 'string' && (m.notes.includes('Historical') || m.notes.includes('Historical delivery fee'))) return false;
            if (m.type === 'Sale Inflow' && m.referenceId && histSaleIds.has(m.referenceId)) return false;
            return true;
          });
          setMoneyMovements(cleanedMovements);
        } else if (isCleared) setMoneyMovements([]);
        else if (moneyMovements.length > 0) await putManyItems('moneyMovements', moneyMovements);

        // All legacy collection data is now represented in IndexedDB. Remove
        // the duplicate localStorage copies before they exhaust its quota.
        removeLegacyBusinessStorage();
      } catch (err) {
        console.warn('IndexedDB initial boot loading warning:', err);
      } finally {
        if (isMounted) {
          isInitialBootRef.current = true;
          setIsStorageReady(true);
        }
      }
    }
    initIndexedDBStorage();
    return () => {
      isMounted = false;
    };
  }, [applyCloudData]);

  // Keep business collections in IndexedDB instead of duplicating them in the
  // much smaller localStorage quota.
  useEffect(() => {
    replaceStoreItems('products', products).catch((e) => console.warn('IndexedDB products sync error:', e));
  }, [products]);

  useEffect(() => {
    replaceStoreItems('customers', customers).catch((e) => console.warn('IndexedDB customers sync error:', e));
  }, [customers]);

  useEffect(() => {
    replaceStoreItems('suppliers', suppliers).catch((e) => console.warn('IndexedDB suppliers sync error:', e));
  }, [suppliers]);

  useEffect(() => {
    replaceStoreItems('sales', sales).catch((e) => console.warn('IndexedDB sales sync error:', e));
  }, [sales]);

  useEffect(() => {
    replaceStoreItems('purchases', purchases).catch((e) => console.warn('IndexedDB purchases sync error:', e));
  }, [purchases]);

  useEffect(() => {
    replaceStoreItems('expenses', expenses).catch((e) => console.warn('IndexedDB expenses sync error:', e));
  }, [expenses]);

  useEffect(() => {
    replaceStoreItems('notifications', notifications).catch((e) => console.warn('IndexedDB notifications sync error:', e));
  }, [notifications]);

  useEffect(() => {
    replaceStoreItems('auditLogs', auditLogs).catch((e) => console.warn('IndexedDB auditLogs sync error:', e));
  }, [auditLogs]);

  useEffect(() => {
    replaceStoreItems('stockMovements', stockMovements).catch((e) => console.warn('IndexedDB stockMovements sync error:', e));
  }, [stockMovements]);

  useEffect(() => {
    replaceStoreItems('pricingHistory', pricingHistory).catch((e) => console.warn('IndexedDB pricingHistory sync error:', e));
  }, [pricingHistory]);

  useEffect(() => {
    safeSetLocalStorage('idofera_settings', JSON.stringify(settings));
    putItem('settings', { ...settings, id: 'store_settings' }).catch((e) => console.warn('IndexedDB settings sync error:', e));
    if (isInitialBootRef.current && !isApplyingD1Ref.current) {
      saveDocument('settings', { ...settings, id: 'store_settings' });
    }
  }, [settings]);

  useEffect(() => {
    replaceStoreItems('heldOrders', heldOrders).catch((e) => console.warn('IndexedDB heldOrders sync error:', e));
  }, [heldOrders]);

  useEffect(() => {
    replaceStoreItems('deliveryOrders', deliveryOrders).catch((e) => console.warn('IndexedDB deliveryOrders sync error:', e));
  }, [deliveryOrders]);

  // Auto deduplicate any existing duplicate SKUs on initial app load
  useEffect(() => {
    const skuCounts = new Map<string, number>();
    let hasDupes = false;
    products.forEach((p) => {
      if (p.sku && p.sku.trim()) {
        const k = p.sku.trim().toUpperCase();
        const current = (skuCounts.get(k) || 0) + 1;
        skuCounts.set(k, current);
        if (current > 1) {
          hasDupes = true;
        }
      }
    });

    if (hasDupes) {
      deduplicateProductsBySku();
    }
  }, []);

  useEffect(() => {
    replaceStoreItems('whatsAppPreOrders', whatsAppPreOrders).catch((e) => console.warn('IndexedDB preorders sync error:', e));
  }, [whatsAppPreOrders]);

  useEffect(() => {
    replaceStoreItems('moneyMovements', moneyMovements).catch((e) => console.warn('IndexedDB moneyMovements sync error:', e));
  }, [moneyMovements]);

  const currentD1Snapshot = (): D1Snapshot => ({
    products,
    customers,
    suppliers,
    sales,
    purchases,
    expenses,
    notifications,
    auditLogs,
    stockMovements,
    pricingHistory,
    settings: [{...settings, id: 'store_settings'}],
    heldOrders,
    whatsAppPreOrders,
    deliveryOrders,
    moneyMovements,
  });

  const d1BootSyncedRef = useRef(false);

  const persistSnapshotToIndexedDB = async (stores: Record<string, any[]>) => {
    try {
      await writeD1SnapshotToIndexedDB(stores);
    } catch (e) {
      console.warn('Persist to IndexedDB error:', e);
    }
  };

  // Immediate sync from D1 on browser refresh / initial load
  useEffect(() => {
    if (!isStorageReady) return;
    if (d1BootSyncedRef.current) return;
    d1BootSyncedRef.current = true;

    initializeD1Storage(currentD1Snapshot())
      .then(async (restored) => {
        if (restored) {
          isApplyingD1Ref.current = true;
          // Immediately merge remote D1 data into application state
          applyCloudData(restored);
          // Immediately write remote D1 data directly to local IndexedDB stores
          await writeD1SnapshotToIndexedDB(restored);
          window.setTimeout(() => {
            isApplyingD1Ref.current = false;
          }, 250);
        }
      })
      .catch((error) => console.warn('D1 startup read warning:', error))
      .finally(() => setIsD1Ready(true));
  }, [isStorageReady, applyCloudData]);

  // If user logs in after boot and D1 hasn't synced yet, ensure initialization
  useEffect(() => {
    if (!currentUser) return;
    if (!isStorageReady || d1BootSyncedRef.current) return;
    d1BootSyncedRef.current = true;
    initializeD1Storage(currentD1Snapshot())
      .then(async (restored) => {
        if (restored) {
          isApplyingD1Ref.current = true;
          applyCloudData(restored);
          await writeD1SnapshotToIndexedDB(restored);
          window.setTimeout(() => {
            isApplyingD1Ref.current = false;
          }, 250);
        }
      })
      .catch((error) => console.warn('D1 user login sync warning:', error))
      .finally(() => setIsD1Ready(true));
  }, [currentUser, isStorageReady, applyCloudData]);

  // D1 is the durable business-data source. IndexedDB remains the offline cache;
  // Firebase remains temporarily only for Google authentication.
  useEffect(() => {
    if (!isD1Ready || isApplyingD1Ref.current) return;
    queueD1Snapshot(currentD1Snapshot(), applyCloudData);
  }, [isD1Ready, products, customers, suppliers, sales, purchases, expenses, notifications, auditLogs, stockMovements, pricingHistory, settings, heldOrders, whatsAppPreOrders, deliveryOrders, moneyMovements, applyCloudData]);

  const { showToast } = useToast();

  const pullFromD1 = React.useCallback(async (showNotification = true): Promise<boolean> => {
    try {
      const stores = await pullLatestFromD1();
      if (stores) {
        isApplyingD1Ref.current = true;
        applyCloudData(stores);
        await persistSnapshotToIndexedDB(stores);
        window.setTimeout(() => {
          isApplyingD1Ref.current = false;
        }, 250);

        if (showNotification) {
          const totalDocs = Object.values(stores).reduce((acc, curr) => acc + (Array.isArray(curr) ? curr.length : 0), 0);
          showToast({
            title: 'Cloudflare D1 Synchronized',
            message: `Successfully loaded ${totalDocs} current records directly from Cloudflare D1.`,
            type: 'success',
          });
        }
        return true;
      }
      return false;
    } catch (err: any) {
      console.error('Error pulling from D1:', err);
      if (showNotification) {
        showToast({
          title: 'D1 Sync Error',
          message: err?.message || 'Could not fetch current data from Cloudflare D1.',
          type: 'error',
        });
      }
      return false;
    }
  }, [applyCloudData, showToast]);

  useEffect(() => {
    const handlePullEvent = () => {
      pullFromD1(true);
    };
    window.addEventListener('idofera_pull_d1', handlePullEvent);
    return () => window.removeEventListener('idofera_pull_d1', handlePullEvent);
  }, [pullFromD1]);

  const logAudit = (action: string, entity: string, entityId: string | undefined, performedBy: string, details: string) => {
    const newLog: AuditLog = {
      id: 'audit-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      action,
      entity,
      entityId,
      performedBy,
      details,
      createdAt: new Date().toISOString(),
    };
    setAuditLogs((prev) => [newLog, ...prev]);
    saveDocument('auditLogs', newLog);
  };

  const clearAuditLogs = () => {
    setAuditLogs([]);
    clearStore('auditLogs').catch((e) => console.warn('IndexedDB clear auditLogs error:', e));
    localStorage.removeItem('idofera_auditLogs');
  };

  // Product CRUD
  const addProduct = (p: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>) => {
    const id = 'prod-' + Date.now();
    const now = new Date().toISOString();
    const newProd: Product = {
      ...p,
      id,
      createdAt: now,
      updatedAt: now,
      status: p.currentStock <= 0 ? 'Out of Stock' : p.currentStock <= p.minimumStockLevel ? 'Low Stock' : 'Active',
    };
    setProducts((prev) => [newProd, ...prev]);
    saveDocument('products', newProd);
    logAudit('CREATE_PRODUCT', 'Product', id, 'System User', `Created product ${p.name} (SKU: ${p.sku}).`);
    showToast({ title: 'New Product Added', message: `Product "${p.name}" (SKU: ${p.sku}) added to catalog.`, type: 'success' });
  };

  const updateProduct = (id: string, updates: Partial<Product>, reason?: string) => {
    let targetName = 'Product';
    setProducts((prev) =>
      prev.map((prod) => {
        if (prod.id !== id) return prod;
        targetName = prod.name;
        const updated = { ...prod, ...updates, updatedAt: new Date().toISOString() };

        // Always enforce correct status based on stock level unless explicitly setting Archived
        if (prod.status === 'Archived' && updates.status === undefined) {
          updated.status = 'Archived';
        } else if (updates.status === 'Archived') {
          updated.status = 'Archived';
        } else if (updated.currentStock <= 0) {
          updated.status = 'Out of Stock';
        } else if (updated.currentStock <= updated.minimumStockLevel) {
          updated.status = 'Low Stock';
        } else {
          updated.status = 'Active';
        }

        saveDocument('products', updated);
        return updated;
      })
    );
    logAudit('UPDATE_PRODUCT', 'Product', id, 'User', reason || `Updated product details for ${id}.`);
    showToast({ title: 'Product Updated', message: `Updated details for "${targetName}".`, type: 'info' });
  };

  const deleteProduct = (id: string) => {
    const target = products.find((p) => p.id === id);
    setProducts((prev) => prev.filter((p) => p.id !== id));
    removeDocument('products', id);
    deleteItem('products', id).catch((e) => console.warn('IndexedDB product delete error:', e));
    markIdDeleted('products', id);

    // Clean up low stock notifications for this product
    if (target) {
      setNotifications((prev) => {
        const removed = prev.filter((n) => n.message.includes(target.name));
        removed.forEach((n) => removeDocument('notifications', n.id));
        return prev.filter((n) => !n.message.includes(target.name));
      });
    }

    logAudit('DELETE_PRODUCT', 'Product', id, 'User', target ? `Deleted product "${target.name}" (SKU: ${target.sku}).` : `Deleted product ${id}.`);
    showToast({ title: 'Product Deleted', message: target ? `Product "${target.name}" removed from inventory.` : 'Product deleted.', type: 'error' });
  };

  const archiveProduct = (id: string) => {
    const target = products.find((p) => p.id === id);
    updateProduct(id, { status: 'Archived' }, 'Archived product from active catalog.');
    showToast({ title: 'Product Archived', message: target ? `"${target.name}" moved to archive repository.` : 'Product archived.', type: 'warning' });
  };

  const unarchiveProduct = (id: string) => {
    const target = products.find((p) => p.id === id);
    if (!target) return;
    const restoredStatus = target.currentStock <= 0 ? 'Out of Stock' : target.currentStock <= target.minimumStockLevel ? 'Low Stock' : 'Active';
    updateProduct(id, { status: restoredStatus }, 'Unarchived product and restored to active catalog.');
    showToast({ title: 'Product Unarchived', message: `"${target.name}" restored to active inventory.`, type: 'success' });
  };

  const deduplicateProductsBySku = (): number => {
    const skuMap = new Map<string, Product>();
    const duplicatesToRemove: string[] = [];

    products.forEach((prod) => {
      const skuKey = prod.sku ? prod.sku.trim().toUpperCase() : '';
      if (!skuKey) return;

      if (skuMap.has(skuKey)) {
        const existing = skuMap.get(skuKey)!;
        let keep = existing;
        let remove = prod;
        // Prefer keeping original or non 'prod-imp-' record
        if (existing.id.startsWith('prod-imp-') && !prod.id.startsWith('prod-imp-')) {
          keep = prod;
          remove = existing;
          skuMap.set(skuKey, keep);
        }
        duplicatesToRemove.push(remove.id);
      } else {
        skuMap.set(skuKey, prod);
      }
    });

    if (duplicatesToRemove.length === 0) {
      return 0;
    }

    const removedCount = duplicatesToRemove.length;

    duplicatesToRemove.forEach((id) => {
      removeDocument('products', id);
    });

    setProducts((prev) => prev.filter((p) => !duplicatesToRemove.includes(p.id)));

    logAudit('DEDUPLICATE_PRODUCTS', 'Product', undefined, 'User', `Cleaned up ${removedCount} duplicate product record(s) using SKU key.`);
    showToast({
      title: 'Duplicates Cleaned Up',
      message: `Successfully removed ${removedCount} duplicate item(s) from inventory by matching SKU.`,
      type: 'success',
    });

    return removedCount;
  };

  const bulkImportProducts = (imported: Partial<Product>[]) => {
    const now = new Date().toISOString();
    const gen4CharSKU = () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let s = '';
      for (let i = 0; i < 4; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
      return s;
    };

    let createdCount = 0;
    let updatedCount = 0;

    setProducts((prevProducts) => {
      const workingList = [...prevProducts];

      imported.forEach((item, idx) => {
        const rawSku = item.sku ? String(item.sku).trim() : '';
        const itemSKU = rawSku || gen4CharSKU();
        const skuKey = itemSKU.toUpperCase();

        const existingIdx = workingList.findIndex(
          (p) => p.sku && p.sku.trim().toUpperCase() === skuKey
        );

        if (existingIdx !== -1) {
          const existing = workingList[existingIdx];
          const newStock = item.currentStock !== undefined ? Number(item.currentStock) : existing.currentStock;
          const minStock = item.minimumStockLevel !== undefined ? Number(item.minimumStockLevel) : existing.minimumStockLevel;
          const newStatus = newStock <= 0 ? 'Out of Stock' : newStock <= minStock ? 'Low Stock' : 'Active';

          const updatedProduct: Product = {
            ...existing,
            name: item.name || existing.name,
            sku: itemSKU,
            barcode: item.barcode || existing.barcode,
            category: item.category || existing.category,
            brand: item.brand || existing.brand,
            supplierId: item.supplierId || existing.supplierId,
            supplierName: item.supplierName || existing.supplierName,
            description: item.description || existing.description,
            images: item.images && item.images.length > 0 ? item.images : existing.images,
            costPrice: item.costPrice !== undefined ? Number(item.costPrice) : existing.costPrice,
            retailPrice: item.retailPrice !== undefined ? Number(item.retailPrice) : existing.retailPrice,
            wholesalePrice: item.wholesalePrice !== undefined ? Number(item.wholesalePrice) : existing.wholesalePrice,
            minWholesaleQty: item.minWholesaleQty !== undefined ? Number(item.minWholesaleQty) : existing.minWholesaleQty,
            minimumSellingPrice: item.minimumSellingPrice !== undefined ? Number(item.minimumSellingPrice) : existing.minimumSellingPrice,
            currentStock: newStock,
            minimumStockLevel: minStock,
            unit: item.unit || existing.unit,
            status: newStatus,
            updatedAt: now,
          };

          workingList[existingIdx] = updatedProduct;
          saveDocument('products', updatedProduct);
          updatedCount++;
        } else {
          const stockVal = Number(item.currentStock) || 0;
          const minStock = Number(item.minimumStockLevel) || 5;
          const newProduct: Product = {
            id: 'prod-imp-' + Date.now() + '-' + idx,
            name: item.name || 'Imported Product',
            sku: itemSKU,
            barcode: item.barcode || `${Math.floor(Math.random() * 899999999999 + 100000000000)}`,
            category: item.category || 'General',
            brand: item.brand || 'Unbranded',
            supplierId: item.supplierId || 'sup-1',
            supplierName: item.supplierName || 'General Supplier',
            description: item.description || '',
            images: item.images && item.images.length > 0 ? item.images : ['https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=600&auto=format&fit=crop'],
            costPrice: Number(item.costPrice) || 10,
            retailPrice: Number(item.retailPrice) || 20,
            wholesalePrice: Number(item.wholesalePrice) || 15,
            minWholesaleQty: Number(item.minWholesaleQty) || settings.defaultMinWholesaleQty,
            minimumSellingPrice: Number(item.minimumSellingPrice) || 12,
            currentStock: stockVal,
            minimumStockLevel: minStock,
            unit: item.unit || 'pcs',
            status: stockVal <= 0 ? 'Out of Stock' : stockVal <= minStock ? 'Low Stock' : 'Active',
            createdAt: now,
            updatedAt: now,
          };

          workingList.unshift(newProduct);
          saveDocument('products', newProduct);
          createdCount++;
        }
      });

      return workingList;
    });

    logAudit('BULK_IMPORT', 'Product', undefined, 'User', `Imported ${imported.length} products (${createdCount} new, ${updatedCount} updated using SKU key).`);
    showToast({
      title: 'Products Imported',
      message: `Processed ${imported.length} item(s): ${createdCount} created, ${updatedCount} updated using SKU as key.`,
      type: 'success',
    });
  };

  const bulkImportCustomers = (imported: Partial<Customer>[]) => {
    const now = new Date().toISOString();
    const newItems: Customer[] = imported.map((item, idx) => ({
      id: 'cust-imp-' + Date.now() + '-' + idx,
      name: item.name || 'Imported Customer',
      email: item.email || `client${idx + 1}@example.com`,
      phone: item.phone || '+234 800 000 0000',
      address: item.address || 'Lagos, Nigeria',
      outstandingBalance: Number(item.outstandingBalance) || 0,
      loyaltyPoints: Number(item.loyaltyPoints) || 0,
      lifetimeValue: Number(item.lifetimeValue) || 0,
      purchaseHistoryCount: Number(item.purchaseHistoryCount) || 0,
      createdAt: now,
    }));

    setCustomers((prev) => [...newItems, ...prev]);
    newItems.forEach((c) => saveDocument('customers', c));
    logAudit('BULK_IMPORT', 'Customer', undefined, 'User', `Imported ${newItems.length} customers via data wizard.`);
    showToast({ title: 'Customers Imported', message: `Successfully imported ${newItems.length} customer records.`, type: 'success' });
  };

  const bulkImportSuppliers = (imported: Partial<Supplier>[]) => {
    const now = new Date().toISOString();
    const newItems: Supplier[] = imported.map((item, idx) => ({
      id: 'sup-imp-' + Date.now() + '-' + idx,
      name: item.name || 'Imported Supplier',
      contactPerson: item.contactPerson || 'Account Manager',
      email: item.email || `vendor${idx + 1}@supplier.com`,
      phone: item.phone || '+234 800 000 0000',
      address: item.address || 'Industrial Zone, Ikeja',
      paymentTerms: item.paymentTerms || 'Net 30',
      outstandingBalance: Number(item.outstandingBalance) || 0,
      productsCount: Number(item.productsCount) || 0,
      createdAt: now,
    }));

    setSuppliers((prev) => [...newItems, ...prev]);
    newItems.forEach((s) => saveDocument('suppliers', s));
    logAudit('BULK_IMPORT', 'Supplier', undefined, 'User', `Imported ${newItems.length} suppliers via data wizard.`);
    showToast({ title: 'Suppliers Imported', message: `Successfully imported ${newItems.length} supplier profiles.`, type: 'success' });
  };

  const bulkImportSales = (imported: Partial<Sale>[]) => {
    const now = new Date().toISOString();
    const newExpenses: Expense[] = [];
    const newItems: Sale[] = imported.map((item, idx) => {
      const saleId = 'sale-imp-' + Date.now() + '-' + idx;
      const fee = Number(item.deliveryFee) || 0;
      let expId: string | undefined = undefined;

      if (fee > 0) {
        expId = generateUniqueId('exp');
        const invoiceRef = item.invoiceNo && item.invoiceNo !== 'N/A' ? item.invoiceNo : saleId.slice(-6).toUpperCase();
        const saleDate = item.createdAt ? item.createdAt.split('T')[0] : now.split('T')[0];
        const saleIso = item.createdAt || now;
        const newExp: Expense = {
          id: expId,
          title: `Logistics Delivery Fee - Historical (${invoiceRef})`,
          category: 'Logistics',
          amount: fee,
          description: `Historical delivery fee expense for ${item.customerName || 'Walk-in Customer'}. Sale ${item.invoiceNo && item.invoiceNo !== 'N/A' ? item.invoiceNo : saleId}.${item.notes ? ' ' + item.notes : ''}`.trim(),
          paidBy: item.createdBy || 'Import Wizard',
          paymentMethod: (item.paymentMethod as PaymentMethod) || 'Cash',
          date: saleDate,
          createdAt: saleIso,
          isHistorical: true,
          saleId,
        };
        newExpenses.push(newExp);
      }

      return {
        id: saleId,
        invoiceNo: item.invoiceNo || 'N/A',
        customerName: item.customerName || 'Walk-in Customer',
        type: item.type || 'Retail',
        items: item.items && item.items.length > 0 ? item.items : [
          {
            productId: 'prod-gen',
            productName: 'Historical Item',
            sku: 'HIST-001',
            quantity: 1,
            unitPrice: Number(item.totalAmount) || 5000,
            costPrice: (Number(item.totalAmount) || 5000) * 0.6,
            total: Number(item.totalAmount) || 5000,
          }
        ],
        subtotal: Number(item.subtotal) || Number(item.totalAmount) || 5000,
        discount: Number(item.discount) || 0,
        tax: Number(item.tax) || 0,
        deliveryFee: fee,
        totalAmount: Number(item.totalAmount) || 5000,
        paymentMethod: (item.paymentMethod as PaymentMethod) || 'Cash',
        paidAmount: Number(item.paidAmount) || Number(item.totalAmount) || 5000,
        status: item.status || 'Completed',
        notes: item.notes || 'Historical Data Import Wizard',
        createdBy: item.createdBy || 'Import Wizard',
        createdAt: item.createdAt || now,
        isHistorical: true,
        expenseId: expId,
      };
    });

    setSales((prev) => [...newItems, ...prev]);
    newItems.forEach((s) => saveDocument('sales', s));

    if (newExpenses.length > 0) {
      setExpenses((prev) => [...newExpenses, ...prev]);
      newExpenses.forEach((e) => {
        saveDocument('expenses', e);
        putItem('expenses', e).catch(() => {});
      });
    }

    logAudit('BULK_IMPORT', 'Sale', undefined, 'User', `Imported ${newItems.length} sales records via data wizard${newExpenses.length > 0 ? ` (${newExpenses.length} delivery expenses created)` : ''}.`);
    showToast({ title: 'Sales Imported', message: `Successfully imported ${newItems.length} historical sales records (no invoices created).`, type: 'success' });
  };

  const bulkImportWhatsAppPreOrders = (imported: Partial<WhatsAppPreOrder>[]) => {
    const now = new Date().toISOString();
    const currentSales = [...sales];
    const currentPreOrders = [...whatsAppPreOrders];

    const newItems: WhatsAppPreOrder[] = imported.map((item, idx) => {
      const uniqueInvoiceNo = item.convertedInvoiceNo || generateUniqueInvoiceNo(currentSales, currentPreOrders);
      const preOrderNo = item.preOrderNo || `WAPO-${new Date().getFullYear()}-${String(currentPreOrders.length + idx + 1).padStart(3, '0')}`;

      const newPo: WhatsAppPreOrder = {
        id: 'wa-imp-' + Date.now() + '-' + idx,
        preOrderNo,
        convertedInvoiceNo: uniqueInvoiceNo,
        customerName: item.customerName || 'WhatsApp Customer',
        customerPhone: item.customerPhone || '+234800000000',
        items: item.items && item.items.length > 0 ? item.items : [
          {
            productId: 'prod-wa-' + idx,
            productName: 'Catalogue Item',
            quantity: 1,
            unitPrice: Number(item.totalAmount) || 2500,
            total: Number(item.totalAmount) || 2500,
          }
        ],
        subtotal: Number(item.subtotal) || Number(item.totalAmount) || 2500,
        discount: Number(item.discount) || 0,
        depositAmount: Number(item.depositAmount) || 0,
        totalAmount: Number(item.totalAmount) || 2500,
        status: item.status || 'Pending Review',
        notes: item.notes || 'Imported via WhatsApp Catalogue CSV/Excel Wizard',
        createdBy: item.createdBy || 'Import Wizard',
        createdAt: item.createdAt || now,
        updatedAt: now,
      };

      currentPreOrders.push(newPo);
      return newPo;
    });

    setWhatsAppPreOrders((prev) => [...newItems, ...prev]);
    newItems.forEach((w) => saveDocument('whatsAppPreOrders', w));
    logAudit('BULK_IMPORT', 'WhatsAppPreOrder', undefined, 'User', `Imported ${newItems.length} WhatsApp catalogue pre-orders.`);
    showToast({ title: 'WhatsApp Orders Imported', message: `Successfully imported ${newItems.length} WhatsApp catalogue pre-orders with unique invoice numbers.`, type: 'success' });
  };

  // Pricing Change
  const changeProductPrice = (
    productId: string,
    newPrice: number,
    priceType: 'Retail' | 'Wholesale' | 'Dealer' | 'Promotional',
    reason: string,
    performedBy: string
  ) => {
    const prod = products.find((p) => p.id === productId);
    if (!prod) return;

    let oldPrice = prod.retailPrice;
    const updates: Partial<Product> = {};

    if (priceType === 'Retail') {
      oldPrice = prod.retailPrice;
      updates.retailPrice = newPrice;
    } else if (priceType === 'Wholesale') {
      oldPrice = prod.wholesalePrice;
      updates.wholesalePrice = newPrice;
    } else if (priceType === 'Dealer') {
      oldPrice = prod.dealerPrice || prod.wholesalePrice;
      updates.dealerPrice = newPrice;
    } else if (priceType === 'Promotional') {
      oldPrice = prod.promotionalPrice || prod.retailPrice;
      updates.promotionalPrice = newPrice;
    }

    updateProduct(productId, updates, `Price change: ${priceType} updated to $${newPrice}`);

    const ph: PricingHistory = {
      id: generateUniqueId('ph'),
      productId,
      productName: prod.name,
      oldPrice,
      newPrice,
      priceType,
      changedBy: performedBy,
      reason,
      createdAt: new Date().toISOString(),
    };

    setPricingHistory((prev) => [ph, ...prev]);
    saveDocument('pricingHistory', ph);
    logAudit('PRICE_CHANGE', 'Product', productId, performedBy, `Changed ${priceType} price for ${prod.name} from $${oldPrice} to $${newPrice}. Reason: ${reason}`);
    showToast({ title: 'Price Updated', message: `Updated ${priceType} price for "${prod.name}" to ${settings.currencySymbol}${newPrice}.`, type: 'info' });
  };

  // Adjust Stock
  const adjustStock = (
    productId: string,
    qtyChange: number,
    type: StockMovement['type'],
    notes: string,
    performedBy: string
  ) => {
    const prod = products.find((p) => p.id === productId);
    if (!prod) return;

    const previousStock = prod.currentStock;
    const newStock = Math.max(0, previousStock + qtyChange);

    updateProduct(productId, { currentStock: newStock }, `Stock movement: ${type} (${qtyChange >= 0 ? '+' : ''}${qtyChange})`);

    const mv: StockMovement = {
      id: generateUniqueId('mv'),
      productId,
      productName: prod.name,
      type,
      quantity: Math.abs(qtyChange),
      previousStock,
      newStock,
      referenceNo: `REF-${Math.floor(Math.random() * 89999 + 10000)}`,
      notes,
      performedBy,
      createdAt: new Date().toISOString(),
    };

    setStockMovements((prev) => [mv, ...prev]);
    saveDocument('stockMovements', mv);

    // Check low stock trigger notification
    if (newStock <= prod.minimumStockLevel) {
      const notif: NotificationItem = {
        id: generateUniqueId('notif-stock'),
        title: newStock === 0 ? 'Out of Stock Alert' : 'Low Stock Alert',
        message: `${prod.name} stock level is at ${newStock} units (Minimum: ${prod.minimumStockLevel}).`,
        type: 'low_stock',
        read: false,
        createdAt: new Date().toISOString(),
      };
      setNotifications((prev) => [notif, ...prev]);
      saveDocument('notifications', notif);
    }
    showToast({ title: 'Stock Adjusted', message: `${prod.name} inventory level set to ${newStock} ${prod.unit}.`, type: 'info' });
  };

  // Generate unique invoice number across all sales and WhatsApp pre-orders
  const generateUniqueInvoiceNo = (
    salesList: Sale[] = sales,
    whatsappList: WhatsAppPreOrder[] = whatsAppPreOrders
  ): string => {
    const currentYear = new Date().getFullYear();
    const used = new Set<string>();

    salesList.forEach((s) => {
      if (s.invoiceNo) used.add(s.invoiceNo.trim().toUpperCase());
    });

    whatsappList.forEach((w) => {
      if (w.convertedInvoiceNo) used.add(w.convertedInvoiceNo.trim().toUpperCase());
    });

    let maxNum = 0;
    used.forEach((inv) => {
      const match = inv.match(/INV-\d{4}-(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    });

    let nextSeq = maxNum + 1;
    let candidate = `INV-${currentYear}-${String(nextSeq).padStart(4, '0')}`;

    while (used.has(candidate.toUpperCase())) {
      nextSeq++;
      candidate = `INV-${currentYear}-${String(nextSeq).padStart(4, '0')}`;
    }

    return candidate;
  };

  // Process Sale
  const processSale = (
    items: SaleItem[],
    customer: Customer | null,
    discount: number,
    tax: number,
    paymentMethod: PaymentMethod,
    paidAmount: number,
    type: 'Retail' | 'Wholesale',
    performedBy: string,
    notes?: string,
    customCreatedAt?: string,
    deliveryFee: number = 0,
    orderTakenBy?: string,
    convertedBy?: string,
    customInvoiceNo?: string
  ): Sale => {
    const subtotal = items.reduce((acc, item) => acc + item.total, 0);
    const totalAmount = Math.max(0, subtotal - discount + tax + (deliveryFee || 0));
    const isHistorical = !!customCreatedAt || (notes ? notes.includes('Historical') : false);
    // For Historical Sales only, do not create/generate invoices unless explicitly provided
    const invoiceNo = isHistorical ? (customInvoiceNo || 'N/A') : (customInvoiceNo || generateUniqueInvoiceNo(sales, whatsAppPreOrders));
    const now = customCreatedAt || new Date().toISOString();

    const newSale: Sale = {
      id: generateUniqueId('sale'),
      invoiceNo,
      customerId: customer?.id,
      customerName: customer ? customer.name : 'Walk-in Customer',
      type,
      items,
      subtotal,
      discount,
      tax,
      deliveryFee: deliveryFee || 0,
      totalAmount,
      paidAmount,
      paymentMethod,
      status: 'Completed',
      notes,
      createdBy: performedBy,
      orderTakenBy,
      convertedBy,
      createdAt: now,
      isHistorical,
    };

    // Update inventory for each sold item (Only for standard live sales, not historical past sales, and skip clearance non-inventory items)
    if (!customCreatedAt && !isHistorical) {
      items.forEach((item) => {
        if (!item.isClearance && !item.productId.startsWith('clearance-')) {
          adjustStock(item.productId, -item.quantity, 'Outgoing', `POS Sale ${invoiceNo}`, performedBy);
        }
      });
    }

    // Update customer metrics if attached or matched by name
    let targetCustomer = customer;
    if (!targetCustomer) {
      // Check if matching customer exists by name
      const matchedName = customer ? customer.name : '';
      if (matchedName && matchedName !== 'Walk-in Customer') {
        targetCustomer = customers.find((c) => c.name && c.name.toLowerCase() === matchedName.toLowerCase()) || null;
      }
    }

    if (targetCustomer) {
      const outstanding = Math.max(0, totalAmount - paidAmount);
      const pointsEarned = Math.floor(totalAmount * (settings.pointsPerDollar || 0.01));

      setCustomers((prev) =>
        prev.map((c) => {
          if (c.id === targetCustomer!.id) {
            const updated: Customer = {
              ...c,
              purchaseHistoryCount: (Number(c.purchaseHistoryCount) || 0) + 1,
              outstandingBalance: Math.max(0, (Number(c.outstandingBalance) || 0) + outstanding),
              loyaltyPoints: (Number(c.loyaltyPoints) || 0) + pointsEarned,
              lifetimeValue: (Number(c.lifetimeValue) || 0) + totalAmount,
            };
            saveDocument('customers', updated);
            return updated;
          }
          return c;
        })
      );

      if (outstanding > 0) {
        const notif: NotificationItem = {
          id: 'notif-bal-' + Date.now(),
          title: 'Customer Balance Recorded',
          message: `${targetCustomer.name} owes an outstanding balance of ${settings.currencySymbol}${outstanding.toFixed(2)} on sale ${invoiceNo}.`,
          type: 'customer_balance',
          read: false,
          createdAt: now,
        };
        setNotifications((prev) => [notif, ...prev]);
        saveDocument('notifications', notif);
      }
    }

    // Historical Sales: If Collect Delivery Fee was checked (deliveryFee > 0), automatically create a Historical Logistics Expense
    if (isHistorical && deliveryFee > 0) {
      const invoiceRef = invoiceNo && invoiceNo !== 'N/A' ? invoiceNo : newSale.id.slice(-6).toUpperCase();
      const expId = generateUniqueId('exp');
      const expenseTitle = `Logistics Delivery Fee - Historical (${invoiceRef})`;
      const custName = customer ? customer.name : (newSale.customerName || 'Walk-in Customer');
      const saleDate = now.split('T')[0];
      const histExpense: Expense = {
        id: expId,
        title: expenseTitle,
        category: 'Logistics',
        amount: deliveryFee,
        description: `Historical delivery fee expense for ${custName}. Sale ${invoiceNo && invoiceNo !== 'N/A' ? invoiceNo : newSale.id}.${notes ? ' ' + notes : ''}`.trim(),
        paidBy: performedBy,
        paymentMethod: paymentMethod === 'Split' ? 'Cash' : (paymentMethod || 'Cash'),
        date: saleDate,
        createdAt: now,
        isHistorical: true,
        saleId: newSale.id,
      };

      newSale.expenseId = expId;

      setExpenses((prev) => [histExpense, ...prev]);
      saveDocument('expenses', histExpense);
      putItem('expenses', histExpense).catch((e) => console.warn('IndexedDB expense put error:', e));

      logAudit(
        'CREATE_EXPENSE',
        'Expense',
        expId,
        performedBy,
        `Automatically logged Historical Logistics delivery fee expense of ${settings.currencySymbol}${deliveryFee.toFixed(2)} for historical sale ${invoiceRef}.`
      );
    }

    setSales((prev) => [newSale, ...prev]);
    saveDocument('sales', newSale);

    // Automatic Treasury / Money Movement logging for sale (Only for live real-time sales, NOT historical sales)
    if (!isHistorical && paidAmount > 0) {
      const isCash = paymentMethod === 'Cash';
      const isBiz = paymentMethod === 'Mobile Transfer' || paymentMethod === 'Bank Transfer' || paymentMethod === 'Card';

      if (isCash) {
        const mm: MoneyMovement = {
          id: generateUniqueId('mm'),
          date: now,
          type: 'Sale Inflow',
          subtype: 'Cash Sale',
          destinationAccount: 'Physical Cash',
          amount: paidAmount,
          referenceNo: invoiceNo,
          referenceId: newSale.id,
          performedBy,
          notes: `Cash sale: ${invoiceNo} (${settings.currencySymbol}${paidAmount.toFixed(2)})`,
          createdAt: now,
        };
        setMoneyMovements((prev) => [mm, ...prev]);
        saveDocument('moneyMovements', mm);
        putItem('moneyMovements', mm).catch(() => {});
      } else if (isBiz) {
        const mm: MoneyMovement = {
          id: generateUniqueId('mm'),
          date: now,
          type: 'Sale Inflow',
          subtype: paymentMethod,
          destinationAccount: 'Biz Account',
          amount: paidAmount,
          referenceNo: invoiceNo,
          referenceId: newSale.id,
          performedBy,
          notes: `${paymentMethod} sale: ${invoiceNo} (${settings.currencySymbol}${paidAmount.toFixed(2)})`,
          createdAt: now,
        };
        setMoneyMovements((prev) => [mm, ...prev]);
        saveDocument('moneyMovements', mm);
        putItem('moneyMovements', mm).catch(() => {});
      } else if (paymentMethod === 'Split') {
        const breakdown = newSale.paymentBreakdown || {};
        const cashPart = breakdown['Cash'] || 0;
        const transferPart = (breakdown['Mobile Transfer'] || 0) + (breakdown['Bank Transfer'] || 0) + (breakdown['Card'] || 0);

        if (cashPart > 0) {
          const mmCash: MoneyMovement = {
            id: generateUniqueId('mm'),
            date: now,
            type: 'Sale Inflow',
            subtype: 'Split - Cash Portion',
            destinationAccount: 'Physical Cash',
            amount: cashPart,
            referenceNo: invoiceNo,
            referenceId: newSale.id,
            performedBy,
            notes: `Split sale cash portion: ${invoiceNo} (${settings.currencySymbol}${cashPart.toFixed(2)})`,
            createdAt: now,
          };
          setMoneyMovements((prev) => [mmCash, ...prev]);
          saveDocument('moneyMovements', mmCash);
          putItem('moneyMovements', mmCash).catch(() => {});
        }

        if (transferPart > 0) {
          const mmBiz: MoneyMovement = {
            id: generateUniqueId('mm'),
            date: now,
            type: 'Sale Inflow',
            subtype: 'Split - Transfer/Card Portion',
            destinationAccount: 'Biz Account',
            amount: transferPart,
            referenceNo: invoiceNo,
            referenceId: newSale.id,
            performedBy,
            notes: `Split sale bank portion: ${invoiceNo} (${settings.currencySymbol}${transferPart.toFixed(2)})`,
            createdAt: now,
          };
          setMoneyMovements((prev) => [mmBiz, ...prev]);
          saveDocument('moneyMovements', mmBiz);
          putItem('moneyMovements', mmBiz).catch(() => {});
        } else if (cashPart === 0) {
          const half = Number((paidAmount / 2).toFixed(2));
          const mmCash: MoneyMovement = {
            id: generateUniqueId('mm'),
            date: now,
            type: 'Sale Inflow',
            subtype: 'Split - Cash (50%)',
            destinationAccount: 'Physical Cash',
            amount: half,
            referenceNo: invoiceNo,
            referenceId: newSale.id,
            performedBy,
            notes: `Split sale cash: ${invoiceNo}`,
            createdAt: now,
          };
          const mmBiz: MoneyMovement = {
            id: generateUniqueId('mm'),
            date: now,
            type: 'Sale Inflow',
            subtype: 'Split - Biz Account (50%)',
            destinationAccount: 'Biz Account',
            amount: paidAmount - half,
            referenceNo: invoiceNo,
            referenceId: newSale.id,
            performedBy,
            notes: `Split sale bank: ${invoiceNo}`,
            createdAt: now,
          };
          setMoneyMovements((prev) => [mmBiz, mmCash, ...prev]);
          saveDocument('moneyMovements', mmCash);
          saveDocument('moneyMovements', mmBiz);
          putItem('moneyMovements', mmCash).catch(() => {});
          putItem('moneyMovements', mmBiz).catch(() => {});
        }
      }
    }

    logAudit('CREATE_SALE', 'Sale', newSale.id, performedBy, `Processed ${type} sale ${invoiceNo} for $${totalAmount.toFixed(2)} via ${paymentMethod}.`);

    // Automatically create a Deliver Product Order if delivery fee was collected (Only for live real-time sales)
    if (!isHistorical && deliveryFee > 0) {
      const deliveryNo = `DEL-${invoiceNo.replace('INV-', '')}`;
      const newDeliveryOrder: DeliveryOrder = {
        id: generateUniqueId('del'),
        deliveryNo,
        saleId: newSale.id,
        invoiceNo: newSale.invoiceNo,
        customerId: customer?.id,
        customerName: customer ? customer.name : 'Walk-in Customer',
        customerPhone: customer?.phone || '',
        deliveryAddress: customer?.address || '',
        items,
        deliveryFee,
        status: 'Pending Pickup',
        isPickupConfirmed: false,
        notes: notes || '',
        createdBy: performedBy,
        createdAt: now,
        updatedAt: now,
      };
      setDeliveryOrders((prev) => [newDeliveryOrder, ...prev]);
      saveDocument('deliveryOrders', newDeliveryOrder);
      putItem('deliveryOrders', newDeliveryOrder).catch((e) => console.warn('IndexedDB deliveryOrder put error:', e));
      logAudit(
        'CREATE_DELIVERY_ORDER',
        'DeliveryOrder',
        newDeliveryOrder.id,
        performedBy,
        `Automatically created Delivery Product Order ${deliveryNo} with fee ${settings.currencySymbol}${deliveryFee.toFixed(2)}.`
      );
      showToast({
        title: 'Deliver Product Order Created',
        message: `Delivery Order ${deliveryNo} created for pickup & delivery.`,
        type: 'info',
      });
    }

    if (isHistorical) {
      showToast({
        title: 'Historical Sale Recorded',
        message: `Historical sale record saved (${settings.currencySymbol}${totalAmount.toFixed(2)})${deliveryFee > 0 ? ` with ${settings.currencySymbol}${deliveryFee.toFixed(2)} delivery fee logged as Historical Logistics Expense` : ''}. No invoice generated.`,
        type: 'success',
      });
    } else {
      showToast({ title: 'Sale Completed', message: `Invoice ${invoiceNo} processed (${settings.currencySymbol}${totalAmount.toFixed(2)}).`, type: 'success' });
    }

    return newSale;
  };

  const holdOrder = (name: string, items: SaleItem[], customerId?: string) => {
    const newHold = {
      id: 'hold-' + Date.now(),
      name: name || `Order #${heldOrders.length + 1}`,
      items,
      customerId,
      date: new Date().toISOString(),
    };
    setHeldOrders((prev) => [newHold, ...prev]);
    saveDocument('heldOrders', newHold);
    showToast({ title: 'Order Saved on Hold', message: `Hold order "${newHold.name}" stored safely.`, type: 'info' });
  };

  const restoreHeldOrder = (id: string) => {
    const found = heldOrders.find((h) => h.id === id);
    setHeldOrders((prev) => prev.filter((h) => h.id !== id));
    if (found) {
      removeDocument('heldOrders', id);
      deleteItem('heldOrders', id).catch(() => {});
      markIdDeleted('heldOrders', id);
      showToast({ title: 'Held Order Restored', message: `Restored order "${found.name}" to active checkout cart.`, type: 'info' });
    }
  };

  const deleteHeldOrder = (id: string) => {
    const found = heldOrders.find((h) => h.id === id);
    setHeldOrders((prev) => prev.filter((h) => h.id !== id));
    removeDocument('heldOrders', id);
    deleteItem('heldOrders', id).catch(() => {});
    markIdDeleted('heldOrders', id);
    showToast({ title: 'Held Order Deleted', message: found ? `Removed held order "${found.name}".` : 'Order deleted.', type: 'error' });
  };

  const deleteHeldOrderItem = (heldOrderId: string, productId: string) => {
    const foundOrder = heldOrders.find((h) => h.id === heldOrderId);
    if (!foundOrder) return;

    const updatedItems = foundOrder.items.filter((item) => item.productId !== productId);
    if (updatedItems.length === 0) {
      deleteHeldOrder(heldOrderId);
    } else {
      const updatedHold = { ...foundOrder, items: updatedItems, date: new Date().toISOString() };
      setHeldOrders((prev) =>
        prev.map((h) => (h.id === heldOrderId ? updatedHold : h))
      );
      saveDocument('heldOrders', updatedHold);
      showToast({
        title: 'Item Deleted from Held Order',
        message: 'Item removed from held order queue.',
        type: 'info',
      });
    }
  };

  const clearAllHeldOrders = () => {
    heldOrders.forEach((h) => {
      removeDocument('heldOrders', h.id).catch(() => {});
      deleteItem('heldOrders', h.id).catch(() => {});
      markIdDeleted('heldOrders', h.id);
    });
    setHeldOrders([]);
    localStorage.removeItem('idofera_heldOrders');
    clearStore('heldOrders').catch((e) => console.warn('IndexedDB clear heldOrders error:', e));
    showToast({ title: 'Held Queue Cleared', message: 'All held orders deleted.', type: 'error' });
  };

  const refundSale = (saleId: string, reason: string, performedBy: string) => {
    const sale = sales.find((s) => s.id === saleId);
    if (!sale) return;

    const updatedSale: Sale = { ...sale, status: 'Refunded' };

    // 1. Update and persist refunded sale
    setSales((prev) => prev.map((s) => (s.id === saleId ? updatedSale : s)));
    saveDocument('sales', updatedSale);
    putItem('sales', updatedSale).catch((e) => console.warn('IndexedDB sale put error:', e));

    // 2. Restock returned items (Only if not a historical past sale entry)
    const isHistoricalSale =
      sale.isHistorical ||
      sale.id.startsWith('sale-imp-') ||
      (sale.notes && (sale.notes.includes('Historical') || sale.notes.includes('Past Entry')));

    if (!isHistoricalSale) {
      sale.items.forEach((item) => {
        if (item.productId && item.quantity > 0) {
          adjustStock(
            item.productId,
            item.quantity,
            'Returned',
            `Refund for sale ${sale.invoiceNo}: ${reason}`,
            performedBy
          );
        }
      });
    }

    // 3. Cascade to Customer Metrics (Deduct outstanding debt, LTV, loyalty points, purchase count)
    const existingPaid = sale.paidAmount !== undefined ? sale.paidAmount : (sale.totalAmount || 0);
    const unpaidOnSale = Math.max(0, (sale.totalAmount || 0) - existingPaid);
    let targetCust = customers.find((c) => c.id === sale.customerId);
    if (!targetCust && sale.customerName && sale.customerName !== 'Walk-in Customer') {
      targetCust = customers.find((c) => c.name && c.name.trim().toLowerCase() === sale.customerName.trim().toLowerCase());
    }

    if (targetCust) {
      const pointsEarned = Math.floor((sale.totalAmount || 0) * (settings.pointsPerDollar || 0.01));
      const newBal = Math.max(0, (Number(targetCust.outstandingBalance) || 0) - unpaidOnSale);
      const newCount = Math.max(0, (Number(targetCust.purchaseHistoryCount) || 0) - 1);
      const newPoints = Math.max(0, (Number(targetCust.loyaltyPoints) || 0) - pointsEarned);
      const newLtv = Math.max(0, (Number(targetCust.lifetimeValue) || 0) - (sale.totalAmount || 0));

      const updatedCust: Customer = {
        ...targetCust,
        outstandingBalance: newBal,
        purchaseHistoryCount: newCount,
        loyaltyPoints: newPoints,
        lifetimeValue: newLtv,
      };
      setCustomers((prev) => prev.map((c) => (c.id === updatedCust.id ? updatedCust : c)));
      saveDocument('customers', updatedCust);
      putItem('customers', updatedCust).catch((e) => console.warn('IndexedDB customer put error:', e));
    }

    // 4. Cascade to Linked Delivery Orders (mark non-delivered as Cancelled)
    const matchingDeliveries = deliveryOrders.filter(
      (d) => d.saleId === saleId || (sale.invoiceNo && d.invoiceNo === sale.invoiceNo)
    );
    if (matchingDeliveries.length > 0) {
      const now = new Date().toISOString();
      setDeliveryOrders((prev) =>
        prev.map((d) => {
          const isMatch = d.saleId === saleId || (sale.invoiceNo && d.invoiceNo === sale.invoiceNo);
          if (!isMatch || d.status === 'Delivered') return d;
          const updatedDel: DeliveryOrder = {
            ...d,
            status: 'Cancelled',
            notes: d.notes ? `${d.notes} | Sale Refunded: ${reason}` : `Sale Refunded: ${reason}`,
            updatedAt: now,
          };
          saveDocument('deliveryOrders', updatedDel);
          putItem('deliveryOrders', updatedDel).catch((e) => console.warn('IndexedDB del put error:', e));
          return updatedDel;
        })
      );
    }

    // 5. Clean up invoice balance notifications
    if (sale.invoiceNo) {
      setNotifications((prev) => {
        const removed = prev.filter((n) => n.message.includes(sale.invoiceNo));
        removed.forEach((n) => removeDocument('notifications', n.id));
        return prev.filter((n) => !n.message.includes(sale.invoiceNo));
      });
    }

    // 6. Cascade to WhatsApp Pre-Orders
    const linkedPreOrders = whatsAppPreOrders.filter(
      (po) =>
        po.convertedSaleId === saleId ||
        (sale.invoiceNo && po.convertedInvoiceNo === sale.invoiceNo)
    );
    if (linkedPreOrders.length > 0) {
      const now = new Date().toISOString();
      setWhatsAppPreOrders((prev) =>
        prev.map((po) => {
          const isMatch =
            po.convertedSaleId === saleId ||
            (sale.invoiceNo && po.convertedInvoiceNo === sale.invoiceNo);
          if (!isMatch) return po;
          const updatedPo: WhatsAppPreOrder = {
            ...po,
            status: 'Approved',
            convertedSaleId: undefined,
            convertedInvoiceNo: undefined,
            notes: po.notes ? `${po.notes} | Sale Refunded: ${reason}` : `Sale Refunded: ${reason}`,
            updatedAt: now,
          };
          saveDocument('whatsAppPreOrders', updatedPo);
          putItem('whatsAppPreOrders', updatedPo).catch((e) => console.warn('IndexedDB po put error:', e));
          return updatedPo;
        })
      );
    }

    // 7. Cascade to Money Movements (Only for real-time live sales, not historical sales)
    const isHistoricalSale =
      sale.isHistorical ||
      sale.id.startsWith('sale-imp-') ||
      (sale.notes && (sale.notes.includes('Historical') || sale.notes.includes('Past Entry') || sale.notes.includes('Import Wizard')));
    const refundPaid = sale.paidAmount !== undefined ? sale.paidAmount : sale.totalAmount;
    if (!isHistoricalSale && refundPaid > 0) {
      const isCash = sale.paymentMethod === 'Cash';
      const refMM: MoneyMovement = {
        id: generateUniqueId('mm'),
        date: new Date().toISOString(),
        type: 'Sale Refund',
        subtype: `Refund - ${sale.paymentMethod || 'Cash'}`,
        sourceAccount: isCash ? 'Physical Cash' : 'Biz Account',
        amount: refundPaid,
        referenceNo: sale.invoiceNo,
        referenceId: sale.id,
        performedBy,
        notes: `Refund for sale ${sale.invoiceNo}: ${settings.currencySymbol}${refundPaid.toFixed(2)} (${reason})`,
        createdAt: new Date().toISOString(),
      };
      setMoneyMovements((prev) => [refMM, ...prev]);
      saveDocument('moneyMovements', refMM);
      putItem('moneyMovements', refMM).catch(() => {});
    }

    logAudit(
      'REFUND_SALE',
      'Sale',
      saleId,
      performedBy,
      `Refunded sale ${sale.invoiceNo} (${settings.currencySymbol}${sale.totalAmount.toFixed(2)}). Restocked items, reconciled customer balance/LTV, and updated linked delivery/pre-orders. Reason: ${reason}`
    );
    showToast({
      title: 'Sale Refunded & Cascaded',
      message: `Invoice ${sale.invoiceNo} has been refunded. Stock returned and customer metrics reconciled.`,
      type: 'warning',
    });
  };

  const deleteSale = (saleId: string, performedBy = 'Administrator') => {
    const sale = sales.find((s) => s.id === saleId);
    if (!sale) return;

    const isHistorical =
      sale.isHistorical ||
      sale.id.startsWith('sale-imp-') ||
      (sale.notes && (sale.notes.includes('Historical') || sale.notes.includes('Past Entry') || sale.notes.includes('Import Wizard')));

    // 1. Cascade to Inventory Stock: Restore stock quantities for all line items if not historical and not already refunded
    if (!isHistorical && sale.status !== 'Refunded') {
      sale.items.forEach((item) => {
        if (item.productId && item.quantity > 0) {
          adjustStock(
            item.productId,
            item.quantity,
            'Adjustment',
            `Stock restored from deleted sale ${sale.invoiceNo}`,
            performedBy
          );
        }
      });
    }

    // 2. Cascade to Linked Delivery Orders
    const matchingDeliveries = deliveryOrders.filter(
      (d) => d.saleId === saleId || (sale.invoiceNo && d.invoiceNo === sale.invoiceNo)
    );
    if (matchingDeliveries.length > 0) {
      const delIdsToDelete = new Set(matchingDeliveries.map((d) => d.id));
      setDeliveryOrders((prev) => prev.filter((d) => !delIdsToDelete.has(d.id)));
      matchingDeliveries.forEach((d) => {
        removeDocument('deliveryOrders', d.id);
        deleteItem('deliveryOrders', d.id).catch((e) => console.warn('IndexedDB del delete error:', e));
        markIdDeleted('deliveryOrders', d.id);
      });
    }

    // 3. Cascade to Linked Logistics Expenses
    const matchingDelNos = new Set(matchingDeliveries.map((d) => d.deliveryNo).filter(Boolean));
    const linkedExpenseIds = new Set<string>();
    if (sale.expenseId) linkedExpenseIds.add(sale.expenseId);
    matchingDeliveries.forEach((d) => {
      if (d.expenseId) linkedExpenseIds.add(d.expenseId);
    });

    const shortSaleId = sale.id ? sale.id.slice(-6).toUpperCase() : '';
    expenses.forEach((e) => {
      if (e.id === sale.expenseId || (e.saleId && e.saleId === sale.id)) {
        linkedExpenseIds.add(e.id);
      }
      if (e.category === 'Logistics') {
        if (sale.invoiceNo && sale.invoiceNo !== 'N/A' && (e.title.includes(sale.invoiceNo) || (e.description && e.description.includes(sale.invoiceNo)))) {
          linkedExpenseIds.add(e.id);
        }
        if (e.description && e.description.includes(sale.id)) {
          linkedExpenseIds.add(e.id);
        }
        if (shortSaleId && (e.title.includes(shortSaleId) || (e.description && e.description.includes(shortSaleId)))) {
          linkedExpenseIds.add(e.id);
        }
        for (const dNo of matchingDelNos) {
          if (e.title.includes(dNo) || (e.description && e.description.includes(dNo))) {
            linkedExpenseIds.add(e.id);
          }
        }
      }
    });

    if (linkedExpenseIds.size > 0) {
      setExpenses((prev) => prev.filter((e) => !linkedExpenseIds.has(e.id)));
      linkedExpenseIds.forEach((expId) => {
        removeDocument('expenses', expId);
        deleteItem('expenses', expId).catch((e) => console.warn('IndexedDB exp delete error:', e));
        markIdDeleted('expenses', expId);
      });
    }

    // 4. Cascade to Customer Metrics (Balance, Purchase Count, Loyalty Points, Lifetime Value)
    const existingPaid = sale.paidAmount !== undefined ? sale.paidAmount : (sale.totalAmount || 0);
    const unpaidOnSale = Math.max(0, (sale.totalAmount || 0) - existingPaid);
    let targetCust = customers.find((c) => c.id === sale.customerId);
    if (!targetCust && sale.customerName && sale.customerName !== 'Walk-in Customer') {
      targetCust = customers.find((c) => c.name && c.name.trim().toLowerCase() === sale.customerName.trim().toLowerCase());
    }
    if (targetCust) {
      const pointsEarned = Math.floor((sale.totalAmount || 0) * (settings.pointsPerDollar || 0.01));
      const newBal = Math.max(0, (Number(targetCust.outstandingBalance) || 0) - unpaidOnSale);
      const newCount = Math.max(0, (Number(targetCust.purchaseHistoryCount) || 0) - 1);
      const newPoints = Math.max(0, (Number(targetCust.loyaltyPoints) || 0) - pointsEarned);
      const newLtv = Math.max(0, (Number(targetCust.lifetimeValue) || 0) - (sale.totalAmount || 0));

      const updatedCust: Customer = {
        ...targetCust,
        outstandingBalance: newBal,
        purchaseHistoryCount: newCount,
        loyaltyPoints: newPoints,
        lifetimeValue: newLtv,
      };
      setCustomers((prev) => prev.map((c) => (c.id === updatedCust.id ? updatedCust : c)));
      saveDocument('customers', updatedCust);
      putItem('customers', updatedCust).catch((e) => console.warn('IndexedDB customer put error:', e));
    }

    // 5. Cascade to WhatsApp Pre-Orders: Reset status and unlink deleted invoice
    const linkedPreOrders = whatsAppPreOrders.filter(
      (po) =>
        po.convertedSaleId === saleId ||
        (sale.invoiceNo && po.convertedInvoiceNo === sale.invoiceNo)
    );
    if (linkedPreOrders.length > 0) {
      const now = new Date().toISOString();
      setWhatsAppPreOrders((prev) =>
        prev.map((po) => {
          const isLinked =
            po.convertedSaleId === saleId ||
            (sale.invoiceNo && po.convertedInvoiceNo === sale.invoiceNo);
          if (!isLinked) return po;

          const reverted: WhatsAppPreOrder = {
            ...po,
            status: 'Approved',
            convertedSaleId: undefined,
            convertedInvoiceNo: undefined,
            updatedAt: now,
          };
          saveDocument('whatsAppPreOrders', reverted);
          putItem('whatsAppPreOrders', reverted).catch((e) => console.warn('IndexedDB whatsAppPreOrder put error:', e));
          return reverted;
        })
      );
    }

    // 6. Clean up invoice balance notifications
    if (sale.invoiceNo) {
      setNotifications((prev) => {
        const removed = prev.filter((n) => n.message.includes(sale.invoiceNo));
        removed.forEach((n) => removeDocument('notifications', n.id));
        return prev.filter((n) => !n.message.includes(sale.invoiceNo));
      });
    }

    // 7. Remove sale from state & persistent storage
    setSales((prev) => prev.filter((s) => s.id !== saleId));
    removeDocument('sales', saleId);
    deleteItem('sales', saleId).catch((e) => console.warn('IndexedDB sales delete error:', e));
    markIdDeleted('sales', saleId);

    // 8. Cascade to Money Movements
    setMoneyMovements((prev) => {
      const removed = prev.filter((m) => m.referenceId === saleId);
      removed.forEach((m) => {
        removeDocument('moneyMovements', m.id);
        deleteItem('moneyMovements', m.id).catch(() => {});
        markIdDeleted('moneyMovements', m.id);
      });
      return prev.filter((m) => m.referenceId !== saleId);
    });

    logAudit(
      'DELETE_SALE',
      'Sale',
      saleId,
      performedBy,
      `Deleted sale record ${sale.invoiceNo} (${settings.currencySymbol}${sale.totalAmount.toFixed(2)}). Restored stock, updated customer ledger/points, reconciled linked delivery orders, expenses, and pre-orders.`
    );
    showToast({
      title: 'Sale Deleted & Cascaded',
      message: `Sale record ${sale.invoiceNo} was removed. Inventory, customer debt, and linked delivery records have been reconciled.`,
      type: 'error',
    });
  };

  const updateSale = (
    saleId: string,
    updates: Partial<Sale>,
    performedBy = 'Administrator',
    isSuperAdminOverride = false
  ) => {
    const existing = sales.find((s) => s.id === saleId);
    if (!existing) return;

    const isHistorical =
      existing.isHistorical ||
      existing.id.startsWith('sale-imp-') ||
      (existing.notes && (existing.notes.includes('Historical') || existing.notes.includes('Past Entry')));

    if (!isHistorical && !isSuperAdminOverride) {
      showToast({
        title: 'Editing Restricted',
        message: 'Real-time sales records cannot be edited by standard users. Super-Admin permissions are required to edit real-time records.',
        type: 'error',
      });
      return;
    }

    const now = new Date().toISOString();
    const itemsList = updates.items || existing.items || [];
    const subtotal = itemsList.reduce(
      (acc, item) => acc + (item.total ?? (item.unitPrice || 0) * (item.quantity || 1)),
      0
    );
    const disc = updates.discount !== undefined ? updates.discount : (existing.discount || 0);
    const tx = updates.tax !== undefined ? updates.tax : (existing.tax || 0);
    const newFee = updates.deliveryFee !== undefined ? Math.max(0, Number(updates.deliveryFee)) : (existing.deliveryFee || 0);
    const calculatedTotal = Math.max(0, subtotal - disc + tx + newFee);

    // Accurately compute paidAmount and outstanding debt difference
    const existingPaid = existing.paidAmount !== undefined ? existing.paidAmount : (existing.totalAmount || 0);
    const wasFullyPaid = existingPaid >= (existing.totalAmount || 0);
    const finalPaidAmount =
      updates.paidAmount !== undefined
        ? Math.max(0, Number(updates.paidAmount))
        : wasFullyPaid
        ? calculatedTotal
        : Math.min(existingPaid, calculatedTotal);

    const oldUnpaid = Math.max(0, (existing.totalAmount || 0) - existingPaid);
    const newUnpaid = Math.max(0, calculatedTotal - finalPaidAmount);
    const unpaidDiff = newUnpaid - oldUnpaid;

    const finalCustomerName = updates.customerName !== undefined ? updates.customerName : existing.customerName;

    const updatedSale: Sale = {
      ...existing,
      ...updates,
      customerName: finalCustomerName,
      items: itemsList,
      subtotal,
      discount: disc,
      tax: tx,
      deliveryFee: newFee,
      totalAmount: calculatedTotal,
      paidAmount: finalPaidAmount,
    };

    // 1. Cascade to Inventory Stock: adjust quantity differences if items were modified (skip non-inventory clearance items)
    if (!isHistorical && existing.status !== 'Refunded' && updates.items) {
      const oldItemMap = new Map<string, number>();
      existing.items.forEach((it) => {
        if (it.productId && !it.isClearance && !it.productId.startsWith('clearance-')) {
          oldItemMap.set(it.productId, (oldItemMap.get(it.productId) || 0) + it.quantity);
        }
      });

      const newItemMap = new Map<string, number>();
      updates.items.forEach((it) => {
        if (it.productId && !it.isClearance && !it.productId.startsWith('clearance-')) {
          newItemMap.set(it.productId, (newItemMap.get(it.productId) || 0) + it.quantity);
        }
      });

      const allProductIds = new Set([...oldItemMap.keys(), ...newItemMap.keys()]);
      allProductIds.forEach((pId) => {
        const oldQty = oldItemMap.get(pId) || 0;
        const newQty = newItemMap.get(pId) || 0;
        const diff = oldQty - newQty; // If positive, restore to stock (+diff); if negative, deduct from stock (-diff)
        if (diff !== 0) {
          adjustStock(
            pId,
            diff,
            'Adjustment',
            `Stock adjusted from edited sale ${existing.invoiceNo} (${diff > 0 ? '+' : ''}${diff})`,
            performedBy
          );
        }
      });
    }

    // 2. Save Sale to State & Persistence
    setSales((prev) => prev.map((s) => (s.id === saleId ? updatedSale : s)));
    saveDocument('sales', updatedSale);
    putItem('sales', updatedSale).catch((e) => console.warn('IndexedDB sales put error:', e));

    // 3. Cascade down to Delivery Order (deliveryOrders)
    let matchingDeliveryOrder = deliveryOrders.find(
      (d) => d.saleId === saleId || (existing.invoiceNo && d.invoiceNo === existing.invoiceNo)
    );

    let linkedExpenseId = matchingDeliveryOrder?.expenseId;

    if (matchingDeliveryOrder) {
      const updatedDelivery: DeliveryOrder = {
        ...matchingDeliveryOrder,
        deliveryFee: newFee,
        customerName: finalCustomerName || matchingDeliveryOrder.customerName,
        items: itemsList.length > 0 ? itemsList : matchingDeliveryOrder.items,
        updatedAt: now,
      };

      setDeliveryOrders((prev) => prev.map((d) => (d.id === updatedDelivery.id ? updatedDelivery : d)));
      saveDocument('deliveryOrders', updatedDelivery);
      putItem('deliveryOrders', updatedDelivery).catch((e) => console.warn('IndexedDB deliveryOrder put error:', e));
    } else if (newFee > 0 && !isHistorical) {
      // If sale didn't have a delivery order previously, but now has a delivery fee > 0, auto-create one
      const deliveryNo = `DEL-${Date.now().toString().slice(-6)}`;
      const newDel: DeliveryOrder = {
        id: generateUniqueId('del'),
        deliveryNo,
        saleId: updatedSale.id,
        invoiceNo: updatedSale.invoiceNo,
        customerId: updatedSale.customerId,
        customerName: finalCustomerName || 'Customer',
        customerPhone: '',
        deliveryAddress: '',
        items: itemsList,
        deliveryFee: newFee,
        status: 'Pending Pickup',
        isPickupConfirmed: false,
        notes: updatedSale.notes || '',
        createdBy: performedBy,
        createdAt: now,
        updatedAt: now,
      };
      matchingDeliveryOrder = newDel;
      setDeliveryOrders((prev) => [newDel, ...prev]);
      saveDocument('deliveryOrders', newDel);
      putItem('deliveryOrders', newDel).catch((e) => console.warn('IndexedDB deliveryOrder put error:', e));
    }

    // 4. Cascade down to Linked Logistics Expense (expenses)
    const shortSaleId = existing.id ? existing.id.slice(-6).toUpperCase() : '';
    let linkedExpense = expenses.find(
      (e) =>
        (linkedExpenseId && e.id === linkedExpenseId) ||
        (existing.expenseId && e.id === existing.expenseId) ||
        (updatedSale.expenseId && e.id === updatedSale.expenseId) ||
        (e.saleId && e.saleId === saleId)
    );
    if (!linkedExpense && matchingDeliveryOrder?.deliveryNo) {
      linkedExpense = expenses.find(
        (e) =>
          e.category === 'Logistics' &&
          (e.title.includes(matchingDeliveryOrder.deliveryNo) ||
            (existing.invoiceNo && existing.invoiceNo !== 'N/A' && (e.title.includes(existing.invoiceNo) || (e.description && e.description.includes(existing.invoiceNo)))))
      );
    }
    if (!linkedExpense && existing.invoiceNo && existing.invoiceNo !== 'N/A') {
      linkedExpense = expenses.find(
        (e) =>
          e.category === 'Logistics' &&
          (e.title.includes(existing.invoiceNo) || (e.description && e.description.includes(existing.invoiceNo)))
      );
    }
    if (!linkedExpense && existing.id) {
      linkedExpense = expenses.find(
        (e) =>
          e.category === 'Logistics' &&
          ((e.description && e.description.includes(existing.id)) ||
            (shortSaleId && (e.title.includes(shortSaleId) || (e.description && e.description.includes(shortSaleId)))))
      );
    }

    if (linkedExpense) {
      if (newFee > 0) {
        // Update linked Logistics expense
        const updatedExpense: Expense = {
          ...linkedExpense,
          amount: newFee,
          date: updatedSale.createdAt ? updatedSale.createdAt.split('T')[0] : linkedExpense.date,
          description: isHistorical
            ? `Historical delivery fee expense for ${finalCustomerName}. Sale ${existing.invoiceNo && existing.invoiceNo !== 'N/A' ? existing.invoiceNo : existing.id}.${updatedSale.notes ? ' Notes: ' + updatedSale.notes : ''}`.trim()
            : `Delivery fee expense for ${finalCustomerName}. ${matchingDeliveryOrder ? `Order ${matchingDeliveryOrder.deliveryNo}, ` : ''}Invoice ${existing.invoiceNo}.${matchingDeliveryOrder?.courierNotes ? ' Courier/Notes: ' + matchingDeliveryOrder.courierNotes : ''}`.trim(),
          isHistorical: isHistorical || linkedExpense.isHistorical,
          saleId: existing.id,
        };
        setExpenses((prev) => prev.map((e) => (e.id === updatedExpense.id ? updatedExpense : e)));
        saveDocument('expenses', updatedExpense);
        putItem('expenses', updatedExpense).catch((e) => console.warn('IndexedDB expense put error:', e));
      } else {
        // Fee was removed (set to 0), delete the linked expense
        const expIdToRemove = linkedExpense.id;
        setExpenses((prev) => prev.filter((e) => e.id !== expIdToRemove));
        removeDocument('expenses', expIdToRemove);
        deleteItem('expenses', expIdToRemove).catch((e) => console.warn('IndexedDB expense delete error:', e));
        markIdDeleted('expenses', expIdToRemove);
        updatedSale.expenseId = undefined;
      }
    } else if (isHistorical && newFee > 0) {
      // Historical sale updated with a delivery fee > 0, auto-create Historical Logistics Expense
      const invoiceRef = existing.invoiceNo && existing.invoiceNo !== 'N/A' ? existing.invoiceNo : existing.id.slice(-6).toUpperCase();
      const expId = generateUniqueId('exp');
      const saleDate = updatedSale.createdAt ? updatedSale.createdAt.split('T')[0] : now.split('T')[0];
      const newExpense: Expense = {
        id: expId,
        title: `Logistics Delivery Fee - Historical (${invoiceRef})`,
        category: 'Logistics',
        amount: newFee,
        description: `Historical delivery fee expense for ${finalCustomerName}. Sale ${existing.invoiceNo && existing.invoiceNo !== 'N/A' ? existing.invoiceNo : existing.id}.${updatedSale.notes ? ' Notes: ' + updatedSale.notes : ''}`.trim(),
        paidBy: updatedSale.createdBy || performedBy,
        paymentMethod: updatedSale.paymentMethod === 'Split' ? 'Cash' : (updatedSale.paymentMethod || 'Cash'),
        date: saleDate,
        createdAt: updatedSale.createdAt || now,
        isHistorical: true,
        saleId: existing.id,
      };
      updatedSale.expenseId = expId;
      setExpenses((prev) => [newExpense, ...prev]);
      saveDocument('expenses', newExpense);
      putItem('expenses', newExpense).catch((e) => console.warn('IndexedDB expense put error:', e));

      // Also persist updatedSale with expenseId
      setSales((prev) => prev.map((s) => (s.id === saleId ? updatedSale : s)));
      saveDocument('sales', updatedSale);
      putItem('sales', updatedSale).catch(() => {});
    } else if (matchingDeliveryOrder?.isPickupConfirmed && newFee > 0) {
      // If delivery pickup was already confirmed, create the Logistics expense
      const expenseTitle = `Logistics Delivery Fee - ${matchingDeliveryOrder.deliveryNo} (${existing.invoiceNo})`;
      const newExpense: Expense = {
        id: generateUniqueId('exp'),
        title: expenseTitle,
        category: 'Logistics',
        amount: newFee,
        description: `Delivery fee expense auto-created for ${finalCustomerName}. Order ${matchingDeliveryOrder.deliveryNo}, Invoice ${existing.invoiceNo}.`,
        paidBy: matchingDeliveryOrder.pickupConfirmedBy || performedBy,
        paymentMethod: 'Cash',
        date: matchingDeliveryOrder.pickupConfirmedAt ? matchingDeliveryOrder.pickupConfirmedAt.split('T')[0] : now.split('T')[0],
        createdAt: matchingDeliveryOrder.pickupConfirmedAt || now,
        saleId: existing.id,
      };
      setExpenses((prev) => [newExpense, ...prev]);
      saveDocument('expenses', newExpense);
      putItem('expenses', newExpense).catch((e) => console.warn('IndexedDB expense put error:', e));
    }

    // 5. Cascade down to Customer (ownership transfer, lifetimeValue, outstandingBalance debt & loyalty points)
    const oldTotal = existing.totalAmount || 0;
    const totalDiff = calculatedTotal - oldTotal;
    const oldPoints = Math.floor(oldTotal * (settings.pointsPerDollar || 0.01));
    const newPoints = Math.floor(calculatedTotal * (settings.pointsPerDollar || 0.01));
    const pointsDiff = newPoints - oldPoints;

    // Resolve old customer record (from previous sale state)
    let oldCust = customers.find((c) => c.id === existing.customerId);
    if (!oldCust && existing.customerName && existing.customerName.trim().toLowerCase() !== 'walk-in customer' && existing.customerName.trim().toLowerCase() !== 'cash customer') {
      oldCust = customers.find((c) => c.name && c.name.trim().toLowerCase() === existing.customerName.trim().toLowerCase());
    }

    // Resolve new target customer record
    const newCustId = updates.customerId !== undefined ? updates.customerId : existing.customerId;
    let targetCust = newCustId ? customers.find((c) => c.id === newCustId) : undefined;
    if (!targetCust && finalCustomerName && finalCustomerName.trim().toLowerCase() !== 'walk-in customer' && finalCustomerName.trim().toLowerCase() !== 'cash customer') {
      targetCust = customers.find((c) => c.name && c.name.trim().toLowerCase() === finalCustomerName.trim().toLowerCase());
    }

    // If customer assignment was explicitly cleared to Walk-in
    if (updates.customerId === undefined && updates.customerName && (updates.customerName.trim().toLowerCase() === 'walk-in customer' || updates.customerName.trim().toLowerCase() === 'cash customer')) {
      targetCust = undefined;
    }

    const isOwnershipTransferred = (oldCust?.id || null) !== (targetCust?.id || null);

    // Synchronize customer identity on updatedSale
    updatedSale.customerId = targetCust ? targetCust.id : (finalCustomerName === 'Walk-in Customer' ? undefined : newCustId);
    updatedSale.customerName = targetCust ? targetCust.name : finalCustomerName;

    let updatedOldCust: Customer | null = null;
    let updatedTargetCust: Customer | null = null;

    if (isOwnershipTransferred) {
      // 5a. If unlinked from previous registered customer, deduct historical contribution
      if (oldCust) {
        updatedOldCust = {
          ...oldCust,
          purchaseHistoryCount: Math.max(0, (Number(oldCust.purchaseHistoryCount) || 0) - 1),
          lifetimeValue: Math.max(0, (Number(oldCust.lifetimeValue) || 0) - oldTotal),
          loyaltyPoints: Math.max(0, (Number(oldCust.loyaltyPoints) || 0) - oldPoints),
          outstandingBalance: Math.max(0, (Number(oldCust.outstandingBalance) || 0) - oldUnpaid),
        };
      }

      // 5b. If linked to new registered customer, credit full transaction contribution
      if (targetCust) {
        updatedTargetCust = {
          ...targetCust,
          purchaseHistoryCount: (Number(targetCust.purchaseHistoryCount) || 0) + 1,
          lifetimeValue: (Number(targetCust.lifetimeValue) || 0) + calculatedTotal,
          loyaltyPoints: (Number(targetCust.loyaltyPoints) || 0) + newPoints,
          outstandingBalance: Math.max(0, (Number(targetCust.outstandingBalance) || 0) + newUnpaid),
        };
      } else if (newUnpaid > 0 && finalCustomerName && finalCustomerName.trim().toLowerCase() !== 'walk-in customer' && finalCustomerName.trim().toLowerCase() !== 'cash customer') {
        // Auto-register new customer in directory if they owe an outstanding balance
        const newCust: Customer = {
          id: generateUniqueId('cust'),
          name: finalCustomerName,
          phone: matchingDeliveryOrder?.customerPhone || '',
          email: '',
          address: matchingDeliveryOrder?.deliveryAddress || '',
          createdAt: now,
          purchaseHistoryCount: 1,
          outstandingBalance: newUnpaid,
          loyaltyPoints: newPoints,
          lifetimeValue: calculatedTotal,
        };
        updatedTargetCust = newCust;
        updatedSale.customerId = newCust.id;
      }

      logAudit(
        'UPDATE_SALE',
        'Sale',
        saleId,
        performedBy,
        `Transferred customer ownership of sale ${existing.invoiceNo} from "${existing.customerName || 'Walk-in Customer'}" to "${finalCustomerName || 'Walk-in Customer'}".`
      );
    } else {
      // 5c. Customer ownership unchanged: apply standard metric diffs
      if (targetCust) {
        const currentBal = Number(targetCust.outstandingBalance) || 0;
        const newBal = Math.max(0, currentBal + unpaidDiff);
        updatedTargetCust = {
          ...targetCust,
          name: finalCustomerName || targetCust.name,
          lifetimeValue: Math.max(0, (targetCust.lifetimeValue || 0) + totalDiff),
          loyaltyPoints: Math.max(0, (Number(targetCust.loyaltyPoints) || 0) + pointsDiff),
          outstandingBalance: newBal,
        };
      } else if (newUnpaid > 0 && finalCustomerName && finalCustomerName.trim().toLowerCase() !== 'walk-in customer' && finalCustomerName.trim().toLowerCase() !== 'cash customer') {
        const newCust: Customer = {
          id: generateUniqueId('cust'),
          name: finalCustomerName,
          phone: matchingDeliveryOrder?.customerPhone || '',
          email: '',
          address: matchingDeliveryOrder?.deliveryAddress || '',
          createdAt: now,
          purchaseHistoryCount: 1,
          outstandingBalance: newUnpaid,
          loyaltyPoints: newPoints,
          lifetimeValue: calculatedTotal,
        };
        updatedTargetCust = newCust;
        updatedSale.customerId = newCust.id;
      }
    }

    // Persist customer updates to React state, Firebase, and IndexedDB
    if (updatedOldCust || updatedTargetCust) {
      setCustomers((prev) => {
        let list = prev;
        if (updatedOldCust) {
          list = list.map((c) => (c.id === updatedOldCust!.id ? updatedOldCust! : c));
          saveDocument('customers', updatedOldCust);
          putItem('customers', updatedOldCust).catch((e) => console.warn('IndexedDB customer put error:', e));
        }
        if (updatedTargetCust) {
          const exists = list.some((c) => c.id === updatedTargetCust!.id);
          if (exists) {
            list = list.map((c) => (c.id === updatedTargetCust!.id ? updatedTargetCust! : c));
          } else {
            list = [updatedTargetCust, ...list];
          }
          saveDocument('customers', updatedTargetCust);
          putItem('customers', updatedTargetCust).catch((e) => console.warn('IndexedDB customer put error:', e));
        }
        return list;
      });
    }

    // Also ensure updatedSale state reflects the finalized customerId
    setSales((prev) => prev.map((s) => (s.id === saleId ? updatedSale : s)));
    saveDocument('sales', updatedSale);
    putItem('sales', updatedSale).catch((e) => console.warn('IndexedDB sales put error:', e));

    if (newUnpaid > 0 && unpaidDiff > 0 && finalCustomerName) {
      const notif: NotificationItem = {
        id: 'notif-bal-' + Date.now(),
        title: 'Customer Outstanding Balance Recorded',
        message: `${finalCustomerName} has an outstanding balance of ${settings.currencySymbol}${newUnpaid.toFixed(2)} on sale ${existing.invoiceNo}.`,
        type: 'customer_balance',
        read: false,
        createdAt: now,
      };
      setNotifications((prev) => [notif, ...prev]);
      saveDocument('notifications', notif);
    }

    // 5. Cascade down to WhatsApp Pre-Order
    const linkedPreOrder = whatsAppPreOrders.find(
      (po) =>
        po.convertedSaleId === saleId ||
        (existing.invoiceNo && po.convertedInvoiceNo === existing.invoiceNo)
    );
    if (linkedPreOrder) {
      const updatedPreOrderTotal = Math.max(
        0,
        (linkedPreOrder.subtotal || 0) - (linkedPreOrder.discount || 0) + newFee
      );
      const updatedPreOrder: WhatsAppPreOrder = {
        ...linkedPreOrder,
        deliveryFee: newFee,
        totalAmount: updatedPreOrderTotal,
        customerName: finalCustomerName || linkedPreOrder.customerName,
        updatedAt: now,
      };
      setWhatsAppPreOrders((prev) => prev.map((po) => (po.id === updatedPreOrder.id ? updatedPreOrder : po)));
      saveDocument('whatsAppPreOrders', updatedPreOrder);
      putItem('whatsAppPreOrders', updatedPreOrder).catch((e) => console.warn('IndexedDB whatsAppPreOrder put error:', e));
    }

    logAudit(
      'UPDATE_SALE',
      'Sale',
      saleId,
      performedBy,
      `Updated sale record ${existing.invoiceNo} (Paid: ${settings.currencySymbol}${finalPaidAmount.toFixed(2)}/${settings.currencySymbol}${calculatedTotal.toFixed(2)}, Outstanding: ${settings.currencySymbol}${newUnpaid.toFixed(2)}). Synchronized customer balance & linked records.`
    );
    showToast({
      title: 'Sale & Customer Balance Updated',
      message: `Sale record ${existing.invoiceNo} saved. Customer outstanding balance: ${settings.currencySymbol}${newUnpaid.toFixed(2)}.`,
      type: 'info',
    });
  };

  // Reconcile Historical Sales with Delivery Fees to automatically create/verify Historical Logistics Expenses
  const reconcileHistoricalDeliveryExpenses = React.useCallback(
    (salesList?: Sale[], expensesList?: Expense[]) => {
      const currentSales = salesList || sales;
      const currentExpenses = expensesList || expenses;

      const historicalSalesWithDelivery = currentSales.filter((s) => {
        const isHist =
          s.isHistorical ||
          s.id.startsWith('sale-imp-') ||
          (s.notes && (s.notes.includes('Historical') || s.notes.includes('Past Entry') || s.notes.includes('Import Wizard')));
        return isHist && (Number(s.deliveryFee) || 0) > 0;
      });

      if (historicalSalesWithDelivery.length === 0) {
        return { fixedCount: 0 };
      }

      // Sort by createdAt descending so most recent historical sales come first
      const sorted = [...historicalSalesWithDelivery].sort((a, b) => {
        const aTime = Date.parse(a.createdAt || '');
        const bTime = Date.parse(b.createdAt || '');
        return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
      });

      const newExpensesToAdd: Expense[] = [];
      const updatedExpensesToSync: Expense[] = [];
      const updatedSalesToSync: Sale[] = [];

      sorted.forEach((sale) => {
        const fee = Number(sale.deliveryFee) || 0;
        if (fee <= 0) return;

        // Check if an expense already exists for this sale
        let existingExpense = currentExpenses.find((e) => {
          if (sale.expenseId && e.id === sale.expenseId) return true;
          if (e.saleId && e.saleId === sale.id) return true;
          if (e.category === 'Logistics') {
            if (e.description && e.description.includes(sale.id)) return true;
            if (sale.invoiceNo && sale.invoiceNo !== 'N/A' && (e.title.includes(sale.invoiceNo) || (e.description && e.description.includes(sale.invoiceNo)))) return true;
            const shortId = sale.id.slice(-6).toUpperCase();
            if (e.title.includes(shortId) || (e.description && e.description.includes(shortId))) return true;
          }
          return false;
        });

        if (!existingExpense) {
          existingExpense = newExpensesToAdd.find((e) => e.saleId === sale.id || (e.description && e.description.includes(sale.id)));
        }

        if (!existingExpense) {
          // Missing expense! Automatically create Historical Logistics Expense
          const invoiceRef = sale.invoiceNo && sale.invoiceNo !== 'N/A' ? sale.invoiceNo : sale.id.slice(-6).toUpperCase();
          const expId = `exp-hist-${sale.id}`;
          const saleDate = sale.createdAt ? sale.createdAt.split('T')[0] : new Date().toISOString().split('T')[0];
          const saleIso = sale.createdAt || new Date().toISOString();
          const histExpense: Expense = {
            id: expId,
            title: `Logistics Delivery Fee - Historical (${invoiceRef})`,
            category: 'Logistics',
            amount: fee,
            description: `Historical delivery fee expense for ${sale.customerName || 'Walk-in Customer'}. Sale ${sale.invoiceNo && sale.invoiceNo !== 'N/A' ? sale.invoiceNo : sale.id}.${sale.notes ? ' ' + sale.notes : ''}`.trim(),
            paidBy: sale.createdBy || 'Administrator',
            paymentMethod: sale.paymentMethod === 'Split' ? 'Cash' : (sale.paymentMethod || 'Cash'),
            date: saleDate,
            createdAt: saleIso,
            isHistorical: true,
            saleId: sale.id,
          };

          newExpensesToAdd.push(histExpense);
          saveDocument('expenses', histExpense);
          putItem('expenses', histExpense).catch(() => {});

          // Link on sale
          if (sale.expenseId !== expId) {
            const updatedSale: Sale = { ...sale, expenseId: expId };
            updatedSalesToSync.push(updatedSale);
            saveDocument('sales', updatedSale);
            putItem('sales', updatedSale).catch(() => {});
          }
        } else {
          let needsUpdate = false;
          let updated = { ...existingExpense };
          if (!updated.isHistorical) {
            updated.isHistorical = true;
            needsUpdate = true;
          }
          if (!updated.saleId) {
            updated.saleId = sale.id;
            needsUpdate = true;
          }
          if (updated.amount !== fee) {
            updated.amount = fee;
            needsUpdate = true;
          }
          if (needsUpdate) {
            updatedExpensesToSync.push(updated);
            saveDocument('expenses', updated);
            putItem('expenses', updated).catch(() => {});
          }
          if (sale.expenseId !== existingExpense.id) {
            const updatedSale: Sale = { ...sale, expenseId: existingExpense.id };
            updatedSalesToSync.push(updatedSale);
            saveDocument('sales', updatedSale);
            putItem('sales', updatedSale).catch(() => {});
          }
        }
      });

      if (newExpensesToAdd.length > 0 || updatedExpensesToSync.length > 0) {
        setExpenses((prev) => {
          let next = [...prev];
          if (updatedExpensesToSync.length > 0) {
            const updateMap = new Map(updatedExpensesToSync.map((e) => [e.id, e]));
            next = next.map((e) => updateMap.get(e.id) || e);
          }
          if (newExpensesToAdd.length > 0) {
            const existingIds = new Set(next.map((e) => e.id));
            const fresh = newExpensesToAdd.filter((e) => !existingIds.has(e.id));
            next = [...fresh, ...next];
          }
          return next;
        });
      }

      if (updatedSalesToSync.length > 0) {
        const updateMap = new Map(updatedSalesToSync.map((s) => [s.id, s]));
        setSales((prev) => prev.map((s) => updateMap.get(s.id) || s));
      }

      return { fixedCount: newExpensesToAdd.length };
    },
    [sales, expenses]
  );

  // Helper to identify historical sales records
  const isHistoricalSaleRecord = React.useCallback((s: Sale): boolean => {
    if (!s) return false;
    if (s.isHistorical) return true;
    if (typeof s.id === 'string' && s.id.startsWith('sale-imp-')) return true;
    if (typeof s.notes === 'string' && (s.notes.includes('Historical') || s.notes.includes('Past Entry') || s.notes.includes('Import Wizard'))) return true;
    return false;
  }, []);

  // Purge any historical sales inflows or historical delivery fee expense outflows from Money Movement Tracker
  const purgeHistoricalMoneyMovements = React.useCallback((): { purgedCount: number } => {
    const histSaleIds = new Set(sales.filter(isHistoricalSaleRecord).map((s) => s.id));
    let purgedCount = 0;

    setMoneyMovements((prev) => {
      const toRemove: MoneyMovement[] = [];
      const kept: MoneyMovement[] = [];

      prev.forEach((m) => {
        const isHistDeliveryExpenseMM =
          (typeof m.id === 'string' && m.id.startsWith('mm-hist-')) ||
          (m.subtype === 'Logistics' && (
            (typeof m.referenceNo === 'string' && m.referenceNo.includes('Historical')) ||
            (typeof m.notes === 'string' && (m.notes.includes('Historical') || m.notes.includes('Historical delivery fee')))
          ));

        const isHistSaleInflow =
          m.type === 'Sale Inflow' && (
            (m.referenceId && histSaleIds.has(m.referenceId)) ||
            (typeof m.notes === 'string' && (m.notes.includes('Historical') || m.notes.includes('Import Wizard')))
          );

        if (isHistDeliveryExpenseMM || isHistSaleInflow) {
          toRemove.push(m);
        } else {
          kept.push(m);
        }
      });

      if (toRemove.length > 0) {
        purgedCount = toRemove.length;
        toRemove.forEach((m) => {
          removeDocument('moneyMovements', m.id);
          deleteItem('moneyMovements', m.id).catch(() => {});
          markIdDeleted('moneyMovements', m.id);
        });
        console.log(`[Treasury] Purged ${toRemove.length} historical money movement records to preserve live Bank and Till balances.`);
      }

      return kept;
    });

    return { purgedCount };
  }, [sales, isHistoricalSaleRecord]);

  // Automatically reconcile historical delivery fee expenses and purge historical movements when storage is ready
  const hasAutoReconciledRef = useRef(false);
  useEffect(() => {
    if (!isStorageReady) return;
    const timer = setTimeout(() => {
      if (!hasAutoReconciledRef.current && sales.length > 0) {
        hasAutoReconciledRef.current = true;
        reconcileHistoricalDeliveryExpenses();
        purgeHistoricalMoneyMovements();
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [isStorageReady, sales.length, reconcileHistoricalDeliveryExpenses, purgeHistoricalMoneyMovements]);

  // Customer Management
  const addCustomer = (c: Omit<Customer, 'id' | 'createdAt' | 'purchaseHistoryCount' | 'outstandingBalance' | 'loyaltyPoints' | 'lifetimeValue'>) => {
    const newCust: Customer = {
      ...c,
      id: generateUniqueId('cust'),
      purchaseHistoryCount: 0,
      outstandingBalance: 0,
      loyaltyPoints: 0,
      lifetimeValue: 0,
      createdAt: new Date().toISOString(),
    };
    setCustomers((prev) => [newCust, ...prev]);
    saveDocument('customers', newCust);
    showToast({ title: 'New Customer Added', message: `Customer "${c.name}" registered successfully.`, type: 'success' });
    return newCust;
  };

  const updateCustomer = (id: string, updates: Partial<Customer>) => {
    const existing = customers.find((c) => c.id === id);
    if (!existing) return;

    const updatedCust: Customer = { ...existing, ...updates };

    setCustomers((prev) =>
      prev.map((c) => (c.id === id ? updatedCust : c))
    );
    saveDocument('customers', updatedCust);
    putItem('customers', updatedCust).catch((e) => console.warn('IndexedDB customer put error:', e));

    // Cascade name/phone/address changes to linked active modules
    if (updates.name || updates.phone || updates.address) {
      const now = new Date().toISOString();

      // Cascade to Delivery Orders
      setDeliveryOrders((prev) =>
        prev.map((d) => {
          if (d.customerId === id || (existing.name && d.customerName === existing.name)) {
            const updatedDel: DeliveryOrder = {
              ...d,
              customerName: updates.name || d.customerName,
              customerPhone: updates.phone || d.customerPhone,
              deliveryAddress: updates.address || d.deliveryAddress,
              updatedAt: now,
            };
            saveDocument('deliveryOrders', updatedDel);
            putItem('deliveryOrders', updatedDel).catch((e) => console.warn('IndexedDB del put error:', e));
            return updatedDel;
          }
          return d;
        })
      );

      // Cascade to WhatsApp Pre-Orders
      setWhatsAppPreOrders((prev) =>
        prev.map((po) => {
          if (po.customerPhone === existing.phone || po.customerName === existing.name) {
            const updatedPo: WhatsAppPreOrder = {
              ...po,
              customerName: updates.name || po.customerName,
              customerPhone: updates.phone || po.customerPhone,
              deliveryAddress: updates.address || po.deliveryAddress,
              updatedAt: now,
            };
            saveDocument('whatsAppPreOrders', updatedPo);
            putItem('whatsAppPreOrders', updatedPo).catch((e) => console.warn('IndexedDB po put error:', e));
            return updatedPo;
          }
          return po;
        })
      );

      // Cascade to Sales
      if (updates.name) {
        setSales((prev) =>
          prev.map((s) => {
            if (s.customerId === id) {
              const updatedSale: Sale = { ...s, customerName: updates.name || s.customerName };
              saveDocument('sales', updatedSale);
              putItem('sales', updatedSale).catch((e) => console.warn('IndexedDB sale put error:', e));
              return updatedSale;
            }
            return s;
          })
        );
      }
    }

    logAudit('UPDATE_CUSTOMER', 'Customer', id, 'Admin', `Updated details for customer "${updatedCust.name}". Cascaded info to linked orders.`);
    showToast({ title: 'Customer Updated', message: `Customer profile for "${updatedCust.name}" updated.`, type: 'success' });
  };

  const updateCustomerBalance = (
    id: string,
    amountChange: number,
    paymentDetails?: { paymentMethod?: PaymentMethod; paymentNote?: string; performedBy?: string }
  ) => {
    const cust = customers.find((c) => c.id === id);
    if (!cust) return;

    const currentBal = Number(cust.outstandingBalance) || 0;
    const newBal = Math.max(0, currentBal + amountChange);
    const updatedCust = { ...cust, outstandingBalance: newBal };

    setCustomers((prev) =>
      prev.map((c) => (c.id === id ? updatedCust : c))
    );
    saveDocument('customers', updatedCust);
    putItem('customers', updatedCust).catch((e) => console.warn('IndexedDB customer put error:', e));

    // If debt payment was made (amountChange < 0), reconcile and credit unpaid sales
    if (amountChange < 0) {
      let settlementAmount = Math.abs(amountChange);
      const paymentMethod = paymentDetails?.paymentMethod || 'Cash';
      const paymentNote = paymentDetails?.paymentNote ? ` [Note: ${paymentDetails.paymentNote}]` : '';

      setSales((prev) => {
        return prev.map((s) => {
          const isCustSale =
            s.customerId === id ||
            (s.customerName && cust.name && s.customerName.trim().toLowerCase() === cust.name.trim().toLowerCase());
          if (!isCustSale || settlementAmount <= 0) return s;

          const unpaidOnSale = Math.max(
            0,
            (s.totalAmount || 0) - (s.paidAmount !== undefined ? s.paidAmount : s.totalAmount || 0)
          );
          if (unpaidOnSale <= 0) return s;

          const credit = Math.min(settlementAmount, unpaidOnSale);
          settlementAmount -= credit;
          const currentPaid = s.paidAmount !== undefined ? s.paidAmount : s.totalAmount || 0;
          const newPaid = currentPaid + credit;
          const settlementNote = `Debt payment of ${settings.currencySymbol}${credit.toFixed(2)} received via ${paymentMethod}${paymentNote}.`;

          const updatedSale: Sale = {
            ...s,
            paidAmount: newPaid,
            notes: s.notes ? `${s.notes} | ${settlementNote}` : settlementNote,
          };
          saveDocument('sales', updatedSale);
          putItem('sales', updatedSale).catch((e) => console.warn('IndexedDB sale put error:', e));
          return updatedSale;
        });
      });

      const user = paymentDetails?.performedBy || 'Admin';

      // Auto-log Money Movement for Customer Debt Payment
      const isCash = paymentMethod === 'Cash';
      const debtMM: MoneyMovement = {
        id: generateUniqueId('mm'),
        date: new Date().toISOString(),
        type: 'Customer Debt Payment',
        subtype: paymentMethod,
        destinationAccount: isCash ? 'Physical Cash' : 'Biz Account',
        amount: Math.abs(amountChange),
        referenceNo: cust.name,
        referenceId: id,
        performedBy: user,
        notes: `Customer debt settled by ${cust.name}: ${settings.currencySymbol}${Math.abs(amountChange).toFixed(2)} via ${paymentMethod}${paymentNote}`,
        createdAt: new Date().toISOString(),
      };
      setMoneyMovements((prev) => [debtMM, ...prev]);
      saveDocument('moneyMovements', debtMM);
      putItem('moneyMovements', debtMM).catch(() => {});

      logAudit(
        'SETTLE_DEBT',
        'Customer',
        id,
        user,
        `Settled balance for ${cust.name}: paid ${settings.currencySymbol}${Math.abs(amountChange).toFixed(2)} via ${paymentMethod}. New balance: ${settings.currencySymbol}${newBal.toFixed(2)}.`
      );
    }

    showToast({
      title: 'Customer Balance Updated',
      message: `Updated balance for ${cust.name}. Current balance: ${settings.currencySymbol}${newBal.toFixed(2)}.`,
      type: 'success',
    });
  };

  const deleteCustomer = (id: string) => {
    const target = customers.find((c) => c.id === id);
    setCustomers((prev) => prev.filter((c) => c.id !== id));
    removeDocument('customers', id);
    deleteItem('customers', id).catch((e) => console.warn('IndexedDB customer delete error:', e));
    markIdDeleted('customers', id);

    // Clean up customer balance notifications
    if (target) {
      setNotifications((prev) => {
        const removed = prev.filter((n) => n.message.includes(target.name));
        removed.forEach((n) => removeDocument('notifications', n.id));
        return prev.filter((n) => !n.message.includes(target.name));
      });
    }

    // Safely unlink customerId on sales (keep customerName so sales history is preserved)
    setSales((prev) =>
      prev.map((s) => {
        if (s.customerId === id) {
          const updatedSale: Sale = { ...s, customerId: undefined };
          saveDocument('sales', updatedSale);
          putItem('sales', updatedSale).catch((e) => console.warn('IndexedDB sale put error:', e));
          return updatedSale;
        }
        return s;
      })
    );

    logAudit('DELETE_CUSTOMER', 'Customer', id, 'Admin', target ? `Deleted customer profile "${target.name}".` : `Deleted customer ${id}.`);
    showToast({ title: 'Customer Deleted', message: target ? `Customer "${target.name}" removed from directory.` : 'Customer deleted.', type: 'error' });
  };

  // Supplier Management
  const addSupplier = (s: Omit<Supplier, 'id' | 'createdAt' | 'productsCount' | 'outstandingBalance'>) => {
    const newSup: Supplier = {
      ...s,
      id: generateUniqueId('sup'),
      productsCount: 0,
      outstandingBalance: 0,
      createdAt: new Date().toISOString(),
    };
    setSuppliers((prev) => [newSup, ...prev]);
    saveDocument('suppliers', newSup);
    putItem('suppliers', newSup).catch((e) => console.warn('IndexedDB supplier put error:', e));
    showToast({ title: 'New Supplier Added', message: `Supplier "${s.name}" added to database.`, type: 'success' });
  };

  const updateSupplier = (id: string, updates: Partial<Supplier>) => {
    const existing = suppliers.find((s) => s.id === id);
    if (!existing) return;

    const updatedSup: Supplier = { ...existing, ...updates };

    setSuppliers((prev) =>
      prev.map((s) => (s.id === id ? updatedSup : s))
    );
    saveDocument('suppliers', updatedSup);
    putItem('suppliers', updatedSup).catch((e) => console.warn('IndexedDB supplier put error:', e));

    // Cascade supplier name change to products and purchase orders
    if (updates.name && updates.name !== existing.name) {
      setProducts((prev) =>
        prev.map((p) => {
          if (p.supplierId === id) {
            const updatedProd: Product = { ...p, supplierName: updates.name! };
            saveDocument('products', updatedProd);
            putItem('products', updatedProd).catch((e) => console.warn('IndexedDB product put error:', e));
            return updatedProd;
          }
          return p;
        })
      );

      setPurchases((prev) =>
        prev.map((po) => {
          if (po.supplierId === id) {
            const updatedPo: PurchaseOrder = { ...po, supplierName: updates.name! };
            saveDocument('purchases', updatedPo);
            putItem('purchases', updatedPo).catch((e) => console.warn('IndexedDB purchase put error:', e));
            return updatedPo;
          }
          return po;
        })
      );
    }

    logAudit('UPDATE_SUPPLIER', 'Supplier', id, 'Admin', `Updated supplier details for "${updatedSup.name}".`);
    showToast({ title: 'Supplier Updated', message: 'Supplier details updated successfully.', type: 'success' });
  };

  const deleteSupplier = (id: string) => {
    const target = suppliers.find((s) => s.id === id);
    setSuppliers((prev) => prev.filter((s) => s.id !== id));
    removeDocument('suppliers', id);
    deleteItem('suppliers', id).catch((e) => console.warn('IndexedDB supplier delete error:', e));
    markIdDeleted('suppliers', id);

    // Unlink supplier from products
    setProducts((prev) =>
      prev.map((p) => {
        if (p.supplierId === id) {
          const updatedProd: Product = { ...p, supplierId: '', supplierName: 'Unassigned' };
          saveDocument('products', updatedProd);
          putItem('products', updatedProd).catch((e) => console.warn('IndexedDB product put error:', e));
          return updatedProd;
        }
        return p;
      })
    );

    logAudit('DELETE_SUPPLIER', 'Supplier', id, 'Admin', target ? `Deleted supplier profile "${target.name}".` : `Deleted supplier ${id}.`);
    showToast({ title: 'Supplier Deleted', message: target ? `Supplier "${target.name}" removed from database.` : 'Supplier deleted.', type: 'error' });
  };

  // Purchases
  const addPurchaseOrder = (po: Omit<PurchaseOrder, 'id' | 'createdAt'>) => {
    const newPO: PurchaseOrder = {
      ...po,
      id: 'po-' + Date.now(),
      createdAt: new Date().toISOString(),
    };
    setPurchases((prev) => [newPO, ...prev]);
    saveDocument('purchases', newPO);

    if (po.deliveryStatus === 'Received') {
      po.items.forEach((item) => {
        adjustStock(item.productId, item.quantity, 'Incoming', `Purchase Order ${po.poNumber}`, po.createdBy);
      });
    }
    showToast({ title: 'Purchase Order Created', message: `PO #${po.poNumber} created successfully.`, type: 'success' });
  };

  const receivePurchaseOrder = (poId: string, performedBy: string) => {
    const po = purchases.find((p) => p.id === poId);
    if (!po) return;

    // Quick receive all items
    const inspectionItems = po.items.map((item) => {
      const unreceived = Math.max(0, item.quantity - (item.receivedQuantity || 0));
      return {
        productId: item.productId,
        receivingQty: unreceived > 0 ? unreceived : item.quantity,
        acceptedQty: unreceived > 0 ? unreceived : item.quantity,
        damagedQty: 0,
        conditionNotes: 'Direct 1-Click Receiving',
      };
    });

    receiveAndInspectPO(poId, {
      items: inspectionItems,
      inspectionStatus: 'Passed',
      inspectorName: performedBy,
      generalNotes: 'Quick-received delivery into stock',
    });
  };

  const receiveAndInspectPO = (
    poId: string,
    inspectionData: {
      items: {
        productId: string;
        receivingQty: number;
        acceptedQty: number;
        damagedQty: number;
        unitCost?: number;
        oldUnitCost?: number;
        customRetailPrice?: number;
        oldRetailPrice?: number;
        updateCatalogCost?: boolean;
        updateCatalogRetail?: boolean;
        conditionNotes?: string;
      }[];
      inspectionStatus: 'Passed' | 'Passed with Exceptions' | 'Failed';
      inspectorName: string;
      generalNotes?: string;
      deliveryFee?: number;
      deliveryFeePaymentMethod?: PaymentMethod;
    }
  ) => {
    const po = purchases.find((p) => p.id === poId);
    if (!po) return;

    const grnNumber = po.grnNumber || `GRN-${new Date().getFullYear()}-${Math.floor(Math.random() * 8999 + 1000)}`;
    const now = new Date().toISOString();

    let totalAcceptedUnits = 0;
    let totalDamagedUnits = 0;

    const updatedItems = po.items.map((item) => {
      const inspectItem = inspectionData.items.find((i) => i.productId === item.productId);
      if (!inspectItem) return item;

      const newReceived = (item.receivedQuantity || 0) + inspectItem.receivingQty;
      const newAccepted = (item.acceptedQuantity || 0) + inspectItem.acceptedQty;
      const newDamaged = (item.damagedQuantity || 0) + inspectItem.damagedQty;

      totalAcceptedUnits += inspectItem.acceptedQty;
      totalDamagedUnits += inspectItem.damagedQty;

      const prod = products.find((p) => p.id === item.productId);

      const newUnitCost = inspectItem.unitCost !== undefined ? inspectItem.unitCost : item.unitCost;
      const oldUnitCost = inspectItem.oldUnitCost !== undefined 
        ? inspectItem.oldUnitCost 
        : (item.oldUnitCost !== undefined ? item.oldUnitCost : (item.unitCost !== newUnitCost ? item.unitCost : (prod?.costPrice || item.unitCost)));

      const newRetailPrice = inspectItem.customRetailPrice !== undefined ? inspectItem.customRetailPrice : (item.customRetailPrice || prod?.retailPrice);
      const oldRetailPrice = inspectItem.oldRetailPrice !== undefined
        ? inspectItem.oldRetailPrice
        : (item.oldRetailPrice !== undefined ? item.oldRetailPrice : (prod?.retailPrice || item.customRetailPrice || 0));

      // If unit cost changed during receiving and catalog update requested/defaulted
      if (inspectItem.unitCost !== undefined && prod && inspectItem.unitCost !== prod.costPrice && inspectItem.updateCatalogCost !== false) {
        updateProduct(
          prod.id,
          { costPrice: inspectItem.unitCost },
          `PO Inspection #${grnNumber} Cost Price updated from ${settings.currencySymbol}${prod.costPrice.toFixed(2)} to ${settings.currencySymbol}${inspectItem.unitCost.toFixed(2)}`
        );
      }

      // If retail price changed during receiving and catalog update requested
      if (inspectItem.customRetailPrice !== undefined && prod && inspectItem.customRetailPrice !== prod.retailPrice && inspectItem.updateCatalogRetail) {
        changeProductPrice(
          prod.id,
          inspectItem.customRetailPrice,
          'Retail',
          `Retail price adjusted during PO Inspection #${grnNumber}`,
          inspectionData.inspectorName
        );
      }

      // Adjust stock for accepted quantity
      if (inspectItem.acceptedQty > 0) {
        adjustStock(
          item.productId,
          inspectItem.acceptedQty,
          'Incoming',
          `GRN #${grnNumber} PO #${po.poNumber} Inspected (${inspectItem.conditionNotes || 'Accepted'})`,
          inspectionData.inspectorName
        );
      }

      // Record damaged stock movement for audit/accounting visibility
      if (inspectItem.damagedQty > 0) {
        const mv: StockMovement = {
          id: generateUniqueId('mv'),
          productId: item.productId,
          productName: item.productName,
          type: 'Damaged',
          quantity: inspectItem.damagedQty,
          previousStock: prod?.currentStock || 0,
          newStock: prod?.currentStock || 0,
          referenceNo: po.poNumber,
          notes: `Inspection Damaged/Defective (${inspectItem.damagedQty} units): ${inspectItem.conditionNotes || 'Rejected during PO receiving'}`,
          performedBy: inspectionData.inspectorName,
          createdAt: now,
        };
        setStockMovements((prev) => [mv, ...prev]);
        saveDocument('stockMovements', mv);
      }

      return {
        ...item,
        unitCost: newUnitCost,
        oldUnitCost: oldUnitCost,
        customRetailPrice: newRetailPrice,
        oldRetailPrice: oldRetailPrice,
        total: item.quantity * newUnitCost,
        receivedQuantity: newReceived,
        acceptedQuantity: newAccepted,
        damagedQuantity: newDamaged,
        lastInspectedAt: now,
        lastInspectionNotes: inspectItem.conditionNotes,
      };
    });

    // Check if fully received
    const isFullyReceived = updatedItems.every(
      (item) => (item.receivedQuantity || 0) >= item.quantity
    );
    const newDeliveryStatus: PurchaseOrder['deliveryStatus'] = isFullyReceived ? 'Received' : 'Partial';

    // Auto-create expense record if delivery fee is provided (>0)
    const recvDeliveryFee = inspectionData.deliveryFee && inspectionData.deliveryFee > 0 ? inspectionData.deliveryFee : undefined;

    if (recvDeliveryFee) {
      addExpense({
        title: `Delivery Fee - PO #${po.poNumber}`,
        category: 'Logistics',
        amount: recvDeliveryFee,
        description: `Local delivery fee charge incurred during stock receiving for PO #${po.poNumber} (${grnNumber}). Supplier: ${po.supplierName}`,
        paidBy: inspectionData.inspectorName || 'Admin',
        paymentMethod: inspectionData.deliveryFeePaymentMethod || 'Cash',
        date: new Date().toISOString().split('T')[0],
      });

      // Calculate gross profit impact on received accepted items
      let totalAcceptedGoodsCost = 0;
      let totalAcceptedRetailSales = 0;

      inspectionData.items.forEach((i) => {
        if (i.acceptedQty <= 0) return;
        const pItem = updatedItems.find((pi) => pi.productId === i.productId);
        const prod = products.find((p) => p.id === i.productId);
        const unitCost = i.unitCost !== undefined ? i.unitCost : (pItem?.unitCost || prod?.costPrice || 0);
        const retailPrice = i.customRetailPrice !== undefined ? i.customRetailPrice : (pItem?.customRetailPrice || prod?.retailPrice || 0);

        totalAcceptedGoodsCost += i.acceptedQty * unitCost;
        totalAcceptedRetailSales += i.acceptedQty * retailPrice;
      });

      if (totalAcceptedGoodsCost > 0) {
        const landedCostIncreasePct = (recvDeliveryFee / totalAcceptedGoodsCost) * 100;
        const marginImpactPct = totalAcceptedRetailSales > 0 ? (recvDeliveryFee / totalAcceptedRetailSales) * 100 : 0;

        // Send high-priority notification to inform user to consider price changes
        addNotification({
          title: 'Delivery Fee Gross Profit Alert',
          message: `Local delivery charge of ${settings.currencySymbol}${recvDeliveryFee.toFixed(2)} on PO #${po.poNumber} (${grnNumber}) reduced gross profit margin by ${marginImpactPct.toFixed(1)}% (effective landed cost +${landedCostIncreasePct.toFixed(1)}%). Consider making a sales price adjustment to maintain profit margins.`,
          type: 'price_increase_alert',
        });
      }
    }

    const historyEntry: ReceivingHistoryEntry = {
      id: 'grn-' + Date.now(),
      grnNumber,
      receivedAt: now,
      receivedBy: inspectionData.inspectorName,
      notes: inspectionData.generalNotes,
      deliveryFee: recvDeliveryFee,
      itemsReceived: inspectionData.items.map((i) => {
        const p = updatedItems.find((pi) => pi.productId === i.productId);
        const prod = products.find((pr) => pr.id === i.productId);
        return {
          productId: i.productId,
          productName: p?.productName || 'Item',
          receivingQty: i.receivingQty,
          acceptedQty: i.acceptedQty,
          damagedQty: i.damagedQty,
          unitCost: i.unitCost !== undefined ? i.unitCost : (p?.unitCost || 0),
          oldUnitCost: i.oldUnitCost !== undefined ? i.oldUnitCost : (p?.oldUnitCost !== undefined ? p.oldUnitCost : (prod?.costPrice || p?.unitCost || 0)),
          customRetailPrice: i.customRetailPrice !== undefined ? i.customRetailPrice : (p?.customRetailPrice || prod?.retailPrice),
          oldRetailPrice: i.oldRetailPrice !== undefined ? i.oldRetailPrice : (p?.oldRetailPrice !== undefined ? p.oldRetailPrice : (prod?.retailPrice || 0)),
          conditionNotes: i.conditionNotes,
        };
      }),
    };

    const updatedPO: PurchaseOrder = {
      ...po,
      items: updatedItems,
      deliveryStatus: newDeliveryStatus,
      inspectionStatus: inspectionData.inspectionStatus,
      inspectedBy: inspectionData.inspectorName,
      inspectedAt: now,
      inspectionNotes: inspectionData.generalNotes || po.inspectionNotes,
      grnNumber,
      deliveryFee: po.deliveryFee,
      localLogisticsFee: (po.localLogisticsFee || 0) + (recvDeliveryFee || 0),
      receivingHistory: [historyEntry, ...(po.receivingHistory || [])],
    };

    setPurchases((prev) => prev.map((p) => (p.id === poId ? updatedPO : p)));
    saveDocument('purchases', updatedPO);

    logAudit(
      'INSPECT_STOCK',
      'PurchaseOrder',
      poId,
      inspectionData.inspectorName,
      `Inspected PO #${po.poNumber} (${grnNumber}). Accepted: ${totalAcceptedUnits}, Damaged: ${totalDamagedUnits}.${recvDeliveryFee ? ` Delivery Fee Charge: ${settings.currencySymbol}${recvDeliveryFee.toFixed(2)} (Logged as Logistics Expense)` : ''} Status: ${inspectionData.inspectionStatus}`
    );

    showToast({
      title: 'Inspection & Receiving Recorded',
      message: `${grnNumber} issued. Restocked ${totalAcceptedUnits} units into inventory${recvDeliveryFee ? ` & recorded ${settings.currencySymbol}${recvDeliveryFee.toFixed(2)} under Logistics Expense` : ''}.`,
      type: 'success',
    });
  };

  const updatePOPayment = (
    poId: string,
    paymentData: {
      additionalPaidAmount: number;
      paymentMethod: PaymentMethod;
      notes?: string;
      performedBy: string;
    }
  ) => {
    const po = purchases.find((p) => p.id === poId);
    if (!po) return;

    const newPaidAmount = Math.min(po.totalAmount, Math.max(0, po.paidAmount + paymentData.additionalPaidAmount));
    let newPaymentStatus: PurchaseOrder['paymentStatus'] = 'Unpaid';
    if (newPaidAmount >= po.totalAmount) {
      newPaymentStatus = 'Paid';
    } else if (newPaidAmount > 0) {
      newPaymentStatus = 'Partial';
    }

    const updatedPO: PurchaseOrder = {
      ...po,
      paidAmount: newPaidAmount,
      paymentStatus: newPaymentStatus,
    };

    setPurchases((prev) => prev.map((p) => (p.id === poId ? updatedPO : p)));
    saveDocument('purchases', updatedPO);

    // Auto-log Money Movement for Supplier Payment
    if (paymentData.additionalPaidAmount > 0) {
      const isCash = paymentData.paymentMethod === 'Cash';
      const poMM: MoneyMovement = {
        id: generateUniqueId('mm'),
        date: new Date().toISOString(),
        type: 'Supplier Payment',
        subtype: `PO #${po.poNumber}`,
        sourceAccount: isCash ? 'Physical Cash' : 'Biz Account',
        amount: paymentData.additionalPaidAmount,
        referenceNo: po.poNumber,
        referenceId: po.id,
        performedBy: paymentData.performedBy,
        notes: `Supplier payment to ${po.supplierName} for PO #${po.poNumber}${paymentData.notes ? ' - ' + paymentData.notes : ''}`,
        createdAt: new Date().toISOString(),
      };
      setMoneyMovements((prev) => [poMM, ...prev]);
      saveDocument('moneyMovements', poMM);
      putItem('moneyMovements', poMM).catch(() => {});
    }

    logAudit(
      'PAYMENT_PO',
      'PurchaseOrder',
      poId,
      paymentData.performedBy,
      `Recorded payment of ${settings.currencySymbol}${paymentData.additionalPaidAmount.toFixed(2)} for PO #${po.poNumber} via ${paymentData.paymentMethod}. Total paid: ${settings.currencySymbol}${newPaidAmount.toFixed(2)}`
    );

    showToast({
      title: 'Supplier Payment Recorded',
      message: `Payment of ${settings.currencySymbol}${paymentData.additionalPaidAmount.toFixed(2)} logged for PO #${po.poNumber}.`,
      type: 'success',
    });
  };

  const updatePurchaseOrder = (poId: string, updates: Partial<PurchaseOrder>, performedBy: string) => {
    const po = purchases.find((p) => p.id === poId);
    if (!po) return;

    const updatedLocalLogistics = updates.localLogisticsFee ?? po.localLogisticsFee ??
      (po.receivingHistory || []).reduce((sum, entry) => sum + (entry.deliveryFee || 0), 0);
    const previousHistoryLogistics = (po.receivingHistory || []).reduce(
      (sum, entry) => sum + (entry.deliveryFee || 0),
      0
    );
    let remainingHistoryLogistics = updatedLocalLogistics;
    const cascadedReceivingHistory = (po.receivingHistory || []).map((entry, index, history) => {
      const isLast = index === history.length - 1;
      const adjustedFee = isLast
        ? remainingHistoryLogistics
        : previousHistoryLogistics > 0
        ? Math.min(remainingHistoryLogistics, Number(((entry.deliveryFee || 0) * updatedLocalLogistics / previousHistoryLogistics).toFixed(2)))
        : index === 0
        ? updatedLocalLogistics
        : 0;
      remainingHistoryLogistics = Math.max(0, remainingHistoryLogistics - adjustedFee);
      return { ...entry, deliveryFee: adjustedFee };
    });

    const updatedPO: PurchaseOrder = {
      ...po,
      ...updates,
      localLogisticsFee: updatedLocalLogistics,
      receivingHistory: cascadedReceivingHistory,
    };
    setPurchases((prev) => prev.map((p) => (p.id === poId ? updatedPO : p)));
    saveDocument('purchases', updatedPO);
    putItem('purchases', updatedPO).catch((e) => console.warn('IndexedDB purchase put error:', e));

    const oldReference = po.poNumber;
    const newReference = updatedPO.poNumber;
    const replacePOReference = (value: string | undefined) =>
      value ? value.split(oldReference).join(newReference) : value;

    // Cascade the current PO reference into stock records used by the receiving trail.
    if (oldReference !== newReference) {
      setStockMovements((prev) => prev.map((movement) => {
        const matchesPO = movement.referenceNo === oldReference || movement.notes?.includes(oldReference);
        if (!matchesPO) return movement;
        const updatedMovement: StockMovement = {
          ...movement,
          referenceNo: movement.referenceNo === oldReference ? newReference : movement.referenceNo,
          notes: replacePOReference(movement.notes),
        };
        saveDocument('stockMovements', updatedMovement);
        putItem('stockMovements', updatedMovement).catch((e) => console.warn('IndexedDB stock movement cascade error:', e));
        return updatedMovement;
      }));
    }

    // Cascade supplier, PO reference, and the edited local-logistics total into linked expense records.
    const linkedExpenseIndexes = expenses
      .map((expense, index) => ({ expense, index }))
      .filter(({ expense }) =>
        expense.category === 'Logistics' &&
        (expense.title.includes(oldReference) || expense.description?.includes(oldReference) ||
          Boolean(po.grnNumber && (expense.title.includes(po.grnNumber) || expense.description?.includes(po.grnNumber))))
      );
    const previousExpenseTotal = linkedExpenseIndexes.reduce((sum, item) => sum + item.expense.amount, 0);
    let remainingExpenseTotal = updatedLocalLogistics;

    if (linkedExpenseIndexes.length > 0) {
      const linkedIndexes = new Set(linkedExpenseIndexes.map((item) => item.index));
      setExpenses((prev) => prev.map((expense, index) => {
        if (!linkedIndexes.has(index)) return expense;
        const linkedPosition = linkedExpenseIndexes.findIndex((item) => item.index === index);
        const isLast = linkedPosition === linkedExpenseIndexes.length - 1;
        const amount = isLast
          ? remainingExpenseTotal
          : previousExpenseTotal > 0
          ? Math.min(remainingExpenseTotal, Number((expense.amount * updatedLocalLogistics / previousExpenseTotal).toFixed(2)))
          : linkedPosition === 0
          ? updatedLocalLogistics
          : 0;
        remainingExpenseTotal = Math.max(0, remainingExpenseTotal - amount);
        const updatedExpense: Expense = {
          ...expense,
          amount,
          title: replacePOReference(expense.title) || expense.title,
          description: `Local logistics for PO #${newReference}${updatedPO.grnNumber ? ` (${updatedPO.grnNumber})` : ''}. Supplier: ${updatedPO.supplierName}.`,
        };
        saveDocument('expenses', updatedExpense);
        putItem('expenses', updatedExpense).catch((e) => console.warn('IndexedDB expense cascade error:', e));
        return updatedExpense;
      }));
    }

    logAudit(
      'UPDATE_PO',
      'PurchaseOrder',
      poId,
      performedBy,
      `Updated purchase order #${oldReference} to #${newReference}. Cascaded supplier, payable, logistics, receiving history, stock references, and invoice/GRN values.`
    );
    showToast({ title: 'Purchase Order & Records Updated', message: `PO #${newReference} and its linked invoice, GRN, logistics, and receiving records were synchronized.`, type: 'info' });
  };

  const deletePurchaseOrder = (poId: string, performedBy: string = 'Administrator') => {
    const po = purchases.find((p) => p.id === poId);
    if (!po) return;

    // 1. Cascade to Inventory Stock: Revert any accepted/received stock from this PO
    po.items.forEach((item) => {
      const receivedQty =
        item.acceptedQuantity !== undefined
          ? item.acceptedQuantity
          : po.deliveryStatus === 'Received'
          ? item.quantity
          : item.receivedQuantity || 0;

      if (item.productId && receivedQty > 0) {
        adjustStock(
          item.productId,
          -receivedQty,
          'Adjustment',
          `Stock deducted due to deleted PO #${po.poNumber}${po.grnNumber ? ` (${po.grnNumber})` : ''}`,
          performedBy
        );
      }
    });

    // 2. Cascade to Expenses: Remove auto-created delivery fee / logistics expense linked to this PO
    const matchingExpenses = expenses.filter(
      (e) =>
        e.category === 'Logistics' &&
        (e.title.includes(po.poNumber) || (po.grnNumber && (e.title.includes(po.grnNumber) || e.description?.includes(po.grnNumber))))
    );
    if (matchingExpenses.length > 0) {
      const expIds = matchingExpenses.map((e) => e.id);
      setExpenses((prev) => prev.filter((e) => !expIds.includes(e.id)));
      expIds.forEach((id) => {
        removeDocument('expenses', id);
        deleteItem('expenses', id).catch(() => {});
        markIdDeleted('expenses', id);
      });
    }

    // 3. Clean up PO notifications
    setNotifications((prev) => {
      const removed = prev.filter(
        (n) => n.message.includes(po.poNumber) || (po.grnNumber && n.message.includes(po.grnNumber))
      );
      removed.forEach((n) => removeDocument('notifications', n.id));
      return prev.filter(
        (n) => !(n.message.includes(po.poNumber) || (po.grnNumber && n.message.includes(po.grnNumber)))
      );
    });

    // 4. Cascade to Supplier metrics: Reconcile outstanding debt if supplier had unpaid PO
    if (po.supplierId && po.paymentStatus !== 'Paid') {
      const unpaidOnPO = Math.max(0, po.totalAmount - (po.paidAmount || 0));
      if (unpaidOnPO > 0) {
        const sup = suppliers.find((s) => s.id === po.supplierId);
        if (sup) {
          const updatedSup: Supplier = {
            ...sup,
            outstandingBalance: Math.max(0, (sup.outstandingBalance || 0) - unpaidOnPO),
          };
          setSuppliers((prev) => prev.map((s) => (s.id === updatedSup.id ? updatedSup : s)));
          saveDocument('suppliers', updatedSup);
          putItem('suppliers', updatedSup).catch(() => {});
        }
      }
    }

    // 5. Remove PO from state and IndexedDB
    setPurchases((prev) => prev.filter((p) => p.id !== poId));
    removeDocument('purchases', poId);
    deleteItem('purchases', poId).catch((e) => console.warn('IndexedDB purchases delete error:', e));
    markIdDeleted('purchases', poId);

    // 6. Cascade to Money Movements: remove supplier payment movements for this PO
    setMoneyMovements((prev) => {
      const removed = prev.filter((m) => m.referenceId === poId);
      removed.forEach((m) => {
        removeDocument('moneyMovements', m.id);
        deleteItem('moneyMovements', m.id).catch(() => {});
        markIdDeleted('moneyMovements', m.id);
      });
      return prev.filter((m) => m.referenceId !== poId);
    });

    logAudit(
      'DELETE_PO',
      'PurchaseOrder',
      poId,
      performedBy,
      `Deleted purchase order #${po.poNumber} (${settings.currencySymbol}${po.totalAmount.toFixed(2)}). Reverted received inventory stock, reconciled supplier ledger, and removed linked logistics expense.`
    );
    showToast({
      title: 'Purchase Order Deleted & Reconciled',
      message: `PO #${po.poNumber} deleted. Inventory and linked records were automatically reconciled.`,
      type: 'error',
    });
  };

  // Expense Tracking
  const addExpense = (exp: Omit<Expense, 'id' | 'createdAt'>) => {
    const newExp: Expense = {
      ...exp,
      id: 'exp-' + Date.now(),
      createdAt: new Date().toISOString(),
    };
    setExpenses((prev) => [newExp, ...prev]);
    saveDocument('expenses', newExp);
    putItem('expenses', newExp).catch((e) => console.warn('IndexedDB expense put error:', e));

    // Auto-log Money Movement for Expense
    if (newExp.amount > 0) {
      const isCash = newExp.paymentMethod === 'Cash';
      const expMM: MoneyMovement = {
        id: generateUniqueId('mm'),
        date: newExp.date || new Date().toISOString(),
        type: 'Expense Outflow',
        subtype: newExp.category,
        sourceAccount: isCash ? 'Physical Cash' : 'Biz Account',
        amount: newExp.amount,
        referenceNo: newExp.title,
        referenceId: newExp.id,
        performedBy: newExp.paidBy,
        notes: newExp.description || `Expense: ${newExp.title}`,
        createdAt: new Date().toISOString(),
      };
      setMoneyMovements((prev) => [expMM, ...prev]);
      saveDocument('moneyMovements', expMM);
      putItem('moneyMovements', expMM).catch(() => {});
    }

    logAudit('CREATE_EXPENSE', 'Expense', newExp.id, exp.paidBy, `Logged expense: ${exp.title} (${settings.currencySymbol}${exp.amount.toFixed(2)}) under ${exp.category}.`);
    showToast({ title: 'Expense Logged', message: `Expense "${exp.title}" (${settings.currencySymbol}${exp.amount.toFixed(2)}) recorded.`, type: 'success' });
  };

  const deleteExpense = (id: string) => {
    const target = expenses.find((e) => e.id === id);
    setExpenses((prev) => prev.filter((e) => e.id !== id));
    removeDocument('expenses', id);
    deleteItem('expenses', id).catch((e) => console.warn('IndexedDB expense delete error:', e));
    markIdDeleted('expenses', id);

    // Cascade to Delivery Orders: clear expenseId if linked
    setDeliveryOrders((prev) =>
      prev.map((d) => {
        if (d.expenseId === id) {
          const updatedDel: DeliveryOrder = { ...d, expenseId: undefined };
          saveDocument('deliveryOrders', updatedDel);
          putItem('deliveryOrders', updatedDel).catch(() => {});
          return updatedDel;
        }
        return d;
      })
    );

    // Cascade to Money Movements
    setMoneyMovements((prev) => {
      const removed = prev.filter((m) => m.referenceId === id);
      removed.forEach((m) => {
        removeDocument('moneyMovements', m.id);
        deleteItem('moneyMovements', m.id).catch(() => {});
        markIdDeleted('moneyMovements', m.id);
      });
      return prev.filter((m) => m.referenceId !== id);
    });

    logAudit('DELETE_EXPENSE', 'Expense', id, 'Admin', target ? `Deleted expense "${target.title}" (${settings.currencySymbol}${target.amount.toFixed(2)}).` : `Deleted expense ${id}.`);
    showToast({ title: 'Expense Deleted', message: target ? `Expense "${target.title}" removed.` : 'Expense deleted.', type: 'error' });
  };

  // ----------------- Money Movement & Treasury -----------------
  const addMoneyMovement = (movement: Omit<MoneyMovement, 'id' | 'createdAt'>): MoneyMovement => {
    const now = new Date().toISOString();
    const newMovement: MoneyMovement = {
      ...movement,
      id: generateUniqueId('mm'),
      date: movement.date || now,
      createdAt: now,
    };
    setMoneyMovements((prev) => [newMovement, ...prev]);
    saveDocument('moneyMovements', newMovement);
    putItem('moneyMovements', newMovement).catch((e) => console.warn('IndexedDB moneyMovement put error:', e));
    return newMovement;
  };

  const deleteMoneyMovement = (id: string, performedBy = 'Administrator') => {
    const target = moneyMovements.find((m) => m.id === id);
    setMoneyMovements((prev) => prev.filter((m) => m.id !== id));
    removeDocument('moneyMovements', id);
    deleteItem('moneyMovements', id).catch((e) => console.warn('IndexedDB moneyMovement delete error:', e));
    markIdDeleted('moneyMovements', id);

    logAudit(
      'DELETE_MONEY_MOVEMENT',
      'MoneyMovement',
      id,
      performedBy,
      target
        ? `Deleted ${target.type} record for ${settings.currencySymbol}${(Number(target.amount) || 0).toFixed(2)} (${target.notes || target.subtype || ''}).`
        : `Deleted money movement record ${id}.`
    );
    showToast({ title: 'Movement Record Removed', message: 'Money movement transaction has been removed.', type: 'info' });
  };

  const setInitialLiquidBalances = (
    bizBalance: number,
    cashBalance: number,
    performedBy: string,
    notes?: string
  ) => {
    const now = new Date().toISOString();
    const currentBiz = treasuryBalances.bizAccountBalance;
    const currentCash = treasuryBalances.physicalCashBalance;

    const deltaBiz = Number((bizBalance - currentBiz).toFixed(2));
    const deltaCash = Number((cashBalance - currentCash).toFixed(2));

    const movementsToAdd: MoneyMovement[] = [];

    // Adjust Biz Account if needed
    if (deltaBiz !== 0) {
      const isIncrease = deltaBiz > 0;
      const mmBiz: MoneyMovement = {
        id: generateUniqueId('mm'),
        date: now,
        type: currentBiz === 0 && movementsToAdd.length === 0 ? 'Opening Balance' : 'Balance Adjustment',
        subtype: 'Direct Recalibration',
        destinationAccount: isIncrease ? 'Biz Account' : undefined,
        sourceAccount: !isIncrease ? 'Biz Account' : undefined,
        amount: Math.abs(deltaBiz),
        referenceNo: 'BIZ-INIT',
        performedBy,
        notes:
          notes ||
          `Set Biz Account balance to ${settings.currencySymbol}${bizBalance.toLocaleString()} (Adjustment: ${isIncrease ? '+' : '-'}${settings.currencySymbol}${Math.abs(deltaBiz).toLocaleString()})`,
        createdAt: now,
      };
      movementsToAdd.push(mmBiz);
    }

    // Adjust Physical Cash if needed
    if (deltaCash !== 0) {
      const isIncrease = deltaCash > 0;
      const mmCash: MoneyMovement = {
        id: generateUniqueId('mm'),
        date: now,
        type: currentCash === 0 && movementsToAdd.length === 0 ? 'Opening Balance' : 'Balance Adjustment',
        subtype: 'Direct Recalibration',
        destinationAccount: isIncrease ? 'Physical Cash' : undefined,
        sourceAccount: !isIncrease ? 'Physical Cash' : undefined,
        amount: Math.abs(deltaCash),
        referenceNo: 'CASH-INIT',
        performedBy,
        notes:
          notes ||
          `Set Physical Cash balance to ${settings.currencySymbol}${cashBalance.toLocaleString()} (Adjustment: ${isIncrease ? '+' : '-'}${settings.currencySymbol}${Math.abs(deltaCash).toLocaleString()})`,
        createdAt: now,
      };
      movementsToAdd.push(mmCash);
    }

    if (movementsToAdd.length > 0) {
      setMoneyMovements((prev) => [...movementsToAdd, ...prev]);
      movementsToAdd.forEach((mm) => {
        saveDocument('moneyMovements', mm);
        putItem('moneyMovements', mm).catch(() => {});
      });

      logAudit(
        'SET_LIQUID_BALANCES',
        'Treasury',
        'liquid_balances',
        performedBy,
        `Recalibrated liquid balances: Biz Account = ${settings.currencySymbol}${bizBalance.toLocaleString()}, Physical Cash = ${settings.currencySymbol}${cashBalance.toLocaleString()}. Notes: ${notes || 'Initial/Recalibrated balances'}`
      );
      showToast({
        title: 'Liquid Cash Balances Updated',
        message: `Biz Account set to ${settings.currencySymbol}${bizBalance.toLocaleString()} & Physical Cash to ${settings.currencySymbol}${cashBalance.toLocaleString()}.`,
        type: 'success',
      });
    } else {
      showToast({
        title: 'Balances Unchanged',
        message: 'Entered balances match current recorded balances exactly.',
        type: 'info',
      });
    }
  };

  const transferBetweenAccounts = (
    paramsOrFrom: TransferFundsParams | LiquidAccountType,
    argTo?: LiquidAccountType,
    argAmount?: number,
    argNotes?: string,
    argPerformedBy?: string
  ) => {
    let from: LiquidAccountType;
    let to: LiquidAccountType;
    let amount: number;
    let notes: string | undefined;
    let referenceNo: string | undefined;
    let performedBy: string;
    let date: string;
    let allowOverdraft = false;

    if (typeof paramsOrFrom === 'object' && paramsOrFrom !== null) {
      from = paramsOrFrom.fromAccount || paramsOrFrom.from || 'Physical Cash';
      to = paramsOrFrom.toAccount || paramsOrFrom.to || 'Biz Account';
      amount = Number(paramsOrFrom.amount) || 0;
      notes = paramsOrFrom.notes;
      referenceNo = paramsOrFrom.referenceNo;
      performedBy = paramsOrFrom.performedBy || 'Store Manager';
      date = paramsOrFrom.date || new Date().toISOString();
      allowOverdraft = !!paramsOrFrom.allowOverdraft;
    } else {
      from = paramsOrFrom as LiquidAccountType;
      to = argTo || 'Biz Account';
      amount = Number(argAmount) || 0;
      notes = argNotes;
      performedBy = argPerformedBy || 'Store Manager';
      date = new Date().toISOString();
    }

    if (from === to) {
      showToast({ title: 'Invalid Transfer', message: 'Source and destination accounts must be different.', type: 'error' });
      return;
    }
    if (amount <= 0 || isNaN(amount)) {
      showToast({ title: 'Invalid Amount', message: 'Transfer amount must be greater than zero.', type: 'error' });
      return;
    }

    const sourceBalance = from === 'Biz Account' ? (treasuryBalances.bizAccountBalance ?? 0) : (treasuryBalances.physicalCashBalance ?? 0);
    if (amount > sourceBalance && !allowOverdraft) {
      showToast({
        title: 'Insufficient Balance',
        message: `Cannot transfer ${settings.currencySymbol}${amount.toLocaleString()}. Available in ${from}: ${settings.currencySymbol}${sourceBalance.toLocaleString()}.`,
        type: 'error',
      });
      return;
    }

    const now = new Date().toISOString();
    const subtype = from === 'Physical Cash' && to === 'Biz Account' ? 'Till to Bank' : 'Bank to Till';
    const defaultNote =
      from === 'Physical Cash' && to === 'Biz Account'
        ? `Deposited cash from Physical Cash Till into Biz Account`
        : `Withdrew cash from Biz Account into Physical Cash Till`;

    const mm: MoneyMovement = {
      id: generateUniqueId('mm'),
      date: date || now,
      type: 'Internal Transfer',
      subtype,
      sourceAccount: from,
      destinationAccount: to,
      amount,
      referenceNo: referenceNo || `TRF-${Date.now().toString().slice(-6)}`,
      performedBy,
      notes: notes || defaultNote,
      createdAt: now,
    };

    setMoneyMovements((prev) => [mm, ...prev]);
    saveDocument('moneyMovements', mm);
    putItem('moneyMovements', mm).catch(() => {});

    logAudit(
      'TRANSFER_FUNDS',
      'Treasury',
      mm.id,
      performedBy,
      `Transferred ${settings.currencySymbol}${amount.toLocaleString()} from ${from} to ${to}. Note: ${notes || defaultNote}`
    );
    showToast({
      title: 'Transfer Completed',
      message: `Transferred ${settings.currencySymbol}${amount.toLocaleString()} from ${from} to ${to}.`,
      type: 'success',
    });
  };

  const recordOwnerWithdrawal = (
    paramsOrSource: RecordOwnerWithdrawalParams | LiquidAccountType,
    argAmount?: number,
    argSubtype?: OwnerWithdrawalSubtype,
    argNotes?: string,
    argPerformedBy?: string
  ) => {
    let sourceAccount: LiquidAccountType;
    let amount: number;
    let subtype: OwnerWithdrawalSubtype;
    let notes: string | undefined;
    let referenceNo: string | undefined;
    let performedBy: string;
    let date: string;
    let allowOverdraft = false;

    if (typeof paramsOrSource === 'object' && paramsOrSource !== null) {
      sourceAccount = paramsOrSource.sourceAccount || 'Biz Account';
      amount = Number(paramsOrSource.amount) || 0;
      subtype = paramsOrSource.subtype || 'Personal Use';
      notes = paramsOrSource.notes;
      referenceNo = paramsOrSource.referenceNo;
      performedBy = paramsOrSource.performedBy || 'Owner';
      date = paramsOrSource.date || new Date().toISOString();
      allowOverdraft = !!paramsOrSource.allowOverdraft;
    } else {
      sourceAccount = paramsOrSource as LiquidAccountType;
      amount = Number(argAmount) || 0;
      subtype = argSubtype || 'Personal Use';
      notes = argNotes;
      performedBy = argPerformedBy || 'Owner';
      date = new Date().toISOString();
    }

    if (amount <= 0 || isNaN(amount)) {
      showToast({ title: 'Invalid Amount', message: 'Withdrawal amount must be greater than zero.', type: 'error' });
      return;
    }

    const sourceBalance = sourceAccount === 'Biz Account' ? (treasuryBalances.bizAccountBalance ?? 0) : (treasuryBalances.physicalCashBalance ?? 0);
    if (amount > sourceBalance && !allowOverdraft) {
      showToast({
        title: 'Insufficient Funds',
        message: `Cannot withdraw ${settings.currencySymbol}${amount.toLocaleString()}. Available in ${sourceAccount}: ${settings.currencySymbol}${sourceBalance.toLocaleString()}.`,
        type: 'error',
      });
      return;
    }

    const now = new Date().toISOString();
    const mm: MoneyMovement = {
      id: generateUniqueId('mm'),
      date: date || now,
      type: 'Owner Drawing',
      subtype,
      sourceAccount,
      amount,
      referenceNo: referenceNo || `DRW-${Date.now().toString().slice(-6)}`,
      performedBy,
      notes: notes || `Owner withdrawal for ${subtype}`,
      createdAt: now,
    };

    setMoneyMovements((prev) => [mm, ...prev]);
    saveDocument('moneyMovements', mm);
    putItem('moneyMovements', mm).catch(() => {});

    logAudit(
      'OWNER_WITHDRAWAL',
      'Treasury',
      mm.id,
      performedBy,
      `Owner withdrew ${settings.currencySymbol}${amount.toLocaleString()} from ${sourceAccount} classified as "${subtype}". Purpose: ${notes || 'Personal/Owner drawing'}`
    );
    showToast({
      title: 'Owner Withdrawal Recorded',
      message: `Withdrew ${settings.currencySymbol}${amount.toLocaleString()} (${subtype}) from ${sourceAccount}.`,
      type: 'warning',
    });
  };

  const recordOwnerRepayment = (
    paramsOrDestination: RecordOwnerRepaymentParams | LiquidAccountType,
    argAmount?: number,
    argNotes?: string,
    argPerformedBy?: string
  ) => {
    let destinationAccount: LiquidAccountType;
    let amount: number;
    let notes: string | undefined;
    let referenceNo: string | undefined;
    let performedBy: string;
    let date: string;

    if (typeof paramsOrDestination === 'object' && paramsOrDestination !== null) {
      destinationAccount = paramsOrDestination.destinationAccount || 'Biz Account';
      amount = Number(paramsOrDestination.amount) || 0;
      notes = paramsOrDestination.notes;
      referenceNo = paramsOrDestination.referenceNo;
      performedBy = paramsOrDestination.performedBy || 'Owner';
      date = paramsOrDestination.date || new Date().toISOString();
    } else {
      destinationAccount = paramsOrDestination as LiquidAccountType;
      amount = Number(argAmount) || 0;
      notes = argNotes;
      performedBy = argPerformedBy || 'Owner';
      date = new Date().toISOString();
    }

    if (amount <= 0 || isNaN(amount)) {
      showToast({ title: 'Invalid Amount', message: 'Repayment amount must be greater than zero.', type: 'error' });
      return;
    }

    const now = new Date().toISOString();
    const mm: MoneyMovement = {
      id: generateUniqueId('mm'),
      date: date || now,
      type: 'Owner Repayment',
      subtype: 'Owner Loan Repayment',
      destinationAccount,
      amount,
      referenceNo: referenceNo || `REP-${Date.now().toString().slice(-6)}`,
      performedBy,
      notes: notes || `Owner repayment/deposit into ${destinationAccount}`,
      createdAt: now,
    };

    setMoneyMovements((prev) => [mm, ...prev]);
    saveDocument('moneyMovements', mm);
    putItem('moneyMovements', mm).catch(() => {});

    logAudit(
      'OWNER_REPAYMENT',
      'Treasury',
      mm.id,
      performedBy,
      `Owner deposited/repaid ${settings.currencySymbol}${amount.toLocaleString()} into ${destinationAccount}. Note: ${notes || 'Owner loan repayment'}`
    );
    showToast({
      title: 'Owner Repayment Recorded',
      message: `Deposited ${settings.currencySymbol}${amount.toLocaleString()} into ${destinationAccount}.`,
      type: 'success',
    });
  };

  const recalibrateLiquidBalance = (
    account: LiquidAccountType,
    newActualBalance: number,
    notes: string,
    performedBy: string
  ) => {
    const current = account === 'Biz Account' ? treasuryBalances.bizAccountBalance : treasuryBalances.physicalCashBalance;
    const delta = Number((newActualBalance - current).toFixed(2));
    if (delta === 0) {
      showToast({ title: 'Balance Verified', message: `${account} is already exactly ${settings.currencySymbol}${newActualBalance.toLocaleString()}.`, type: 'info' });
      return;
    }

    const now = new Date().toISOString();
    const isIncrease = delta > 0;
    const mm: MoneyMovement = {
      id: generateUniqueId('mm'),
      date: now,
      type: 'Balance Adjustment',
      subtype: 'Direct Recalibration',
      destinationAccount: isIncrease ? account : undefined,
      sourceAccount: !isIncrease ? account : undefined,
      amount: Math.abs(delta),
      referenceNo: `ADJ-${Date.now().toString().slice(-6)}`,
      performedBy,
      notes: notes || `Recalibrated ${account} to ${settings.currencySymbol}${newActualBalance.toLocaleString()} (Adjustment: ${isIncrease ? '+' : '-'}${settings.currencySymbol}${Math.abs(delta).toLocaleString()})`,
      createdAt: now,
    };

    setMoneyMovements((prev) => [mm, ...prev]);
    saveDocument('moneyMovements', mm);
    putItem('moneyMovements', mm).catch(() => {});

    logAudit(
      'RECALIBRATE_BALANCE',
      'Treasury',
      mm.id,
      performedBy,
      `Reconciled ${account} from ${settings.currencySymbol}${current.toLocaleString()} to ${settings.currencySymbol}${newActualBalance.toLocaleString()}. Reason: ${notes || 'Manual audit reconciliation'}`
    );
    showToast({
      title: `${account} Reconciled`,
      message: `Balance updated to ${settings.currencySymbol}${newActualBalance.toLocaleString()}.`,
      type: 'success',
    });
  };

  // WhatsApp Pre-Orders
  const addWhatsAppPreOrder = (
    poData: Omit<WhatsAppPreOrder, 'id' | 'preOrderNo' | 'createdAt' | 'updatedAt'>
  ) => {
    const nextSeq = whatsAppPreOrders.length + 1;
    const preOrderNo = `WAPO-${new Date().getFullYear()}-${String(nextSeq).padStart(3, '0')}`;
    const uniqueInvoiceNo = poData.convertedInvoiceNo || generateUniqueInvoiceNo(sales, whatsAppPreOrders);

    const newPreOrder: WhatsAppPreOrder = {
      ...poData,
      id: 'wapo-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      preOrderNo,
      convertedInvoiceNo: uniqueInvoiceNo,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setWhatsAppPreOrders((prev) => [newPreOrder, ...prev]);
    saveDocument('whatsAppPreOrders', newPreOrder);
    putItem('whatsAppPreOrders', newPreOrder).catch((e) => console.warn('IndexedDB whatsAppPreOrder put error:', e));
    logAudit(
      'CREATE_WHATSAPP_PREORDER',
      'WhatsAppPreOrder',
      newPreOrder.id,
      poData.createdBy || 'Staff',
      `Created WhatsApp Pre-Order ${preOrderNo} (Invoice #${uniqueInvoiceNo}) for ${poData.customerName} (${settings.currencySymbol}${poData.totalAmount.toFixed(2)}).`
    );
    showToast({ title: 'WhatsApp Pre-Order Saved', message: `Pre-Order #${preOrderNo} saved with Invoice #${uniqueInvoiceNo}.`, type: 'success' });
    return newPreOrder;
  };

  const updateWhatsAppPreOrderStatus = (id: string, status: PreOrderStatus, depositAmount?: number) => {
    let targetNo = 'Order';
    setWhatsAppPreOrders((prev) =>
      prev.map((po) => {
        if (po.id !== id) return po;
        targetNo = po.preOrderNo;
        const updated = {
          ...po,
          status,
          depositAmount: depositAmount !== undefined ? depositAmount : po.depositAmount,
          updatedAt: new Date().toISOString(),
        };
        saveDocument('whatsAppPreOrders', updated);
        return updated;
      })
    );
    showToast({ title: 'Pre-Order Status Updated', message: `${targetNo} marked as "${status}".`, type: 'info' });
  };

  const updateWhatsAppPreOrder = (
    id: string,
    updatedData: Partial<WhatsAppPreOrder>,
    updatedBy: string = 'Admin'
  ) => {
    let targetNo = 'Order';
    setWhatsAppPreOrders((prev) =>
      prev.map((po) => {
        if (po.id !== id) return po;
        targetNo = po.preOrderNo;
        const subtotal = updatedData.items
          ? updatedData.items.reduce((acc, item) => acc + item.total, 0)
          : po.subtotal;
        const discount = updatedData.discount !== undefined ? updatedData.discount : po.discount;
        const deliveryFee = updatedData.deliveryFee !== undefined ? updatedData.deliveryFee : (po.deliveryFee || 0);
        const totalAmount = Math.max(0, subtotal - discount + deliveryFee);

        const updated: WhatsAppPreOrder = {
          ...po,
          ...updatedData,
          subtotal,
          totalAmount,
          updatedAt: new Date().toISOString(),
        };
        saveDocument('whatsAppPreOrders', updated);
        logAudit(
          'UPDATE_WHATSAPP_PREORDER',
          'WhatsAppPreOrder',
          po.id,
          updatedBy,
          `Updated WhatsApp Pre-Order ${po.preOrderNo} for ${updated.customerName} (${settings.currencySymbol}${totalAmount.toFixed(2)}).`
        );
        return updated;
      })
    );
    showToast({ title: 'Pre-Order Updated', message: `WhatsApp Pre-Order #${targetNo} updated successfully.`, type: 'success' });
  };

  const convertPreOrderToSale = (
    preOrderId: string,
    paymentMethod: PaymentMethod,
    performedBy: string,
    notes?: string,
    attributedSalesperson?: string
  ) => {
    const preOrder = whatsAppPreOrders.find((p) => p.id === preOrderId);
    if (!preOrder) {
      showToast({ title: 'Conversion Failed', message: 'Pre-order record not found.', type: 'error' });
      throw new Error('Pre-order not found.');
    }

    if (preOrder.status === 'Completed') {
      showToast({ title: 'Already Converted', message: 'This WhatsApp pre-order has already been converted to a completed sale.', type: 'warning' });
      throw new Error('Pre-order is already completed.');
    }

    // Validate inventory stock before converting
    for (const item of preOrder.items) {
      const catProd = item.productId
        ? products.find((p) => p.id === item.productId)
        : products.find((p) => (item.sku && p.sku === item.sku) || (item.productName && p.name && p.name.toLowerCase() === item.productName.toLowerCase()));

      if (catProd) {
        const stockAvailable = Math.max(0, catProd.currentStock);
        if (stockAvailable <= 0) {
          showToast({
            title: 'Stock Exceeded',
            message: `Cannot convert pre-order #${preOrder.preOrderNo}. Product "${catProd.name}" is out of stock (0 available).`,
            type: 'error',
          });
          throw new Error(`Product ${catProd.name} is out of stock.`);
        }
        if (item.quantity > stockAvailable) {
          showToast({
            title: 'Stock Exceeded',
            message: `Cannot convert pre-order #${preOrder.preOrderNo}. Quantity for "${catProd.name}" (${item.quantity}) exceeds available stock (${stockAvailable} ${catProd.unit}).`,
            type: 'error',
          });
          throw new Error(`Quantity for ${catProd.name} exceeds available stock.`);
        }
      }
    }

    // Match or create customer
    let targetCustomer = customers.find(
      (c) =>
        (preOrder.customerPhone && c.phone && c.phone.replace(/\D/g, '') === preOrder.customerPhone.replace(/\D/g, '')) ||
        (preOrder.customerName && c.name && c.name.toLowerCase() === preOrder.customerName.toLowerCase())
    );

    if (!targetCustomer && preOrder.customerName) {
      const newCust: Customer = {
        id: 'cust-' + Date.now(),
        name: preOrder.customerName,
        phone: preOrder.customerPhone || '',
        email: '',
        address: preOrder.deliveryAddress || '',
        purchaseHistoryCount: 0,
        outstandingBalance: 0,
        loyaltyPoints: 0,
        lifetimeValue: 0,
        createdAt: new Date().toISOString(),
      };
      setCustomers((prev) => [newCust, ...prev]);
      saveDocument('customers', newCust);
      targetCustomer = newCust;
    }

    // Map pre-order items to SaleItem[]
    const saleItems: SaleItem[] = preOrder.items.map((item) => {
      const catProd = products.find(
        (p) =>
          (item.productId && p.id === item.productId) ||
          (item.sku && p.sku === item.sku) ||
          (item.productName && p.name && p.name.toLowerCase() === item.productName.toLowerCase())
      );

      return {
        productId: catProd ? catProd.id : 'prod-gen-' + Date.now(),
        productName: catProd ? catProd.name : item.productName,
        sku: catProd ? catProd.sku : item.sku || 'N/A',
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        costPrice: catProd ? catProd.costPrice : item.unitPrice * 0.6,
        total: item.total,
        isWholesale: item.isWholesale,
        useRetailPrice: item.useRetailPrice,
      };
    });

    const deliveryFee = preOrder.deliveryFee || 0;
    const orderTakenBy = preOrder.createdBy || 'WhatsApp Order Taker';
    const convertingCashier = performedBy;
    const creditedSalesperson = attributedSalesperson || performedBy;

    const combinedNotes = `Converted from WhatsApp Pre-Order ${preOrder.preOrderNo}. [Order Taken By: ${orderTakenBy} | Converted By: ${convertingCashier}]. Delivery: ${preOrder.deliveryAddress || 'N/A'}${deliveryFee > 0 ? ` (Delivery Fee: ${settings.currencySymbol}${deliveryFee.toFixed(2)})` : ''}. ${notes || ''}`;

    const taxAmt = 0; // No tax is added for WhatsApp Pre-Orders
    const targetInvoiceNo = preOrder.convertedInvoiceNo || generateUniqueInvoiceNo(sales, whatsAppPreOrders);

    const createdSale = processSale(
      saleItems,
      targetCustomer || null,
      preOrder.discount || 0,
      taxAmt,
      paymentMethod,
      preOrder.totalAmount,
      'Retail',
      creditedSalesperson,
      combinedNotes,
      undefined,
      deliveryFee,
      orderTakenBy,
      convertingCashier,
      targetInvoiceNo
    );

    // Update WhatsApp Pre-Order status to Completed
    setWhatsAppPreOrders((prev) =>
      prev.map((p) => {
        if (p.id !== preOrderId) return p;
        const updated: WhatsAppPreOrder = {
          ...p,
          status: 'Completed',
          convertedSaleId: createdSale.id,
          convertedInvoiceNo: createdSale.invoiceNo,
          updatedAt: new Date().toISOString(),
        };
        saveDocument('whatsAppPreOrders', updated);
        return updated;
      })
    );

    logAudit(
      'CONVERT_PREORDER_SALE',
      'WhatsAppPreOrder',
      preOrderId,
      performedBy,
      `Converted WhatsApp Pre-Order ${preOrder.preOrderNo} to Sale Invoice ${createdSale.invoiceNo}. Total: ${settings.currencySymbol}${createdSale.totalAmount.toFixed(2)}.`
    );
    showToast({
      title: 'Converted to Completed Sale!',
      message: `WhatsApp Pre-Order #${preOrder.preOrderNo} converted to Invoice #${createdSale.invoiceNo}. Stock updated & sales log recorded.`,
      type: 'success',
    });

    return createdSale;
  };

  const deleteWhatsAppPreOrder = (id: string) => {
    const target = whatsAppPreOrders.find((w) => w.id === id);
    setWhatsAppPreOrders((prev) => prev.filter((w) => w.id !== id));
    removeDocument('whatsAppPreOrders', id);
    deleteItem('whatsAppPreOrders', id).catch((e) => console.warn('IndexedDB whatsAppPreOrder delete error:', e));
    markIdDeleted('whatsAppPreOrders', id);
    logAudit('DELETE_WHATSAPP_PREORDER', 'WhatsAppPreOrder', id, 'Staff', target ? `Deleted pre-order "${target.preOrderNo}".` : `Deleted pre-order ${id}.`);
    showToast({ title: 'Pre-Order Deleted', message: target ? `WhatsApp Pre-Order "${target.preOrderNo}" deleted.` : 'Pre-order deleted.', type: 'error' });
  };

  // Delivery Product Orders Actions
  const addDeliveryOrder = (del: Omit<DeliveryOrder, 'id' | 'deliveryNo' | 'createdAt' | 'updatedAt'>): DeliveryOrder => {
    const now = new Date().toISOString();
    const deliveryNo = `DEL-${new Date().getFullYear()}-${Math.floor(Math.random() * 899 + 100)}`;
    const newOrder: DeliveryOrder = {
      ...del,
      id: generateUniqueId('del'),
      deliveryNo,
      createdAt: now,
      updatedAt: now,
    };
    setDeliveryOrders((prev) => [newOrder, ...prev]);
    saveDocument('deliveryOrders', newOrder);
    putItem('deliveryOrders', newOrder).catch((e) => console.warn('IndexedDB deliveryOrder put error:', e));
    return newOrder;
  };

  const confirmDeliveryPickup = (deliveryOrderId: string, performedBy: string, courierNotes?: string) => {
    const existing = deliveryOrders.find((d) => d.id === deliveryOrderId);
    if (!existing) {
      showToast({ title: 'Order Not Found', message: 'Delivery order could not be found.', type: 'error' });
      return;
    }
    if (existing.isPickupConfirmed) {
      showToast({ title: 'Already Confirmed', message: 'Delivery pickup has already been confirmed.', type: 'warning' });
      return;
    }

    const now = new Date().toISOString();

    // Automatically create a new expense record categorized under Logistics
    const expenseTitle = `Logistics Delivery Fee - ${existing.deliveryNo} (${existing.invoiceNo})`;
    const newExpense: Expense = {
      id: generateUniqueId('exp'),
      title: expenseTitle,
      category: 'Logistics',
      amount: existing.deliveryFee,
      description: `Delivery fee expense auto-created upon pickup confirmation for ${existing.customerName}. Order ${existing.deliveryNo}, Invoice ${existing.invoiceNo}.${courierNotes ? ' Courier/Notes: ' + courierNotes : ''}`,
      paidBy: performedBy,
      paymentMethod: 'Cash',
      date: now.split('T')[0],
      createdAt: now,
    };

    setExpenses((prev) => [newExpense, ...prev]);
    saveDocument('expenses', newExpense);
    putItem('expenses', newExpense).catch((e) => console.warn('IndexedDB expense put error:', e));

    const updatedDeliveryOrder: DeliveryOrder = {
      ...existing,
      status: 'Picked Up',
      isPickupConfirmed: true,
      pickupConfirmedAt: now,
      pickupConfirmedBy: performedBy,
      expenseId: newExpense.id,
      courierNotes: courierNotes || existing.courierNotes,
      updatedAt: now,
    };

    setDeliveryOrders((prev) => prev.map((d) => (d.id === deliveryOrderId ? updatedDeliveryOrder : d)));
    saveDocument('deliveryOrders', updatedDeliveryOrder);
    putItem('deliveryOrders', updatedDeliveryOrder).catch((e) => console.warn('IndexedDB deliveryOrder put error:', e));

    logAudit(
      'CONFIRM_DELIVERY_PICKUP',
      'DeliveryOrder',
      deliveryOrderId,
      performedBy,
      `Confirmed delivery pickup for ${existing.deliveryNo}. Automatically generated Logistics expense of ${settings.currencySymbol}${existing.deliveryFee.toFixed(2)}.`
    );

    showToast({
      title: 'Pickup Confirmed & Expense Logged',
      message: `Delivery ${existing.deliveryNo} marked as Picked Up. Logistics expense of ${settings.currencySymbol}${existing.deliveryFee.toFixed(2)} recorded.`,
      type: 'success',
    });
  };

  const updateDeliveryOrderStatus = (deliveryOrderId: string, newStatus: DeliveryStatus, performedBy: string = 'Staff') => {
    const existing = deliveryOrders.find((d) => d.id === deliveryOrderId);
    if (!existing) return;

    if ((newStatus === 'Picked Up' || newStatus === 'Out for Delivery' || newStatus === 'Delivered') && !existing.isPickupConfirmed) {
      confirmDeliveryPickup(deliveryOrderId, performedBy);
      if (newStatus !== 'Picked Up') {
        const now = new Date().toISOString();
        setDeliveryOrders((prev) => prev.map((d) => (d.id === deliveryOrderId ? { ...d, status: newStatus, updatedAt: now } : d)));
      }
      return;
    }

    const now = new Date().toISOString();
    const updated: DeliveryOrder = { ...existing, status: newStatus, updatedAt: now };
    setDeliveryOrders((prev) => prev.map((d) => (d.id === deliveryOrderId ? updated : d)));
    saveDocument('deliveryOrders', updated);
    putItem('deliveryOrders', updated).catch((e) => console.warn('IndexedDB deliveryOrder put error:', e));
    logAudit('UPDATE_DELIVERY_STATUS', 'DeliveryOrder', deliveryOrderId, performedBy, `Updated status of ${existing.deliveryNo} to ${newStatus}.`);
    showToast({ title: 'Delivery Status Updated', message: `Order ${existing.deliveryNo} status is now "${newStatus}".`, type: 'info' });
  };

  const updateDeliveryPickup = (
    deliveryOrderId: string,
    updates: Partial<DeliveryOrder>,
    performedBy: string = 'Aidy Mike'
  ) => {
    const existing = deliveryOrders.find((d) => d.id === deliveryOrderId);
    if (!existing) {
      showToast({ title: 'Order Not Found', message: 'Delivery order could not be found.', type: 'error' });
      return;
    }

    const now = new Date().toISOString();
    const finalFee = updates.deliveryFee !== undefined ? Math.max(0, Number(updates.deliveryFee)) : existing.deliveryFee;
    const feeDiff = finalFee - (existing.deliveryFee || 0);
    const finalIsPickupConfirmed = updates.isPickupConfirmed !== undefined ? updates.isPickupConfirmed : existing.isPickupConfirmed;
    const finalCustomerName = updates.customerName !== undefined ? updates.customerName : existing.customerName;
    const finalCustomerPhone = updates.customerPhone !== undefined ? updates.customerPhone : existing.customerPhone;
    const finalDeliveryAddress = updates.deliveryAddress !== undefined ? updates.deliveryAddress : existing.deliveryAddress;
    const finalCourierNotes = updates.courierNotes !== undefined ? updates.courierNotes : existing.courierNotes;
    const finalConfirmedBy = updates.pickupConfirmedBy || existing.pickupConfirmedBy || performedBy;
    const finalConfirmedAt = updates.pickupConfirmedAt || existing.pickupConfirmedAt || now;

    // 1. Find existing linked expense (via expenseId, or fallback match by deliveryNo / invoiceNo)
    let linkedExpense = expenses.find((e) => e.id === existing.expenseId);
    if (!linkedExpense && existing.deliveryNo) {
      linkedExpense = expenses.find(
        (e) =>
          e.category === 'Logistics' &&
          (e.title.includes(existing.deliveryNo) || (existing.invoiceNo && e.description.includes(existing.invoiceNo)))
      );
    }
    let linkedExpenseId = linkedExpense?.id || existing.expenseId;

    // 2. Synchronize auto-created Logistics Expense
    if (finalIsPickupConfirmed) {
      if (linkedExpense) {
        // Update existing linked Logistics Expense
        const updatedExp: Expense = {
          ...linkedExpense,
          title: `Logistics Delivery Fee - ${existing.deliveryNo} (${existing.invoiceNo})`,
          category: 'Logistics',
          amount: finalFee,
          description: `Delivery fee expense for ${finalCustomerName}. Order ${existing.deliveryNo}, Invoice ${existing.invoiceNo}.${finalCourierNotes ? ' Courier/Notes: ' + finalCourierNotes : ''}${finalDeliveryAddress ? ' Address: ' + finalDeliveryAddress : ''}`,
          paidBy: finalConfirmedBy,
          date: finalConfirmedAt ? finalConfirmedAt.split('T')[0] : linkedExpense.date,
        };
        linkedExpenseId = updatedExp.id;
        setExpenses((prev) => prev.map((e) => (e.id === updatedExp.id ? updatedExp : e)));
        saveDocument('expenses', updatedExp);
        putItem('expenses', updatedExp).catch((e) => console.warn('IndexedDB expense put error:', e));
      } else {
        // Create new Logistics expense record if newly marked as confirmed
        const expenseTitle = `Logistics Delivery Fee - ${existing.deliveryNo} (${existing.invoiceNo})`;
        const newExpense: Expense = {
          id: generateUniqueId('exp'),
          title: expenseTitle,
          category: 'Logistics',
          amount: finalFee,
          description: `Delivery fee expense auto-created upon pickup confirmation for ${finalCustomerName}. Order ${existing.deliveryNo}, Invoice ${existing.invoiceNo}.${finalCourierNotes ? ' Courier/Notes: ' + finalCourierNotes : ''}${finalDeliveryAddress ? ' Address: ' + finalDeliveryAddress : ''}`,
          paidBy: finalConfirmedBy,
          paymentMethod: 'Cash',
          date: finalConfirmedAt ? finalConfirmedAt.split('T')[0] : now.split('T')[0],
          createdAt: finalConfirmedAt || now,
        };
        linkedExpenseId = newExpense.id;
        setExpenses((prev) => [newExpense, ...prev]);
        saveDocument('expenses', newExpense);
        putItem('expenses', newExpense).catch((e) => console.warn('IndexedDB expense put error:', e));
      }
    } else if (!finalIsPickupConfirmed && linkedExpenseId) {
      // If pickup confirmation is explicitly reset/reverted, clean up the linked expense
      const idToRemove = linkedExpenseId;
      setExpenses((prev) => prev.filter((e) => e.id !== idToRemove));
      removeDocument('expenses', idToRemove);
      deleteItem('expenses', idToRemove).catch((e) => console.warn('IndexedDB expense delete error:', e));
      markIdDeleted('expenses', idToRemove);
      linkedExpenseId = undefined;
    }

    // 3. Synchronize linked Sale record
    const linkedSale = sales.find((s) => s.id === existing.saleId || (existing.invoiceNo && s.invoiceNo === existing.invoiceNo));
    if (linkedSale) {
      const calculatedNewTotal = Math.max(
        0,
        (linkedSale.subtotal || 0) - (linkedSale.discount || 0) + (linkedSale.tax || 0) + finalFee
      );
      
      const wasFullyPaid = linkedSale.paidAmount >= linkedSale.totalAmount;
      const updatedPaidAmount = wasFullyPaid ? calculatedNewTotal : Math.min(linkedSale.paidAmount, calculatedNewTotal);

      const updatedSale: Sale = {
        ...linkedSale,
        deliveryFee: finalFee,
        totalAmount: calculatedNewTotal,
        paidAmount: updatedPaidAmount,
        customerName: finalCustomerName || linkedSale.customerName,
      };

      setSales((prev) => prev.map((s) => (s.id === updatedSale.id ? updatedSale : s)));
      saveDocument('sales', updatedSale);
      putItem('sales', updatedSale).catch((e) => console.warn('IndexedDB sale put error:', e));
    }

    // 4. Synchronize linked Customer record (lifetime value, phone, address)
    const targetCustomerId = existing.customerId || linkedSale?.customerId;
    if (targetCustomerId) {
      const targetCustomer = customers.find((c) => c.id === targetCustomerId);
      if (targetCustomer) {
        const updatedCustomer: Customer = {
          ...targetCustomer,
          name: finalCustomerName || targetCustomer.name,
          phone: finalCustomerPhone || targetCustomer.phone,
          address: finalDeliveryAddress || targetCustomer.address,
          lifetimeValue: Math.max(0, (targetCustomer.lifetimeValue || 0) + feeDiff),
        };
        setCustomers((prev) => prev.map((c) => (c.id === updatedCustomer.id ? updatedCustomer : c)));
        saveDocument('customers', updatedCustomer);
        putItem('customers', updatedCustomer).catch((e) => console.warn('IndexedDB customer put error:', e));
      }
    }

    // 5. Synchronize linked WhatsApp Pre-Order (if applicable)
    const linkedPreOrder = whatsAppPreOrders.find(
      (po) =>
        (linkedSale && po.convertedSaleId === linkedSale.id) ||
        (existing.invoiceNo && po.convertedInvoiceNo === existing.invoiceNo)
    );
    if (linkedPreOrder) {
      const updatedPreOrderTotal = Math.max(
        0,
        (linkedPreOrder.subtotal || 0) - (linkedPreOrder.discount || 0) + finalFee
      );
      const updatedPreOrder: WhatsAppPreOrder = {
        ...linkedPreOrder,
        deliveryFee: finalFee,
        totalAmount: updatedPreOrderTotal,
        customerName: finalCustomerName || linkedPreOrder.customerName,
        customerPhone: finalCustomerPhone || linkedPreOrder.customerPhone,
        deliveryAddress: finalDeliveryAddress || linkedPreOrder.deliveryAddress,
        updatedAt: now,
      };
      setWhatsAppPreOrders((prev) => prev.map((po) => (po.id === updatedPreOrder.id ? updatedPreOrder : po)));
      saveDocument('whatsAppPreOrders', updatedPreOrder);
      putItem('whatsAppPreOrders', updatedPreOrder).catch((e) => console.warn('IndexedDB whatsAppPreOrder put error:', e));
    }

    // 6. Update Delivery Order record
    const updatedDeliveryOrder: DeliveryOrder = {
      ...existing,
      ...updates,
      customerName: finalCustomerName,
      customerPhone: finalCustomerPhone,
      deliveryAddress: finalDeliveryAddress,
      courierNotes: finalCourierNotes,
      deliveryFee: finalFee,
      isPickupConfirmed: finalIsPickupConfirmed,
      pickupConfirmedBy: finalIsPickupConfirmed ? finalConfirmedBy : undefined,
      pickupConfirmedAt: finalIsPickupConfirmed ? finalConfirmedAt : undefined,
      expenseId: linkedExpenseId,
      updatedAt: now,
    };

    setDeliveryOrders((prev) => prev.map((d) => (d.id === deliveryOrderId ? updatedDeliveryOrder : d)));
    saveDocument('deliveryOrders', updatedDeliveryOrder);
    putItem('deliveryOrders', updatedDeliveryOrder).catch((e) => console.warn('IndexedDB deliveryOrder put error:', e));

    logAudit(
      'UPDATE_DELIVERY_PICKUP',
      'DeliveryOrder',
      deliveryOrderId,
      performedBy,
      `Super-Admin edited delivery & pickup record for ${existing.deliveryNo} (${existing.invoiceNo}). Synchronized changes across Logistics Expense, Sale Invoice ${existing.invoiceNo}, Customer, and WhatsApp Pre-Orders. Fee: ${settings.currencySymbol}${finalFee.toFixed(2)}, Status: ${updatedDeliveryOrder.status}, Confirmed: ${finalIsPickupConfirmed ? 'Yes' : 'No'}.`
    );

    showToast({
      title: 'Delivery Pickup & Related Records Updated',
      message: `Order "${existing.deliveryNo}" and its linked expense, sales invoice, and customer records have been synchronized successfully.`,
      type: 'success',
    });
  };

  const deleteDeliveryOrder = (id: string, performedBy: string = 'Aidy Mike') => {
    const target = deliveryOrders.find((d) => d.id === id);
    setDeliveryOrders((prev) => prev.filter((d) => d.id !== id));
    removeDocument('deliveryOrders', id);
    deleteItem('deliveryOrders', id).catch((e) => console.warn('IndexedDB deliveryOrder delete error:', e));
    markIdDeleted('deliveryOrders', id);

    if (target) {
      // If there was an auto-created expense linked to this delivery order, clean it up as well
      let linkedExpId = target.expenseId;
      if (!linkedExpId && target.deliveryNo) {
        const found = expenses.find(
          (e) =>
            e.category === 'Logistics' &&
            (e.title.includes(target.deliveryNo) || (target.invoiceNo && e.description.includes(target.invoiceNo)))
        );
        if (found) linkedExpId = found.id;
      }
      if (linkedExpId) {
        setExpenses((prev) => prev.filter((e) => e.id !== linkedExpId));
        removeDocument('expenses', linkedExpId);
        deleteItem('expenses', linkedExpId).catch((e) => console.warn('IndexedDB expense delete error:', e));
        markIdDeleted('expenses', linkedExpId);
      }

      logAudit(
        'DELETE_DELIVERY_ORDER',
        'DeliveryOrder',
        id,
        performedBy,
        `Deleted delivery record ${target.deliveryNo} (${target.invoiceNo}) for customer ${target.customerName}${linkedExpId ? ' and cleaned up linked Logistics expense.' : '.'}`
      );
    }
    showToast({
      title: 'Delivery Record Deleted',
      message: target ? `Delivery record "${target.deliveryNo}" was permanently deleted.` : 'Delivery order deleted.',
      type: 'info',
    });
  };

  // Notifications
  const addNotification = (notif: Omit<NotificationItem, 'id' | 'read' | 'createdAt'>) => {
    const newNotif: NotificationItem = {
      ...notif,
      id: 'notif-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
      read: false,
      createdAt: new Date().toISOString(),
    };
    setNotifications((prev) => [newNotif, ...prev]);
    saveDocument('notifications', newNotif);
  };

  const markNotificationRead = (id: string) => {
    setNotifications((prev) => {
      const updated = prev.map((n) => (n.id === id ? { ...n, read: true } : n));
      const target = updated.find((n) => n.id === id);
      if (target) {
        saveDocument('notifications', target);
      }
      return updated;
    });
  };

  const deleteNotification = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    removeDocument('notifications', id);
    deleteItem('notifications', id).catch(() => {});
    markIdDeleted('notifications', id);
  };

  const clearNotifications = () => {
    notifications.forEach((n) => {
      removeDocument('notifications', n.id).catch(() => {});
      deleteItem('notifications', n.id).catch(() => {});
      markIdDeleted('notifications', n.id);
    });
    setNotifications([]);
    localStorage.removeItem('idofera_notifications');
    clearStore('notifications').catch((e) => console.warn('IndexedDB clear notifications error:', e));
    showToast({ title: 'Notifications Cleared', message: 'All alert notifications cleared.', type: 'info' });
  };

  // Settings
  const updateSettings = (newSettings: Partial<StoreSettings>) => {
    setSettings((prev) => {
      const updated = sanitizeStoreSettings({ ...prev, ...newSettings });
      saveDocument('settings', { ...updated, id: 'store_settings' });
      return updated;
    });
    showToast({ title: 'Settings Saved', message: 'Store preferences updated successfully.', type: 'success' });
  };

  const orderedLists = useMemo(() => ({
    products: sortRecordsLifo(products),
    customers: sortRecordsLifo(customers),
    suppliers: sortRecordsLifo(suppliers),
    sales: sortRecordsLifo(sales),
    purchases: sortRecordsLifo(purchases),
    expenses: sortRecordsLifo(expenses),
    notifications: sortRecordsLifo(notifications),
    auditLogs: sortRecordsLifo(auditLogs),
    stockMovements: sortRecordsLifo(stockMovements),
    pricingHistory: sortRecordsLifo(pricingHistory),
    heldOrders: sortRecordsLifo(heldOrders),
    whatsAppPreOrders: sortRecordsLifo(whatsAppPreOrders),
    deliveryOrders: sortRecordsLifo(deliveryOrders),
    moneyMovements: sortRecordsLifo(moneyMovements),
  }), [products, customers, suppliers, sales, purchases, expenses, notifications, auditLogs, stockMovements, pricingHistory, heldOrders, whatsAppPreOrders, deliveryOrders, moneyMovements]);

  return (
    <AppContext.Provider
      value={{
        products: orderedLists.products,
        customers: orderedLists.customers,
        suppliers: orderedLists.suppliers,
        sales: orderedLists.sales,
        purchases: orderedLists.purchases,
        expenses: orderedLists.expenses,
        notifications: orderedLists.notifications,
        auditLogs: orderedLists.auditLogs,
        stockMovements: orderedLists.stockMovements,
        pricingHistory: orderedLists.pricingHistory,
        settings,
        heldOrders: orderedLists.heldOrders,
        moneyMovements: orderedLists.moneyMovements,
        treasuryBalances,
        addMoneyMovement,
        deleteMoneyMovement,
        setInitialLiquidBalances,
        transferBetweenAccounts,
        recordOwnerWithdrawal,
        recordOwnerRepayment,
        recalibrateLiquidBalance,
        addProduct,
        updateProduct,
        deleteProduct,
        archiveProduct,
        unarchiveProduct,
        deduplicateProductsBySku,
        bulkImportProducts,
        bulkImportCustomers,
        bulkImportSuppliers,
        bulkImportSales,
        bulkImportWhatsAppPreOrders,
        changeProductPrice,
        adjustStock,
        processSale,
        generateUniqueInvoiceNo,
        holdOrder,
        restoreHeldOrder,
        deleteHeldOrder,
        deleteHeldOrderItem,
        clearAllHeldOrders,
        refundSale,
        updateSale,
        deleteSale,
        reconcileHistoricalDeliveryExpenses,
        purgeHistoricalMoneyMovements,
        addCustomer,
        updateCustomer,
        updateCustomerBalance,
        deleteCustomer,
        addSupplier,
        updateSupplier,
        deleteSupplier,
        addPurchaseOrder,
        receivePurchaseOrder,
        receiveAndInspectPO,
        updatePOPayment,
        updatePurchaseOrder,
        deletePurchaseOrder,
        addExpense,
        deleteExpense,
        whatsAppPreOrders: orderedLists.whatsAppPreOrders,
        addWhatsAppPreOrder,
        updateWhatsAppPreOrderStatus,
        updateWhatsAppPreOrder,
        convertPreOrderToSale,
        deleteWhatsAppPreOrder,
        deliveryOrders: orderedLists.deliveryOrders,
        addDeliveryOrder,
        confirmDeliveryPickup,
        updateDeliveryOrderStatus,
        updateDeliveryPickup,
        deleteDeliveryOrder,
        addNotification,
        markNotificationRead,
        deleteNotification,
        clearNotifications,
        updateSettings,
        pullFromD1,
        logAudit,
        clearAuditLogs,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
};
