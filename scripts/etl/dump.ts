/** ETL SQL dump writer: same transforms as run.ts, emits wrangler-importable SQL. */
import fs from 'node:fs';
import path from 'node:path';
import { SOURCE_FILE, parseDump } from './lib.js';
import type { Stmt } from './lib.js';
import { newCtx } from './ctx.js';
import { loadCategories, loadSuppliers } from './part2a.js';
import { loadProducts, loadCustomers } from './part2b.js';
import { loadSales, loadPurchases } from './part2c.js';
import { loadFinance } from './part2d1.js';
import { loadOps } from './part2d2.js';

const esc = (v: any): string => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
};

// Consume params left-to-right, but only for placeholders OUTSIDE quoted literals.
function bindParams(sql: string, params: any[]): string {
  let out = '';
  let pi = 0;
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      if (inStr && sql[i + 1] === "'") { out += "''"; i++; continue; }
      inStr = !inStr;
      out += ch;
      continue;
    }
    if (ch === '?' && !inStr) {
      if (pi >= params.length) throw new Error('Not enough params for: ' + sql.slice(0, 120));
      out += esc(params[pi++]);
      continue;
    }
    out += ch;
  }
  if (pi !== params.length) throw new Error(`Param count mismatch (${pi}/${params.length}): ` + sql.slice(0, 120));
  return out;
}

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
