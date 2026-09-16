/**
 * Phase 4 — rebuild data/d1_storage.db's relational tables from its own legacy
 * mirror (app_documents), using the exact same bridge the dev server uses on
 * first boot. users / app_documents / sync_revisions are left untouched.
 */
import { DatabaseSync } from 'node:sqlite';
import { backfillStatementsFromDocumentRows } from '../src/server/relationalWrites.js';

const db = new DatabaseSync('./data/d1_storage.db');
const TABLES = [
  'receiving_history', 'purchase_items', 'purchases', 'sale_items', 'sales',
  'stock_movements', 'pricing_history', 'money_movements', 'delivery_orders',
  'whatsapp_preorders', 'notifications', 'audit_logs', 'held_orders', 'expenses',
  'customers', 'suppliers', 'product_variants', 'payments', 'reviews',
  'mall_cart_items', 'mall_carts', 'mall_order_items', 'mall_orders',
  'products', 'categories', 'settings',
];

db.exec('BEGIN;');
for (const table of TABLES) db.prepare(`DELETE FROM ${table}`).run();
db.exec('COMMIT;');
console.log(`wiped ${TABLES.length} relational tables`);

const rows = db.prepare('SELECT owner_id, collection, payload, updated_at FROM app_documents ORDER BY updated_at').all() as any[];
const { stmts, skipped, collapsed } = backfillStatementsFromDocumentRows(rows, new Date().toISOString());
db.exec('BEGIN;');
for (const st of stmts) db.prepare(st.sql).run(...(st.params || []));
db.exec('COMMIT;');

const count = (table: string) => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n);
console.log(`rebuilt from ${rows.length} mirror rows | statements=${stmts.length} skipped=${skipped} collapsed=${JSON.stringify(collapsed)}`);
for (const table of ['categories', 'products', 'customers', 'suppliers', 'sales', 'sale_items', 'purchases', 'purchase_items', 'expenses', 'stock_movements', 'audit_logs']) {
  console.log(`${table.padEnd(18)} ${count(table)}`);
}
const total = Number((db.prepare('SELECT COALESCE(SUM(total_kobo), 0) AS s FROM sales').get() as any).s) / 100;
console.log(`sales total NGN ${total.toFixed(2)}`);
console.log('LOCAL REBUILD DONE');