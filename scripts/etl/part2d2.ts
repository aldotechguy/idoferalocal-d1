/** ETL 2d-ii: deliveries, preorders, notifications, audit, settings. */
import { toKobo, str, bool01, nowIso, unwrapSettings } from './lib.js';
import type { DocRow, Stmt } from './lib.js';
import type { Ctx } from './ctx.js';
import { parsePayload } from './ctx.js';

export function loadOps(byCol: Map<string, DocRow[]>, stmts: Stmt[], ctx: Ctx) {
  // Clone-dedup for delivery + preorder numbers (same multi-device cause).
  const dedup = (col: string, numKey: string) => {
    const m = new Map<string, { d: DocRow; o: any }>();
    for (const d of byCol.get(col) || []) {
      const o = parsePayload(ctx, d); if (!o) continue;
      const key = str(o[numKey] || o.id || d.docId);
      const prev = m.get(key);
      if (!prev || str(o.createdAt, '') >= str(prev.o.createdAt, '')) m.set(key, { d, o });
    }
    return [...m.values()];
  };
  for (const { d, o } of dedup('deliveryOrders', 'deliveryNo')) {
    stmts.push({ sql: `INSERT INTO delivery_orders (id, delivery_no, sale_id, invoice_no, customer_id, customer_name, delivery_address, items_json, delivery_fee_kobo, status, is_pickup_confirmed, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status=excluded.status;`, params: [str(o.id || d.docId), str(o.deliveryNo || d.docId), o.saleId ? str(o.saleId) : null, str(o.invoiceNo), o.customerId ? str(o.customerId) : null, str(o.customerName), o.deliveryAddress ? str(o.deliveryAddress) : null, JSON.stringify(o.items || []), toKobo(o.deliveryFee), str(o.status, 'Pending Pickup'), bool01(o.isPickupConfirmed), str(o.createdBy), str(o.createdAt, nowIso()), o.updatedAt ? str(o.updatedAt) : null] });
  }
  for (const { d, o: w } of dedup('whatsAppPreOrders', 'preOrderNo')) {
    stmts.push({ sql: `INSERT INTO whatsapp_preorders (id, preorder_no, customer_id, customer_name, customer_phone, items_json, subtotal_kobo, total_kobo, status, converted_sale_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status=excluded.status;`, params: [str(w.id || d.docId), str(w.preOrderNo || d.docId), w.customerId ? str(w.customerId) : null, str(w.customerName), str(w.customerPhone), JSON.stringify(w.items || []), toKobo(w.subtotal), toKobo(w.totalAmount), str(w.status, 'Pending Review'), w.convertedSaleId ? str(w.convertedSaleId) : null, str(w.createdBy), str(w.createdAt, nowIso()), w.updatedAt ? str(w.updatedAt) : null] });
  }
  for (const d of byCol.get('notifications') || []) {
    const n = parsePayload(ctx, d); if (!n) continue;
    stmts.push({ sql: `INSERT INTO notifications (id, title, message, type, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING;`, params: [str(n.id || d.docId), str(n.title, 'Note'), str(n.message), str(n.type, 'daily_report'), bool01(n.read), str(n.createdAt, nowIso())] });
  }
  for (const d of byCol.get('auditLogs') || []) {
    const a = parsePayload(ctx, d); if (!a) continue;
    stmts.push({ sql: `INSERT INTO audit_logs (id, actor_id, action, entity, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING;`, params: [str(a.id || d.docId), str(a.performedBy), str(a.action, 'UNKNOWN'), str(a.entity, 'Unknown'), a.entityId ? str(a.entityId) : null, str(a.details), str(a.createdAt, nowIso())] });
  }
  for (const d of byCol.get('settings') || []) {
    const raw = parsePayload(ctx, d); if (!raw) continue;
    const s = unwrapSettings(raw) || raw;
    stmts.push({ sql: `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json;`, params: [str((s as any).id, d.docId), JSON.stringify(s), Date.now()] });
  }
}
