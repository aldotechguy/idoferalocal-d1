import {index, integer, primaryKey, sqliteTable, text} from 'drizzle-orm/sqlite-core';

export const appDocuments = sqliteTable(
  'app_documents',
  {
    ownerId: text('owner_id').notNull(),
    collection: text('collection').notNull(),
    documentId: text('document_id').notNull(),
    payload: text('payload').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    primaryKey({columns: [table.ownerId, table.collection, table.documentId]}),
    index('idx_app_documents_owner_collection').on(table.ownerId, table.collection),
  ],
);

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  username: text('username').unique(),
  displayName: text('display_name').notNull(),
  role: text('role').notNull(),
  status: text('status').notNull().default('Active'),
  avatarUrl: text('avatar_url'),
  passwordHash: text('password_hash').notNull(),
  passwordSalt: text('password_salt').notNull(),
  passwordIterations: integer('password_iterations').notNull().default(100000),
  isSuperAdmin: integer('is_super_admin').notNull().default(0),
  isProtected: integer('is_protected').notNull().default(0),
  createdAt: text('created_at').notNull(),
  lastLogin: text('last_login'),
  passwordLastChanged: text('password_last_changed'),
});

export const appSessions = sqliteTable(
  'app_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('idx_app_sessions_user_expiry').on(t.userId, t.expiresAt)],
);

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  parentId: text('parent_id'),
  imageUrl: text('image_url'),
});

