/**
 * verify-prod-native-money.ts
 *
 * Proves the Rust money engine on the code that production actually runs.
 *
 * The Cloudflare Worker cannot load a native Node addon, so the deployed Mall
 * executes the TypeScript implementations. Production money math is shared code:
 * the Worker and the Node server both call the same `src/server/mall*.ts`
 * modules, so exercising those modules here with IDOFERA_NATIVE_ENABLED=true is
 * the closest verifiable path to "the Rust engine on production money math".
 *
 * This script is a verifier, not a test suite: it fails if the addon is not
 * actually loaded, if any bridge silently falls back, or if a clean Node
 * process (the same loader path as the deployed Node server) cannot use it.
 *
 * Usage: npm run verify:prod-native-money
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  isNativeLedgerAvailable,
  computeTreasuryBalances,
} from '../src/native-bridge/ledgerBridge.js';
import {
  isNativeMallEngineAvailable,
  validateOrderTransition,
  calculateAmountDueKobo,
  verifyOrderTotals,
} from '../src/native-bridge/mallBridge.js';
import {
  isNativeRelationalAvailable,
  planCoreUpsert,
  planCoreDelete,
} from '../src/native-bridge/relationalBridge.js';
import {
  getNativeBridgeEventCounts,
  resetNativeBridgeEventCounts,
  setNativeBridgeTelemetry,
  isNativeBridgeEnabled,
} from '../src/native-bridge/telemetry.js';
import type { MoneyMovement } from '../src/types/index.js';

type Check = { name: string; run: () => void | Promise<void> };

const checks: Check[] = [];
function check(name: string, run: () => void | Promise<void>): void {
  checks.push({ name, run });
}

/** Real checkout invariants, in exact integer kobo. */
check('order totals invariant matches subtotal - discount + delivery', async () => {
  const cases = [
    [10_000, 0, 1_500, 11_500],
    [250_000, 25_000, 0, 225_000],
    [1_000, 1_000, 0, 0],
  ] as const;
  for (const [subtotal, discount, delivery, total] of cases) {
    assert.equal(await verifyOrderTotals(subtotal, discount, delivery, total), true);
  }
});

check('rejects a total that is off by one kobo or over-discounted', async () => {
  assert.equal(await verifyOrderTotals(10_000, 0, 1_500, 11_501), false);
  assert.equal(await verifyOrderTotals(1_000, 2_000, 0, 0), false);
});

check('amount due clamps part payments and terminates cancelled orders', async () => {
  assert.equal(await calculateAmountDueKobo(50_000, 20_000, 'processing'), 30_000);
  assert.equal(await calculateAmountDueKobo(50_000, 50_000, 'processing'), 0);
  assert.equal(await calculateAmountDueKobo(50_000, 70_000, 'processing'), 0, 'overpayment clamps to zero');
  assert.equal(await calculateAmountDueKobo(50_000, 10_000, 'cancelled'), 0);
  assert.equal(await calculateAmountDueKobo(50_000, 10_000, 'refunded'), 0);
  await assert.rejects(() => calculateAmountDueKobo(-1, 0, 'pending'), RangeError);
});

check('order state machine rejects illegal jumps', async () => {
  assert.equal((await validateOrderTransition('pending', 'confirmed')).allowed, true);
  assert.equal((await validateOrderTransition('confirmed', 'processing')).allowed, true);
  assert.equal((await validateOrderTransition('processing', 'completed')).allowed, true);
  assert.equal((await validateOrderTransition('packed', 'out_for_delivery')).allowed, true);
  assert.equal((await validateOrderTransition('completed', 'pending')).allowed, false);
  assert.equal((await validateOrderTransition('pending', 'completed')).allowed, false);
  assert.equal((await validateOrderTransition('confirmed', 'confirmed')).isIdempotent, true);
});

