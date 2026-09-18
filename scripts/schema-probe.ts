/** Dump the currently mall-listed products from data/d1_storage.db.
 * Single source of truth for the Phase 5 hero set: we publish the DB, not whatever script named it.
 */
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/d1_storage.db');

const rows = db.prepare(
  `SELECT id, sku, name,
          COALESCE(mall_price_kobo, retail_price_kobo) AS price_kobo,
          retail_price_kobo,
          stock_qty,
          COALESCE(category_name, '') AS category,
          COALESCE(brand, '') AS brand,
          COALESCE(unit, 'pcs') AS unit,
          images_json,
          is_mall_listed,
          status,
          updated_at
   FROM products
   WHERE is_mall_listed = 1 AND status = 'Active'
   ORDER BY COALESCE(mall_price_kobo, retail_price_kobo) DESC`
).all() as any[];

console.log(`mall-listed / active rows: ${rows.length}`);

const byId: Record<string, any> = {};
for (const r of rows) {
  byId[r.id] = r;
}

function firstImg(r: any): string {
  try {
    const arr = JSON.parse(String(r.images_json ?? '[]'));
    if (Array.isArray(arr) && arr.length) return String(arr[0]);
  } catch {}
  return 'no-image';
}

console.log('--- currently mall-listed ---');
for (const r of rows) {
  console.log(
    `${r.id}\n  sku=${r.sku} name=${r.name}\n  category=${r.category} brand=${r.brand} unit=${r.unit}\n  mall_or_retail=${(Number(r.price_kobo) / 100).toFixed(2)} | retail=${(Number(r.retail_price_kobo) / 100).toFixed(2)} | stock=${r.stock_qty}\n  updated=${r.updated_at}\n  image=${firstImg(r)}`
  );
}

console.log('--- categories present ---');
const cats = [...new Set(rows.map((r) => r.category).filter(Boolean))];
for (const c of cats) {
  const inCat = rows.filter((r) => r.category === c);
  console.log(`${c}: ${inCat.length} row(s)`);
}

console.log('--- price tiers ---');
const min = Math.min(...rows.map((r) => Number(r.price_kobo)));
const max = Math.max(...rows.map((r) => Number(r.price_kobo)));
console.log(`min=${(min / 100).toFixed(2)} | max=${(max / 100).toFixed(2)}`);

console.log('--- raw ids (for hero selection) ---');
for (const r of rows) {
  console.log(r.id);
}

// Convenience: a stable, reviewable hero list derived from the live rows.
// If you want a smaller curated set, pick from these ids after reviewing the dump above.
const CURRENT_HERO_IDS = rows.map((r) => r.id);
console.log('--- current hero candidate ids ---');
for (const id of CURRENT_HERO_IDS) {
  console.log(id);
}

// Verification: we expect at least one mall-listed row, and the ids file should match the DB.
(() => {
  if (rows.length === 0) {
    console.error('VERIFY FAILED: no mall-listed rows in DB.');
    process.exit(1);
  }
  const dbIds = new Set(rows.map((r) => r.id));
  for (const id of CURRENT_HERO_IDS) {
    if (!dbIds.has(id)) {
      console.error('VERIFY FAILED: hero id missing in current DB:', id);
      process.exit(1);
    }
  }
  console.log('VERIFY OK: current mall-listed ids match DB.');
})();