export const suppliers = sqliteTable('suppliers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  contactPerson: text('contact_person').notNull().default(''),
  email: text('email').notNull().default(''),
  phone: text('phone').notNull().default(''),
  address: text('address'),
  paymentTerms: text('payment_terms').notNull().default('Due on Receipt'),
  productsCount: integer('products_count').notNull().default(0),
  openingBalanceKobo: integer('opening_balance_kobo').notNull().default(0),
  outstandingBalanceKobo: integer('outstanding_balance_kobo').notNull().default(0),
  createdAt: text('created_at').notNull(),
});
export const syncRevisions = sqliteTable('sync_revisions', {
  ownerId: text('owner_id').primaryKey(),
  revision: integer('revision').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const products = sqliteTable(
  'products',
  {
    id: text('id').primaryKey(),
    sku: text('sku').notNull().unique(),
    barcode: text('barcode').notNull().default(''),
    qrCode: text('qr_code'),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    categoryId: text('category_id'),
    categoryName: text('category_name').notNull().default(''),
    brand: text('brand').notNull().default(''),
    supplierId: text('supplier_id'),
    supplierName: text('supplier_name').notNull().default(''),
    imagesJson: text('images_json').notNull().default('[]'),
    costPriceKobo: integer('cost_price_kobo').notNull().default(0),
    retailPriceKobo: integer('retail_price_kobo').notNull().default(0),
    wholesalePriceKobo: integer('wholesale_price_kobo').notNull().default(0),
    minWholesaleQty: integer('min_wholesale_qty').notNull().default(1),
    dealerPriceKobo: integer('dealer_price_kobo'),
    promoPriceKobo: integer('promo_price_kobo'),
    minSellingPriceKobo: integer('min_selling_price_kobo').notNull().default(0),
    stockQty: integer('stock_qty').notNull().default(0),
    lowStockThreshold: integer('low_stock_threshold').notNull().default(5),
    unit: text('unit').notNull().default('pcs'),
    expiryDate: text('expiry_date'),
    status: text('status').notNull().default('Active'),
    isMallListed: integer('is_mall_listed').notNull().default(0),
    mallPriceKobo: integer('mall_price_kobo'),
    mallDescription: text('mall_description'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    index('idx_products_category').on(t.categoryId),
    index('idx_products_supplier').on(t.supplierId),
    index('idx_products_mall').on(t.isMallListed, t.stockQty),
  ],
);

export const productVariants = sqliteTable(
  'product_variants',
  {
    id: text('id').primaryKey(),
    productId: text('product_id').notNull(),
    name: text('name').notNull(),
    sku: text('sku').notNull().default(''),
    priceDeltaKobo: integer('price_delta_kobo').notNull().default(0),
    stockQty: integer('stock_qty').notNull().default(0),
  },
  (t) => [index('idx_variants_product').on(t.productId)],
);

export const customers = sqliteTable(
  'customers',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    phone: text('phone').notNull().default(''),
    email: text('email').notNull().default(''),
    address: text('address'),
    purchaseHistoryCount: integer('purchase_history_count').notNull().default(0),
    outstandingBalanceKobo: integer('outstanding_balance_kobo').notNull().default(0),
    loyaltyPoints: integer('loyalty_points').notNull().default(0),
    lifetimeValueKobo: integer('lifetime_value_kobo').notNull().default(0),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('idx_customers_phone').on(t.phone)],
);
export const sales = sqliteTable(
  'sales',
  {
    id: text('id').primaryKey(),
    receiptNo: text('receipt_no').notNull().unique(),
    customerId: text('customer_id'),
    customerName: text('customer_name').notNull().default(''),
    type: text('type').notNull().default('Retail'),
    subtotalKobo: integer('subtotal_kobo').notNull().default(0),
    discountKobo: integer('discount_kobo').notNull().default(0),
    taxKobo: integer('tax_kobo').notNull().default(0),
    deliveryFeeKobo: integer('delivery_fee_kobo').notNull().default(0),
    totalKobo: integer('total_kobo').notNull().default(0),
    paidKobo: integer('paid_kobo').notNull().default(0),
    paymentMethod: text('payment_method').notNull().default('Cash'),
    paymentBreakdownJson: text('payment_breakdown_json'),
    status: text('status').notNull().default('Completed'),
    notes: text('notes'),
    createdBy: text('created_by').notNull().default(''),
    orderTakenBy: text('order_taken_by'),
    isHistorical: integer('is_historical').notNull().default(0),
    expenseId: text('expense_id'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('idx_sales_created').on(t.createdAt), index('idx_sales_customer').on(t.customerId)],
);

export const saleItems = sqliteTable(
  'sale_items',
  {
    id: text('id').primaryKey(),
    saleId: text('sale_id').notNull(),
    productId: text('product_id'),
    productName: text('product_name').notNull().default(''),
    sku: text('sku').notNull().default(''),
    qty: integer('qty').notNull().default(0),
    unitPriceKobo: integer('unit_price_kobo').notNull().default(0),
    costPriceKobo: integer('cost_price_kobo').notNull().default(0),
    totalKobo: integer('total_kobo').notNull().default(0),
    isWholesale: integer('is_wholesale').notNull().default(0),
    isClearance: integer('is_clearance').notNull().default(0),
  },
  (t) => [index('idx_sale_items_sale').on(t.saleId)],
);

export const purchases = sqliteTable(
  'purchases',
  {
    id: text('id').primaryKey(),
    poNumber: text('po_number').notNull().unique(),
    supplierId: text('supplier_id'),
    supplierName: text('supplier_name').notNull().default(''),
    deliveryFeeKobo: integer('delivery_fee_kobo').notNull().default(0),
    logisticsFeeKobo: integer('logistics_fee_kobo').notNull().default(0),
    totalKobo: integer('total_kobo').notNull().default(0),
    paidKobo: integer('paid_kobo').notNull().default(0),
    paymentStatus: text('payment_status').notNull().default('Unpaid'),
    deliveryStatus: text('delivery_status').notNull().default('Pending'),
    expectedDelivery: text('expected_delivery').notNull().default(''),
    createdBy: text('created_by').notNull().default(''),
    notes: text('notes'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
  },
  (t) => [index('idx_purchases_supplier').on(t.supplierId)],
);

export const purchaseItems = sqliteTable(
  'purchase_items',
  {
    id: text('id').primaryKey(),
    purchaseId: text('purchase_id').notNull(),
    productId: text('product_id'),
    productName: text('product_name').notNull().default(''),
    sku: text('sku').notNull().default(''),
    qty: integer('qty').notNull().default(0),
    unitCostKobo: integer('unit_cost_kobo').notNull().default(0),
    totalKobo: integer('total_kobo').notNull().default(0),
    receivedQty: integer('received_qty').notNull().default(0),
    acceptedQty: integer('accepted_qty').notNull().default(0),
    damagedQty: integer('damaged_qty').notNull().default(0),
  },
  (t) => [index('idx_purchase_items_po').on(t.purchaseId)],
);

export const expenses = sqliteTable(
  'expenses',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    category: text('category').notNull().default('Miscellaneous'),
    amountKobo: integer('amount_kobo').notNull().default(0),
    description: text('description'),
    spentBy: text('spent_by').notNull().default(''),
    paymentMethod: text('payment_method').notNull().default('Cash'),
    receiptUrl: text('receipt_url'),
    date: text('date').notNull(),
    isHistorical: integer('is_historical').notNull().default(0),
    saleId: text('sale_id'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('idx_expenses_date').on(t.date)],
);

export const stockMovements = sqliteTable(
  'stock_movements',
  {
    id: text('id').primaryKey(),
    productId: text('product_id'),
    productName: text('product_name').notNull().default(''),
    type: text('type').notNull(),
    qty: integer('qty').notNull().default(0),
    prevStock: integer('prev_stock').notNull().default(0),
    newStock: integer('new_stock').notNull().default(0),
    refId: text('ref_id'),
    notes: text('notes'),
    performedBy: text('performed_by').notNull().default(''),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('idx_stock_product_time').on(t.productId, t.createdAt)],
);

export const pricingHistory = sqliteTable(
  'pricing_history',
  {
    id: text('id').primaryKey(),
    productId: text('product_id'),
    productName: text('product_name').notNull().default(''),
    oldPriceKobo: integer('old_price_kobo').notNull().default(0),
    newPriceKobo: integer('new_price_kobo').notNull().default(0),
    priceType: text('price_type').notNull().default('Retail'),
    changedBy: text('changed_by').notNull().default(''),
    reason: text('reason').notNull().default(''),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('idx_pricing_product').on(t.productId)],
);

export const moneyMovements = sqliteTable(
  'money_movements',
  {
    id: text('id').primaryKey(),
    date: text('date').notNull(),
    type: text('type').notNull(),
    subtype: text('subtype'),
    sourceAccount: text('source_account'),
    destAccount: text('dest_account'),
    amountKobo: integer('amount_kobo').notNull().default(0),
    notes: text('notes'),
    refNo: text('ref_no'),
    refId: text('ref_id'),
    performedBy: text('performed_by').notNull().default(''),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('idx_money_date').on(t.date)],
);

export const deliveryOrders = sqliteTable('delivery_orders', {
  id: text('id').primaryKey(),
  deliveryNo: text('delivery_no').notNull().unique(),
  saleId: text('sale_id'),
  invoiceNo: text('invoice_no').notNull().default(''),
  customerId: text('customer_id'),
  customerName: text('customer_name').notNull().default(''),
  customerPhone: text('customer_phone'),
  deliveryAddress: text('delivery_address'),
  itemsJson: text('items_json').notNull().default('[]'),
  deliveryFeeKobo: integer('delivery_fee_kobo').notNull().default(0),
  status: text('status').notNull().default('Pending Pickup'),
  isPickupConfirmed: integer('is_pickup_confirmed').notNull().default(0),
  courierNotes: text('courier_notes'),
  notes: text('notes'),
  createdBy: text('created_by').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
});

export const heldOrders = sqliteTable('held_orders', {
  id: text('id').primaryKey(),
  cartJson: text('cart_json').notNull(),
  heldBy: text('held_by').notNull().default(''),
  createdAt: text('created_at').notNull(),
});

export const whatsappPreorders = sqliteTable('whatsapp_preorders', {
  id: text('id').primaryKey(),
  preorderNo: text('preorder_no').notNull().unique(),
  customerId: text('customer_id'),
  customerName: text('customer_name').notNull().default(''),
  customerPhone: text('customer_phone').notNull().default(''),
  deliveryAddress: text('delivery_address'),
  notes: text('notes'),
  itemsJson: text('items_json').notNull().default('[]'),
  subtotalKobo: integer('subtotal_kobo').notNull().default(0),
  discountKobo: integer('discount_kobo').notNull().default(0),
  deliveryFeeKobo: integer('delivery_fee_kobo').notNull().default(0),
  depositKobo: integer('deposit_kobo').notNull().default(0),
  totalKobo: integer('total_kobo').notNull().default(0),
  status: text('status').notNull().default('Pending Review'),
  convertedSaleId: text('converted_sale_id'),
  createdBy: text('created_by').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
});

export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  type: text('type').notNull(),
  isRead: integer('is_read').notNull().default(0),
  link: text('link'),
  createdAt: text('created_at').notNull(),
});

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id').notNull().default(''),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    details: text('details').notNull().default(''),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('idx_audit_time').on(t.createdAt)],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const mallCarts = sqliteTable('mall_carts', {
  id: text('id').primaryKey(),
  customerId: text('customer_id'),
  sessionId: text('session_id'),
  status: text('status').notNull().default('active'),
  updatedAt: integer('updated_at').notNull(),
});

