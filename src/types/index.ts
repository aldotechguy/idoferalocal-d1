export type UserRole = 'Administrator' | 'Sales Staff' | 'Accountant' | 'Store Manager';

export interface UserProfile {
  id: string;
  email: string;
  username?: string;
  displayName: string;
  role: UserRole;
  avatarUrl?: string;
  status: 'Active' | 'Inactive';
  createdAt: string;
  lastLogin?: string;
  password?: string;
  passwordLastChanged?: string;
  isProtected?: boolean;
  isSuperAdmin?: boolean;
}

export type ProductStatus = 'Active' | 'Low Stock' | 'Out of Stock' | 'Archived';

export interface Product {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  qrCode?: string;
  category: string;
  brand: string;
  supplierId: string;
  supplierName: string;
  description: string;
  images: string[];
  costPrice: number;
  retailPrice: number;
  wholesalePrice: number;
  minWholesaleQty: number;
  dealerPrice?: number;
  promotionalPrice?: number;
  minimumSellingPrice: number;
  currentStock: number;
  minimumStockLevel: number;
  unit: string; // e.g. 'pcs', 'kg', 'box', 'pack', 'set'
  expiryDate?: string;
  status: ProductStatus;
  /** Phase 5 — mall listing. */
  isMallListed?: boolean;
  mallPrice?: number;
  /** Mall-specific storefront copy; falls back to `description` when blank. */
  mallDescription?: string;
  /** Merchandising: promoted position, manual ordering, and optional promo window. */
  mallFeatured?: boolean;
  mallDisplayOrder?: number;
  mallPromoPrice?: number;
  mallPromoStart?: string;
  mallPromoEnd?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PricingHistory {
  id: string;
  productId: string;
  productName: string;
  oldPrice: number;
  newPrice: number;
  priceType: 'Retail' | 'Wholesale' | 'Dealer' | 'Promotional';
  changedBy: string;
  reason: string;
  createdAt: string;
}

export type MovementType =
  | 'Opening Stock'
  | 'Incoming'
  | 'Outgoing'
  | 'Adjustment'
  | 'Damaged'
  | 'Returned'
  | 'Lost'
  | 'Transfer';

export interface StockMovement {
  id: string;
  productId: string;
  productName: string;
  type: MovementType;
  quantity: number;
  previousStock: number;
  newStock: number;
  referenceNo?: string;
  notes?: string;
  performedBy: string;
  createdAt: string;
}

export interface SaleItem {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  costPrice: number;
  total: number;
  isWholesale?: boolean;
  useRetailPrice?: boolean;
  isClearance?: boolean;
  clearanceDescription?: string;
}

export type PaymentMethod = 'Cash' | 'Card' | 'Mobile Transfer' | 'Bank Transfer' | 'Store Credit' | 'Split';
export type SaleStatus = 'Completed' | 'Draft' | 'Held' | 'Refunded';

export interface Sale {
  id: string;
  invoiceNo: string;
  customerId?: string;
  customerName: string;
  type: 'Retail' | 'Wholesale';
  items: SaleItem[];
  subtotal: number;
  discount: number;
  tax: number;
  deliveryFee?: number;
  totalAmount: number;
  paidAmount: number;
  paymentMethod: PaymentMethod;
  paymentBreakdown?: Record<string, number>;
  status: SaleStatus;
  notes?: string;
  createdBy: string;
  orderTakenBy?: string;
  convertedBy?: string;
  createdAt: string;
  isHistorical?: boolean;
  expenseId?: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  address?: string;
  purchaseHistoryCount: number;
  outstandingBalance: number;
  loyaltyPoints: number;
  lifetimeValue: number;
  createdAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  address?: string;
  paymentTerms: string;
  productsCount: number;
  outstandingBalance: number;
  createdAt: string;
}

export interface ReceivingHistoryEntry {
  id: string;
  grnNumber: string;
  receivedAt: string;
  receivedBy: string;
  notes?: string;
  deliveryFee?: number;
  itemsReceived: {
    productId: string;
    productName: string;
    receivingQty: number;
    acceptedQty: number;
    damagedQty: number;
    unitCost: number;
    oldUnitCost?: number;
    customRetailPrice?: number;
    oldRetailPrice?: number;
    conditionNotes?: string;
  }[];
}

export interface PurchaseItem {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitCost: number;
  oldUnitCost?: number;
  customRetailPrice?: number;
  oldRetailPrice?: number;
  total: number;
  receivedQuantity?: number;
  acceptedQuantity?: number;
  damagedQuantity?: number;
  lastInspectedAt?: string;
  lastInspectionNotes?: string;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  items: PurchaseItem[];
  deliveryFee?: number;
  localLogisticsFee?: number;
  totalAmount: number;
  paidAmount: number;
  paymentStatus: 'Paid' | 'Partial' | 'Overdue' | 'Unpaid';
  deliveryStatus: 'Received' | 'Partial' | 'Pending' | 'Cancelled' | 'Draft';
  expectedDelivery: string;
  createdBy: string;
  createdAt: string;
  inspectionStatus?: 'Pending' | 'Passed' | 'Passed with Exceptions' | 'Failed';
  inspectedBy?: string;
  inspectedAt?: string;
  inspectionNotes?: string;
  grnNumber?: string;
  receivingHistory?: ReceivingHistoryEntry[];
  notes?: string;
  updatedAt?: string;
  isDraft?: boolean;
  quotationNotes?: string;
  supplierConfirmedAt?: string;
}

export interface PriceAdjustmentItem {
  productId: string;
  productName: string;
  sku: string;
  oldCost: number;
  newCost: number;
  oldRetail: number;
  newRetail: number;
  oldWholesale: number;
  newWholesale: number;
}

export type ExpenseCategory =
  | 'Rent'
  | 'Salaries'
  | 'Electricity'
  | 'Fuel'
  | 'Marketing'
  | 'Repairs'
  | 'Lunch'
  | 'Logistics'
  | 'Miscellaneous';

export interface Expense {
  id: string;
  title: string;
  category: ExpenseCategory;
  amount: number;
  description?: string;
  paidBy: string;
  paymentMethod: PaymentMethod;
  receiptUrl?: string;
  date: string;
  createdAt: string;
  isHistorical?: boolean;
  saleId?: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: 'low_stock' | 'expiry' | 'customer_balance' | 'supplier_overdue' | 'daily_report' | 'price_increase_alert' | 'price_change';
  read: boolean;
  link?: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  action: string;
  entity: string;
  entityId?: string;
  performedBy: string;
  details: string;
  createdAt: string;
}

export type WhatsAppSalesAttributionRule = 'converter' | 'creator' | 'custom';

export interface StoreSettings {
  storeName: string;
  phone: string;
  email: string;
  address: string;
  currencySymbol: string;
  currencyCode: string;
  taxRatePct: number;
  defaultMinWholesaleQty: number;
  receiptHeader: string;
  receiptFooter: string;
  enableLoyaltyProgram: boolean;
  pointsPerDollar: number;
  loyaltyPointValue: number;
  whatsAppSalesAttributionRule?: WhatsAppSalesAttributionRule;
}

export type PreOrderStatus =
  | 'Pending Review'
  | 'Confirmed'
  | 'Deposit Paid'
  | 'Processing'
  | 'Completed'
  | 'Cancelled';

export interface PreOrderItem {
  productId?: string;
  productName: string;
  sku?: string;
  quantity: number;
  unitPrice: number;
  total: number;
  isWholesale?: boolean;
  useRetailPrice?: boolean;
}

export interface WhatsAppPreOrder {
  id: string;
  preOrderNo: string;
  customerId?: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress?: string;
  notes?: string;
  rawWhatsAppMessage?: string;
  items: PreOrderItem[];
  subtotal: number;
  discount: number;
  deliveryFee?: number;
  depositAmount: number;
  totalAmount: number;
  status: PreOrderStatus;
  convertedSaleId?: string;
  convertedInvoiceNo?: string;
  expectedDeliveryDate?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type DeliveryStatus = 'Pending Pickup' | 'Picked Up' | 'Out for Delivery' | 'Delivered' | 'Cancelled';

export interface DeliveryOrder {
  id: string;
  deliveryNo: string;
  saleId: string;
  invoiceNo: string;
  customerId?: string;
  customerName: string;
  customerPhone?: string;
  deliveryAddress?: string;
  items: SaleItem[];
  deliveryFee: number;
  status: DeliveryStatus;
  isPickupConfirmed: boolean;
  pickupConfirmedAt?: string;
  pickupConfirmedBy?: string;
  expenseId?: string;
  courierNotes?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConflictingField {
  field: string;
  label: string;
  localValue: any;
  cloudValue: any;
}

export interface SyncConflict {
  id: string;
  storeName: string;
  itemName: string;
  localItem: Record<string, any>;
  cloudItem: Record<string, any>;
  conflictingFields: ConflictingField[];
  detectedAt: string;
}

// ---------------- Money Movement & Treasury Types ----------------
export type LiquidAccountType = 'Biz Account' | 'Physical Cash';

export type MoneyMovementType =
  | 'Opening Balance'
  | 'Balance Adjustment'
  | 'Sale Inflow'
  | 'Sale Refund'
  | 'Expense Outflow'
  | 'Supplier Payment'
  | 'Customer Debt Payment'
  | 'Internal Transfer'
  | 'Owner Drawing'
  | 'Owner Repayment';

export type OwnerWithdrawalSubtype =
  | 'Personal Use'
  | 'Owner Loan'
  | 'Profit / Dividend'
  | 'Interest Withdrawal';

export interface RecordOwnerWithdrawalParams {
  sourceAccount: LiquidAccountType;
  amount: number;
  subtype?: OwnerWithdrawalSubtype;
  notes?: string;
  referenceNo?: string;
  performedBy?: string;
  date?: string;
  allowOverdraft?: boolean;
}

export interface RecordOwnerRepaymentParams {
  destinationAccount: LiquidAccountType;
  amount: number;
  notes?: string;
  referenceNo?: string;
  performedBy?: string;
  date?: string;
}

export interface TransferFundsParams {
  fromAccount?: LiquidAccountType;
  from?: LiquidAccountType;
  toAccount?: LiquidAccountType;
  to?: LiquidAccountType;
  amount: number;
  notes?: string;
  referenceNo?: string;
  performedBy?: string;
  date?: string;
  allowOverdraft?: boolean;
}

export interface MoneyMovement {
  id: string;
  date: string; // ISO string
  type: MoneyMovementType;
  subtype?: OwnerWithdrawalSubtype | 'Till to Bank' | 'Bank to Till' | 'Direct Recalibration' | string;
  sourceAccount?: LiquidAccountType;
  destinationAccount?: LiquidAccountType;
  amount: number;
  notes?: string;
  referenceNo?: string;
  referenceId?: string; // e.g. saleId, expenseId, poId, customerId
  performedBy: string;
  createdAt: string;
}

export interface TreasuryBalances {
  bizAccountBalance: number;
  physicalCashBalance: number;
  totalLiquidCash: number;
  totalOwnerDrawings: number;
  totalOwnerLoans: number;
}

export * from './mall';
