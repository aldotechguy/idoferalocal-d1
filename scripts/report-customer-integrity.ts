/**
 * Read-only integrity report for customer aggregates vs the sales ledger.
 *
 * Reveals whether "loyalty drift" is really a points problem or a symptom of
 * inflated/incorrect customers.lifetime_value_kobo & purchase_history_count.
 * Writes nothing.
 */
import { queryD1 } from './etl/lib.js';
import { loyaltyPointsForAmount } from '../src/shared/customerLedger.js';

const customers = (await queryD1(
  'SELECT id, name, loyalty_points, lifetime_value_kobo, purchase_history_count FROM customers',
)) as any[];
const sales = (await queryD1('SELECT id, customer_id, customer_name, total_kobo, status FROM sales')) as any[];

const byId = new Map<string, any[]>();
for (const s of sales) {
  if (!s.customer_id) continue;
  if (!byId.has(s.customer_id)) byId.set(s.customer_id, []);
  byId.get(s.customer_id)!.push(s);
}

let ltvMismatch = 0;
let orderMismatch = 0;
let pointsMismatch = 0;
let salesSumHigher = 0;
let salesSumLower = 0;
const rows: string[] = [];

for (const c of customers) {
  const linked = (byId.get(c.id) || []).filter((s) => s.status !== 'Refunded');
  const ledgerKobo = linked.reduce((a, s) => a + Number(s.total_kobo || 0), 0);
  const storedKobo = Number(c.lifetime_value_kobo || 0);
  const storedOrders = Number(c.purchase_history_count || 0);
  const ledgerOrders = linked.length;

  const ltvDiff = storedKobo - ledgerKobo;
  const orderDiff = storedOrders - ledgerOrders;
  const expectedPts = loyaltyPointsForAmount(storedKobo / 100, 0.01);
  const ptsDiff = Number(c.loyalty_points || 0) - expectedPts;

  // Does stored loyalty agree with stored LTV? (that would prove the old display rule was what wrote it)
  const ptsMatchStoredLtv = ptsDiff === 0;

  if (ltvDiff !== 0) { ltvMismatch += 1; if (ltvDiff > 0) salesSumLower += 1; else salesSumHigher += 1; }
  if (orderDiff !== 0) orderMismatch += 1;
  if (!ptsMatchStoredLtv) pointsMismatch += 1;

  if (ltvDiff !== 0 || orderDiff !== 0) {
    rows.push(
      `${(c.name || '').slice(0, 26).padEnd(26)} storedLTV=${(storedKobo / 100).toFixed(0).padStart(9)} ledgerLTV=${(ledgerKobo / 100).toFixed(0).padStart(9)} diff=${(ltvDiff / 100).toFixed(0).padStart(8)}  storedOrders=${String(storedOrders).padStart(3)} ledgerOrders=${String(ledgerOrders).padStart(3)}  pts=${c.loyalty_points}(exp=${expectedPts})`,
    );
  }
}

console.log(`customers scanned            : ${customers.length}`);
console.log(`sales scanned                : ${sales.length}`);
console.log(`LTV mismatch (stored!=ledger): ${ltvMismatch}  (stored higher: ${salesSumLower}, stored lower: ${salesSumHigher})`);
console.log(`order-count mismatch         : ${orderMismatch}`);
console.log(`loyalty != floor(storedLTV)  : ${pointsMismatch}`);
console.log(`\nRows with LTV or order mismatch (up to 60):`);
for (const r of rows.slice(0, 60)) console.log('  ' + r);
if (rows.length > 60) console.log(`  ... and ${rows.length - 60} more`);
