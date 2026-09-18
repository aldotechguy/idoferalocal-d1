/**
 * Phase 4 — money helpers + row->frontend mappers (part 1/3).
 * Shared by server.ts (node:sqlite) and sites-worker.ts (D1).
 * Frontend contract (src/types) is UNCHANGED.
 */
export type Snapshot = Record<string, any[]>;
export type QueryAll = (sql: string, params?: any[]) => Promise<any[]>;

export const NairaToKobo = (n: unknown): number => {
  const v = typeof n === 'number' ? n : typeof n === 'string' ? Number(n) : 0;
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100);
};
export const KoboToNaira = (k: unknown): number => {
  const v = typeof k === 'number' ? k : Number(k);
  if (!Number.isFinite(v)) return 0;
  return v / 100;
};
export const s = (v: unknown, fb = ''): string => (v === null || v === undefined ? fb : String(v));
export const n = (v: unknown, fb = 0): number => {
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : fb;
};
export const b01 = (v: unknown): number => (v === true || v === 1 || v === 'true' ? 1 : 0);
export const b = (v: unknown): boolean => v === 1 || v === true || v === 'true';
export function slugifyName(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'uncategorized';
}
export function parseJsonArray(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * Settings documents were occasionally stored as nested wrappers (`{"0": {...}}`)
 * by old sync builds. The ETL and every write path must unwrap identically, so
 * this lives in the shared mapper (scripts/etl/lib.ts re-exports it).
 */
export function unwrapSettings(payload: any): any {
  let cur = payload;
  for (let i = 0; i < 25 && cur && typeof cur === 'object'; i++) {
    if (typeof cur.storeName === 'string') return cur;
    if (cur['0'] && typeof cur['0'] === 'object') { cur = cur['0']; continue; }
    break;
  }
  return null;
}

export function productRow(r: any) {
  return {
    id: r.id, name: r.name, sku: r.sku, barcode: r.barcode || '', qrCode: r.qr_code || undefined,
    category: r.category_name || '', brand: r.brand || '',
    supplierId: r.supplier_id || '', supplierName: r.supplier_name || '',
    description: r.description || '', images: parseJsonArray(r.images_json),
    costPrice: KoboToNaira(r.cost_price_kobo), retailPrice: KoboToNaira(r.retail_price_kobo),
    wholesalePrice: KoboToNaira(r.wholesale_price_kobo), minWholesaleQty: n(r.min_wholesale_qty, 1),
    dealerPrice: r.dealer_price_kobo != null ? KoboToNaira(r.dealer_price_kobo) : undefined,
    promotionalPrice: r.promo_price_kobo != null ? KoboToNaira(r.promo_price_kobo) : undefined,
    minimumSellingPrice: KoboToNaira(r.min_selling_price_kobo),
    currentStock: n(r.stock_qty), minimumStockLevel: n(r.low_stock_threshold, 5),
    unit: r.unit || 'pcs', expiryDate: r.expiry_date || undefined, status: r.status || 'Active',
    isMallListed: n(r.is_mall_listed) === 1,
    mallPrice: r.mall_price_kobo != null ? KoboToNaira(r.mall_price_kobo) : undefined,
    mallDescription: r.mall_description || undefined,
    mallFeatured: n(r.mall_featured) === 1,
    mallDisplayOrder: r.mall_display_order != null ? n(r.mall_display_order) : undefined,
    mallPromoPrice: r.mall_promo_price_kobo != null ? KoboToNaira(r.mall_promo_price_kobo) : undefined,
    mallPromoStart: r.mall_promo_start || undefined,
    mallPromoEnd: r.mall_promo_end || undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
export function customerRow(r: any) {
  return {
    id: r.id, name: r.name, phone: r.phone || '', email: r.email || '', address: r.address || undefined,
    purchaseHistoryCount: n(r.purchase_history_count), outstandingBalance: KoboToNaira(r.outstanding_balance_kobo),
    loyaltyPoints: n(r.loyalty_points), lifetimeValue: KoboToNaira(r.lifetime_value_kobo), createdAt: r.created_at,
  };
}
export function supplierRow(r: any) {
  return {
    id: r.id, name: r.name, contactPerson: r.contact_person || '', email: r.email || '',
    phone: r.phone || '', address: r.address || undefined,
    paymentTerms: r.payment_terms || 'Due on Receipt', productsCount: n(r.products_count),
    outstandingBalance: KoboToNaira(r.outstanding_balance_kobo), createdAt: r.created_at,
  };
}
export function saleRow(r: any, itemsBySale: Map<string, any[]>) {
  const items = (itemsBySale.get(String(r.id)) || []).map((it) => ({
    productId: it.product_id, productName: it.product_name, sku: it.sku,
    quantity: n(it.qty), unitPrice: KoboToNaira(it.unit_price_kobo),
    costPrice: KoboToNaira(it.cost_price_kobo), total: KoboToNaira(it.total_kobo),
    isWholesale: b(it.is_wholesale) || undefined, isClearance: b(it.is_clearance) || undefined,
  }));
  return {
    id: r.id, invoiceNo: r.receipt_no, customerId: r.customer_id || undefined,
    customerName: r.customer_name || '', type: r.type || 'Retail', items,
    subtotal: KoboToNaira(r.subtotal_kobo), discount: KoboToNaira(r.discount_kobo),
    tax: KoboToNaira(r.tax_kobo), deliveryFee: KoboToNaira(r.delivery_fee_kobo),
    totalAmount: KoboToNaira(r.total_kobo), paidAmount: KoboToNaira(r.paid_kobo),
    paymentMethod: r.payment_method || 'Cash',
    paymentBreakdown: r.payment_breakdown_json ? JSON.parse(r.payment_breakdown_json) : undefined,
    status: r.status || 'Completed', notes: r.notes || undefined,
    createdBy: r.created_by || '', orderTakenBy: r.order_taken_by || undefined,
    isHistorical: b(r.is_historical) || undefined,
    expenseId: r.expense_id || undefined, createdAt: r.created_at,
  };
}
export function purchaseRow(r: any, itemsByPo: Map<string, any[]>, recvByPo: Map<string, any[]>) {
  const items = (itemsByPo.get(String(r.id)) || []).map((it) => ({
    productId: it.product_id, productName: it.product_name, sku: it.sku,
    quantity: n(it.qty), unitCost: KoboToNaira(it.unit_cost_kobo), total: KoboToNaira(it.total_kobo),
    receivedQuantity: n(it.received_qty), acceptedQuantity: n(it.accepted_qty), damagedQuantity: n(it.damaged_qty),
  }));
  const receivingHistory = (recvByPo.get(String(r.id)) || []).map((g) => ({
    id: g.id, grnNumber: g.grn_number, receivedAt: g.received_at, receivedBy: g.received_by,
    notes: g.notes || undefined, itemsReceived: parseJsonArray(g.items_json),
  }));
  return {
    id: r.id, poNumber: r.po_number, supplierId: r.supplier_id || '', supplierName: r.supplier_name || '',
    items, deliveryFee: KoboToNaira(r.delivery_fee_kobo), localLogisticsFee: KoboToNaira(r.logistics_fee_kobo),
    totalAmount: KoboToNaira(r.total_kobo), paidAmount: KoboToNaira(r.paid_kobo),
    paymentStatus: r.payment_status || 'Unpaid', deliveryStatus: r.delivery_status || 'Pending',
    expectedDelivery: r.expected_delivery || '', createdBy: r.created_by || '',
    createdAt: r.created_at, updatedAt: r.updated_at || undefined,
    receivingHistory: receivingHistory.length ? receivingHistory : undefined,
  };
}

export const IMAGE_CAP = 8;
/**
 * Relational image policy — storage-safe, applied identically by the ETL and by
 * every runtime write path (node server + edge worker).
 *
 * WHY: legacy documents hold product photos as `data:` base64 URLs — 9.2 MB across
 * 11 products, the largest 772 KB. D1 rejects such statements (`SQLITE_TOOBIG`) and
 * base64 would bloat every snapshot push, so it never belongs in relational tables.
 *
 * - `cleanImageList` -> real image URLs only (https:// or /path). Mall-ready.
 * - base64 originals -> extracted ONCE to backups/images/ + manifest.json by
 *   `scripts/etl/extract-images.ts`, to be re-pointed at R2 in Phase 4.5 BEFORE
 *   cutover, so no product photo is lost.
 */
export function cleanImageList(images: unknown): string[] {
  if (!Array.isArray(images)) return [];
  return (images as unknown[])
    .filter((u) => typeof u === 'string' && String(u).trim().length > 0)
    .filter((u) => !String(u).startsWith('data:'))
    .slice(0, IMAGE_CAP) as string[];
}

/** Every image string a document carried, base64 included (used by the extraction job). */
export function rawImageList(images: unknown): string[] {
  if (!Array.isArray(images)) return [];
  return (images as unknown[]).filter((u) => typeof u === 'string' && String(u).trim().length > 0) as string[];
}

/** How many base64 photos were dropped from relational storage for a document. */
export function base64ImageCount(images: unknown): number {
  return rawImageList(images).filter((u) => u.startsWith('data:')).length;
}
export function imageUrlList(images: unknown): string[] {
  return cleanImageList(images).filter((u) => /^(https?:)?\/\//i.test(u) || u.startsWith('/'));
}
export function productToRow(p: any, now: string) {
  const catName = s(p.category, '').trim() || 'Uncategorized';
  const images = cleanImageList(p.images);
  return {
    id: s(p.id), sku: s(p.sku || p.id), barcode: s(p.barcode), qr_code: p.qrCode ? s(p.qrCode) : null,
    name: s(p.name, 'Unnamed Product'), description: s(p.description),
    category_id: `cat-${slugifyName(catName)}`, category_name: catName, brand: s(p.brand, 'Unbranded'),
    supplier_id: p.supplierId ? s(p.supplierId) : null, supplier_name: s(p.supplierName, 'General Supplier'),
    images_json: JSON.stringify(images),
    cost_price_kobo: NairaToKobo(p.costPrice), retail_price_kobo: NairaToKobo(p.retailPrice),
    wholesale_price_kobo: NairaToKobo(p.wholesalePrice), min_wholesale_qty: n(p.minWholesaleQty, 1),
    dealer_price_kobo: p.dealerPrice != null ? NairaToKobo(p.dealerPrice) : null,
    promo_price_kobo: p.promotionalPrice != null ? NairaToKobo(p.promotionalPrice) : null,
    min_selling_price_kobo: NairaToKobo(p.minimumSellingPrice),
    stock_qty: n(p.currentStock), low_stock_threshold: n(p.minimumStockLevel, 5),
    unit: s(p.unit, 'pcs'), expiry_date: p.expiryDate ? s(p.expiryDate) : null,
    status: s(p.status, 'Active'), is_mall_listed: b01(p.isMallListed),
    mall_price_kobo: p.mallPrice != null ? NairaToKobo(p.mallPrice) : null,
    mall_description: s(p.mallDescription) || null,
    mall_featured: p.mallFeatured ? 1 : 0,
    mall_display_order: p.mallDisplayOrder != null && Number.isFinite(Number(p.mallDisplayOrder)) ? Math.trunc(Number(p.mallDisplayOrder)) : null,
    mall_promo_price_kobo: p.mallPromoPrice != null ? NairaToKobo(p.mallPromoPrice) : null,
    mall_promo_start: p.mallPromoStart ? s(p.mallPromoStart) : null,
    mall_promo_end: p.mallPromoEnd ? s(p.mallPromoEnd) : null,
    created_at: s(p.createdAt, now), updated_at: s(p.updatedAt, now),
  };
}
export function customerToRow(c: any, now: string) {
  return {
    id: s(c.id), name: s(c.name, 'Walk-in Customer'), phone: s(c.phone), email: s(c.email),
    address: c.address ? s(c.address) : null, purchase_history_count: n(c.purchaseHistoryCount),
    outstanding_balance_kobo: NairaToKobo(c.outstandingBalance), loyalty_points: n(c.loyaltyPoints),
    lifetime_value_kobo: NairaToKobo(c.lifetimeValue), created_at: s(c.createdAt, now),
  };
}
export function supplierToRow(sp: any, now: string) {
  return {
    id: s(sp.id), name: s(sp.name, 'Unknown Supplier'), contact_person: s(sp.contactPerson),
    email: s(sp.email), phone: s(sp.phone), address: sp.address ? s(sp.address) : null,
    payment_terms: s(sp.paymentTerms, 'Due on Receipt'), products_count: n(sp.productsCount),
    opening_balance_kobo: 0, outstanding_balance_kobo: NairaToKobo(sp.outstandingBalance),
    created_at: s(sp.createdAt, now),
  };
}
export function expenseToRow(e: any, now: string) {
  return {
    id: s(e.id), title: s(e.title, 'Expense'), category: s(e.category, 'Miscellaneous'),
    amount_kobo: NairaToKobo(e.amount), description: e.description ? s(e.description) : null,
    spent_by: s(e.paidBy), payment_method: s(e.paymentMethod, 'Cash'),
    receipt_url: e.receiptUrl ? s(e.receiptUrl) : null, date: s(e.date, now),
    is_historical: b01(e.isHistorical), sale_id: e.saleId ? s(e.saleId) : null,
    created_at: s(e.createdAt, now),
  };
}
export function stockMovementToRow(m: any, now: string) {
  return {
    id: s(m.id), product_id: m.productId ? s(m.productId) : null, product_name: s(m.productName),
    type: s(m.type, 'Adjustment'), qty: n(m.quantity),
    prev_stock: n(m.previousStock), new_stock: n(m.newStock),
    ref_id: m.referenceNo ? s(m.referenceNo) : null, notes: m.notes ? s(m.notes) : null,
    performed_by: s(m.performedBy), created_at: s(m.createdAt, now),
  };
}
export function pricingToRow(ph: any, now: string) {
  return {
    id: s(ph.id), product_id: ph.productId ? s(ph.productId) : null, product_name: s(ph.productName),
    old_price_kobo: NairaToKobo(ph.oldPrice), new_price_kobo: NairaToKobo(ph.newPrice),
    price_type: s(ph.priceType, 'Retail'), changed_by: s(ph.changedBy), reason: s(ph.reason),
    created_at: s(ph.createdAt, now),
  };
}
export function moneyToRow(m: any, now: string) {
  return {
    id: s(m.id), date: s(m.date, now), type: s(m.type, 'Balance Adjustment'),
    subtype: m.subtype ? s(m.subtype) : null,
    source_account: m.sourceAccount ? s(m.sourceAccount) : null,
    dest_account: m.destinationAccount ? s(m.destinationAccount) : null,
    amount_kobo: NairaToKobo(m.amount), notes: m.notes ? s(m.notes) : null,
    ref_no: m.referenceNo ? s(m.referenceNo) : null, ref_id: m.referenceId ? s(m.referenceId) : null,
    performed_by: s(m.performedBy), created_at: s(m.createdAt, now),
  };
}
export function saleToRows(doc: any) {
  const id = s(doc.id);
  const now = s(doc.createdAt, new Date().toISOString());
  const header = {
    id, receipt_no: s(doc.invoiceNo || id), customer_id: doc.customerId ? s(doc.customerId) : null,
    customer_name: s(doc.customerName), type: s(doc.type, 'Retail'),
    subtotal_kobo: NairaToKobo(doc.subtotal), discount_kobo: NairaToKobo(doc.discount),
    tax_kobo: NairaToKobo(doc.tax), delivery_fee_kobo: NairaToKobo(doc.deliveryFee),
    total_kobo: NairaToKobo(doc.totalAmount), paid_kobo: NairaToKobo(doc.paidAmount),
    payment_method: s(doc.paymentMethod, 'Cash'),
    payment_breakdown_json: doc.paymentBreakdown ? JSON.stringify(doc.paymentBreakdown) : null,
    status: s(doc.status, 'Completed'), notes: doc.notes ? s(doc.notes) : null,
    created_by: s(doc.createdBy), order_taken_by: doc.orderTakenBy ? s(doc.orderTakenBy) : null,
    is_historical: b01(doc.isHistorical), expense_id: doc.expenseId ? s(doc.expenseId) : null,
    created_at: now,
  };
  const lines = (Array.isArray(doc.items) ? doc.items : []).map((it: any, i: number) => ({
    id: `${id}-item-${i}`, sale_id: id, product_id: it.productId ? s(it.productId) : null,
    product_name: s(it.productName), sku: s(it.sku), qty: n(it.quantity),
    unit_price_kobo: NairaToKobo(it.unitPrice), cost_price_kobo: NairaToKobo(it.costPrice),
    total_kobo: NairaToKobo(it.total),
    is_wholesale: b01(it.isWholesale), is_clearance: b01(it.isClearance),
  }));
  return { header, lines };
}
export function purchaseToRows(doc: any) {
  const id = s(doc.id);
  const now = s(doc.createdAt, new Date().toISOString());
  const header = {
    id, po_number: s(doc.poNumber || id), supplier_id: doc.supplierId ? s(doc.supplierId) : null,
    supplier_name: s(doc.supplierName), delivery_fee_kobo: NairaToKobo(doc.deliveryFee),
    logistics_fee_kobo: NairaToKobo(doc.localLogisticsFee),
    total_kobo: NairaToKobo(doc.totalAmount), paid_kobo: NairaToKobo(doc.paidAmount),
    payment_status: s(doc.paymentStatus, 'Unpaid'), delivery_status: s(doc.deliveryStatus, 'Pending'),
    expected_delivery: s(doc.expectedDelivery), created_by: s(doc.createdBy),
    notes: doc.notes ? s(doc.notes) : null, created_at: now,
    updated_at: doc.updatedAt ? s(doc.updatedAt) : null,
  };
  const lines = (Array.isArray(doc.items) ? doc.items : []).map((it: any, i: number) => ({
    id: `${id}-item-${i}`, purchase_id: id, product_id: it.productId ? s(it.productId) : null,
    product_name: s(it.productName), sku: s(it.sku), qty: n(it.quantity),
    unit_cost_kobo: NairaToKobo(it.unitCost), total_kobo: NairaToKobo(it.total),
    received_qty: n(it.receivedQuantity), accepted_qty: n(it.acceptedQuantity), damaged_qty: n(it.damagedQuantity),
  }));
  const receipts = (Array.isArray(doc.receivingHistory) ? doc.receivingHistory : []).map((r: any, i: number) => ({
    id: s(r.id || `${id}-grn-${i}`), purchase_id: id, grn_number: s(r.grnNumber),
    received_by: s(r.receivedBy), notes: r.notes ? s(r.notes) : null,
    items_json: JSON.stringify(r.itemsReceived || []), received_at: s(r.receivedAt, now),
  }));
  return { header, lines, receipts };
}
