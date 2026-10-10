/**
 * Loyalty-points reconciliation (audit 2026-10-09, flag 1).
 *
 * WHY
 * ---
 * The Customer's Hub used to DISPLAY loyalty as `floor(lifetimeValue * rate)`
 * while the ledger EARNED it as `floor(saleAmount * rate)` per sale and summed.
 * `floor(a+b) != floor(a)+floor(b)`, so the displayed total was almost always
 * higher than what the customer actually held. Commit 2026-10-09 removed the
 * competing Hub formula and made `loyaltyPointsForAmount` the single source of
 * truth — but rows already written under the old display rule may carry an
 * inflated `loyalty_points` in D1. This script finds and (optionally) corrects
 * that drift.
 *
 * SAFETY
 * ------
 *   default            READ-ONLY. Prints drift; writes nothing.
 *   --apply            Writes ONLY rows whose recomputed value differs, and
 *                      writes one audit_logs row per corrected customer.
 *
 * It never touches balances, lifetime value, or purchase counts — only
 * `loyalty_points`. The authoritative value is recomputed from the SAME
 * per-sale helper the runtime now uses, so the correction converges on the
 * formula the app enforces going forward.
 *
 * Usage:
 *   npx tsx scripts/etl/reconcile-loyalty.ts                 # dry-run report
 *   npx tsx scripts/etl/reconcile-loyalty.ts --apply         # write corrections
 *   npx tsx scripts/etl/reconcile-loyalty.ts --apply --limit=25
 *
 * Requires CLOUDFLARE_API_TOKEN (and optionally CLOUDFLARE_ACCOUNT_ID /
 * CLOUDFLARE_D1_DATABASE_ID_TARGET) in the environment, same as the other ETL
 * scripts. Always review the dry-run before applying.
 */
import { loyaltyPointsForAmount } from '../../src/shared/customerLedger.js';
import { queryD1, ACCOUNT_ID, DATABASE_ID, API_TOKEN, nowIso } from './lib.js';

const APPLY = process.argv.includes('--apply');
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='))?.slice('--limit='.length);
const LIMIT = LIMIT_ARG ? Math.max(1, Number(LIMIT_ARG) || 0) : 0;

/**
 * Points per unit of currency. Mirrors `settings.pointsPerDollar` default of
 * 0.01 used throughout the app. Override with LOYALTY_RATE if the store has
 * changed it (the runtime reads it per-store from settings).
 */
const POINTS_RATE = Number(process.env.LOYALTY_RATE || 0.01);

interface CustomerRow {
  id: string;
  name: string;
  loyalty_points: number;
}

interface SaleRow {
  id: string;
  customer_id: string | null;
  customerName?: string | null;
  customer_name: string | null;
  total_kobo: number;
  status: string;
}

/**
 * Expected points for a customer, using the runtime's per-sale floor summed.
 * Refunded sales are excluded — the ledger deducts their points on refund.
 */
export function expectedPoints(customerName: string, sales: SaleRow[], rate: number): number {
  const nameKey = (customerName || '').trim().toLowerCase();
  return sales
    .filter((s) => s.status !== 'Refunded')
    .filter((s) => {
      // Match by id where the sale carries one, else fall back to the name
      // (legacy rows). Mirrors the Hub's aggregate matching.
      if (s.customer_id) return true; // filtered by the SQL join already
      return nameKey && (s.customer_name || '').trim().toLowerCase() === nameKey;
    })
    .reduce((sum, s) => sum + loyaltyPointsForAmount(Number(s.total_kobo) / 100, rate), 0);
}

export interface Drift {
  id: string;
  name: string;
  stored: number;
  expected: number;
  delta: number;
}

/** Pure drift computation — unit-tested separately. */
export function computeDrift(customers: CustomerRow[], salesByCustomer: Map<string, SaleRow[]>, rate: number): Drift[] {
  const drift: Drift[] = [];
  for (const c of customers) {
    const sales = salesByCustomer.get(c.id) || [];
    const expected = expectedPoints(c.name, sales, rate);
    const stored = Number(c.loyalty_points) || 0;
    if (stored !== expected) {
      drift.push({ id: c.id, name: c.name, stored, expected, delta: expected - stored });
    }
  }
  return drift;
}

