import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { ensureRelationalSchemaNode, makeNodeMallExecutor } from '../src/server/nodeAdapter.ts';
import { handleMallApi } from '../src/server/mallApi.ts';
import { handleStaffMallApi } from '../src/server/mallOrderAdminApi.ts';

/**
 * Mall order PART PAYMENT → customer debt — planned feature, not implemented.
 *
 * See docs/mall-part-payment.md. Today `collect-payment` hard-requires the
 * amount to equal the whole order total and never writes a customer debt, so
 * every case here fails against the current code. They are written against the
 * agreed contract so that implementing the plan turns them green without the
 * tests being rewritten.
 *
 * Expectation summary (the "planned" behaviour):
 *   - a partial `amountKobo` (0 < paid < total) is accepted;
 *   - the mirrored sale records only what was collected (sales.paid_kobo = paid);
 *   - the shortfall is booked as customer debt (customers.outstanding_balance_kobo);
 *   - the payment row is 'partial' and the money movement equals cash received;
 *   - the order still proceeds to 'processing' (part payment does not hold it);
 *   - full payment keeps today's exact behaviour (no regression);
 *   - over-payment and zero payment are rejected;
 *   - a part payment for an UNRECOGNISED phone is refused (debt needs a customer);
 *   - LTV / loyalty accrue on the amount actually PAID, not the order total;
 *   - a refund of a part-paid order clears the debt it created.
 */

const actor = { id: 'staff-1', displayName: 'Test Manager', role: 'Administrator' };

function fixture() {
  const db = new DatabaseSync(':memory:');
  ensureRelationalSchemaNode(db);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO products (id, sku, name, description, category_name, brand, supplier_name, images_json,
    cost_price_kobo, retail_price_kobo, wholesale_price_kobo, min_wholesale_qty, min_selling_price_kobo,
    stock_qty, low_stock_threshold, unit, status, is_mall_listed, mall_price_kobo, created_at, updated_at)
    VALUES ('prod-1', 'SKU1', 'Mall Product', '', 'Test', 'Test', '', '[]', 5000, 10000, 9000, 10, 5000, 10, 2, 'pcs', 'Active', 1, 10000, ?, ?)`).run(now, now);
  const session = 'mall-part-pay-session-1234';
  const cartId = `mc-${session}`;
  db.prepare(`INSERT INTO mall_carts (id, session_id, status, updated_at) VALUES (?, ?, 'active', ?)`).run(cartId, session, Date.now());
  // 2 × ₦100 = ₦200 = 20000 kobo.
  db.prepare(`INSERT INTO mall_cart_items (id, cart_id, product_id, qty, unit_price_kobo) VALUES ('ci-1', ?, 'prod-1', 2, 1)`).run(cartId);
  return { db, exec: makeNodeMallExecutor(db), session };
}

async function checkout(exec: ReturnType<typeof makeNodeMallExecutor>, session: string, overrides: Record<string, unknown> = {}) {
  const response = await handleMallApi(new Request('http://test/api/mall/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mall-session': session, 'idempotency-key': `test-attempt-${session}` },
    body: JSON.stringify({ customerName: 'Ada', customerPhone: '08031234567', paymentMethod: 'pay_on_pickup', ...overrides }),
  }), exec);
  return { response, body: await response.json() as any };
}

const orderId = (db: DatabaseSync) => (db.prepare('SELECT id FROM mall_orders LIMIT 1').get() as any).id as string;
const row = (db: DatabaseSync, sql: string) => db.prepare(sql).get() as any;

async function confirm(exec: ReturnType<typeof makeNodeMallExecutor>, id: string) {
  const request = new Request(`http://test/api/staff/mall-orders/${id}/confirm`, { method: 'POST', body: '{}' });
  return handleStaffMallApi(request, exec, actor);
}

async function collect(exec: ReturnType<typeof makeNodeMallExecutor>, id: string, body: Record<string, unknown>) {
  const request = new Request(`http://test/api/staff/mall-orders/${id}/collect-payment`, {
    method: 'POST', body: JSON.stringify(body),
  });
  return handleStaffMallApi(request, exec, actor);
}

/**
 * Checkout + confirm, returning the ids the payment cases need.
 *
 * A part payment is only legal for an EXISTING customer, so by default this
 * seeds a customer already on file under the buyer's phone number — the
 * feature's precondition. Pass `{ customerPhone: '…' }` for an unrecognised
 * number to exercise the refusal branch.
 */
async function prepared(overrides: Record<string, unknown> = {}) {
  const f = fixture();
  // Only seed the customer when the order will actually use the default phone.
  if (!('customerPhone' in overrides)) {
    // Zeroed counters isolate the part payment's own effect on the assertions.
    f.db.prepare(`INSERT INTO customers (id, name, phone, email, address, purchase_history_count, outstanding_balance_kobo, loyalty_points, lifetime_value_kobo, created_at)
      VALUES ('cust-1', 'Ada Existing', '+234 803 123 4567', '', '', 0, 0, 0, 0, '2026-01-01T00:00:00.000Z')`).run();
  }
  await checkout(f.exec, f.session, overrides);
  const id = orderId(f.db);
  await confirm(f.exec, id);
  return { ...f, id };
}

