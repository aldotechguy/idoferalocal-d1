/** Phase 4 — snapshot builder: raw table rows -> frontend D1Snapshot (part 4/4). */
import { KoboToNaira, n, b, parseJsonArray } from './relationalMapper.js';
import { productRow, customerRow, supplierRow, saleRow, purchaseRow } from './relationalMapper.js';
import type { QueryAll, Snapshot } from './relationalMapper.js';

/**
 * Row caps for append-only history collections. Sales, stock movements and
 * audit entries grow without limit as the shop runs, and a full snapshot read
 * (first sync or repair) previously scanned each one end to end. Each capped
 * collection keeps its NEWEST rows (the queries already order newest-first).
 * The client merge is an upsert by id, so rows a cap omits are never deleted
 * from an existing device; a fresh device simply starts with the newest slice.
 * Child tables (sale_items, purchase_items, receiving_history) stay uncapped:
 * they are scoped to the parents actually fetched, so capping them independently
 * could only orphan line items.
 *
 * A cap is only worth anything WITH a matching index on the ORDER BY column:
 * `ORDER BY created_at DESC LIMIT n` on an unindexed column scans and sorts the
 * whole table, so it reads every row and then throws most of them away. The
 * indexes are declared in mallSafety.MALL_SAFETY_DDL.
 */
export const SNAPSHOT_ROW_CAPS: Record<string, number> = {
  audit_logs: 1500,
  notifications: 500,
  pricing_history: 2000,
  stock_movements: 5000,
  money_movements: 5000,
  expenses: 5000,
  delivery_orders: 5000,
  whatsapp_preorders: 2000,
  held_orders: 1000,
  // Sales and purchases were passed to qCapped() but had no entry here, so the
  // cap silently did nothing and every sale line ever recorded was read and
  // sorted on each full snapshot. Their children are scoped to the fetched
  // parents, so bounding the parents is what keeps that scoping correct.
  sales: 5000,
  purchases: 5000,
};

/**
 * A repair push rewrites every supplied document twice (document mirror +
 * relational rows). Reject runaway payloads before any write; the normal write
 * path is PATCH micro-batches, and a healthy store is ~1,600 documents.
 */
export const SNAPSHOT_PUSH_DOC_LIMIT = 20_000;

export type BoundedSnapshot = { stores: Snapshot; capped: string[] };