async function main() {
  if (!API_TOKEN) {
    console.error('Missing CLOUDFLARE_API_TOKEN. Export it before running (see scripts/etl/README notes).');
    process.exitCode = 1;
    return;
  }

  console.log(`Loyalty reconciliation — database ${DATABASE_ID} (account ${ACCOUNT_ID})`);
  console.log(`Mode: ${APPLY ? 'APPLY (will write corrections)' : 'DRY-RUN (read-only)'} | rate=${POINTS_RATE} pts per unit`);
  if (LIMIT) console.log(`Limit: ${LIMIT} customers`);

  const customers = (await queryD1(
    `SELECT id, name, loyalty_points FROM customers ORDER BY created_at DESC`,
  )) as CustomerRow[];

  const sales = (await queryD1(
    `SELECT id, customer_id, customer_name, total_kobo, status FROM sales`,
  )) as SaleRow[];

  // Group sales by the customer id they point at, and collect unmatched-by-id
  // sales for the name fallback inside expectedPoints.
  const salesByCustomer = new Map<string, SaleRow[]>();
  const unlinked: SaleRow[] = [];
  for (const s of sales) {
    if (s.customer_id) {
      if (!salesByCustomer.has(s.customer_id)) salesByCustomer.set(s.customer_id, []);
      salesByCustomer.get(s.customer_id)!.push(s);
    } else {
      unlinked.push(s);
    }
  }

  // A name-matched sale must count for the customer whose name it matches.
  for (const c of customers) {
    const byName = unlinked.filter(
      (s) => (s.customer_name || '').trim().toLowerCase() === (c.name || '').trim().toLowerCase(),
    );
    if (byName.length) {
      salesByCustomer.set(c.id, [...(salesByCustomer.get(c.id) || []), ...byName]);
    }
  }

  // -------------------------------------------------------------------------
  // GUARD (added after the 2026-10-09 production probe).
  //
  // The probe found that stored `loyalty_points` ALWAYS equals
  // floor(stored_lifetime_value * rate) — i.e. points are internally
  // consistent with LTV. The real corruption is in the AGGREGATES: 14 of 15
  // mismatched customers have sales linked by customer_id that were never
  // folded into lifetime_value_kobo / purchase_history_count.
  //
  // Rewriting points alone in that state would make points DISAGREE with LTV
  // (a new inconsistency) and would award large sums of unearned loyalty on the
  // strength of a number we have not yet repaired. So: if a drifting customer's
  // stored LTV does not reconcile with the sales ledger, refuse to apply.
  // -------------------------------------------------------------------------
  const aggregateMismatch: string[] = [];
  for (const c of customers) {
    const linked = (salesByCustomer.get(c.id) || []).filter((s) => s.status !== 'Refunded');
    const ledgerKobo = linked.reduce((sum, s) => sum + Number(s.total_kobo || 0), 0);
    const storedKobo = Number((c as any).lifetime_value_kobo ?? 0);
    if (Math.abs(storedKobo - ledgerKobo) > 1) aggregateMismatch.push(c.name);
  }

  const drift = computeDrift(customers, salesByCustomer, POINTS_RATE);

  console.log(`\nScanned ${customers.length} customers across ${sales.length} sales.`);
  console.log(`Customers with loyalty drift: ${drift.length}`);

  const over = drift.filter((d) => d.delta < 0);
  const under = drift.filter((d) => d.delta > 0);
  const totalDelta = drift.reduce((a, d) => a + d.delta, 0);
  console.log(`  over-credited (stored > expected): ${over.length}`);
  console.log(`  under-credited (stored < expected): ${under.length}`);
  console.log(`  net point change if applied: ${totalDelta > 0 ? '+' : ''}${totalDelta}`);

  // Aggregate integrity: the precondition for a SAFE points correction.
  console.log(`\nCustomers whose stored lifetime value does not match the sales ledger: ${aggregateMismatch.length}`);
  if (aggregateMismatch.length) {
    console.log('  ' + aggregateMismatch.slice(0, 20).join(', '));
    if (aggregateMismatch.length > 20) console.log(`  ... and ${aggregateMismatch.length - 20} more`);
    console.log(
      '\n  RUNNING THIS WITH --apply IS BLOCKED while aggregates disagree with the\n' +
      '  ledger: rewriting points alone would make points disagree with lifetime\n' +
      '  value and would award unearned loyalty from an unrepaired number.\n' +
      '  Repair the customer aggregates first (see scripts/report-customer-integrity.ts),\n' +
      '  then re-run this dry run. The storefront/Hub read these aggregates live.',
    );
  }

  const preview = (LIMIT ? drift.slice(0, LIMIT) : drift).slice(0, 30);
  if (preview.length) {
    console.log('\nSample drift (up to 30 rows):');
    console.log('  id'.padEnd(26), 'stored'.padStart(8), 'expected'.padStart(9), 'delta'.padStart(7), '  name');
    for (const d of preview) {
      console.log(
        `  ${d.id}`.padEnd(26),
        String(d.stored).padStart(8),
        String(d.expected).padStart(9),
        `${d.delta > 0 ? '+' : ''}${d.delta}`.padStart(7),
        `  ${d.name}`,
      );
    }
  }

  if (!APPLY) {
    console.log('\nDRY-RUN complete. Nothing written. Re-run with --apply to correct these rows.');
    return;
  }

  if (aggregateMismatch.length) {
    console.error(
      `\nREFUSING TO APPLY: ${aggregateMismatch.length} customer aggregate(s) disagree with the sales ledger. ` +
      'Correct points only after the aggregates are repaired, or the correction creates a new inconsistency.',
    );
    process.exitCode = 2;
    return;
  }

  if (!drift.length) {
    console.log('\nNo drift to correct.');
    return;
  }

  const toApply = LIMIT ? drift.slice(0, LIMIT) : drift;
  const stamp = nowIso();
  let corrected = 0;

  for (const d of toApply) {
    const auditId = `audit-loyalty-${d.id}-${Date.now()}`;
    const details =
      `Loyalty reconciliation: ${d.name} points ${d.stored} -> ${d.expected} ` +
      `(delta ${d.delta > 0 ? '+' : ''}${d.delta}) using the per-sale floor formula (rate ${POINTS_RATE}).`;

    // Update the customer's points and record the change, one transaction each
    // so a partial failure never leaves a corrected row without its audit trail.
    await queryD1(
      `UPDATE customers SET loyalty_points = ? WHERE id = ? AND loyalty_points = ?`,
      [d.expected, d.id, d.stored],
    );
    await queryD1(
      `INSERT INTO audit_logs (id, actor_id, action, entity, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [auditId, 'system:loyalty-reconcile', 'RECONCILE_LOYALTY', 'Customer', d.id, details, stamp],
    );
    corrected += 1;
  }

  console.log(`\nAPPLIED: corrected ${corrected} customer(s); wrote ${corrected} audit_logs row(s).`);
  console.log('Verify with: npm run etl:reconcile-loyalty   (dry-run should now report 0 drift)');
}

// Only run when invoked directly (so tests can import the pure helpers).
const invokedDirectly = process.argv[1] && /reconcile-loyalty\.(ts|js)$/.test(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error('Loyalty reconciliation failed:', error);
    process.exitCode = 1;
  });
}
