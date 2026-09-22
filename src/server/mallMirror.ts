/**
 * Option B — mirror writes for Mall operations.
 *
 * Open staff workspaces never re-read the whole store: they poll
 * /api/storage/snapshot with a composite (updated_at, collection,
 * document_id) watermark, and that delta read is served from the
 * `app_documents` mirror ONLY. Mall writes go straight to the relational
 * tables, so before this module an open Dashboard could not see a settled
 * Mall sale, its stock movements or its money movement until a full reload.
 *
 * After every committed Mall write batch the caller re-reads the affected
 * rows and upserts their DOCUMENT shapes into the mirror here. The payloads
 * are built by the exact snapshot mappers (saleRow/customerRow/productRow)
 * or the exact toStores() inline shapes in relationalSnapshot.ts, so the
 * mirror and the full snapshot can never disagree about a document.
 *
 * The mirror is an ACCELERATOR, not a source of truth: it runs as a small
 * follow-up batch after the main write has committed, so a failure here
 * never corrupts anything — it only delays delivery to open tabs. The
 * revision bump in the main batch (revisionBumpStatement) remains the
 * correctness backstop that forces a full re-read on the next snapshot GET.
 */
import type { MallExecutor, MallStmt } from './mallApi.js';
import { KoboToNaira, b, n, parseJsonArray, saleRow, customerRow, productRow } from './relationalMapper.js';

const MIRROR_OWNER = 'idofera-business';
const MIRROR_UPSERT = 'INSERT INTO app_documents (owner_id, collection, document_id, payload, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner_id, collection, document_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at';

export type MallMirrorTargets = {
  products?: string[];
  customers?: string[];
  sales?: string[];
  moneyMovements?: string[];
  stockMovements?: string[];
  deliveryOrders?: string[];
  notifications?: string[];
};

/** Re-reads the affected rows and mirror-upserts their client document shapes. */
export async function mirrorMallWrites(exec: MallExecutor, targets: MallMirrorTargets): Promise<void> {
  const at = Date.now();
  const stmts: MallStmt[] = [];
  const upsert = (collection: string, documentId: string, document: unknown) =>
    stmts.push({ sql: MIRROR_UPSERT, params: [MIRROR_OWNER, collection, documentId, JSON.stringify(document), at] });
  const ids = (values?: string[]) => (values && values.length ? [...new Set(values)] : []);
  const inList = (count: number) => `(${Array.from({ length: count }, () => '?').join(', ')})`;

  const productIds = ids(targets.products);
  if (productIds.length) {
    const rows = await exec.queryAll(`SELECT * FROM products WHERE id IN ${inList(productIds.length)}`, productIds);
    for (const row of rows) upsert('products', row.id, productRow(row));
  }
  const customerIds = ids(targets.customers);
  if (customerIds.length) {
    const rows = await exec.queryAll(`SELECT * FROM customers WHERE id IN ${inList(customerIds.length)}`, customerIds);
    for (const row of rows) upsert('customers', row.id, customerRow(row));
  }
  const saleIds = ids(targets.sales);
  if (saleIds.length) {
    const rows = await exec.queryAll(`SELECT * FROM sales WHERE id IN ${inList(saleIds.length)}`, saleIds);
    const items = await exec.queryAll(`SELECT * FROM sale_items WHERE sale_id IN ${inList(saleIds.length)}`, saleIds);
    const itemsBySale = new Map<string, any[]>();
    for (const item of items) {
      const key = String(item.sale_id);
      if (!itemsBySale.has(key)) itemsBySale.set(key, []);
      itemsBySale.get(key)!.push(item);
    }
    for (const row of rows) upsert('sales', row.id, saleRow(row, itemsBySale));
  }
  const moneyIds = ids(targets.moneyMovements);
  if (moneyIds.length) {
    const rows = await exec.queryAll(`SELECT * FROM money_movements WHERE id IN ${inList(moneyIds.length)}`, moneyIds);
    for (const r of rows) upsert('moneyMovements', r.id, { id: r.id, date: r.date, type: r.type, subtype: r.subtype || undefined, sourceAccount: r.source_account || undefined, destinationAccount: r.dest_account || undefined, amount: KoboToNaira(r.amount_kobo), notes: r.notes || undefined, referenceNo: r.ref_no || undefined, referenceId: r.ref_id || undefined, performedBy: r.performed_by || '', createdAt: r.created_at });
  }
  const stockIds = ids(targets.stockMovements);
  if (stockIds.length) {
    const rows = await exec.queryAll(`SELECT * FROM stock_movements WHERE id IN ${inList(stockIds.length)}`, stockIds);
    for (const r of rows) upsert('stockMovements', r.id, { id: r.id, productId: r.product_id, productName: r.product_name, type: r.type, quantity: n(r.qty), previousStock: n(r.prev_stock), newStock: n(r.new_stock), referenceNo: r.ref_id || undefined, notes: r.notes || undefined, performedBy: r.performed_by || '', createdAt: r.created_at });
  }
  const deliveryIds = ids(targets.deliveryOrders);
  if (deliveryIds.length) {
    const rows = await exec.queryAll(`SELECT * FROM delivery_orders WHERE id IN ${inList(deliveryIds.length)}`, deliveryIds);
    for (const r of rows) upsert('deliveryOrders', r.id, { id: r.id, deliveryNo: r.delivery_no, saleId: r.sale_id || '', invoiceNo: r.invoice_no || '', customerId: r.customer_id || undefined, customerName: r.customer_name || '', deliveryAddress: r.delivery_address || undefined, items: parseJsonArray(r.items_json), deliveryFee: KoboToNaira(r.delivery_fee_kobo), status: r.status || 'Pending Pickup', isPickupConfirmed: b(r.is_pickup_confirmed), createdBy: r.created_by || '', createdAt: r.created_at, updatedAt: r.updated_at || undefined });
  }
  const notificationIds = ids(targets.notifications);
  if (notificationIds.length) {
    const rows = await exec.queryAll(`SELECT * FROM notifications WHERE id IN ${inList(notificationIds.length)}`, notificationIds);
    for (const r of rows) upsert('notifications', r.id, { id: r.id, title: r.title, message: r.message, type: r.type, read: b(r.is_read), createdAt: r.created_at });
  }

  if (stmts.length) {
    try { await exec.runBatch(stmts); }
    catch (error) {
      // Acceleration only: the committed write is the truth, and the revision
      // bump already guarantees convergence on the next full snapshot read.
      console.error('[mall-mirror] delta acceleration failed; open tabs fall back to the revision-bumped re-read', error);
    }
  }
}