export async function buildSnapshot(q: QueryAll): Promise<BoundedSnapshot> {
  const capped = new Set<string>();
  // Applies the per-collection cap and records collections that REACHED it
  // (rows may exist beyond the cap on the server).
  const qCapped = (sql: string, table: string) => {
    const cap = SNAPSHOT_ROW_CAPS[table];
    return q(cap ? `${sql} LIMIT ${cap}` : sql).then((rows) => {
      if (cap && rows.length >= cap) capped.add(table);
      return rows;
    });
  };
  // Fetch capped parent rows FIRST so we can scope child-table reads to
  // only those parents. Without this, sale_items/purchase_items/receiving_history
  // scanned their full tables even though only the capped parents' children
  // were ever used — the largest read-amplification in the app on busy stores.
  const [productRows, customerRows, supplierRows, saleRows, purchaseRows] = await Promise.all([
    q('SELECT * FROM products ORDER BY updated_at DESC'),
    q('SELECT * FROM customers ORDER BY created_at DESC'),
    q('SELECT * FROM suppliers ORDER BY created_at DESC'),
    qCapped('SELECT * FROM sales ORDER BY created_at DESC', 'sales'),
    qCapped('SELECT * FROM purchases ORDER BY created_at DESC', 'purchases'),
  ]);
  // Collect parent IDs to scope child reads. The comment in SNAPSHOT_ROW_CAPS
  // says capping child tables independently could orphan line items — the fix is
  // the opposite: load only children of the parents we actually fetched.
  const saleIds = saleRows.map(r => r.id);
  const purchaseIds = purchaseRows.map(r => r.id);
  const saleIdJson = saleIds.length ? JSON.stringify(saleIds) : '[]';
  const purchaseIdJson = purchaseIds.length ? JSON.stringify(purchaseIds) : '[]';
  const [saleItemRows, purchaseItemRows, recvRows, expenseRows, stockRows, pricingRows, moneyRows, deliveryRows, heldRows, wapoRows, notifRows, auditRows, settingsRows] = await Promise.all([
    // Only load sale_items belonging to the (capped) fetched sales. With no
    // parents there is nothing to attach them to, so the old unconditional
    // `SELECT * FROM sale_items` full-table read answered nothing either.
    saleIds.length
      ? q(`SELECT * FROM sale_items WHERE sale_id IN (SELECT value FROM json_each(?))`, [saleIdJson])
      : Promise.resolve([]),
    // Same for purchase_items and receiving_history — receiving_history used to
    // be read end to end on EVERY snapshot regardless of the parents fetched.
    purchaseIds.length
      ? q(`SELECT * FROM purchase_items WHERE purchase_id IN (SELECT value FROM json_each(?))`, [purchaseIdJson])
      : Promise.resolve([]),
    purchaseIds.length
      ? q(`SELECT * FROM receiving_history WHERE purchase_id IN (SELECT value FROM json_each(?))`, [purchaseIdJson])
      : Promise.resolve([]),
    qCapped('SELECT * FROM expenses ORDER BY date DESC', 'expenses'),
    qCapped('SELECT * FROM stock_movements ORDER BY created_at DESC', 'stock_movements'),
    qCapped('SELECT * FROM pricing_history ORDER BY created_at DESC', 'pricing_history'),
    qCapped('SELECT * FROM money_movements ORDER BY date DESC', 'money_movements'),
    qCapped('SELECT * FROM delivery_orders ORDER BY created_at DESC', 'delivery_orders'),
    qCapped('SELECT * FROM held_orders ORDER BY created_at DESC', 'held_orders'),
    qCapped('SELECT * FROM whatsapp_preorders ORDER BY created_at DESC', 'whatsapp_preorders'),
    qCapped('SELECT * FROM notifications ORDER BY created_at DESC', 'notifications'),
    qCapped('SELECT * FROM audit_logs ORDER BY created_at DESC', 'audit_logs'),
    q('SELECT * FROM settings'),
  ]);
  const itemsBySale = new Map<string, any[]>();
  for (const it of saleItemRows) {
    const k = String((it as any).sale_id);
    if (!itemsBySale.has(k)) itemsBySale.set(k, []);
    itemsBySale.get(k)!.push(it);
  }
  const itemsByPo = new Map<string, any[]>();
  for (const it of purchaseItemRows) {
    const k = String((it as any).purchase_id);
    if (!itemsByPo.has(k)) itemsByPo.set(k, []);
    itemsByPo.get(k)!.push(it);
  }
  const recvByPo = new Map<string, any[]>();
  for (const g of recvRows) {
    const k = String((g as any).purchase_id);
    if (!recvByPo.has(k)) recvByPo.set(k, []);
    recvByPo.get(k)!.push(g);
  }
  const stores = toStores({
    productRows, customerRows, supplierRows, saleRows, purchaseRows,
    itemsBySale, itemsByPo, recvByPo,
    expenseRows, stockRows, pricingRows, moneyRows, deliveryRows, heldRows, wapoRows, notifRows, auditRows, settingsRows,
  });
  return { stores, capped: [...capped] };
}

/**
 * Raw table rows -> the frontend `stores` contract. Shared by the full snapshot
 * and the delta read so the two can never disagree about a document's shape:
 * deltas used to be served from the stored document payload, and now that they
 * are rebuilt from relational rows they must produce the identical document.
 */
