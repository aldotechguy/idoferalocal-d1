/**
 * Push a relational import SQL file to a target D1 via the REST API (bypasses
 * pathological wrangler cold starts on this machine). Used both for Stage A
 * (blob -> `idofera-d1` relational) and Stage B (relational -> `idofera`).
 *
 * The dump is one statement per line EXCEPT when a payload embeds a raw newline
 * (legacy description/notes); the splitter tracks single-quote parity so such a
 * statement is reassembled instead of being cut in half.
 *
 * Safe to re-run: the file starts with the full-refresh DELETEs, so a partial
 * earlier run simply converges.
 *
 * Run:
 *   npx tsx scripts/etl/push-import.ts [--file=backups/<file>.sql] [--db=<database_id>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { executeD1, queryD1 } from './lib.js';

function arg(name: string, fallback: string): string {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
}
const FILE = path.resolve(arg('file', './backups/idofera-relational-import.sql'));
const DATABASE_ID = arg('db', '3a3eb157-5aa5-419a-a8ce-2eade2afc436'); // live `idofera`

function splitStatements(raw: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inString = false;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!buf && (trimmed.length === 0 || trimmed.startsWith('--'))) continue;
    buf = buf ? `${buf}\n${line}` : line;
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== "'") continue;
      if (inString && line[i + 1] === "'") { i++; continue; }
      inString = !inString;
    }
    if (!inString) { const done = buf.trim(); if (done && !done.startsWith('--')) out.push(done); buf = ''; }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

const statements = splitStatements(fs.readFileSync(FILE, 'utf8'));
console.log(`file: ${FILE}`);
console.log(`statements: ${statements.length}  target: ${DATABASE_ID}`);
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

const check = await queryD1(`SELECT
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
  (SELECT COUNT(*) FROM products WHERE id LIKE 'clearance-%' OR UPPER(sku) = 'CLEARANCE') AS clearance_products,
  (SELECT COUNT(*) FROM products WHERE images_json LIKE '%data:%') AS base64_products`, [], DATABASE_ID);
console.log('VERIFY:', JSON.stringify(check[0] || check, null, 1));