// ---------------------------------------------------------------------------
// P1 — a part payment is accepted and only the collected cash is recorded.
// ---------------------------------------------------------------------------

test('P1: a part payment is accepted and the sale records only the paid amount', async () => {
  const f = await prepared();
  const res = await collect(f.exec, f.id, { paymentMethod: 'Cash', amountKobo: 8000 });
  assert.equal(res.status, 200, 'a below-total amount must no longer 400');

  const sale = row(f.db, 'SELECT paid_kobo, total_kobo FROM sales LIMIT 1');
  assert.equal(sale.total_kobo, 20000);
  assert.equal(sale.paid_kobo, 8000, 'the mirrored sale records the cash actually collected, not the full price');

  // The order is released for fulfilment even though it is underpaid.
  assert.equal(row(f.db, 'SELECT status FROM mall_orders LIMIT 1').status, 'processing');
  assert.ok(row(f.db, 'SELECT linked_sale_id FROM mall_orders LIMIT 1').linked_sale_id, 'a settlement still mirrors into a sale');
});

// ---------------------------------------------------------------------------
// P2 — the shortfall is booked against the customer as debt.
// ---------------------------------------------------------------------------

test('P2: the unpaid balance is recorded as customer debt', async () => {
  const f = await prepared();
  await collect(f.exec, f.id, { paymentMethod: 'Cash', amountKobo: 8000 });

  const cust = row(f.db, 'SELECT * FROM customers LIMIT 1');
  assert.equal(cust.outstanding_balance_kobo, 12000, 'total 20000 − paid 8000 = 12000 kobo booked as debt');
  assert.equal(cust.purchase_history_count, 1, 'the order still counts as a purchase');
});

test('P2b: lifetime value and loyalty accrue on the amount actually paid', async () => {
  const f = await prepared();
  await collect(f.exec, f.id, { paymentMethod: 'Cash', amountKobo: 8000 });

  const cust = row(f.db, 'SELECT lifetime_value_kobo, loyalty_points FROM customers LIMIT 1');
  assert.equal(cust.lifetime_value_kobo, 8000, 'only cash collected is realised value, not the full 20000 total');
  assert.equal(cust.loyalty_points, 0, 'points follow paid value: floor(8000 / 10000) = 0');
});

test('P2: a returning customer has their existing debt increased, not replaced', async () => {
  const f = fixture();
  f.db.prepare(`INSERT INTO customers (id, name, phone, email, address, purchase_history_count, outstanding_balance_kobo, loyalty_points, lifetime_value_kobo, created_at)
    VALUES ('cust-1', 'Ada Existing', '+234 803 123 4567', '', '', 2, 5000, 7, 30000, '2026-01-01T00:00:00.000Z')`).run();
  await checkout(f.exec, f.session);
  const id = orderId(f.db);
  await confirm(f.exec, id);
  const res = await collect(f.exec, id, { paymentMethod: 'Cash', amountKobo: 8000 });
  assert.equal(res.status, 200);

  const cust = row(f.db, `SELECT * FROM customers WHERE id = 'cust-1'`);
  assert.equal(cust.outstanding_balance_kobo, 17000, 'prior debt 5000 + new shortfall 12000 = 17000 kobo');
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM customers').get() as any).n, 1, 'the phone match reuses the customer');
});

// ---------------------------------------------------------------------------
// P3 — payment row + treasury reflect cash received, not the full price.
// ---------------------------------------------------------------------------

test('P3: the payment is marked partial and the inflow equals cash received', async () => {
  const f = await prepared();
  await collect(f.exec, f.id, { paymentMethod: 'Cash', amountKobo: 8000 });

  const payment = row(f.db, 'SELECT amount_kobo, status FROM payments LIMIT 1');
  assert.equal(payment.amount_kobo, 8000);
  assert.equal(payment.status, 'partial', 'a part payment is not a settled payment');

  const movement = row(f.db, `SELECT amount_kobo FROM money_movements WHERE type = 'Sale Inflow' LIMIT 1`);
  assert.equal(movement.amount_kobo, 8000, 'only cash actually received may hit the treasury as an inflow');
});

test('P3: the order detail reports the remaining balance due', async () => {
  const f = await prepared();
  const res = await collect(f.exec, f.id, { paymentMethod: 'Cash', amountKobo: 8000 });
  const body = await res.json() as any;
  assert.equal(body.order.paidKobo, 8000);
  assert.equal(body.order.amountDueKobo, 12000, 'staff must see the balance booked as debt');
});

// ---------------------------------------------------------------------------
// P4 — full payment is unchanged (no regression on the happy path).
// ---------------------------------------------------------------------------

