/** ETL SQL dump writer: same transforms as run.ts, emits wrangler-importable SQL. */
import fs from 'node:fs';
import path from 'node:path';
import { SOURCE_FILE, parseDump, bindParams } from './lib.js';
import type { Stmt } from './lib.js';
import { newCtx } from './ctx.js';
import { loadCategories, loadSuppliers } from './part2a.js';
import { loadProducts, loadCustomers } from './part2b.js';
import { loadSales, loadPurchases } from './part2c.js';
import { loadFinance } from './part2d1.js';
import { loadOps } from './part2d2.js';

async function main() {
  const { docs, userInserts } = parseDump(fs.readFileSync(SOURCE_FILE, 'utf8'));
  const byCol = new Map<string, (typeof docs)[number][]>();
  for (const d of docs) {
    if (!byCol.has(d.collection)) byCol.set(d.collection, []);
    byCol.get(d.collection)!.push(d);
  }
  const ctx = newCtx();
  const stmts: Stmt[] = [];
  // app_users (legacy name) -> users (new relational name). Column shapes match.
  const out: string[] = ['PRAGMA defer_foreign_keys=TRUE;'];
  // --full-refresh: wipe child tables first so re-running the ETL on an existing
  // D1 (e.g. after a mapping fix) is deterministic instead of PK-conflicting.
  if (process.argv.includes('--full-refresh')) {
    const wipeOrder = [
      'receiving_history', 'purchase_items', 'purchases', 'sale_items', 'sales',
      'mall_cart_items', 'mall_carts', 'mall_order_items', 'mall_orders', 'reviews',
      'payments', 'stock_movements', 'pricing_history', 'money_movements',
      'delivery_orders', 'held_orders', 'whatsapp_preorders', 'notifications',
      'audit_logs', 'expenses', 'product_variants', 'products', 'categories',
      'customers', 'suppliers', 'settings',
    ];
    for (const table of wipeOrder) out.push(`DELETE FROM "${table}";`);
    // users/sessions keep their rows so the app stays authenticated.
    out.push('-- full refresh: users + app_sessions preserved');
  }
  for (const sql of userInserts)
    out.push(sql.replace('"app_users"', '"users"').replace('INSERT INTO "users"', 'INSERT OR IGNORE INTO "users"'));
  loadCategories(byCol, stmts, ctx);
  loadSuppliers(byCol, stmts, ctx);
  loadProducts(byCol, stmts, ctx);
  loadCustomers(byCol, stmts, ctx);
  loadSales(byCol, stmts, ctx);
  loadPurchases(byCol, stmts, ctx);
  loadFinance(byCol, stmts, ctx);
  loadOps(byCol, stmts, ctx);
  // Reorder: placeholders (INSERT ... ON CONFLICT DO NOTHING into products) are emitted
  // inline during sales/purchases — hoist all product INSERTs first so no ordering issue.
  const isProductInsert = (s: Stmt) => s.sql.startsWith('INSERT INTO products');
  const prodStmts = stmts.filter(isProductInsert);
  const restStmts = stmts.filter((s) => !isProductInsert(s));
  const render = (s: Stmt): string => {
    const sql = bindParams(s.sql, s.params || []);
    return sql.endsWith(';') ? sql : sql + ';';
  };
  for (const s of [...prodStmts, ...restStmts]) out.push(render(s));
  const outPath = path.join(process.cwd(), 'backups', 'idofera-relational-import.sql');
  fs.writeFileSync(outPath, out.join('\n'));
  console.log(`Wrote ${out.length} statements -> ${outPath}`);
  console.log(`cats=${ctx.categoryByName.size} placeholders=${ctx.placeholderProducts} sales=${ctx.salesCount}/${ctx.saleItemsCount} errors=${ctx.errors.length}`);
}
main().catch((e) => { console.error('dump fatal:', e); process.exit(1); });
