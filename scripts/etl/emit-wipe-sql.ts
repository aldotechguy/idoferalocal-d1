/**
 * Emit a full-wipe SQL file for the target `idofera`.
 *
 * Produces child -> parent DELETE statements for EVERY table the schema can hold,
 * including the legacy document-store tables if they still exist on the live DB.
 * Used with `wrangler d1 execute idofera --remote --file=<out>` for the "empty the
 * target" half of the canon cutover.
 *
 * Usage: npx tsx scripts/etl/emit-wipe-sql.ts [--out=backups/idofera-wipe.sql]
 */
import fs from 'node:fs';
import path from 'node:path';

function arg(name: string, fallback: string): string {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
}
const OUT = path.resolve(arg('out', path.join('backups', 'idofera-wipe.sql')));

// Child -> parent. Includes the legacy blob tables (dropped after the wipe) so a
// live database that still carries them is emptied too.
const WIPE_ORDER = [
  'mall_cart_items', 'mall_carts', 'mall_order_items', 'mall_order_events', 'mall_orders',
  'mall_outbox', 'mall_returns', 'mall_checkout_attempts', 'mall_write_guards',
  'mall_webhook_deliveries', 'mall_rate_limits', 'mall_metrics', 'mall_job_runs',
  'mall_schema_versions',
  'receiving_history', 'purchase_items', 'purchases', 'sale_items', 'sales',
  'pricing_history', 'stock_movements', 'money_movements', 'expenses',
  'delivery_orders', 'held_orders', 'whatsapp_preorders', 'notifications',
  'audit_logs', 'product_variants', 'products', 'categories', 'customers', 'suppliers',
  'payments', 'reviews', 'settings', 'sync_revisions',
  'app_sessions', 'staff_entrances', 'users', 'app_users', 'app_documents',
];

const lines = ['PRAGMA defer_foreign_keys=TRUE;'];
for (const table of WIPE_ORDER) lines.push(`DELETE FROM "${table}";`);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join('\n') + '\n');
console.log(`wrote ${WIPE_ORDER.length} DELETEs -> ${OUT}`);
