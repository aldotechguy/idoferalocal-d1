import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { effectivePrice } from '../src/server/mallApi';
import { hasMallPrice } from '../src/shared/mallProductPresentation';

// Read-only audit: no catalog values are changed or invented.
const db = new DatabaseSync(resolve(process.argv[2] || 'data/d1_storage.db'), { readOnly: true });
const output = resolve(process.argv[3] || 'mall-catalog-completion.csv');
try {
  const rows = db.prepare(`SELECT id,sku,name,images_json,
    COALESCE(NULLIF(TRIM(mall_description),''),TRIM(description),'') AS description,
    ${effectivePrice('products')} AS price
    FROM products WHERE status <> 'Archived' ORDER BY name,id`).all();
  const report = [['ID', 'SKU', 'Product', 'Needs price', 'Needs image', 'Needs description']];
  for (const row of rows) {
    let images: unknown = [];
    try { images = JSON.parse(String(row.images_json || '[]')); } catch { /* Invalid image data needs correction. */ }
    const missingPrice = !hasMallPrice(Number(row.price));
    const missingImage = !Array.isArray(images) || !images.some(image => typeof image === 'string' && image.trim());
    const missingDescription = !row.description;
    if (missingPrice || missingImage || missingDescription) report.push([
      String(row.id), String(row.sku), String(row.name),
      missingPrice ? 'Yes' : '', missingImage ? 'Yes' : '', missingDescription ? 'Yes' : '',
    ]);
  }
  const quote = (value: string) => `"${(/^[=+@\-\t\r]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
  writeFileSync(output, '\uFEFF' + report.map(row => row.map(quote).join(',')).join('\r\n') + '\r\n');
  console.log(`${report.length - 1} products need catalog content. Report: ${output}`);
} finally { db.close(); }