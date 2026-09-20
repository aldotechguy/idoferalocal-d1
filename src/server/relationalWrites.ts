/** Phase 4 — write router part 2: finance + ops + misc collections. */
import { s, expenseToRow, stockMovementToRow, pricingToRow, moneyToRow, unwrapSettings } from './relationalMapper.js';
import { coreUpsert, coreDelete } from './relationalWritesCore.js';
import type { SqlStmt } from './relationalWritesCore.js';
import type { QueryAll } from './relationalMapper.js';

export type { SqlStmt };

/** Child-first table list per frontend collection (used for full-replace snapshots). */
export function collectionTables(collection: string): string[] {
  switch (collection) {
    case 'products': return ['products'];
    case 'customers': return ['customers'];
    case 'suppliers': return ['suppliers'];
    case 'sales': return ['sale_items', 'sales'];
    case 'purchases': return ['receiving_history', 'purchase_items', 'purchases'];
    case 'expenses': return ['expenses'];
    case 'stockMovements': return ['stock_movements'];
    case 'pricingHistory': return ['pricing_history'];
    case 'moneyMovements': return ['money_movements'];
    case 'notifications': return ['notifications'];
    case 'auditLogs': return ['audit_logs'];
    case 'settings': return ['settings'];
    case 'heldOrders': return ['held_orders'];
    case 'deliveryOrders': return ['delivery_orders'];
    case 'whatsAppPreOrders': return ['whatsapp_preorders'];
    default: return [];
  }
}

/** PUT-snapshot semantics: replace every row of a collection with the supplied documents. */
export function replaceCollectionStatements(collection: string, documents: unknown, nowIso: string): SqlStmt[] {
  const tables = collectionTables(collection);
  if (!tables.length) return [];
  const stmts: SqlStmt[] = tables.map((table) => ({ sql: `DELETE FROM ${table}`, params: [] }));
  if (!Array.isArray(documents)) return stmts;
  for (const document of documents) {
    if (!document || typeof document !== 'object') continue;
    stmts.push(...upsertToStatements(collection, document, nowIso));
  }
  return stmts;
}

/** True when the relational store already holds business data (products/sales). */
export async function relationalHasData(q: QueryAll): Promise<boolean> {
  try {
    const rows = await q('SELECT (SELECT COUNT(*) FROM products) AS p, (SELECT COUNT(*) FROM sales) AS s');
    const row: any = rows?.[0] || {};
    return Number(row.p || 0) > 0 || Number(row.s || 0) > 0;
  } catch {
    return false;
  }
}

/** Business keys protected by UNIQUE indexes on the relational tables. */
const BUSINESS_KEYS: Record<string, string[]> = {
  products: ['sku'],
  sales: ['invoiceNo', 'receiptNo'],
  purchases: ['poNumber', 'invoiceNo'],
  deliveryOrders: ['deliveryNo'],
  whatsAppPreOrders: ['preOrderNo', 'preorderNo'],
  categories: ['slug'],
};

function businessKeyOf(collection: string, document: any): string | null {
  const fields = BUSINESS_KEYS[collection];
  if (!fields) return null;
  for (const field of fields) {
    const value = s(document?.[field]).trim();
    if (value) return `${field}:${value.toLowerCase()}`;
  }
  return null;
}

/**
 * One-time bridge: legacy `app_documents` rows -> relational tables.
 *
 * Dedup policy — MUST stay identical to the ETL (enforced by the drift guard in
 * scripts/verify-relational.ts, which seeds one DB via the ETL and another via
 * this bridge and requires byte-identical snapshots):
 *  1. per (owner, collection, id): newest `updated_at` wins;
 *  2. same logical record synced from two owners: highest owner rank wins
 *     (`idofera-business` is the live device), then newest `updated_at`;
 *  3. UNIQUE business keys (duplicate receipts / PO numbers from multi-device
 *     sync): newest `createdAt` wins, exactly like the ETL receipt dedup;
 *  4. sale/purchase line items referencing a missing product get an Archived-*
 *     placeholder product, exactly like the ETL.
 * Malformed payloads are skipped and reported, never dropped silently.
 */
