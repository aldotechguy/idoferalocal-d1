import assert from 'node:assert/strict';
import test from 'node:test';
import { computeDrift, expectedPoints } from './etl/reconcile-loyalty.ts';

/**
 * Reconciliation logic tests (audit flag 1). These pin the drift calculation
 * BEFORE the script is ever pointed at production, so a dry-run report the
 * operator reads is provably correct.
 */

const sale = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  customer_id: 'cust-1',
  customer_name: 'Apex Ltd',
  total_kobo: 0,
  status: 'Completed',
  ...over,
});

const customer = (over: Record<string, unknown> = {}) => ({
  id: 'cust-1',
  name: 'Apex Ltd',
  loyalty_points: 0,
  ...over,
});

test('expected points are the per-sale floor, summed', () => {
  const sales = [
    sale({ id: 's1', total_kobo: 13700 }), // ₦137 -> 1 pt
    sale({ id: 's2', total_kobo: 13700 }), // ₦137 -> 1 pt
    sale({ id: 's3', total_kobo: 13700 }), // ₦137 -> 1 pt
  ];
  // 3 x floor(1.37) = 3, NOT floor(4.11) = 4.
  assert.equal(expectedPoints('Apex Ltd', sales, 0.01), 3);
});

test('refunded sales do not earn points', () => {
  const sales = [
    sale({ id: 's1', total_kobo: 100000, status: 'Completed' }),
    sale({ id: 's2', total_kobo: 100000, status: 'Refunded' }),
    sale({ id: 's3', total_kobo: 50000, status: 'Partially Refunded' }),
  ];
  // 10 + 5 points; the refunded one contributes nothing.
  assert.equal(expectedPoints('Apex Ltd', sales, 0.01), 15);
});

test('drift is reported only where stored differs from expected', () => {
  const customers = [
    customer({ id: 'c1', name: 'Apex Ltd', loyalty_points: 4 }), // over-credited, should be 3
    customer({ id: 'c2', name: 'Beta Stores', loyalty_points: 10 }), // correct
    customer({ id: 'c3', name: 'Gamma', loyalty_points: 0 }), // under-credited, should be 1
  ];
  const salesByCustomer = new Map([
    ['c1', [
      sale({ customer_id: 'c1', total_kobo: 13700 }),
      sale({ customer_id: 'c1', total_kobo: 13700 }),
      sale({ customer_id: 'c1', total_kobo: 13700 }),
    ]],
    ['c2', [sale({ customer_id: 'c2', total_kobo: 100000 })]],
    ['c3', [sale({ customer_id: 'c3', total_kobo: 15000 })]],
  ]);

  const drift = computeDrift(customers, salesByCustomer, 0.01);
  assert.equal(drift.length, 2, 'only c1 and c3 drift');

  const c1 = drift.find((d) => d.id === 'c1')!;
  assert.equal(c1.stored, 4);
  assert.equal(c1.expected, 3);
  assert.equal(c1.delta, -1, 'over-credit is a negative delta');

  const c3 = drift.find((d) => d.id === 'c3')!;
  assert.equal(c3.expected, 1);
  assert.equal(c3.delta, 1);
});

test('a clean ledger reports no drift at all', () => {
  const customers = [customer({ id: 'c1', loyalty_points: 3 })];
  const salesByCustomer = new Map([
    ['c1', [sale({ customer_id: 'c1', total_kobo: 13700 }), sale({ customer_id: 'c1', total_kobo: 13700 }), sale({ customer_id: 'c1', total_kobo: 13700 })]],
  ]);
  assert.equal(computeDrift(customers, salesByCustomer, 0.01).length, 0);
});

test('a customer with no sales and no stored points is not flagged', () => {
  const drift = computeDrift([customer({ loyalty_points: 0 })], new Map(), 0.01);
  assert.equal(drift.length, 0);
});

test('a stale non-zero balance with no provable sales IS flagged for review', () => {
  // Someone holds points the ledger cannot justify — the operator should see it.
  const drift = computeDrift([customer({ loyalty_points: 7 })], new Map(), 0.01);
  assert.equal(drift.length, 1);
  assert.equal(drift[0].expected, 0);
  assert.equal(drift[0].delta, -7);
});
