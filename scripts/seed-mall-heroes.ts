/** Mark 7 curated mall hero products as mall-listed in data/d1_storage.db.
 * Does NOT create new rows. Only updates:
 *   - is_mall_listed = 1
 *   - optionally mall_price_kobo (mall-specific retail price)
 *   - optionally mall_description
 * Uses the SAME db path that server.ts opens, so updates are visible immediately
 * to the node mall executor.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const DB_PATH = 'data/d1_storage.db';
const LISTING_STEP_PCT = 0.85; // mall price = 85% of retail (20% off headline)

const HERO_IDS = [
  { id: 'prod-imp-1785576583554-82', name: 'Large Travel Nylon Bag', mallPrice: 300000 },
  { id: 'prod-imp-1785576583547-0', name: 'Translucent 1L Bucket', mallPrice: 40000 },
  { id: 'prod-imp-1785576583550-11', name: 'Cream Jar 200g', mallPrice: 20000 },
  { id: 'prod-imp-1785576583551-36', name: 'Small Foil Plate', mallPrice: 10000 },
  { id: 'prod-imp-1785576583551-25', name: 'Long Plain Bottle 25cl', mallPrice: 11000 },
  { id: 'prod-1785999491663', name: 'Clear TPouch 2kg', mallPrice: 20000 },
  { id: 'prod-imp-1785576583553-73', name: 'Small Chops Pouch', mallPrice: 10000 },
];

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');

const missingIds = HERO_IDS.filter((h) => {
  const row = db.prepare('SELECT id, status, stock_qty, retail_price_kobo, is_mall_listed FROM products WHERE id = ?').get(h.id) as any;
  return !row || row.status !== 'Active' || row.stock_qty <= 0;
});

if (missingIds.length) {
  console.error('Hero products not found or not sellable:');
  missingIds.forEach((h) => console.error('  ' + h.id));
  process.exit(1);
}

const existingCount = db.prepare('SELECT COUNT(*) AS n FROM products WHERE is_mall_listed = 1').get() as any;
console.log('currently mall-listed rows:', existingCount.n);

const now = new Date().toISOString();
let updated = 0;
for (const h of HERO_IDS) {
  const row = db.prepare('SELECT id, retail_price_kobo, mall_price_kobo FROM products WHERE id = ?').get(h.id) as any;
  const mallPrice = (h.mallPrice ?? Math.round(Number(row.retail_price_kobo) * LISTING_STEP_PCT)) as number;

  db.prepare(`
    UPDATE products
    SET is_mall_listed = 1,
        mall_price_kobo = ?,
        mall_description = ?,
        updated_at = ?
    WHERE id = ?
  `).run(mallPrice, 'Featured item on the storefront, shown with the mall price.', now, h.id);

  updated++;
}

const afterCount = db.prepare('SELECT COUNT(*) AS n FROM products WHERE is_mall_listed = 1').get() as any;
console.log('updated hero rows:', updated, '/ now mall-listed rows:', afterCount.n);

fs.writeFileSync('tmp_hero_list.json', JSON.stringify(HERO_IDS.map((h) => ({ id: h.id, name: h.name })), null, 2));