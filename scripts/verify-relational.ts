/** Phase 4c â€” verify relational layer maps rows identically to ETL. */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { makeNodeAdapter, ensureRelationalSchemaNode } from '../src/server/nodeAdapter.js';
import { buildSnapshot } from '../src/server/relationalSnapshot.js';
import { upsertToStatements, backfillStatementsFromDocumentRows } from '../src/server/relationalWrites.js';
import { cleanImageList } from '../src/server/relationalMapper.js';
import { parseDump } from './etl/lib.js';
import { newCtx } from './etl/ctx.js';
import { loadCategories, loadSuppliers } from './etl/part2a.js';
import { loadProducts, loadCustomers } from './etl/part2b.js';
import { loadSales, loadPurchases } from './etl/part2c.js';
import { loadFinance } from './etl/part2d1.js';
import { loadOps } from './etl/part2d2.js';

const db = new DatabaseSync(':memory:');
ensureRelationalSchemaNode(db);
const tx = makeNodeAdapter(db);

// Seed :memory: DB using the SAME ETL transforms (proves mapper == ETL).
const src = fs.readFileSync('./backups/idofera-d1-2026-09-15.sql', 'utf8');
const { docs } = parseDump(src);
const byCol = new Map<string, typeof docs>();
for (const d of docs) {
  if (!byCol.has(d.collection)) byCol.set(d.collection, []);
  byCol.get(d.collection)!.push(d);
}
const ctx = newCtx();
// Freeze the clock: ETL fallback timestamps (nowIso()) and the backfill's `now`
// fallback must be byte-identical â€” wall-clock drift is not data drift.
const FIXED_TS = Date.parse('2026-09-15T00:00:00.000Z');
const realDateNow = Date.now;
Date.now = () => FIXED_TS;
const stmts: { sql: string; params?: any[] }[] = [];
loadCategories(byCol, stmts, ctx);
loadSuppliers(byCol, stmts, ctx);
loadProducts(byCol, stmts, ctx);
loadCustomers(byCol, stmts, ctx);
loadSales(byCol, stmts, ctx);
loadPurchases(byCol, stmts, ctx);
loadFinance(byCol, stmts, ctx);
loadOps(byCol, stmts, ctx);
Date.now = realDateNow;
db.exec('BEGIN;');
for (const s of stmts) db.prepare(s.sql).run(...(s.params || []));
db.exec('COMMIT;');
console.log(`seeded ${stmts.length} stmts`);

// Build snapshot through the NEW Phase 4 mapper and check shape/totals.
const { stores: snap } = await buildSnapshot(tx.queryAll);
const salesTotal = (snap.sales as any[]).reduce((a, x) => a + Number(x.totalAmount || 0), 0);
console.log('snapshot collections:', Object.keys(snap).map((k) => `${k}=${(snap[k] as any[]).length}`).join(' '));
console.log('sales total naira:', salesTotal, 'expected 1113680');
console.log('products:', (snap.products as any[]).length, 'expected 117 (106 + 11 placeholders)');
const p0 = (snap.products as any[])[0];
console.log('sample product keys:', Object.keys(p0).sort().join(','));
const s0 = (snap.sales as any[])[0];
console.log('sample sale keys:', Object.keys(s0).sort().join(','), '| items:', (s0.items as any[]).length);

// Image policy: base64 photos must NOT enter relational storage (D1 SQLITE_TOOBIG),
// URL images must survive, and the base64 originals must be recoverable from the
// extraction job. Parity: ETL output === what the running mapper would write.
const srcProducts = byCol.get('products') || [];
const srcWithBase64 = srcProducts.filter((d) => {
  try {
    const doc = JSON.parse(d.payload);
    return Array.isArray(doc.images) && doc.images.some((u: unknown) => String(u).startsWith('data:'));
  } catch {
    return false;
  }
});
const dbBase64Rows = await tx.queryAll("SELECT id FROM products WHERE images_json LIKE '%data:%'");
console.log('source products with base64 photos:', srcWithBase64.length, '| relational rows holding base64:', dbBase64Rows.length);
if (dbBase64Rows.length !== 0) throw new Error('base64 leaked into relational products.images_json');

