/**
 * Phase 5 (Stage B) — table-to-table canon move: source D1 -> target `idofera`.
 *
 * After Stage A has materialised the `idofera-d1` blob into relational tables, this
 * copies those tables STRAIGHT ACROSS (no JSON re-derivation, no document blob).
 * It reads rows from the source via REST and bulk-inserts them into the target.
 *
 * Excluded by design:
 *   - app_documents / sync_revisions  (the blob — the target stays 100% relational)
 *   - transient / operational mall tables (outbox, webhook deliveries, metrics,
 *     rate limits, job runs, checkout attempts, write guards, schema versions)
 *   - app_sessions / staff_entrances  (live sessions must not be cloned)
 * Auth: app_users -> users is copied (accounts + password hashes come across).
 *
 * Safety: requires --yes to write. Always export the target first.
 *
 * Usage:
 *   npx tsx scripts/etl/move-canon.ts --from=<source_db_id> [--to=<target_db_id>] [--yes]
 */
import { queryD1, executeD1, API_TOKEN } from './lib.js';

function arg(name: string, fallback: string): string {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
}
const FROM = arg('from', '3e95a550-a091-490b-819d-f0acb7ea8dd8'); // `idofera-d1`
const TO = arg('to', '3a3eb157-5aa5-419a-a8ce-2eade2afc436'); // `idofera`
const CONFIRM = process.argv.includes('--yes');

// Parent-first so FK-safe inserts; children follow their parents.
const TABLES = [
  'categories', 'suppliers', 'customers', 'products', 'product_variants',
  'sales', 'sale_items', 'purchases', 'purchase_items', 'receiving_history',
  'expenses', 'stock_movements', 'pricing_history', 'money_movements',
  'delivery_orders', 'held_orders', 'whatsapp_preorders', 'notifications',
  'audit_logs', 'settings', 'payments', 'reviews',
  'mall_carts', 'mall_cart_items', 'mall_orders', 'mall_order_items',
  'users', // from app_users on the source, copied as-is
];
const USERS_FROM = 'app_users';

const esc = (v: any): string => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return `'${String(v).replace(/'/g, "''")}'`;
};

async function columnsOf(db: string, table: string): Promise<string[]> {
  try {
    const rows = await queryD1(`PRAGMA table_info(${table})`, [], db);
    return rows.map((r: any) => String(r.name));
  } catch { return []; }
}

async function moveTable(table: string): Promise<number> {
  const srcCols = await columnsOf(FROM, table === 'users' ? USERS_FROM : table);
  if (!srcCols.length) { console.log(`  skip  ${table} (absent on source)`); return 0; }
  const dstCols = await columnsOf(TO, table);
  if (!dstCols.length) { console.log(`  skip  ${table} (absent on target)`); return 0; }
  const shared = srcCols.filter((c) => dstCols.includes(c));
  if (!shared.length) { console.log(`  skip  ${table} (no shared columns)`); return 0; }

  const rows = await queryD1(`SELECT ${shared.join(', ')} FROM ${table === 'users' ? USERS_FROM : table}`, [], FROM);
  if (!rows.length) { console.log(`  none  ${table}`); return 0; }
  if (!CONFIRM) { console.log(`  plan  ${table}  rows=${rows.length} cols=${shared.length}`); return rows.length; }

  const colList = shared.join(', ');
  const CHUNK = 40; // statements per REST call's worth of rows
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const values = slice.map((r) => `(${shared.map((c) => esc(r[c])).join(', ')})`).join(',\n');
    await executeD1([{ sql: `INSERT OR REPLACE INTO ${table} (${colList}) VALUES ${values}` }]);
  }
  console.log(`  copy  ${table}  ${rows.length} rows (${shared.length} cols)`);
  return rows.length;
}

async function main() {
  if (!API_TOKEN) throw new Error('CLOUDFLARE_API_TOKEN is required (set it in .env).');
  console.log(`canon move  from=${FROM}  to=${TO}  confirm=${CONFIRM}`);
  let total = 0;
  for (const table of TABLES) total += await moveTable(table);
  console.log(CONFIRM ? `MOVE COMPLETE (${total} rows)` : `DRY PLAN (${total} rows; re-run with --yes)`);
}

main().catch((e) => { console.error('move-canon fatal:', e); process.exit(1); });