export const mallCartItems = sqliteTable(
  'mall_cart_items',
  {
    id: text('id').primaryKey(),
    cartId: text('cart_id').notNull(),
    productId: text('product_id'),
    variantId: text('variant_id'),
    qty: integer('qty').notNull().default(0),
    unitPriceKobo: integer('unit_price_kobo').notNull().default(0),
  },
  (t) => [index('idx_cart_items_cart').on(t.cartId)],
);

export const mallOrders = sqliteTable(
  'mall_orders',
  {
    id: text('id').primaryKey(),
    orderNo: text('order_no').notNull().unique(),
    customerId: text('customer_id'),
    customerName: text('customer_name').notNull().default(''),
    customerPhone: text('customer_phone'),
    customerEmail: text('customer_email'),
    status: text('status').notNull().default('pending'),
    subtotalKobo: integer('subtotal_kobo').notNull().default(0),
    deliveryFeeKobo: integer('delivery_fee_kobo').notNull().default(0),
    discountKobo: integer('discount_kobo').notNull().default(0),
    totalKobo: integer('total_kobo').notNull().default(0),
    paymentRef: text('payment_ref'),
    deliveryAddressJson: text('delivery_address_json'),
    linkedSaleId: text('linked_sale_id'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('idx_mall_orders_status_time').on(t.status, t.createdAt)],
);

export const mallOrderItems = sqliteTable(
  'mall_order_items',
  {
    id: text('id').primaryKey(),
    mallOrderId: text('mall_order_id').notNull(),
    productId: text('product_id'),
    productName: text('product_name').notNull().default(''),
    qty: integer('qty').notNull().default(0),
    unitPriceKobo: integer('unit_price_kobo').notNull().default(0),
    totalKobo: integer('total_kobo').notNull().default(0),
  },
  (t) => [index('idx_mall_order_items_order').on(t.mallOrderId)],
);

export const payments = sqliteTable(
  'payments',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id'),
    saleId: text('sale_id'),
    provider: text('provider').notNull().default('cash'),
    reference: text('reference').notNull().unique(),
    amountKobo: integer('amount_kobo').notNull().default(0),
    status: text('status').notNull().default('pending'),
    rawJson: text('raw_json'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('idx_payments_order').on(t.orderId)],
);

export const reviews = sqliteTable(
  'reviews',
  {
    id: text('id').primaryKey(),
    productId: text('product_id'),
    customerId: text('customer_id'),
    rating: integer('rating').notNull().default(5),
    comment: text('comment'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('idx_reviews_product').on(t.productId)],
);

export const receivingHistory = sqliteTable(
  'receiving_history',
  {
    id: text('id').primaryKey(),
    purchaseId: text('purchase_id').notNull(),
    grnNumber: text('grn_number').notNull().default(''),
    receivedBy: text('received_by').notNull().default(''),
    notes: text('notes'),
    itemsJson: text('items_json').notNull().default('[]'),
    receivedAt: text('received_at').notNull(),
  },
  (t) => [index('idx_receiving_po').on(t.purchaseId)],
);



