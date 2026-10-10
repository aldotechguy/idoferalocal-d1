/**
 * Phase 4 — completely clear the target `idofera` before the canon load.
 *
 * Deletes EVERY row from every table (child -> parent order so FK-safe), so no
 * test/stale data survives. This is destructive by design and is the first half of
 * the "empty target" cutover.
 *
 * Safety: requires `--yes` to actually execute. Without it, prints the plan only.
 * Always export the target first:  npx tsx scripts/etl/export-d1.ts --db=<id> --out=backups/<name>.sql
 *
 * Usage:
 *   npx tsx scripts/etl/wipe-target.ts --db=<database_id> [--yes]
 */
import { executeD1, queryD1, API_TOKEN } from './lib.js';

function arg(name: string, fallback: string): string {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
}
const DATABASE_ID = arg('db', '3a3eb157-5aa5-419a-a8ce-2eade2afc436'); // live `idofera`
const CONFIRM = process.argv.includes('--yes');

// Child -> parent. Every table the schema can create, plus legacy/transient tables
// that may exist on the live DB. `DELETE FROM` on a missing table is tolerated.
const WIPE_ORDER = [
  // mall children first
  'mall_cart_items', 'mall_carts', 'mall_order_items', 'mall_orders', 'mall_order_events',
  'mall_outbox', 'mall_returns', 'mall_checkout_attempts', 'mall_write_guards',
  'mall_webhook_deliveries', 'mall_rate_limits', 'mall_metrics', 'mall_job_runs',
  'mall_schema_versions',
  // POS children -> parents
  'receiving_history', 'purchase_items', 'purchases', 'sale_items', 'sales',
  'pricing_history', 'stock_movements', 'money_movements', 'expenses',
  'delivery_orders', 'held_orders', 'whatsapp_preorders', 'notifications',
  'audit_logs', 'product_variants', 'products', 'categories', 'customers', 'suppliers',
  'payments', 'reviews', 'settings', 'sync_revisions',
  // auth + document mirror LAST (so a failed run still has logins)
  'app_sessions', 'staff_entrances', 'users', 'app_users', 'app_documents',
];

async function count(table: string): Promise<number | null> {
  const rows = await queryD1(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(rows?.[0]?.n ?? 0);
}

/** Probe a table's existence without swallowing auth/transport errors. */
async function probe(table: string): Promise<boolean> {
  const rows = await queryD1(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`, [table]);
  return rows.length > 0;
}

async function main() {
  if (!API_TOKEN) throw new Error('CLOUDFLARE_API_TOKEN is required (set it in .env).');
  console.log(`wipe target D1 ${DATABASE_ID}  confirm=${CONFIRM}`);
  for (const table of WIPE_ORDER) {
    if (!(await probe(table))) { console.log(`  skip  ${table} (absent)`); continue; }
    const before = await count(table);
    if (!CONFIRM) { console.log(`  plan  ${table}  rows=${before}`); continue; }
    await executeD1([{ sql: `DELETE FROM ${table}` }]);
    const after = await count(table);
    console.log(`  clear ${table}  ${before} -> ${after}`);
  }
  console.log(CONFIRM ? 'WIPE COMPLETE' : 'DRY PLAN (re-run with --yes to execute)');
}

main().catch((e) => { console.error('wipe-target fatal:', e); process.exit(1); });
