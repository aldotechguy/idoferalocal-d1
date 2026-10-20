/**
 * native-bridge.test.ts
 * Smoke-tests every function exported from src/native/index.ts
 * Run: npm run test:native
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTreasuryBalances,
  planCoreUpsert,
  planCoreDelete,
  validateOrderTransition,
  calculateAmountDue,
  verifyOrderTotals,
  type MoneyMovementInput,
} from '../src/native/index.ts';
import { getNativeBridgeEventCounts, resetNativeBridgeEventCounts, setNativeBridgeTelemetry, isNativeBridgeEnabled } from '../src/native-bridge/telemetry.js';
import { computeTreasuryBalances as bridgeLedger } from '../src/native-bridge/ledgerBridge.js';
import { planCoreUpsert as bridgeUpsert } from '../src/native-bridge/relationalBridge.js';
import { calculateAmountDueKobo as bridgeAmountDue } from '../src/native-bridge/mallBridge.js';

describe('controlled native rollout', () => {
  it('defaults to TypeScript until explicitly enabled and records fallback counts', async () => {
    resetNativeBridgeEventCounts();
    const events: unknown[] = [];
    setNativeBridgeTelemetry((event) => events.push(event));
    try {
      if (process.env.IDOFERA_NATIVE_ENABLED !== 'true') {
        assert.equal(isNativeBridgeEnabled(), false);
        bridgeLedger([]);
        await bridgeUpsert('customers', { id: 'rollout-customer' }, '2026-10-19T00:00:00Z');
        await bridgeAmountDue(100, 20, 'processing');
        assert.ok(events.length >= 3);
        assert.ok(Object.values(getNativeBridgeEventCounts()).some((count) => count > 0));
      }
    } finally {
      setNativeBridgeTelemetry();
    }
  });
});


// --- computeTreasuryBalances ---
describe('computeTreasuryBalances', () => {
  it('returns zeros for empty ledger', () => {
    const r = computeTreasuryBalances([]);
    assert.equal(r.totalLiquidCash, 0);
    assert.equal(r.bizAccountBalance, 0);
  });

  it('sale inflow credits biz account', () => {
    const mvs: MoneyMovementInput[] = [
      { id: 'mv-1', type: 'Sale Inflow', destinationAccount: 'Biz Account', amount_cents: 50000 },
    ];
    const r = computeTreasuryBalances(mvs);
    assert.equal(r.bizAccountBalance, 500.00);
    assert.equal(r.totalLiquidCash, 500.00);
  });

  it('owner drawing reduces biz account', () => {
    const mvs: MoneyMovementInput[] = [
      { id: 'mv-1', type: 'Sale Inflow', destinationAccount: 'Biz Account', amount_cents: 100000 },
      { id: 'mv-2', type: 'Owner Drawing', subtype: 'Owner Loan', sourceAccount: 'Biz Account', amount_cents: 30000 },
    ];
    const r = computeTreasuryBalances(mvs);
    assert.equal(r.bizAccountBalance, 700.00);
    assert.equal(r.totalOwnerDrawings, 300.00);
    assert.equal(r.totalOwnerLoans, 300.00);
  });
});

// --- planCoreUpsert ---
describe('planCoreUpsert', () => {
  it('returns null for unknown collection', () => {
    assert.equal(planCoreUpsert('widgets', { id: 'x' }, new Date().toISOString()), null);
  });

  it('generates category + product INSERT', () => {
    const stmts = planCoreUpsert('products', { id: 'p1', name: 'Test', category: 'Groceries', retailPrice: 150 }, '2026-10-19T00:00:00Z');
    assert.ok(stmts && stmts.length >= 2);
    assert.ok(stmts![0].sql.includes('categories'));
    assert.ok(stmts![1].sql.includes('ON CONFLICT'));
  });

  it('generates customer upsert', () => {
    const stmts = planCoreUpsert('customers', { id: 'c1', name: 'Jane', outstandingBalance: 0 }, '2026-10-19T00:00:00Z');
    assert.ok(stmts && stmts.length === 1);
    assert.ok(stmts![0].sql.startsWith('INSERT INTO customers'));
  });

  it('plans sales and purchase child statements in Rust', () => {
    const sale = planCoreUpsert('sales', { id: 'sale-1', items: [{ productName: 'One', quantity: 1 }] }, '2026-10-19T00:00:00Z');
    const purchase = planCoreUpsert('purchases', { id: 'po-1', items: [{ productName: 'One', quantity: 1 }], receivingHistory: [{ receivedAt: '2026-10-19T00:00:00Z' }] }, '2026-10-19T00:00:00Z');
    assert.equal(sale?.length, 3);
    assert.equal(purchase?.length, 5);
    assert.ok(sale?.some((statement) => statement.sql.includes('INSERT INTO sale_items')));
    assert.ok(purchase?.some((statement) => statement.sql.includes('INSERT INTO receiving_history')));
  });
});

// --- planCoreDelete ---
describe('planCoreDelete', () => {
  it('cascades sale delete (items first)', () => {
    const stmts = planCoreDelete('sales', 'sale-1');
    assert.ok(stmts && stmts.length === 2);
    assert.ok(stmts![0].sql.includes('sale_items'));
  });

  it('cascades purchase delete (3 stmts)', () => {
    assert.equal(planCoreDelete('purchases', 'po-1')?.length, 3);
  });

  it('returns null for unknown collection', () => {
    assert.equal(planCoreDelete('widgets', 'x'), null);
  });
});

// --- validateOrderTransition ---
describe('validateOrderTransition', () => {
  it('allows valid fulfillment pipeline', () => {
    assert.ok(validateOrderTransition('pending', 'confirmed').allowed);
    assert.ok(validateOrderTransition('confirmed', 'processing').allowed);
    assert.ok(validateOrderTransition('packed', 'out_for_delivery').allowed);
  });

  it('rejects illegal backwards transitions', () => {
    const r = validateOrderTransition('completed', 'pending');
    assert.equal(r.allowed, false);
  });

  it('marks same-state as idempotent', () => {
    const r = validateOrderTransition('confirmed', 'confirmed');
    assert.ok(r.allowed && r.isIdempotent);
  });

  it('throws on unknown status', () => {
    assert.throws(() => validateOrderTransition('banana', 'confirmed'));
  });
});

// --- calculateAmountDue ---
describe('calculateAmountDue', () => {
  it('returns remainder for partial payment', () => {
    assert.equal(calculateAmountDue(10000, 3000, 'processing'), 7000);
  });

  it('clamps to zero when overpaid', () => {
    assert.equal(calculateAmountDue(10000, 15000, 'processing'), 0);
  });

  it('returns 0 for cancelled orders', () => {
    assert.equal(calculateAmountDue(10000, 0, 'cancelled'), 0);
  });
});

// --- verifyOrderTotals ---
describe('verifyOrderTotals', () => {
  it('passes when totals balance', () => {
    assert.doesNotThrow(() => verifyOrderTotals(1000, 100, 50, 950));
  });

  it('throws when total is wrong', () => {
    assert.throws(() => verifyOrderTotals(1000, 0, 0, 999));
  });

  it('throws on negative values', () => {
    assert.throws(() => verifyOrderTotals(-100, 0, 0, -100));
  });
});
