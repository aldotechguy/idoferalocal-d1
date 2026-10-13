/**
 * @regression:F1/F2/F3 — mall money-path write-shape locks.
 *
 * F1 (fix 1d14377): a mall refund must book type 'Sale Refund' (with a proper
 *   settlement source account), never 'Refund Outflow' with a NULL account —
 *   the old shape broke Reports refund math and the liquid ledger identity.
 * F2 (fix fa9ae7e): the Logistics expense booked at dispatch must ship with its
 *   own 'Expense Outflow' money movement, or Treasury under-counts the courier
 *   cost while Reports (expense-based) counts it.
 * F3 (fix fa9ae7e): mall checkout stock reservation must write type 'Outgoing'
 *   (the type the invariant ledger signs negative), never 'Mall Order', which
 *   reconciled as a POSITIVE delta and doubled phantom stock.
 *
 * All in-memory via scripts/test-harness.ts — no network, no remote D1.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  makeTestDb, makeTestExecutor, seedCatalog, seedActiveCart, moneyTotals, assertNotProduction,
} from '../test-harness.ts';
import { handleMallApi } from '../../src/server/mallApi.ts';
import { handleStaffMallApi } from '../../src/server/mallOrderAdminApi.ts';

const actor = { id: 'staff-reg', displayName: 'Regression Manager', role: 'Administrator' };

type Ctx = {
  db: ReturnType<typeof makeTestDb>;
  exec: ReturnType<typeof makeTestExecutor>;
  session: string;
};

function fixture(delivery: boolean): Ctx {
  assertNotProduction(':memory: regression F1/F2/F3');
  const db = makeTestDb();
  const exec = makeTestExecutor(db);
  const session = `reg-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
  seedCatalog(db, { id: 'p', retailPriceKobo: 10000, stockQty: 10 });
  seedActiveCart(db, session, [{ productId: 'p', qty: 2, unitPriceKobo: 1 }]);
  const body: Record<string, unknown> = { customerName: 'Ada', customerPhone: '08031234567', paymentMethod: 'pay_on_pickup' };
  if (delivery) Object.assign(body, { deliveryZone: 'uyo_outer', deliveryAddress: 'Shelter Afrique, Uyo' });
  const response = handleMallApi(new Request('http://test/api/mall/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mall-session': session, 'idempotency-key': `reg-${session}` },
    body: JSON.stringify(body),
  }), exec);
  return { db, exec, session, response } as unknown as Ctx;
}

const orderId = (ctx: Ctx) => String((ctx.db.prepare('SELECT id FROM mall_orders LIMIT 1').get() as any).id);

async function staff(ctx: Ctx, action: string, body: Record<string, unknown> = {}) {
  return handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${orderId(ctx)}/${action}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), ctx.exec, actor);
}

test('@regression:F1 — a mall refund books Sale Refund (source account set), never Refund Outflow', async () => {
  const ctx = fixture(false);
  await (ctx as any).response;
  const id = orderId(ctx);
  assert.equal((await staff(ctx, 'confirm')).status, 200);
  assert.equal((await staff(ctx, 'collect-payment', { paymentMethod: 'Card', amountKobo: 20000 })).status, 200);
  const refund = await staff(ctx, 'refund', { reason: 'Regression lock', returnStock: false });
  assert.equal(refund.status, 200);

  const movements = ctx.db.prepare(
    "SELECT type, source_account, dest_account, amount_kobo FROM money_movements WHERE id = ?",
  ).get(`mm-refund-sale-${id}`) as any;
  assert.ok(movements, 'the refund must book a movement');
  // THE LOCK: the type is 'Sale Refund' — a 'Refund Outflow' regression would
  // break the Reports refund column and the liquid ledger sign convention.
  assert.equal(movements.type, 'Sale Refund');
  assert.equal(movements.source_account, 'Biz Account', 'Card settlement refunds leave the Biz Account');
  assert.equal(movements.dest_account, null);
  assert.equal(movements.amount_kobo, 20000, 'the full paid amount is refunded');
  ctx.db.close();
});

test('@regression:F2 — dispatch books the Logistics expense WITH its Expense Outflow; refund voids both', async () => {
  const ctx = fixture(true);
  await (ctx as any).response;
  const id = orderId(ctx);
  assert.equal((await staff(ctx, 'review-delivery', { confirmed: true })).status, 200);
  assert.equal((await staff(ctx, 'confirm')).status, 200);
  assert.equal((await staff(ctx, 'collect-payment', { paymentMethod: 'Cash', amountKobo: 270000 })).status, 200);
  assert.equal((await staff(ctx, 'mark-packed')).status, 200);
  assert.equal((await staff(ctx, 'mark-out-for-delivery', { courier: 'Regression courier' })).status, 200);

  // Dispatch created BOTH halves, atomically, with the same deterministic ids.
  const exp = ctx.db.prepare('SELECT amount_kobo FROM expenses WHERE id = ?').get(`exp-mall-del-${id}`) as any;
  assert.ok(exp, 'dispatch must create the Logistics expense');
  assert.equal(exp.amount_kobo, 250000);
  const out = ctx.db.prepare('SELECT type, amount_kobo, source_account FROM money_movements WHERE id = ?')
    .get(`mm-exp-mall-del-${id}`) as any;
  // THE LOCK: the movement exists and matches the expense — dropping it (the F2
  // bug) left the courier cost invisible to Treasury.
  assert.ok(out, 'the Logistics expense must ship with an Expense Outflow movement');
  assert.equal(out.type, 'Expense Outflow');
  assert.equal(out.amount_kobo, 250000);
  assert.equal(out.source_account, 'Physical Cash');

  const refund = await staff(ctx, 'refund', { reason: 'Returned goods', returnStock: true, returnReference: 'GRN-REG' });
  assert.equal(refund.status, 200);
  // THE LOCK part 2: the refund voids BOTH — zeroed expense AND zeroed movement.
  const expAfter = ctx.db.prepare('SELECT amount_kobo FROM expenses WHERE id = ?').get(`exp-mall-del-${id}`) as any;
  const outAfter = ctx.db.prepare('SELECT amount_kobo FROM money_movements WHERE id = ?').get(`mm-exp-mall-del-${id}`) as any;
  assert.equal(expAfter.amount_kobo, 0, 'refund must zero the Logistics expense');
  assert.equal(outAfter.amount_kobo, 0, 'refund must zero its Expense Outflow');
  const totals = moneyTotals(ctx.db);
  assert.ok(Number.isFinite(totals.expenseOutflowKobo));
  ctx.db.close();
});

test('@regression:F3 — mall checkout stock reservation writes type Outgoing (signed negative)', async () => {
  const ctx = fixture(false);
  await (ctx as any).response;
  // THE LOCK: the checkout's stock movement is 'Outgoing'. The F3 bug wrote
  // 'Mall Order', which the invariant ledger treated as an INFLOW and doubled
  // phantom stock on every checkout.
  const movement = ctx.db.prepare(
    "SELECT type, qty, prev_stock, new_stock FROM stock_movements WHERE product_id = 'p'",
  ).get() as any;
  assert.ok(movement, 'checkout must record a stock movement');
  assert.equal(movement.type, 'Outgoing');
  assert.equal(movement.new_stock, 8, '2 reserved of 10');
  assert.equal(
    (ctx.db.prepare('SELECT stock_qty FROM products WHERE id = ?').get('p') as any).stock_qty, 8,
    'stock must drop exactly by the reserved qty',
  );
  ctx.db.close();
});