export function backfillStatementsFromDocumentRows(
  rows: { collection: string; payload: string; owner?: string; updatedAt?: number | string }[],
  nowIso: string,
): { stmts: SqlStmt[]; skipped: number; collapsed: Record<string, number> } {
  const OWNER_RANK: Record<string, number> = { 'idofera-business': 3, default_owner: 2, test_owner: 1 };
  const rankOf = (owner?: string) => OWNER_RANK[s(owner)] ?? 0;
  const tsOf = (v: number | string | undefined) => (v == null ? 0 : Number(v) || 0);
  const latest = new Map<string, { collection: string; document: any; owner?: string; updatedAt?: number | string }>();
  const collapsed: Record<string, number> = {};
  let skipped = 0;
  for (const row of rows) {
    const collection = s(row?.collection);
    if (!collection) { skipped += 1; continue; }
    let document: any;
    try {
      document = JSON.parse(s(row?.payload, 'null'));
    } catch {
      skipped += 1;
      continue;
    }
    if (!document || typeof document !== 'object') { skipped += 1; continue; }
    const owner = s(row?.owner ?? (row as any)?.owner_id) || undefined;
    const updatedAt = row?.updatedAt ?? (row as any)?.updated_at;
    const key = `${s(owner)}|${collection}|${s(document.id, 'singleton')}`;
    const prev = latest.get(key);
    if (!prev || tsOf(updatedAt) >= tsOf(prev.updatedAt)) latest.set(key, { collection, document, owner, updatedAt });
  }
  // Stage 2: collapse cross-owner copies of the same logical document.
  const perDoc = new Map<string, { collection: string; document: any; owner?: string; updatedAt?: number | string }>();
  for (const row of latest.values()) {
    const key = `${row.collection}::${s(row.document.id, 'singleton')}`;
    const prev = perDoc.get(key);
    if (!prev) { perDoc.set(key, row); continue; }
    if (rankOf(row.owner) > rankOf(prev.owner) || (rankOf(row.owner) === rankOf(prev.owner) && tsOf(row.updatedAt) >= tsOf(prev.updatedAt))) {
      perDoc.set(key, row);
    }
  }
  // Stage 3: business-key collisions — newest createdAt wins (ETL rule).
  const winners = new Map<string, { collection: string; document: any; owner?: string; updatedAt?: number | string }>();
  for (const row of perDoc.values()) {
    const docId = s(row.document.id, 'singleton');
    const businessKey = businessKeyOf(row.collection, row.document);
    const key = businessKey ? `${row.collection}::${businessKey}` : `${row.collection}::${docId}`;
    const prev = winners.get(key);
    if (!prev) { winners.set(key, row); continue; }
    const createdAt = s(row.document.createdAt, '');
    const prevCreatedAt = s(prev.document.createdAt, '');
    const newer = createdAt > prevCreatedAt || (createdAt === prevCreatedAt && tsOf(row.updatedAt) >= tsOf(prev.updatedAt));
    if (newer) winners.set(key, row);
    collapsed[row.collection] = (collapsed[row.collection] || 0) + 1;
  }
  const byCollection = new Map<string, any[]>();
  for (const { collection, document } of winners.values()) {
    if (!byCollection.has(collection)) byCollection.set(collection, []);
    byCollection.get(collection)!.push(document);
  }
  // Products first (their upserts also create categories), then the rest in a
  // stable order; placeholders mirror the ETL exactly.
  const ordered = [
    'products', 'customers', 'suppliers', 'sales', 'purchases', 'expenses',
    'stockMovements', 'pricingHistory', 'moneyMovements', 'deliveryOrders',
    'whatsAppPreOrders', 'notifications', 'auditLogs', 'heldOrders', 'settings',
  ];
  const productIds = new Set<string>((byCollection.get('products') || []).map((d: any) => s(d.id)));
  const stmts: SqlStmt[] = [];
  const placeholder = (pid: string, pname: string) => {
    if (!pid || productIds.has(pid)) return;
    productIds.add(pid);
    stmts.push({
      sql: `INSERT INTO products (id, sku, name, category_name, stock_qty, created_at, updated_at) VALUES (?, ?, ?, 'Uncategorized', 0, ?, ?) ON CONFLICT(id) DO NOTHING;`,
      params: [pid, pid.slice(0, 40), pname ? pname.slice(0, 120) : `Archived ${pid.slice(0, 12)}`, nowIso, nowIso],
    });
  };
  const emit = (collection: string, documents: any[]) => {
    for (const document of documents) stmts.push(...upsertToStatements(collection, document, nowIso));
  };
  for (const collection of ordered) emit(collection, byCollection.get(collection) || []);
  for (const [collection, documents] of byCollection) {
    if (!ordered.includes(collection)) emit(collection, documents);
  }
  for (const collection of ['sales', 'purchases']) {
    for (const d of byCollection.get(collection) || []) {
      for (const it of Array.isArray(d.items) ? d.items : []) placeholder(s(it?.productId), s(it?.productName));
    }
  }
  return { stmts, skipped, collapsed };
}

const up = (table: string, row: Record<string, unknown>, conflict: string, updateCols: string[]): SqlStmt => ({
  sql: `INSERT INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.keys(row).map(() => '?').join(', ')}) ON CONFLICT(${conflict}) DO UPDATE SET ${updateCols.map((c) => `${c}=excluded.${c}`).join(', ')}${updateCols.length ? ` WHERE ${updateCols.map((c) => `excluded.${c} IS NOT ${table}.${c}`).join(' OR ')}` : ''}`,
  params: Object.values(row),
});