function toStores(raw: {
  productRows: any[]; customerRows: any[]; supplierRows: any[]; saleRows: any[]; purchaseRows: any[];
  itemsBySale: Map<string, any[]>; itemsByPo: Map<string, any[]>; recvByPo: Map<string, any[]>;
  expenseRows: any[]; stockRows: any[]; pricingRows: any[]; moneyRows: any[]; deliveryRows: any[];
  heldRows: any[]; wapoRows: any[]; notifRows: any[]; auditRows: any[]; settingsRows: any[];
}): Snapshot {
  const {
    productRows, customerRows, supplierRows, saleRows, purchaseRows,
    itemsBySale, itemsByPo, recvByPo,
    expenseRows, stockRows, pricingRows, moneyRows, deliveryRows, heldRows, wapoRows, notifRows, auditRows, settingsRows,
  } = raw;
  const stores: Snapshot = {
    products: productRows.map(productRow),
    customers: customerRows.map(customerRow),
    suppliers: supplierRows.map(supplierRow),
    sales: saleRows.map((r) => saleRow(r, itemsBySale)),
    purchases: purchaseRows.map((r) => purchaseRow(r, itemsByPo, recvByPo)),
    expenses: expenseRows.map((r: any) => ({ id: r.id, title: r.title, category: r.category, amount: KoboToNaira(r.amount_kobo), description: r.description || undefined, paidBy: r.spent_by || '', paymentMethod: r.payment_method || 'Cash', date: r.date, createdAt: r.created_at, isHistorical: b(r.is_historical) || undefined, saleId: r.sale_id || undefined })),
    stockMovements: stockRows.map((r: any) => ({ id: r.id, productId: r.product_id, productName: r.product_name, type: r.type, quantity: n(r.qty), previousStock: n(r.prev_stock), newStock: n(r.new_stock), referenceNo: r.ref_id || undefined, notes: r.notes || undefined, performedBy: r.performed_by || '', createdAt: r.created_at })),
    pricingHistory: pricingRows.map((r: any) => ({ id: r.id, productId: r.product_id, productName: r.product_name, oldPrice: KoboToNaira(r.old_price_kobo), newPrice: KoboToNaira(r.new_price_kobo), priceType: r.price_type || 'Retail', changedBy: r.changed_by || '', reason: r.reason || '', createdAt: r.created_at })),
    moneyMovements: moneyRows.map((r: any) => ({ id: r.id, date: r.date, type: r.type, subtype: r.subtype || undefined, sourceAccount: r.source_account || undefined, destinationAccount: r.dest_account || undefined, amount: KoboToNaira(r.amount_kobo), notes: r.notes || undefined, referenceNo: r.ref_no || undefined, referenceId: r.ref_id || undefined, performedBy: r.performed_by || '', createdAt: r.created_at })),
    settings: settingsRows.map((r: any) => {
      try {
        const v = JSON.parse(r.value_json);
        return typeof v === 'object' && v !== null ? v : { id: r.key, value: v };
      } catch { return { id: r.key, value: r.value_json }; }
    }),
    notifications: notifRows.map((r: any) => ({ id: r.id, title: r.title, message: r.message, type: r.type, read: b(r.is_read), createdAt: r.created_at })),
    auditLogs: auditRows.map((r: any) => ({ id: r.id, action: r.action, entity: r.entity, entityId: r.entity_id || undefined, performedBy: r.actor_id || '', details: r.details || '', createdAt: r.created_at })),
    deliveryOrders: deliveryRows.map((r: any) => ({ id: r.id, deliveryNo: r.delivery_no, saleId: r.sale_id || '', invoiceNo: r.invoice_no || '', customerId: r.customer_id || undefined, customerName: r.customer_name || '', deliveryAddress: r.delivery_address || undefined, items: parseJsonArray(r.items_json), deliveryFee: KoboToNaira(r.delivery_fee_kobo), status: r.status || 'Pending Pickup', isPickupConfirmed: b(r.is_pickup_confirmed), createdBy: r.created_by || '', createdAt: r.created_at, updatedAt: r.updated_at || undefined })),
    heldOrders: heldRows.map((r: any) => {
      try {
        const cart = JSON.parse(r.cart_json || '{}');
        return { id: r.id, ...(cart as object), heldBy: r.held_by, createdAt: r.created_at };
      } catch { return { id: r.id, heldBy: r.held_by, createdAt: r.created_at }; }
    }),
    whatsAppPreOrders: wapoRows.map((r: any) => ({ id: r.id, preOrderNo: r.preorder_no, customerId: r.customer_id || undefined, customerName: r.customer_name || '', customerPhone: r.customer_phone || '', items: parseJsonArray(r.items_json), subtotal: KoboToNaira(r.subtotal_kobo), totalAmount: KoboToNaira(r.total_kobo), status: r.status || 'Pending Review', convertedSaleId: r.converted_sale_id || undefined, createdBy: r.created_by || '', createdAt: r.created_at, updatedAt: r.updated_at || undefined })),
  };
  return stores;
}
