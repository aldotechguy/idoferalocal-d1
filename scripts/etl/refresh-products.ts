/**
 * Phase 4 — targeted refresh of the `products` table from the legacy dump, using the
 * SAME mapper the running server uses (src/server/relationalMapper.ts). Needed because
 * the original ETL wrongly stripped base64 product images; re-running the whole import
 * is unnecessary (and risky) when only one table changed.
 * Run: npx tsx scripts/etl/refresh-products.ts
 * Apply: npx wrangler d1 execute idofera --remote --yes --file=./backups/idofera-products-refresh.sql
 */
import fs from 'node:fs';
import path from 'node:path';
import { SOURCE_FILE, parseDump, bindParams } from './lib.js';
import { upsertToStatements, collectionTables } from '../../src/server/relationalWrites.js';

const { docs } = parseDump(fs.readFileSync(SOURCE_FILE, 'utf8'));
const now = new Date().toISOString();
// Last occurrence wins per product id (matches the live app's insert-or-replace behaviour).
const latest = new Map<string, any>();
let skipped = 0;
for (const d of docs) {
  if (d.collection !== 'products') continue;
  try {
    const parsed = JSON.parse(d.payload);
    const id = String(parsed?.id || d.docId);
    if (!id || typeof parsed !== 'object') { skipped += 1; continue; }
    latest.set(id, parsed);
  } catch {
    skipped += 1;
  }
}

const stmts = [...latest.values()].flatMap((p) => upsertToStatements('products', p, now));
const tables = collectionTables('products');
if (tables.length !== 1 || tables[0] !== 'products') throw new Error('unexpected product table map');

const out: string[] = ['PRAGMA defer_foreign_keys=TRUE;'];
for (const s of stmts) {
  const sql = bindParams(s.sql, s.params || []);
  out.push(sql.endsWith(';') ? sql : `${sql};`);
}
const outPath = path.join(process.cwd(), 'backups', 'idofera-products-refresh.sql');
fs.writeFileSync(outPath, out.join('\n'));

const withBase64 = [...latest.values()].filter((p) =>
  Array.isArray(p.images) && p.images.some((u: unknown) => typeof u === 'string' && String(u).startsWith('data:'))).length;
console.log(`products=${latest.size} (base64 images=${withBase64}) statements=${stmts.length} skipped=${skipped}`);
console.log(`bytes=${(fs.statSync(outPath).size / 1048576).toFixed(2)}MB -> ${outPath}`);