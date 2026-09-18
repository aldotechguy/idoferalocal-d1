/** Dump active-stock analytics from data/d1_storage.db.

Usage:
  npx tsx scripts/dump-mall-live.ts --categories
  npx tsx scripts/dump-mall-live.ts --catalog
*/
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/d1_storage.db');

if (process.argv.includes('--categories')) {
  const rows = db.prepare(`
    SELECT category_name,
           COUNT(*) AS n,
           MIN(stock_qty) AS min_stock,
           SUM(stock_qty) AS total_stock,
           MIN(retail_price_kobo) AS min_price,
           MAX(retail_price_kobo) AS max_price
    FROM products
    WHERE status = 'Active' AND stock_qty > 0
    GROUP BY category_name
    ORDER BY n DESC, category_name
  `).all() as any[];

  console.log('active-stock categories (count | total_stock | price_min..max | min_unit_stock):');
  for (const r of rows) {
    console.log(String(r.category_name) + ' | n=' + r.n + ' | stock=' + r.total_stock + ' | price=' + r.min_price + '..' + r.max_price + ' | min_unit_stock=' + r.min_stock);
  }
  process.exit(0);
}

if (process.argv.includes('--catalog')) {
  const rows = db.prepare(`
    SELECT id, sku, name,
           COALESCE(description, '') AS description,
           COALESCE(brand, '') AS brand,
           COALESCE(unit, 'pcs') AS unit,
           category_name,
           is_mall_listed,
           COALESCE(mall_price_kobo, 0) AS mall_price_kobo,
           retail_price_kobo,
           stock_qty,
           updated_at,
           images_json
    FROM products
    WHERE status = 'Active' AND stock_qty > 0
    ORDER BY COALESCE(mall_price_kobo, retail_price_kobo) DESC
  `).all() as any[];

  const catalog = rows.map((r) => ({
    id: String(r.id),
    sku: String(r.sku),
    name: String(r.name),
    description: String(r.description),
    brand: String(r.brand),
    unit: String(r.unit),
    category: String(r.category_name),
    is_mall_listed: Number(r.is_mall_listed),
    has_mall_price: Number(r.mall_price_kobo) > 0,
    mall_price_kobo: Number(r.mall_price_kobo),
    retail_price_kobo: Number(r.retail_price_kobo),
    stock: Number(r.stock_qty),
    updated_at: String(r.updated_at),
    images: (() => {
      try {
        const arr = JSON.parse(String(r.images_json));
        return Array.isArray(arr) ? arr.map(String) : [];
      } catch {
        return [];
      }
    })(),
  }));

  fs.writeFileSync('tmp_catalog_live.json', JSON.stringify(catalog, null, 2));

  console.log('rows:', catalog.length);
  console.log('mall-listed now:', catalog.filter((p) => p.is_mall_listed).length);
  console.log('has mall_price:', catalog.filter((p) => p.has_mall_price).length);
  console.log('with image url:', catalog.filter((p) => p.images.length > 0).length);
  console.log('sample top 3:');
  console.log(JSON.stringify(catalog.slice(0, 3), null, 2));
  process.exit(0);
}