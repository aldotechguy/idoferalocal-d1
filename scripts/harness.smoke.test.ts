/**
 * Harness smoke test: build an in-memory DB, seed a product, run a real
 * checkout through handleMallApi, and assert moneyTotals() returns finite
 * numbers. Entirely :memory: — nothing touches production.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { makeTestDb, makeTestExecutor, seedCatalog, seedActiveCart, moneyTotals, assertNotProduction } from './test-harness.ts';
import { handleMallApi } from '../src/server/mallApi.ts';

test('harness: seeded checkout yields finite money totals', async () => {
  assertNotProduction('http://127.0.0.1:1/ (local-only smoke test)');
  const db = makeTestDb();
  const exec = makeTestExecutor(db);
  const session = 'harness-smoke-session-1';
  seedCatalog(db, { id: 'prod-harness', retailPriceKobo: 10000 });
  seedActiveCart(db, session, [{ productId: 'prod-harness', qty: 2, unitPriceKobo: 1 }]);

  const response = await handleMallApi(new Request('http://test/api/mall/checkout', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-mall-session': session,
      'idempotency-key': 'harness-smoke-attempt-1',
    },
    body: JSON.stringify({ customerName: 'Ada', customerPhone: '08031234567', paymentMethod: 'pay_on_pickup' }),
  }), exec);
  assert.equal(response.status, 201, 'checkout must place a pending order');

  const totals = moneyTotals(db);
  assert.ok(Number.isFinite(totals.salesTotalKobo), `salesTotalKobo finite: ${totals.salesTotalKobo}`);
  assert.ok(Number.isFinite(totals.saleInflowKobo), `saleInflowKobo finite: ${totals.saleInflowKobo}`);
  assert.ok(Number.isFinite(totals.saleRefundKobo), `saleRefundKobo finite: ${totals.saleRefundKobo}`);
  assert.ok(Number.isFinite(totals.expenseOutflowKobo), `expenseOutflowKobo finite: ${totals.expenseOutflowKobo}`);
  for (const [account, value] of Object.entries(totals.liquidByAccount)) {
    assert.ok(Number.isFinite(value), `liquidByAccount.${account} finite: ${value}`);
  }
  // A checkout alone books no movements yet (payment is pending); the sale is
  // only written on settlement. The totals must simply stay consistent.
  assert.ok(totals.salesTotalKobo >= 0);
  db.close();
});

test('harness: assertNotProduction rejects known production targets', () => {
  assert.throws(() => assertNotProduction('https://idomall.olz.workers.dev'));
  assert.throws(() => assertNotProduction('d1 database: idofera'));
  assert.throws(() => assertNotProduction({ databaseId: '3e95a550-a091-490b-819d-f0acb7ea8dd8' }));
  assert.doesNotThrow(() => assertNotProduction('idofera-local-d1 (this repo)'));
});
