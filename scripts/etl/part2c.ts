/** ETL 2c: sales + sale_items + purchases. */
import { toKobo, str, num, bool01, nowIso } from './lib.js';
import type { DocRow, Stmt } from './lib.js';
import type { Ctx } from './ctx.js';
import { parsePayload } from './ctx.js';
import { placeholder } from './part2b.js';

export function loadSales(byCol: Map<string, DocRow[]>, stmts: Stmt[], ctx: Ctx) {
  // Dedup receipts: prod has duplicate invoiceNo across DISTINCT sale ids
  // (multi-device sync created clones). Keep newest createdAt per receipt_no.
  type SaleDoc = { d: DocRow; s: any };
  const byReceipt = new Map<string, SaleDoc>();
  for (const d of byCol.get('sales') || []) {
    const s = parsePayload(ctx, d); if (!s) continue;
    const receipt = str(s.invoiceNo || s.id || d.docId);
    const prev = byReceipt.get(receipt);
    if (!prev || str(s.createdAt, '') >= str(prev.s.createdAt, '')) byReceipt.set(receipt, { d, s });
  }
  for (const { d, s } of byReceipt.values()) {
    const id = str(s.id || d.docId);
    ctx.salesCount++;
    ctx.salesTotalKobo += toKobo(s.totalAmount);
    stmts.push({
      sql: `INSERT INTO sales (id, receipt_no, customer_id, customer_name, type, subtotal_kobo, discount_kobo, tax_kobo, delivery_fee_kobo, total_kobo, paid_kobo, payment_method, payment_breakdown_json, status, notes, created_by, is_historical, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, total_kobo=excluded.total_kobo;`,
      params: [id, str(s.invoiceNo || id), s.customerId ? str(s.customerId) : null, str(s.customerName), str(s.type, 'Retail'), toKobo(s.subtotal), toKobo(s.discount), toKobo(s.tax), toKobo(s.deliveryFee), toKobo(s.totalAmount), toKobo(s.paidAmount), str(s.paymentMethod, 'Cash'), s.paymentBreakdown ? JSON.stringify(s.paymentBreakdown) : null, str(s.status, 'Completed'), s.notes ? str(s.notes) : null, str(s.createdBy), bool01(s.isHistorical), str(s.createdAt, nowIso())],
    });
    (Array.isArray(s.items) ? s.items : []).forEach((it: any, i: number) => {
      placeholder(stmts, ctx, str(it.productId), str(it.productName));
      ctx.saleItemsCount++;
      stmts.push({
        sql: `INSERT INTO sale_items (id, sale_id, product_id, product_name, sku, qty, unit_price_kobo, cost_price_kobo, total_kobo, is_wholesale, is_clearance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET qty=excluded.qty;`,
        params: [`${id}-item-${i}`, id, str(it.productId) || null, str(it.productName), str(it.sku), num(it.quantity), toKobo(it.unitPrice), toKobo(it.costPrice), toKobo(it.total), bool01(it.isWholesale), bool01(it.isClearance)],
      });
    });
  }
}

export function loadPurchases(byCol: Map<string, DocRow[]>, stmts: Stmt[], ctx: Ctx) {
  // Same clone-dedup as sales: keep newest per po_number.
  const byPo = new Map<string, { d: DocRow; po: any }>();
  for (const d of byCol.get('purchases') || []) {
    const po = parsePayload(ctx, d); if (!po) continue;
    const key = str(po.poNumber || po.id || d.docId);
    const prev = byPo.get(key);
    if (!prev || str(po.createdAt, '') >= str(prev.po.createdAt, '')) byPo.set(key, { d, po });
  }
  for (const { d, po } of byPo.values()) {
    const id = str(po.id || d.docId);
    stmts.push({
      sql: `INSERT INTO purchases (id, po_number, supplier_id, supplier_name, delivery_fee_kobo, logistics_fee_kobo, total_kobo, paid_kobo, payment_status, delivery_status, expected_delivery, created_by, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET delivery_status=excluded.delivery_status;`,
      params: [id, str(po.poNumber || id), po.supplierId ? str(po.supplierId) : null, str(po.supplierName), toKobo(po.deliveryFee), toKobo(po.localLogisticsFee), toKobo(po.totalAmount), toKobo(po.paidAmount), str(po.paymentStatus, 'Unpaid'), str(po.deliveryStatus, 'Pending'), str(po.expectedDelivery), str(po.createdBy), po.notes ? str(po.notes) : null, str(po.createdAt, nowIso()), po.updatedAt ? str(po.updatedAt) : null],
    });
    (Array.isArray(po.items) ? po.items : []).forEach((it: any, i: number) => {
      placeholder(stmts, ctx, str(it.productId), str(it.productName));
      stmts.push({
        sql: `INSERT INTO purchase_items (id, purchase_id, product_id, product_name, sku, qty, unit_cost_kobo, total_kobo, received_qty, accepted_qty, damaged_qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET qty=excluded.qty;`,
        params: [`${id}-item-${i}`, id, str(it.productId) || null, str(it.productName), str(it.sku), num(it.quantity), toKobo(it.unitCost), toKobo(it.total), num(it.receivedQuantity), num(it.acceptedQuantity), num(it.damagedQuantity)],
      });
    });
    (Array.isArray(po.receivingHistory) ? po.receivingHistory : []).forEach((r: any, i: number) => {
      stmts.push({
        sql: `INSERT INTO receiving_history (id, purchase_id, grn_number, received_by, notes, items_json, received_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING;`,
        params: [str(r.id || `${id}-grn-${i}`), id, str(r.grnNumber), str(r.receivedBy), r.notes ? str(r.notes) : null, JSON.stringify(r.itemsReceived || []), str(r.receivedAt, nowIso())],
      });
    });
  }
}
