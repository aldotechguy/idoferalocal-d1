/**
 * Phase 4e — local store parity.
 * De-duplicates data/d1_storage.db's legacy mirror with the SAME rules as the ETL
 * (owner rank, newest createdAt per receipt/PO, Archived-* placeholders) and
 * asserts the relational tables the dev server reads agree with it.
 */
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('./data/d1_storage.db');
const rows = db.prepare('SELECT owner_id, collection, document_id, payload, updated_at FROM app_documents').all() as any[];

const OWNER_RANK: Record<string, number> = { 'idofera-business': 3, default_owner: 2, test_owner: 1 };
const ts = (v: unknown) => (v == null ? 0 : Number(v) || 0);
const latest = new Map<string, any>();
for (const r of rows) {
  const key = `${r.owner_id}|${r.collection}|${r.document_id}`;
  const prev = latest.get(key);
  if (!prev || ts(r.updated_at) >= ts(prev.updated_at)) latest.set(key, r);
}
const byDoc = new Map<string, any>();
for (const r of latest.values()) {
  const key = `${r.collection}|${r.document_id}`;
  const prev = byDoc.get(key);
  if (!prev) { byDoc.set(key, r); continue; }
  const rank = (o: string) => OWNER_RANK[o] ?? 0;
  if (rank(r.owner_id) > rank(prev.owner_id) || (rank(r.owner_id) === rank(prev.owner_id) && ts(r.updated_at) >= ts(prev.updated_at))) {
    byDoc.set(key, r);
  }
}

const raw = new Map<string, any[]>();
let malformed = 0;
for (const r of byDoc.values()) {
  let doc: any;
  try { doc = JSON.parse(r.payload); } catch { malformed += 1; continue; }
  if (!doc || typeof doc !== 'object') { malformed += 1; continue; }
  if (!raw.has(r.collection)) raw.set(r.collection, []);
  raw.get(r.collection)!.push(doc);
}

// Receipt / PO dedup: newest createdAt wins (ETL rule).
const collapse = (list: any[], field: string) => {
  const byKey = new Map<string, any>();
  for (const d of list) {
    const key = String(d[field] || d.id || '');
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, d); continue; }
    const a = String(d.createdAt || '');
    const b = String(prev.createdAt || '');
    if (a > b || (a === b && ts(d.updatedAt) >= ts(prev.updatedAt))) byKey.set(key, d);
  }
  return [...byKey.values()];
};
const sales = collapse(raw.get('sales') || [], 'invoiceNo');
const purchases = collapse(raw.get('purchases') || [], 'poNumber');

// Placeholder products for orphan line items (ETL rule).
const productIds = new Set<string>((raw.get('products') || []).map((d) => String(d.id)));
let placeholders = 0;
for (const list of [sales, purchases]) {
  for (const d of list) {
    for (const it of Array.isArray(d.items) ? d.items : []) {
      const pid = String(it?.productId || '');
      if (pid && !productIds.has(pid)) { productIds.add(pid); placeholders += 1; }
    }
  }
}

const docs = new Map<string, any[]>(raw);
docs.set('sales', sales);
docs.set('purchases', purchases);

const count = (sql: string, params: any[] = []) => Number((db.prepare(sql).get(...params) as any)?.n || 0);
const one = (sql: string) => db.prepare(sql).get() as any;

console.log(`mirror rows=${rows.length} logical docs=${byDoc.size} malformed=${malformed}`);
let failures = 0;
const expect = (label: string, expected: number, actual: number) => {
  const ok = expected === actual;
  if (!ok) failures += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label.padEnd(24)} docs=${String(expected).padStart(4)} rows=${String(actual).padStart(4)}`);
};
const pairs: [string, string][] = [
  ['customers', 'customers'], ['suppliers', 'suppliers'], ['expenses', 'expenses'],
  ['stockMovements', 'stock_movements'], ['pricingHistory', 'pricing_history'],
  ['moneyMovements', 'money_movements'], ['notifications', 'notifications'],
  ['auditLogs', 'audit_logs'], ['deliveryOrders', 'delivery_orders'],
  ['whatsAppPreOrders', 'whatsapp_preorders'],
];
for (const [collection, table] of pairs) expect(collection, (docs.get(collection) || []).length, count(`SELECT COUNT(*) AS n FROM ${table}`));
expect('products (+placeholders)', (raw.get('products') || []).length + placeholders, count('SELECT COUNT(*) AS n FROM products'));
expect('sales (receipt-deduped)', sales.length, count('SELECT COUNT(*) AS n FROM sales'));
expect('purchases (po-deduped)', purchases.length, count('SELECT COUNT(*) AS n FROM purchases'));

// Money is the real test: receipt-deduped document totals vs relational kobo sums.
const docSalesTotal = sales.reduce((a, d) => a + Number(d.totalAmount || 0), 0);
const relTotalNaira = Number(one('SELECT COALESCE(SUM(total_kobo), 0) AS kobo FROM sales').kobo) / 100;
const moneyOk = Math.abs(docSalesTotal - relTotalNaira) < 0.01;
console.log(`money: docs NGN ${docSalesTotal.toFixed(2)} vs relational NGN ${relTotalNaira.toFixed(2)} -> ${moneyOk ? 'OK' : 'FAIL'}`);
if (!moneyOk) failures += 1;

const docLineItems = sales.reduce((a, d) => a + (Array.isArray(d.items) ? d.items.length : 0), 0)
  + purchases.reduce((a, d) => a + (Array.isArray(d.items) ? d.items.length : 0), 0);
const relLineItems = count('SELECT COUNT(*) AS n FROM sale_items') + count('SELECT COUNT(*) AS n FROM purchase_items');
expect('line items', docLineItems, relLineItems);

const orphanItems = count(`SELECT COUNT(*) AS n FROM sale_items WHERE product_id IS NULL OR product_id = '' OR product_id NOT IN (SELECT id FROM products)`);
console.log(`orphan/blank sale_items=${orphanItems} (must be 0 after placeholders)`);
if (orphanItems) failures += 1;

if (failures) throw new Error(`PHASE4-LOCAL-PARITY FAILED (${failures} mismatches)`);
console.log('PHASE4-LOCAL-PARITY OK');