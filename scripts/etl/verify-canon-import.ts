/**
 * Canon migration gate — dry-load a generated relational import into an in-memory
 * DB and assert the post-migration invariants the target `idofera` must satisfy.
 *
 * Checks (all must pass):
 *   - no active-catalogue product whose id starts with `clearance-` or sku 'CLEARANCE'
 *   - no sale_items / purchase_items orphan: a non-null product_id must exist in products
 *   - clearance lines keep a NULL product_id (option A) but retain name/sku
 *   - no base64 (`data:`) images anywhere in products.images_json
 *   - a reported sales money total (kobo) for cross-checking against the source
 *
 * Usage: npx tsx scripts/etl/verify-canon-import.ts [--file=backups/idofera-relational-import.sql]
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { makeNodeAdapter, ensureRelationalSchemaNode } from '../../src/server/nodeAdapter.js';
import { buildSnapshot } from '../../src/server/relationalSnapshot.js';
import { isClearanceItem } from '../../src/shared/productStatus.js';

const FILE_ARG = process.argv.find((a) => a.startsWith('--file='))?.slice('--file='.length);
const FILE = path.resolve(FILE_ARG || path.join(process.cwd(), 'backups', 'idofera-relational-import.sql'));
const raw = fs.readFileSync(FILE, 'utf8');
// Statement split: one statement per line UNLESS a string literal contains a raw
// newline (legacy payloads occasionally embed one in description/notes). Track
// single-quote parity so a split only happens on a line that CLOSES its literals,
// then join the pieces back into a real single statement.
const lines = raw.split('\n');
const statements: string[] = [];
let buf = '';
let inString = false;
for (const line of lines) {
  const trimmed = line.trim();
  if (!buf && (trimmed.length === 0 || trimmed.startsWith('--'))) continue;
  buf = buf ? `${buf}\n${line}` : line;
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== "'") continue;
    if (inString && line[i + 1] === "'") { i++; continue; }
    inString = !inString;
  }
  if (!inString) { const done = buf.trim(); if (done && !done.startsWith('--')) statements.push(done); buf = ''; }
}
if (buf.trim()) statements.push(buf.trim());

const db = new DatabaseSync(':memory:');
ensureRelationalSchemaNode(db);
const tx = makeNodeAdapter(db);
db.exec('BEGIN;');
for (const sql of statements) {
  try { db.exec(sql); }
  catch (e) { db.exec('ROLLBACK;'); console.error('FAILED statement:', sql.slice(0, 160)); throw e; }
}
db.exec('COMMIT;');

const one = (sql: string) => db.prepare(sql).get() as any;
const count = (sql: string) => Number(one(sql)?.n || 0);
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
};

const clearanceProducts = count(`SELECT COUNT(*) n FROM products WHERE id LIKE 'clearance-%' OR UPPER(sku) = 'CLEARANCE'`);
check('no clearance products in catalogue', clearanceProducts === 0, `found ${clearanceProducts}`);

const orphanSale = count(`SELECT COUNT(*) n FROM sale_items WHERE product_id IS NOT NULL AND product_id != '' AND product_id NOT IN (SELECT id FROM products)`);
check('no orphan sale_items', orphanSale === 0, `found ${orphanSale}`);

const orphanPurchase = count(`SELECT COUNT(*) n FROM purchase_items WHERE product_id IS NOT NULL AND product_id != '' AND product_id NOT IN (SELECT id FROM products)`);
check('no orphan purchase_items', orphanPurchase === 0, `found ${orphanPurchase}`);

const clearanceWithPid = count(`SELECT COUNT(*) n FROM sale_items WHERE is_clearance = 1 AND product_id IS NOT NULL`);
check('clearance lines carry NULL product_id', clearanceWithPid === 0, `found ${clearanceWithPid}`);

const clearanceNamed = count(`SELECT COUNT(*) n FROM sale_items WHERE is_clearance = 1 AND (product_name IS NULL OR product_name = '')`);
check('clearance lines keep product_name', clearanceNamed === 0, `found ${clearanceNamed}`);

const base64 = count(`SELECT COUNT(*) n FROM products WHERE images_json LIKE '%data:%'`);
check('no base64 images', base64 === 0, `found ${base64}`);

const sales = one(`SELECT COUNT(*) n, COALESCE(SUM(total_kobo),0) kobo FROM sales`);
console.log(`summary: products=${count('SELECT COUNT(*) n FROM products')} sales=${sales.n} sale_items=${count('SELECT COUNT(*) n FROM sale_items')} sales_total_kobo=${sales.kobo}`);

// Snapshot must build cleanly through the runtime mapper (proves the rows satisfy
// the frontend contract the target app reads).
await (async () => {
  const { stores } = await buildSnapshot(tx.queryAll);
  const snapClearance = (stores.products as any[]).filter((p) => isClearanceItem({productId: p.id, sku: p.sku}));
  check('snapshot has no clearance products', snapClearance.length === 0, `found ${snapClearance.length}`);
  const salesTotal = (stores.sales as any[]).reduce((a, s) => a + Number(s.totalAmount || 0), 0);
  console.log(`snapshot: products=${(stores.products as any[]).length} sales=${(stores.sales as any[]).length} sales_total_naira=${salesTotal}`);
})();

db.close();
if (failures) throw new Error(`CANON-IMPORT VERIFY FAILED (${failures} checks)`);
console.log('CANON-IMPORT VERIFY OK');
