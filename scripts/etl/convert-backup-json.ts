/**
 * Convert an app backup JSON (Upload-to-Drive / IndexedDB export shape:
 * `{ app, version, exportedAt, data: { <collection>: [...] } }`) into a relational
 * import SQL for `idofera`, using the SAME transforms as the live write path.
 *
 * This is the recovery path when the true canon lives on a device rather than in
 * D1: export from the app, run this, then push the result to `idofera`.
 *
 * Usage:
 *   npx tsx scripts/etl/convert-backup-json.ts --in=<backup.json> [--out=backups/idofera-backup-import.sql]
 */
import fs from 'node:fs';
import path from 'node:path';
import { bindParams } from './lib.js';
import type { Stmt } from './lib.js';
import { upsertToStatements } from '../../src/server/relationalWrites.js';
import { isClearanceItem } from '../../src/shared/productStatus.js';

function arg(name: string, fallback: string): string {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
}
const IN = path.resolve(arg('in', ''));
const OUT = path.resolve(arg('out', path.join('backups', 'idofera-backup-import.sql')));
if (!IN || !fs.existsSync(IN)) throw new Error(`--in=<backup.json> is required and must exist (got: ${IN})`);

const raw = JSON.parse(fs.readFileSync(IN, 'utf8'));
// Accept either the backup envelope (`data`) or a bare snapshot of collections.
const data = (raw && typeof raw === 'object' && raw.data && typeof raw.data === 'object') ? raw.data : raw;

const ORDER = [
  'products', 'customers', 'suppliers', 'sales', 'purchases', 'expenses',
  'stockMovements', 'pricingHistory', 'moneyMovements', 'deliveryOrders',
  'whatsAppPreOrders', 'notifications', 'auditLogs', 'heldOrders', 'settings',
];

const nowIso = new Date().toISOString();
const stmts: Stmt[] = [];
// --full replace: each collection is emptied before its rows are written, so the
// import is a true restore, not a merge.
const REPLACE = ['receiving_history', 'purchase_items', 'purchases', 'sale_items', 'sales', 'stock_movements', 'pricing_history', 'money_movements', 'delivery_orders', 'held_orders', 'whatsapp_preorders', 'notifications', 'audit_logs', 'expenses', 'product_variants', 'products', 'categories', 'customers', 'suppliers'];
const deletes = REPLACE.map((t): Stmt => ({ sql: `DELETE FROM "${t}"`, params: [] }));

// `sales.receipt_no` is UNIQUE and reads back as `invoiceNo`. Placeholder receipts
// ("", "N/A") and genuine repeated invoices (the same INV on two distinct sales)
// would collide, so every sale is given a unique receipt_no here: the real invoice
// when first seen, otherwise the invoice with a short deterministic id suffix (and
// the sale id for placeholder receipts). This preserves all sales — nothing is
// dropped — while keeping the displayed invoice recognisable.
const usedReceipts = new Set<string>();
function uniqueReceipt(doc: any): string {
  const id = String(doc?.id || '');
  const raw = String(doc?.invoiceNo ?? '').trim();
  const placeholder = raw === '' || /^n\/?a$/i.test(raw) || raw === '-';
  let candidate = placeholder ? id : raw;
  if (!candidate) candidate = id || `sale-${usedReceipts.size + 1}`;
  if (usedReceipts.has(candidate)) {
    const suffix = (id || String(usedReceipts.size + 1)).slice(-6);
    candidate = `${placeholder ? 'NA' : raw}#${suffix}`;
    let n = 1;
    while (usedReceipts.has(candidate)) candidate = `${placeholder ? 'NA' : raw}#${suffix}-${n++}`;
  }
  usedReceipts.add(candidate);
  return candidate;
}

// Products first so their category/placeholder emission precedes dependent rows.
for (const collection of ORDER) {
  const documents = Array.isArray(data[collection]) ? data[collection] : [];
  let written = 0;
  for (const document of documents) {
    if (!document || typeof document !== 'object') continue;
    // Clearance / non-inventory lines must never become catalogue products.
    if (collection === 'products' && isClearanceItem({ productId: String((document as any).id || ''), sku: (document as any).sku, isClearance: (document as any).isClearance })) continue;
    // Keep every sale (no receipt-dedup): give each a unique receipt_no instead.
    const doc = collection === 'sales'
      ? { ...document, invoiceNo: uniqueReceipt(document) }
      : document;
    const s = upsertToStatements(collection, doc, nowIso);
    for (const st of s) stmts.push(st);
    written += 1;
  }
  if (documents.length) console.log(`${collection.padEnd(18)} ${written}/${documents.length}`);
}

const out = ['PRAGMA defer_foreign_keys=TRUE;'];
for (const d of deletes) out.push(`${d.sql};`);
for (const st of stmts) {
  const sql = bindParams(st.sql, st.params || []);
  out.push(sql.endsWith(';') ? sql : sql + ';');
}
fs.writeFileSync(OUT, out.join('\n') + '\n');
console.log(`\nwrote ${out.length} statements -> ${OUT}`);
console.log(`source: ${IN}`);
