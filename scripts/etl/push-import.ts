/**
 * Phase 4 — push backups/idofera-relational-import.sql to D1 `idofera` via the
 * REST API (bypasses pathological wrangler cold starts on this machine).
 * The dump file is one statement per line (dump.ts joins with '\n'), so a line
 * split is an exact statement split. Safe to re-run: the file starts with the
 * full-refresh DELETEs, so a partial earlier run simply converges.
 * Run: npx tsx scripts/etl/push-import.ts
 */
import fs from 'node:fs';
import { executeD1 } from './lib.js';

const raw = fs.readFileSync('./backups/idofera-relational-import.sql', 'utf8');
const statements = raw
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('--'));

console.log(`statements: ${statements.length}`);
let done = 0;
for (const sql of statements) {
  try {
    await executeD1([{ sql }]);
  } catch (e) {
    // PRAGMA defer_foreign_keys is best-effort; anything else is fatal.
    if (sql.toUpperCase().startsWith('PRAGMA')) {
      console.warn(`skipped: ${sql}`);
    } else {
      console.error(`FAILED: ${sql.slice(0, 160)}`);
      throw e;
    }
  }
  done += 1;
  if (done % 250 === 0) console.log(`progress ${done}/${statements.length}`);
}
console.log(`pushed ${done} statements`);

const check = await executeD1([
  {
    sql: `SELECT
      (SELECT COUNT(*) FROM products) AS products,
      (SELECT COUNT(*) FROM categories) AS categories,
      (SELECT COUNT(*) FROM sales) AS sales,
      (SELECT COUNT(*) FROM sale_items) AS sale_items,
      (SELECT COUNT(*) FROM purchases) AS purchases,
      (SELECT COUNT(*) FROM customers) AS customers,
      (SELECT COUNT(*) FROM suppliers) AS suppliers,
      (SELECT COUNT(*) FROM delivery_orders) AS deliveries,
      (SELECT COUNT(*) FROM whatsapp_preorders) AS preorders,
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COALESCE(SUM(total_kobo), 0) FROM sales) AS sales_total_kobo,
      (SELECT COUNT(*) FROM products WHERE description != '') AS with_description,
      (SELECT COUNT(*) FROM delivery_orders WHERE updated_at IS NOT NULL) AS deliveries_with_updated_at`,
  },
]);
console.log('VERIFY:', JSON.stringify((check as any)?.[0] || check, null, 1));
