/**
 * initialData.ts
 *
 * Seed / fallback constants used by AppContext when no persisted data
 * is found in IndexedDB, Firestore, or Cloudflare D1.
 *
 * All collection constants are intentionally empty arrays — real data
 * is loaded from the storage layer at runtime.  INITIAL_SETTINGS provides
 * the shape/defaults that sanitizeStoreSettings() overlays with the
 * store-specific values defined in AppContext.
 */

import type {
  Product,
  Customer,
  Supplier,
  Sale,
  PurchaseOrder,
  Expense,
  NotificationItem,
  AuditLog,
  StockMovement,
  PricingHistory,
  StoreSettings,
  WhatsAppPreOrder,
  DeliveryOrder,
  MoneyMovement,
} from '../types';

// ── Collections (empty — populated from storage at boot) ────────────────────

export const INITIAL_PRODUCTS: Product[] = [];
export const INITIAL_CUSTOMERS: Customer[] = [];
export const INITIAL_SUPPLIERS: Supplier[] = [];
export const INITIAL_SALES: Sale[] = [];
export const INITIAL_PURCHASES: PurchaseOrder[] = [];
export const INITIAL_EXPENSES: Expense[] = [];
export const INITIAL_NOTIFICATIONS: NotificationItem[] = [];
export const INITIAL_AUDIT_LOGS: AuditLog[] = [];
export const INITIAL_STOCK_MOVEMENTS: StockMovement[] = [];
export const INITIAL_PRICING_HISTORY: PricingHistory[] = [];
export const INITIAL_WHATSAPP_PREORDERS: WhatsAppPreOrder[] = [];
export const INITIAL_DELIVERY_ORDERS: DeliveryOrder[] = [];
export const INITIAL_MONEY_MOVEMENTS: MoneyMovement[] = [];

// ── Default store settings ──────────────────────────────────────────────────
// Note: sanitizeStoreSettings() in AppContext will override these with the
// store-specific values (name, address, phone, etc.) after merging.

export const INITIAL_SETTINGS: StoreSettings = {
  storeName: 'Idofera Packaging',
  phone: '+234 806 376 6861',
  email: '',
  address: '16 Atakpo Street, off Nwaniba Road, Uyo',
  currencySymbol: '\u20a6',
  currencyCode: 'NGN',
  taxRatePct: 0,
  defaultMinWholesaleQty: 25,
  receiptHeader: 'Thank you for shopping at Idofera Packaging!',
  receiptFooter:
    'Goods sold in good condition are subject to standard return policy within 2 working days.',
  enableLoyaltyProgram: false,
  pointsPerDollar: 0.01,
  loyaltyPointValue: 0.5,
  whatsAppSalesAttributionRule: 'converter',
};