export function upsertToStatements(collection: string, document: any, nowIso: string): SqlStmt[] {
  const core = coreUpsert(collection, document);
  if (core) return core;
  if (!document || typeof document !== 'object' || !document.id) return [];
  const id = s(document.id);
  switch (collection) {
    case 'expenses': return [up('expenses', expenseToRow(document, nowIso), 'id', ['amount_kobo', 'category'])];
    case 'stockMovements': return [up('stock_movements', stockMovementToRow(document, nowIso), 'id', ['qty', 'new_stock'])];
    case 'pricingHistory': return [up('pricing_history', pricingToRow(document, nowIso), 'id', ['new_price_kobo'])];
    case 'moneyMovements': return [up('money_movements', moneyToRow(document, nowIso), 'id', ['amount_kobo'])];
    case 'notifications': return [up('notifications', { id, title: s(document.title, 'Note'), message: s(document.message), type: s(document.type, 'daily_report'), is_read: document.read ? 1 : 0, link: document.link ? s(document.link) : null, created_at: s(document.createdAt, nowIso) }, 'id', ['message'])];
    case 'auditLogs': return [up('audit_logs', { id, actor_id: s(document.performedBy), action: s(document.action, 'UNKNOWN'), entity: s(document.entity, 'Unknown'), entity_id: document.entityId ? s(document.entityId) : null, details: s(document.details), created_at: s(document.createdAt, nowIso) }, 'id', ['details'])];
    case 'settings': {
      // Mirror the ETL exactly: unwrap legacy wrapper payloads and key by the
      // unwrapped document id when present.
      const settingsDoc = unwrapSettings(document) || document;
      const settingsValue = JSON.stringify(settingsDoc);
      return [{ sql: `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json WHERE excluded.value_json IS NOT settings.value_json`, params: [s((settingsDoc as any).id, s(document.id, 'app_settings')), settingsValue, Date.now()] }];
    }
    case 'heldOrders': return [up('held_orders', { id, cart_json: JSON.stringify(document), held_by: s(document.heldBy), created_at: s(document.createdAt, nowIso) }, 'id', ['cart_json'])];
    case 'deliveryOrders': return [up('delivery_orders', { id, delivery_no: s(document.deliveryNo || id), sale_id: document.saleId ? s(document.saleId) : null, invoice_no: s(document.invoiceNo), customer_id: document.customerId ? s(document.customerId) : null, customer_name: s(document.customerName), delivery_address: document.deliveryAddress ? s(document.deliveryAddress) : null, items_json: JSON.stringify(document.items || []), delivery_fee_kobo: Math.round(Number(document.deliveryFee || 0) * 100), status: s(document.status, 'Pending Pickup'), is_pickup_confirmed: document.isPickupConfirmed ? 1 : 0, created_by: s(document.createdBy), created_at: s(document.createdAt, nowIso), updated_at: document.updatedAt ? s(document.updatedAt) : null }, 'id', ['status'])];
    case 'whatsAppPreOrders': return [up('whatsapp_preorders', { id, preorder_no: s(document.preOrderNo || id), customer_id: document.customerId ? s(document.customerId) : null, customer_name: s(document.customerName), customer_phone: s(document.customerPhone), items_json: JSON.stringify(document.items || []), subtotal_kobo: Math.round(Number(document.subtotal || 0) * 100), total_kobo: Math.round(Number(document.totalAmount || 0) * 100), status: s(document.status, 'Pending Review'), converted_sale_id: document.convertedSaleId ? s(document.convertedSaleId) : null, created_by: s(document.createdBy), created_at: s(document.createdAt, nowIso), updated_at: document.updatedAt ? s(document.updatedAt) : null }, 'id', ['status'])];
    default: return [];
  }
}

export function deleteToStatements(collection: string, documentId: string): SqlStmt[] {
  const core = coreDelete(collection, documentId);
  if (core) return core;
  const id = s(documentId);
  if (!id) return [];
  const one = (sql: string): SqlStmt[] => [{ sql, params: [id] }];
  switch (collection) {
    case 'expenses': return one(`DELETE FROM expenses WHERE id = ?`);
    case 'stockMovements': return one(`DELETE FROM stock_movements WHERE id = ?`);
    case 'pricingHistory': return one(`DELETE FROM pricing_history WHERE id = ?`);
    case 'moneyMovements': return one(`DELETE FROM money_movements WHERE id = ?`);
    case 'notifications': return one(`DELETE FROM notifications WHERE id = ?`);
    case 'auditLogs': return one(`DELETE FROM audit_logs WHERE id = ?`);
    case 'settings': return [{ sql: `DELETE FROM settings WHERE key = ?`, params: [id] }];
    case 'heldOrders': return one(`DELETE FROM held_orders WHERE id = ?`);
    case 'deliveryOrders': return one(`DELETE FROM delivery_orders WHERE id = ?`);
    case 'whatsAppPreOrders': return one(`DELETE FROM whatsapp_preorders WHERE id = ?`);
    default: return [];
  }
}