test('P4: a full payment keeps today behaviour — fully paid, no debt', async () => {
  const f = await prepared();
  const res = await collect(f.exec, f.id, { paymentMethod: 'Cash', amountKobo: 20000 });
  assert.equal(res.status, 200);

  const sale = row(f.db, 'SELECT paid_kobo FROM sales LIMIT 1');
  assert.equal(sale.paid_kobo, 20000);
  const payment = row(f.db, 'SELECT status FROM payments LIMIT 1');
  assert.equal(payment.status, 'paid');
  const cust = row(f.db, 'SELECT outstanding_balance_kobo, lifetime_value_kobo FROM customers LIMIT 1');
  assert.equal(cust.outstanding_balance_kobo, 0, 'a fully paid order creates no debt');
  assert.equal(cust.lifetime_value_kobo, 20000, 'full payment still realises the whole order value');
});

// ---------------------------------------------------------------------------
// P5 — the bounds: over-payment and zero payment are refused.
// ---------------------------------------------------------------------------

test('P5: an over-payment is rejected and writes nothing', async () => {
  const f = await prepared();
  const res = await collect(f.exec, f.id, { paymentMethod: 'Cash', amountKobo: 30000 });
  assert.equal(res.status, 400, 'a Mall order must never accept more than its total');
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM sales').get() as any).n, 0, 'a rejected payment mirrors no sale');
  assert.equal(row(f.db, 'SELECT status FROM mall_orders LIMIT 1').status, 'confirmed', 'the order is left untouched');
});

test('P5: a zero payment is rejected on the settlement endpoint', async () => {
  const f = await prepared();
  const res = await collect(f.exec, f.id, { paymentMethod: 'Cash', amountKobo: 0 });
  assert.equal(res.status, 400, 'a genuinely unpaid order stays pending; 0 is not a settlement');
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM sales').get() as any).n, 0);
});

// ---------------------------------------------------------------------------
// P6 — an unrecognised phone cannot carry debt, so a part payment is refused.
// ---------------------------------------------------------------------------

test('P6: a part payment for an unknown phone is refused', async () => {
  const f = await prepared({ customerPhone: '08030000000' });
  const res = await collect(f.exec, f.id, { paymentMethod: 'Cash', amountKobo: 8000 });
  assert.equal(res.status, 400, 'debt can only be booked against a recognised customer');
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM sales').get() as any).n, 0, 'a refused part payment mirrors no sale');
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM customers').get() as any).n, 0, 'no customer row is minted for a refused part payment');
  assert.equal(row(f.db, 'SELECT status FROM mall_orders LIMIT 1').status, 'confirmed', 'the order is left untouched');
});

test('P6b: a FULL payment for an unknown phone is still accepted (no debt involved)', async () => {
  const f = await prepared({ customerPhone: '08030000000' });
  const res = await collect(f.exec, f.id, { paymentMethod: 'Cash', amountKobo: 20000 });
  assert.equal(res.status, 200, 'the unknown-phone refusal is specific to part payment');
  const cust = row(f.db, 'SELECT outstanding_balance_kobo FROM customers LIMIT 1');
  assert.equal(cust.outstanding_balance_kobo, 0, 'a fully paid order creates no debt regardless of the phone');
});

// ---------------------------------------------------------------------------
// P7 — idempotency: a replay cannot double-charge or double-book debt.
// ---------------------------------------------------------------------------

test('P7: replaying a part payment does not duplicate the sale or the debt', async () => {
  const f = await prepared();
  const first = await collect(f.exec, f.id, { paymentMethod: 'Cash', amountKobo: 8000 });
  assert.equal(first.status, 200);
  const replay = await collect(f.exec, f.id, { paymentMethod: 'Cash', amountKobo: 8000 });
  assert.equal(replay.status, 200, 'a replay returns the current detail, not an error');

  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM sales').get() as any).n, 1, 'exactly one mirrored sale');
  const cust = row(f.db, 'SELECT outstanding_balance_kobo FROM customers LIMIT 1');
  assert.equal(cust.outstanding_balance_kobo, 12000, 'the debt is booked once, not once per attempt');
});

// ---------------------------------------------------------------------------
// P8 — refunding a part-paid order unwinds the debt it created.
// ---------------------------------------------------------------------------

test('P8: refunding a part-paid order clears the debt it recorded', async () => {
  const f = await prepared();
  await collect(f.exec, f.id, { paymentMethod: 'Cash', amountKobo: 8000 });
  assert.equal(row(f.db, 'SELECT outstanding_balance_kobo FROM customers LIMIT 1').outstanding_balance_kobo, 12000);

  const refund = await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${f.id}/refund`, {
    method: 'POST', body: JSON.stringify({ reason: 'Customer returned goods', returnStock: true }),
  }), f.exec, actor);
  assert.equal(refund.status, 200);

  const cust = row(f.db, 'SELECT outstanding_balance_kobo FROM customers LIMIT 1');
  assert.equal(cust.outstanding_balance_kobo, 0, 'a returned part-paid order must not leave phantom debt behind');
});
