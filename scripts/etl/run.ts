/** ETL runner: parse dump -> build statements -> dry-run report or push to D1. */
import fs from 'node:fs';
import path from 'node:path';
import { SOURCE_FILE, DRY_RUN, DATABASE_ID, parseDump, executeD1 } from './lib.js';
import { newCtx } from './ctx.js';
import { loadCategories, loadSuppliers } from './part2a.js';
import { loadProducts, loadCustomers } from './part2b.js';
import { loadSales, loadPurchases } from './part2c.js';
import { loadFinance } from './part2d1.js';
import { loadOps } from './part2d2.js';

async function main() {
  console.log('Phase 3 ETL -> relational `idofera`');
  console.log(`Source: ${SOURCE_FILE} dry-run=${DRY_RUN} target=${DATABASE_ID}`);
  const { docs } = parseDump(fs.readFileSync(SOURCE_FILE, 'utf8'));
  const byCol = new Map<string, (typeof docs)[number][]>();
  for (const d of docs) {
    if (!byCol.has(d.collection)) byCol.set(d.collection, []);
    byCol.get(d.collection)!.push(d);
  }
  for (const [c, rows] of [...byCol.entries()].sort((a, b) => b[1].length - a[1].length))
    console.log(`  ${c.padEnd(18)} ${rows.length}`);
  const ctx = newCtx();
  const stmts: { sql: string; params?: any[] }[] = [];
  // Legacy app_users -> relational users is handled in dump.ts (users INSERT OR IGNORE).
  // run.ts loads everything else via the D1 REST API.
  loadCategories(byCol, stmts, ctx);
  loadSuppliers(byCol, stmts, ctx);
  loadProducts(byCol, stmts, ctx);
  loadCustomers(byCol, stmts, ctx);
  loadSales(byCol, stmts, ctx);
  loadPurchases(byCol, stmts, ctx);
  loadFinance(byCol, stmts, ctx);
  loadOps(byCol, stmts, ctx);
  const skipped = (byCol.get('test_coll') || []).length;
  console.log(`categories=${ctx.categoryByName.size} products=${byCol.get('products')?.length || 0} strippedImages=${ctx.strippedImages} placeholders=${ctx.placeholderProducts} sales=${ctx.salesCount}/${ctx.saleItemsCount} totalKobo=${ctx.salesTotalKobo} skipped=${skipped} errors=${ctx.errors.length} stmts=${stmts.length}`);
  fs.writeFileSync(path.join(process.cwd(), 'backups', 'etl-report.json'), JSON.stringify({ at: new Date().toISOString(), docs: docs.length, stmts: stmts.length, cats: ctx.categoryByName.size, products: byCol.get('products')?.length || 0, strippedImages: ctx.strippedImages, placeholders: ctx.placeholderProducts, sales: ctx.salesCount, saleItems: ctx.saleItemsCount, salesTotalKobo: ctx.salesTotalKobo, skipped, errors: ctx.errors }, null, 2));
  if (DRY_RUN) { console.log('DRY RUN ok — no writes.'); return; }
  let done = 0;
  for (let i = 0; i < stmts.length; i += 25) {
    await executeD1(stmts.slice(i, i + 25));
    done = Math.min(i + 25, stmts.length);
    process.stdout.write(`\rProgress ${done}/${stmts.length}`);
  }
  console.log('\nETL load complete.');
}
main().catch((e) => { console.error('ETL fatal:', e); process.exit(1); });