const srcWithUrls = srcProducts.filter((d) => {
  try {
    const doc = JSON.parse(d.payload);
    return Array.isArray(doc.images) && doc.images.some((u: unknown) => !String(u).startsWith('data:'));
  } catch {
    return false;
  }
});
for (const d of srcWithUrls) {
  const doc = JSON.parse(d.payload);
  const expected = JSON.stringify(cleanImageList(doc.images));
  const actual = await tx.queryAll('SELECT images_json FROM products WHERE id = ?', [String(doc.id)]);
  if (!actual.length) continue;
  if ((actual[0] as any).images_json !== expected) throw new Error(`image policy drift on ${doc.id}`);
}
console.log('image policy OK (ETL === mapper, base64 excluded, URL images preserved)');

const manifestPath = './backups/images/manifest.json';
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  console.log('extracted base64 originals:', manifest.images.length, 'from', manifest.products, 'products (Phase 4.5 R2 input)');
  if (!manifest.images.length) throw new Error('extraction manifest is empty');
}
const now = new Date(FIXED_TS).toISOString();
const prodStmts = upsertToStatements('products', { ...(p0 as object), name: (p0 as any).name, currentStock: 777 }, now);
for (const st of prodStmts) tx.run(st.sql, st.params);
const check = await tx.queryAll('SELECT stock_qty FROM products WHERE id = ?', [(p0 as any).id]);
console.log('product write round-trip stock_qty:', (check[0] as any).stock_qty, 'expected 777');
if ((check[0] as any).stock_qty !== 777) throw new Error('product round-trip FAILED');
if (Math.round(salesTotal) !== 1113680) throw new Error('sales total MISMATCH');
// DRIFT GUARD: the Phase 4 backfill bridge must land on the SAME relational
// content as the ETL when fed the same documents. One DB is seeded through the
// ETL loaders, a second through backfillStatementsFromDocumentRows; identical
// per-collection snapshots are the contract that keeps local dev, the edge
// worker and D1 `idofera` in sync.
const backfillDb = new DatabaseSync(':memory:');
ensureRelationalSchemaNode(backfillDb);
const btx = makeNodeAdapter(backfillDb);
const bf = backfillStatementsFromDocumentRows(
  docs.map((d) => ({ collection: d.collection, payload: d.payload, owner: d.owner, updatedAt: d.updatedAt })),
  now,
);
backfillDb.exec('BEGIN;');
for (const st of bf.stmts) btx.run(st.sql, st.params);
backfillDb.exec('COMMIT;');
const { stores: bSnapAll } = await buildSnapshot(btx.queryAll);
let drift = 0;
for (const key of Object.keys(snap)) {
  const norm = (rows: any[]) => JSON.stringify([...(rows || [])].sort((x, y) => String(x?.id ?? '').localeCompare(String(y?.id ?? ''))));
  const a = norm((snap as any)[key]);
  const b = norm((bSnapAll as any)[key]);
  if (a !== b) {
    drift += 1;
    console.log(`DRIFT in ${key}: etl=${JSON.parse(a).length} backfill=${JSON.parse(b).length}`);
    const pa = JSON.parse(a);
    const pb = JSON.parse(b);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      if (JSON.stringify(pa[i]) !== JSON.stringify(pb[i])) {
        const keys = new Set([...Object.keys(pa[i] || {}), ...Object.keys(pb[i] || {})]);
        const diffs = [...keys].filter((k) => JSON.stringify(pa[i]?.[k]) !== JSON.stringify(pb[i]?.[k]));
        console.log(`  doc#${i} id=${pa[i]?.id ?? pb[i]?.id} differing keys: ${diffs.join(', ')}`);
        for (const k of diffs) console.log(`    ${k}: etl=${JSON.stringify(pa[i]?.[k])} backfill=${JSON.stringify(pb[i]?.[k])}`);
        break;
      }
    }
  }
}
if (drift) throw new Error(`ETL vs backfill DRIFT in ${drift} collection(s)`);
console.log('drift guard OK: ETL seed === backfill seed (identical snapshots)');
console.log('PHASE4-VERIFY OK');
