/**
 * Rebuild the local dev database (data/d1_storage.db) from the migrated `idofera`
 * relational export, so a developer's local store matches the canonical relational
 * data exactly. 100% relational: no document mirror is created.
 *
 * Usage: npx tsx scripts/rebuild-local-from-idofera.ts [--source=backups/idofera-post-migration-<ts>.sql]
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ensureRelationalSchemaNode } from '../src/server/nodeAdapter.js';

const SOURCE = path.resolve(
  process.argv.find((a) => a.startsWith('--source='))?.slice('--source='.length)
  || path.join(process.cwd(), 'backups', 'idofera-post-migration-2026-10-04.sql'),
);
const DB_PATH = path.join(process.cwd(), 'data', 'd1_storage.db');

// Refresh ONLY the business/relational tables from the export. Local auth rows are
// preserved (a developer's own login), and the blob tables are never (re)created.
const TABLES = [
  'receiving_history', 'purchase_items', 'purchases', 'sale_items', 'sales',
  'stock_movements', 'pricing_history', 'money_movements', 'delivery_orders',
  'whatsapp_preorders', 'notifications', 'audit_logs', 'held_orders', 'expenses',
  'customers', 'suppliers', 'product_variants', 'payments', 'reviews',
  'mall_cart_items', 'mall_carts', 'mall_order_items', 'mall_orders',
  'products', 'categories', 'settings',
];

// Statement split that is tolerant of raw newlines inside string literals.
function splitStatements(raw: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inString = false;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!buf && (trimmed.length === 0 || trimmed.startsWith('--'))) continue;
    buf = buf ? `${buf}\n${line}` : line;
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== "'") continue;
      if (inString && line[i + 1] === "'") { i++; continue; }
      inString = !inString;
    }
    if (!inString) { const done = buf.trim(); if (done) out.push(done); buf = ''; }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

const db = new DatabaseSync(DB_PATH);
ensureRelationalSchemaNode(db);

db.exec('BEGIN;');
for (const table of TABLES) {
  try { db.prepare(`DELETE FROM ${table}`).run(); } catch { /* table may not exist yet */ }
}
db.exec('COMMIT;');
console.log(`wiped ${TABLES.length} relational tables`);

const statements = splitStatements(fs.readFileSync(SOURCE, 'utf8'))
  .filter((sql) => {
    // Only replay INSERTs into the business tables (skip DDL / blob / auth).
    const m = sql.match(/^INSERT (?:OR (?:IGNORE|REPLACE) )?INTO "?([a-zA-Z_]+)"?/);
    return Boolean(m && TABLES.includes(m[1]));
  });
console.log(`replaying ${statements.length} statements from ${path.basename(SOURCE)}`);

db.exec('BEGIN;');
let applied = 0;
for (const sql of statements) {
  try { db.exec(sql); applied++; }
  catch (e: any) { console.warn('skipped:', sql.slice(0, 100), '->', e?.message); }
}
db.exec('COMMIT;');

const count = (t: string) => { try { return Number((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as any).n); } catch { return -1; } };
for (const t of ['categories', 'products', 'customers', 'suppliers', 'sales', 'sale_items', 'purchases', 'products']) {
  console.log(`${t.padEnd(18)} ${count(t)}`);
}
const total = Number((db.prepare('SELECT COALESCE(SUM(total_kobo), 0) AS s FROM sales').get() as any).s) / 100;
console.log(`applied ${applied} statements | sales total NGN ${total.toFixed(2)} | LOCAL REBUILD DONE`);
db.close();