check('ledger treasury balances use exact kobo arithmetic', () => {
  const now = '2026-10-20T00:00:00.000Z';
  const movement = (
    id: string,
    type: MoneyMovement['type'],
    amount: number,
    extra: Omit<Partial<MoneyMovement>, 'id' | 'type' | 'amount'> = {},
  ): MoneyMovement => ({
    id, date: now, type, amount, performedBy: 'verifier', createdAt: now, ...extra,
  });
  const balances = computeTreasuryBalances([
    movement('pv-shift-1', 'Sale Inflow', 12_345.67, { destinationAccount: 'Biz Account' }),
    movement('pv-till-1', 'Sale Inflow', 0.29, { destinationAccount: 'Physical Cash' }),
    movement('pv-draw-1', 'Owner Drawing', 2_000, { subtype: 'Owner Loan', sourceAccount: 'Biz Account' }),
  ]);
  assert.equal(balances.bizAccountBalance, 10_345.67, 'inflow minus drawing, exact to the kobo');
  assert.equal(balances.physicalCashBalance, 0.29, 'sub-naira cash must not round away');
  assert.equal(balances.totalLiquidCash, 10_345.96);
  assert.equal(balances.totalOwnerDrawings, 2_000);
  assert.equal(balances.totalOwnerLoans, 2_000);
});

check('relational planner emits SQL for supported collections only', async () => {
  const sale = await planCoreUpsert('sales', { id: 'sale-ev-1', items: [{ productName: 'One', quantity: 1 }] }, '2026-10-20T00:00:00Z');
  assert.ok(sale && sale.length >= 2, 'sale upsert must emit child statements');
  assert.ok(await planCoreUpsert('customers', { id: 'c-ev-1', name: 'Verification' }, '2026-10-20T00:00:00Z'));
  assert.equal(await planCoreUpsert('widgets', { id: 'x' }, '2026-10-20T00:00:00Z'), null);
  assert.equal(await planCoreDelete('widgets', 'x'), null);
});

async function run(): Promise<void> {
  const engines = {
    rolloutEnabled: isNativeBridgeEnabled(),
    ledger: isNativeLedgerAvailable(),
    mall: isNativeMallEngineAvailable(),
    relational: isNativeRelationalAvailable(),
  };
  console.log('[verify:prod-native-money] engine', JSON.stringify(engines));
  assert.equal(engines.rolloutEnabled, true, 'Run with IDOFERA_NATIVE_ENABLED=true; otherwise only the TypeScript engine is exercised.');
  assert.equal(engines.ledger, true, 'Rust ledger bridge must be loaded.');
  assert.equal(engines.mall, true, 'Rust mall engine must be loaded.');
  assert.equal(engines.relational, true, 'Rust relational planner must be loaded.');

  resetNativeBridgeEventCounts();
  setNativeBridgeTelemetry((event) => {
    if (event.outcome === 'native') return;
    throw new Error(`unexpected ${event.bridge} fallback: ${event.reason ?? 'no reason'}`);
  });

  let failures = 0;
  for (const { name, run: body } of checks) {
    try {
      await body();
      console.log(`  PASS  ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`  FAIL  ${name}`);
      console.error(`        ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  setNativeBridgeTelemetry();
  console.log('[verify:prod-native-money] bridge events', JSON.stringify(getNativeBridgeEventCounts()));
  if (failures) {
    console.error(`[verify:prod-native-money] ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('[verify:prod-native-money] all checks passed on the Rust engine');
}

/** Confirm a fresh Node process (how the server runs) loads the addon too. */
function probeCleanProcess(): void {
  const probe = [
    "const { isNativeMallEngineAvailable, calculateAmountDueKobo } = require('./src/native-bridge/mallBridge.ts');",
    "const { remoteCheckRemote } = require('./src/native-bridge/remoteEngine.ts');",
    "if (!isNativeMallEngineAvailable()) { console.error('addon not loaded'); process.exit(3); }",
    "calculateAmountDueKobo(50000, 20000, 'processing').then((due) => {",
    "  if (due !== 30000) { console.error('unexpected due', due); process.exit(4); }",
    "  console.log('clean-process native check ok');",
    "});",
  ].join('\n');
  const result = spawnSync(process.execPath, ['--import', 'tsx', '-e', probe], {
    cwd: process.cwd(),
    env: { ...process.env, IDOFERA_NATIVE_ENABLED: 'true' },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    console.error(result.stdout ?? '');
    console.error(result.stderr ?? '');
    throw new Error('A clean Node process could not use the Rust addon.');
  }
  console.log(`  PASS  ${result.stdout.trim()}`);
}

if (process.argv.includes('--help')) {
  console.log('Usage: IDOFERA_NATIVE_ENABLED=true npm run verify:prod-native-money');
  process.exit(0);
}

probeCleanProcess();
await run();
