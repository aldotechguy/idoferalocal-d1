/**
 * Mall order money-and-stock lifecycle, dual-runtime (node + worker).
 *
 * Runs the REAL Mall API + staff admin API against real in-memory SQLite
 * tables through the SAME MallExecutor contract both runtimes use:
 *   - node:   handleMallApi / handleStaffMallApi over makeNodeMallExecutor
 *   - worker: sites-worker fetch over the SqliteD1 binding double
 * SqliteD1 executes real SQL in atomic batches — it is not a canned mock.
 *
 * Production safety: every test uses a fresh DatabaseSync(':memory:') with
 * unique sessions/attempt keys. No file database, no network, no existing
 * records are touched.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import worker from '../sites-worker.ts';
import { ensureRelationalSchemaNode, makeNodeMallExecutor } from '../src/server/nodeAdapter.ts';
import { handleMallApi, invalidateMallFacetCache } from '../src/server/mallApi.ts';
import { handleStaffMallApi } from '../src/server/mallOrderAdminApi.ts';
import { clearMallRateLimitWindows } from '../src/server/mallOperations.ts';

/** Binding-shaped test double; executes real SQL and atomic batches, not canned results.
 * This is NOT a deployed D1/workerd test. */
class SqliteD1 {
  constructor(readonly db: DatabaseSync) { }
  prepare(sql: string) {
    const db = this.db;
    return {
      sql, params: [] as unknown[],
      bind(...params: unknown[]) { this.params = params; return this; },
      async all() { return { results: db.prepare(this.sql).all(...this.params as any[]) }; },
      async run() { return { meta: { changes: Number(db.prepare(this.sql).run(...this.params as any[]).changes) } }; },
    };
  }
  async batch(statements: ReturnType<SqliteD1['prepare']>[]) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((st) => ({ meta: { changes: Number(this.db.prepare(st.sql).run(...st.params as any[]).changes) } }));
      this.db.exec('COMMIT');
      return results;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

const actor = { id: 'staff-test', displayName: 'Manager', role: 'Administrator' };
const buyerBody = { customerName: 'Ada', customerPhone: '08031234567', paymentMethod: 'pay_on_pickup' };
const key = () => `money-${crypto.randomUUID().replaceAll('-', '')}`;
const sid = (tag: string) => `money-${tag}-${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`;

async function fixture(runtime: 'node' | 'worker') {
  const db = new DatabaseSync(':memory:');
  ensureRelationalSchemaNode(db);
  invalidateMallFacetCache();
  clearMallRateLimitWindows();
  const exec = makeNodeMallExecutor(db);
  const env: any = { MALL_CHECKOUT_ENABLED: 'true', MALL_PICKUP_ADDRESS: 'Test pickup', MALL_PICKUP_HOURS: 'Test hours', DB: new SqliteD1(db), ASSETS: { fetch: async (req: Request) => new Response(`asset:${new URL(req.url).pathname}`) } };
  const send = (request: Request) => runtime === 'worker' ? worker.fetch(request, env) : handleMallApi(request, exec);
  await worker.fetch(new Request('http://test/api/mall/health'), env);
  const token = `money-token-${crypto.randomUUID()}`;
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  db.prepare(`INSERT INTO app_users(id,email,display_name,role,status,password_hash,password_salt,created_at) VALUES (?, 'staff@test.invalid', 'Manager', 'Administrator', 'Active', 'test-only-disabled-login', 'test-only', 'now')`).run(actor.id);
  db.prepare('INSERT INTO app_sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)').run(hash, actor.id, Date.now(), Date.now() + 600_000);
  db.exec(`INSERT INTO products(id,sku,name,stock_qty,status,is_mall_listed,retail_price_kobo,created_at,updated_at)
    VALUES('p','p','Product',10,'Active',1,10000,'now','now');`);
  const fill = (session: string, qty = 2) => {
    db.prepare(`INSERT OR IGNORE INTO mall_carts(id,session_id,status,updated_at) VALUES(?,?,'active',1)`).run(`mc-${session}`, session);
    db.prepare('INSERT INTO mall_cart_items(id,cart_id,product_id,qty,unit_price_kobo) VALUES(?,?,?, ?,1)').run(crypto.randomUUID(), `mc-${session}`, 'p', qty);
  };
  const session = sid('main');
  fill(session);
  const checkout = (attemptKey = key(), overrides: Record<string, unknown> = {}, s = session) => send(new Request('http://test/api/mall/checkout', {
    method: 'POST', headers: { 'x-mall-session': s, 'idempotency-key': attemptKey }, body: JSON.stringify({ ...buyerBody, ...overrides }),
  }));
  const id = () => (db.prepare('SELECT id FROM mall_orders LIMIT 1').get() as any).id as string;
  const op = (action: string, payload: Record<string, unknown> = {}, role = 'Administrator') => {
    const request = new Request(`http://test/api/staff/mall-orders/${id()}/${action}`, {
      method: 'POST', headers: { cookie: `idofera_session=${token}` }, body: JSON.stringify(payload),
    });
    if (runtime === 'worker') {
      db.prepare('UPDATE app_users SET role = ? WHERE id = ?').run(role, actor.id);
      return worker.fetch(request, env);
    }
    return handleStaffMallApi(request, exec, { ...actor, role });
  };
  const scalar = (sql: string) => Object.values(db.prepare(sql).get()!)[0];
  const pay = (amountKobo = 20000) => op('collect-payment', { paymentMethod: 'Cash', amountKobo });
  /** Same op() but against an explicit order id (for tests holding several orders). */
  const opId = (orderId: string, action: string, payload: Record<string, unknown> = {}, role = 'Administrator') => {
    const request = new Request(`http://test/api/staff/mall-orders/${orderId}/${action}`, {
      method: 'POST', headers: { cookie: `idofera_session=${token}` }, body: JSON.stringify(payload),
    });
    if (runtime === 'worker') {
      db.prepare('UPDATE app_users SET role = ? WHERE id = ?').run(role, actor.id);
      return worker.fetch(request, env);
    }
    return handleStaffMallApi(request, exec, { ...actor, role });
  };
  return { db, exec, env, send, fill, checkout, id, op, opId, pay, scalar, token, session };
}
for (const runtime of ['node', 'worker'] as const) {
  test(`${runtime}: checkout ignores tampered cart prices and client delivery fees, pricing strictly from the server`, async t => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    // Server prices: mall_price NULL -> falls back to retail 10000 kobo.
    f.db.prepare('UPDATE products SET mall_price_kobo = 8000 WHERE id = ?').run('p');
    // Buyer tampers the stored cart line price down to 1 kobo per unit.
    f.db.prepare('UPDATE mall_cart_items SET unit_price_kobo = 1 WHERE cart_id = ?').run(`mc-${f.session}`);
    const response = await f.checkout(key(), { deliveryFeeNaira: 99999, deliveryZone: 'uyo_central', deliveryAddress: '12 Market Road, Uyo' });
    assert.equal(response.status, 201);
    const order: any = await response.json();
    // 2 x 8000 server price — the tampered 1-kobo line is ignored entirely.
    assert.equal(order.subtotalKobo, 16000, 'the subtotal is priced from products, never the cart line');
    // uyo_central zone fee from the server policy — the client-sent 99999 is ignored.
    assert.equal(order.deliveryFeeKobo, 150000, 'the delivery fee comes from the trusted zone policy');
    assert.equal(order.totalKobo, 166000);
    assert.equal(f.scalar('SELECT unit_price_kobo FROM mall_order_items'), 8000, 'the order line records the server price');
    assert.equal(f.scalar('SELECT total_kobo FROM mall_orders'), 166000);
  });

  test(`${runtime}: negative quantities and bad zones are rejected before any write lands`, async t => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    const qty = (q: unknown) => f.send(new Request('http://test/api/mall/cart/qty', {
      method: 'POST', headers: { 'x-mall-session': f.session }, body: JSON.stringify({ productId: 'p', qty: q }),
    }));
    assert.equal((await qty(-1)).status, 400, 'a negative cart quantity is rejected');
    assert.equal((await qty(0)).status, 200, 'zero clears the line without error');
    assert.equal((await qty(1.5)).status, 400, 'a fractional quantity is rejected');
    await qty(2);
    // Unknown delivery zone.
    assert.equal((await f.checkout(key(), { deliveryZone: 'invented_free_zone' })).status, 400);
    // Delivery zone without a usable address.
    assert.equal((await f.checkout(key(), { deliveryZone: 'uyo_central' })).status, 400);
    // Zero/negative client delivery fee claims change nothing: pickup is fee-free.
    const pickup = await f.checkout(key(), { deliveryFeeNaira: 0 });
    assert.equal(pickup.status, 201);
    assert.equal((await pickup.json() as any).deliveryFeeKobo, 0, 'the pickup fee is the server policy (0), not the client claim');
    assert.equal(f.scalar('SELECT COUNT(*) FROM mall_orders'), 1, 'only the valid checkout persisted');
    assert.equal(f.scalar('SELECT stock_qty FROM products'), 8, 'only the valid checkout decremented stock');
  });

  test(`${runtime}: archived products cannot be bought; unlisted products are hidden from browse but the cart path trusts status`, async t => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    const add = (s: string) => f.send(new Request('http://test/api/mall/cart', {
      method: 'POST', headers: { 'x-mall-session': s }, body: JSON.stringify({ productId: 'p', qty: 1 }),
    }));
    // Archived: the cart add path rejects (status is the purchase gate) ...
    f.db.exec("UPDATE products SET status = 'Archived'");
    assert.equal((await add(sid('archived'))).status, 404, 'an archived product cannot enter a cart');
    // ... and a cart line left over from before the archive cannot check out.
    assert.equal((await f.checkout()).status, 409, 'a cart holding an archived product cannot check out');
    assert.equal(f.scalar('SELECT COUNT(*) FROM mall_orders'), 0, 'no order was created for an archived product');
    assert.equal(f.scalar('SELECT stock_qty FROM products'), 10, 'stock is untouched');
    // Unlisted-but-Active: the purchase path keys on status — probe the observed
    // contract (listing flag is merchandising scope, not the purchase gate).
    f.db.exec("UPDATE products SET status = 'Active', is_mall_listed = 0");
    assert.equal((await add(sid('unlisted-still-active'))).status, 200, 'the cart add path trusts status, not the listing flag');
    assert.equal((await f.checkout(key(), {}, sid('unlisted-checkout'))).status, 400, '...but an empty cart still cannot check out');
  });

  test(`${runtime}: last-unit contention fails the loser cleanly with no partial order or outbox event`, async t => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    f.db.exec('UPDATE products SET stock_qty = 3');
    const sessionA = sid('A');
    const sessionB = sid('B');
    f.fill(sessionA, 2);
    f.fill(sessionB, 2);
    const first = await f.checkout(key(), {}, sessionA);
    assert.equal(first.status, 201, 'the first checkout wins the last units');
    assert.equal(f.scalar('SELECT stock_qty FROM products'), 1, 'winner reserved 2 of 3 units');
    const failed = await f.checkout(key(), {}, sessionB);
    assert.equal(failed.status, 409, 'the loser is told the cart changed, not given a 500');
    const errorBody: any = await failed.json().catch(() => ({}));
    assert.match(String(errorBody?.error ?? ''), /cart|availability|stock/i, 'the error tells the buyer to refresh, not an internal code');
    assert.equal(f.scalar('SELECT stock_qty FROM products'), 1, 'the failed checkout did not move stock');
    assert.equal(f.scalar('SELECT COUNT(*) FROM mall_orders'), 1, 'no partial second order exists');
    assert.equal(f.scalar('SELECT COUNT(*) FROM mall_checkout_attempts'), 1, 'the failed attempt was never recorded as committed');
    const phantomLines = f.scalar('SELECT COUNT(*) FROM mall_order_items WHERE mall_order_id NOT IN (SELECT id FROM mall_orders)');
    assert.equal(phantomLines, 0, 'no orphan lines exist for a phantom order');
    const phantomOutbox = f.scalar('SELECT COUNT(*) FROM mall_outbox WHERE order_id IS NOT NULL AND order_id NOT IN (SELECT id FROM mall_orders)');
    assert.equal(phantomOutbox, 0, 'no outbox event references a non-existent order');
  });

  test(`${runtime}: repeating collect-payment never double-credits the sale or the customer`, async t => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    assert.equal((await f.checkout()).status, 201);
    const orderId = f.id();
    await f.op('confirm', {});
    assert.equal((await f.pay()).status, 200, 'the first collection settles the order');
    assert.equal((await f.pay()).status, 200, 'a retried collection returns the settled state, not an error');
    assert.equal((await f.op('collect-payment', { paymentMethod: 'Cash', amountKobo: 1 })).status, 200, 'even a conflicting replay amount cannot move a settled order');
    const saleId = `sale-${orderId}`;
    assert.equal(f.scalar('SELECT COUNT(*) FROM sales'), 1, 'exactly one POS sale exists');
    assert.equal(f.scalar(`SELECT paid_kobo FROM sales WHERE id = '${saleId}'`), 20000, 'paid_kobo was not double-credited');
    assert.equal(f.scalar('SELECT amount_kobo FROM payments WHERE order_id IS NOT NULL'), 20000, 'the payment row was not double-credited');
    assert.equal(f.scalar('SELECT status FROM payments WHERE order_id IS NOT NULL'), 'paid');
    const customerId = String(f.scalar(`SELECT customer_id FROM sales WHERE id = '${saleId}'`));
    assert.equal(f.scalar(`SELECT lifetime_value_kobo FROM customers WHERE id = '${customerId}'`), 20000, 'lifetime value credited exactly once');
    assert.equal(f.scalar(`SELECT loyalty_points FROM customers WHERE id = '${customerId}'`), 2, 'loyalty credited exactly once (1pt per 100 naira)');
    assert.equal(f.scalar(`SELECT COUNT(*) FROM money_movements WHERE id = 'mm-${saleId}'`), 1, 'exactly one treasury inflow exists');
  });

  test(`${runtime}: collect-payment refuses zero and over-total amounts on an unsettled order`, async t => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    assert.equal((await f.checkout()).status, 201);
    await f.op('confirm', {});
    assert.equal((await f.op('collect-payment', { paymentMethod: 'Cash', amountKobo: 0 })).status, 400, 'zero is not a settlement');
    assert.equal((await f.op('collect-payment', { paymentMethod: 'Cash', amountKobo: 20001 })).status, 400, 'the Mall never takes more than its price');
    assert.equal((await f.op('collect-payment', { paymentMethod: 'Cash', amountKobo: 12.5 })).status, 400, 'a non-integer amount is rejected');
    assert.equal(f.scalar('SELECT COUNT(*) FROM sales'), 0, 'no sale was minted by refused payments');
    assert.equal(f.scalar('SELECT linked_sale_id IS NULL FROM mall_orders'), 1, 'the order is still unsettled');
  });

  test(`${runtime}: cancelling restores stock exactly once; re-cancel and delivered-cancel never double-restock`, async t => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    // Pending order cancel.
    assert.equal((await f.checkout()).status, 201);
    const pendingId = f.id();
    assert.equal(f.scalar('SELECT stock_qty FROM products'), 8, 'checkout reserved 2 units');
    assert.equal((await f.op('cancel', { reason: 'Buyer changed mind' }, 'Store Manager')).status, 200);
    assert.equal(f.scalar('SELECT stock_qty FROM products'), 10, 'cancel restores the exact ordered quantity');
    assert.equal(f.scalar(`SELECT status FROM mall_orders WHERE id = '${pendingId}'`), 'cancelled');
    assert.equal(f.scalar(`SELECT COUNT(*) FROM stock_movements WHERE ref_id = 'cancel:${pendingId}' AND type = 'Returned'`), 1, 'exactly one restock movement is written');
    // Re-cancel is an idempotent read, not a second restock.
    assert.equal((await f.op('cancel', { reason: 'Again' }, 'Store Manager')).status, 200);
    assert.equal(f.scalar('SELECT stock_qty FROM products'), 10, 're-cancelling never double-restocks');
    assert.equal(f.scalar(`SELECT COUNT(*) FROM stock_movements WHERE ref_id = 'cancel:${pendingId}'`), 1);
    // Confirmed order cancel also restores.
    const session2 = sid('confirmed');
    f.fill(session2, 3);
    assert.equal((await f.checkout(key(), {}, session2)).status, 201);
    assert.equal(f.scalar('SELECT stock_qty FROM products'), 7, 'second checkout reserved 3 more units');
    const secondId = String((f.db.prepare('SELECT id FROM mall_orders WHERE status = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get('pending') as any).id);
    assert.equal((await f.opId(secondId, 'confirm', {})).status, 200);
    assert.equal(f.scalar('SELECT stock_qty FROM products'), 7, 'confirm moves no stock');
    assert.equal((await f.opId(secondId, 'cancel', { reason: 'No show' }, 'Administrator')).status, 200);
    assert.equal(f.scalar('SELECT stock_qty FROM products'), 10, 'confirmed cancel restores all 3 units');
    // Delivered (completed) order: cancel is rejected, stock never moves.
    const session3 = sid('delivered');
    f.fill(session3, 1);
    assert.equal((await f.checkout(key(), {}, session3)).status, 201);
    const thirdId = String((f.db.prepare('SELECT id FROM mall_orders WHERE status = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get('pending') as any).id);
    await f.opId(thirdId, 'confirm', {});
    await f.opId(thirdId, 'collect-payment', { paymentMethod: 'Cash', amountKobo: 10000 });
    await f.opId(thirdId, 'start-processing', {});
    await f.opId(thirdId, 'mark-packed', {});
    assert.equal((await f.opId(thirdId, 'mark-ready', {})).status, 200);
    assert.equal((await f.opId(thirdId, 'complete', {})).status, 200, 'pickup order completes');
    assert.equal((await f.opId(thirdId, 'cancel', { reason: 'Too late' }, 'Store Manager')).status, 409, 'a delivered order cannot be cancelled');
    assert.equal(f.scalar('SELECT stock_qty FROM products'), 9, 'the refused cancel left stock at 9 (only the delivered unit out)');
  });

  // --- Mutation-killing locks (Stryker Cycle 1, arithmetic/conditional survivors
  // --- on the part-payment debt + refund unwind math. See docs/mutation-report.md.

  test(`${runtime}: part-payment debt math is exact — dueKobo, inflow, loyalty and debt all keyed to cash collected`, async t => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    // Registered customer so a part payment is accepted (the debt rule).
    f.db.prepare(`INSERT INTO customers (id, name, phone, email, address, purchase_history_count,
      outstanding_balance_kobo, loyalty_points, lifetime_value_kobo, created_at)
      VALUES ('cust-mut', 'Ada', '08031234567', '', '', 0, 0, 0, 0, '2026-01-01')`).run();
    assert.equal((await f.checkout()).status, 201);
    const id = f.id();
    // Order total 20000; collect exactly 12000 -> debt 8000, loyalty floor(12000/10000)=1.
    assert.equal((await f.op('collect-payment', { paymentMethod: 'Cash', amountKobo: 12000 })).status, 200);
    const saleId = `sale-${id}`;
    // THE LOCK (line 304 `totalKobo - amountKobo`): the debt is total minus cash
    // collected, not cash-collected minus total or 0.
    assert.equal(f.scalar(`SELECT outstanding_balance_kobo FROM customers WHERE id = 'cust-mut'`), 8000,
      'the receivable is total - collected (8000), never flipped or zeroed');
    // THE LOCK (line 353 Sale Inflow amountKobo): the treasury inflow is the cash
    // actually received (12000), not the order total.
    assert.equal(f.scalar(`SELECT amount_kobo FROM money_movements WHERE id = 'mm-${saleId}'`), 12000,
      'the inflow is the cash collected, not the order total');
    assert.equal(f.scalar("SELECT amount_kobo FROM payments WHERE order_id = '" + id + "'"), 12000);
    assert.equal(f.scalar("SELECT status FROM payments WHERE order_id = '" + id + "'"), 'partial');
    // THE LOCK (line 364/365 loyalty `Math.floor(amountKobo / 10_000)`): 1 point
    // per 100 naira collected — mutating the divisor or the floor breaks this.
    assert.equal(f.scalar(`SELECT loyalty_points FROM customers WHERE id = 'cust-mut'`), 1,
      'loyalty = floor(collected / 100 naira)');
    assert.equal(f.scalar(`SELECT lifetime_value_kobo FROM customers WHERE id = 'cust-mut'`), 12000,
      'LTV is keyed to the cash collected, not the total');
    // Notes text embeds the due amount via `dueKobo / 100` (line 353 ternary) —
    // mutating to dueKobo*100 or dropping the branch changes this string.
    const inflowNotes = String(f.scalar(`SELECT notes FROM money_movements WHERE id = 'mm-${saleId}'`));
    assert.ok(inflowNotes.includes('80 due'), `the part-payment note carries the 80 naira due, got: ${inflowNotes}`);
    assert.ok(inflowNotes.includes('part payment'), 'the note marks it as a part payment');
  });

  test(`${runtime}: refund of a part-paid order unwinds debt and loyalty with exact clamping`, async t => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    f.db.prepare(`INSERT INTO customers (id, name, phone, email, address, purchase_history_count,
      outstanding_balance_kobo, loyalty_points, lifetime_value_kobo, overage_balance_kobo, created_at)
      VALUES ('cust-ref', 'Ada', '08031234567', '', '', 1, 0, 2, 12000, 500, '2026-01-01')`).run();
    assert.equal((await f.checkout()).status, 201);
    const id = f.id();
    await f.op('confirm', {});
    assert.equal((await f.op('collect-payment', { paymentMethod: 'Cash', amountKobo: 12000 })).status, 200);
    // Sanity: debt booked at settlement.
    assert.equal(f.scalar(`SELECT outstanding_balance_kobo FROM customers WHERE id = 'cust-ref'`), 8000);
    // THE LOCK (line 506 `Math.max(0, total - paidKobo)`): the refund clears the
    // receivable by exactly the shortfall (8000), floored at 0.
    assert.equal((await f.op('refund', { reason: 'Returned', returnStock: true, returnReference: 'GRN-M' })).status, 200);
    assert.equal(f.scalar(`SELECT outstanding_balance_kobo FROM customers WHERE id = 'cust-ref'`), 0,
      'the part-payment debt is cleared by the refund');
    // THE LOCK (line 535 customer unwind): loyalty claws back floor(paid/10000)=1
    // (settlement added 1 to the seeded 2, refund subtracts 1 -> 2), LTV nets to
    // the collected amount (seed 12000 + 12000 - clawback 12000), history nets to
    // seeded 1 (+1 at settlement, -1 at refund), and the overage clawback is the
    // sale's overage_created (0 for a Mall order), floored at 0.
    assert.equal(f.scalar(`SELECT loyalty_points FROM customers WHERE id = 'cust-ref'`), 2,
      'loyalty: seed 2 +1 at settlement, -1 clawback at refund');
    assert.equal(f.scalar(`SELECT lifetime_value_kobo FROM customers WHERE id = 'cust-ref'`), 12000,
      'LTV: seed 12000 +12000 collected, -12000 clawback');
    assert.equal(f.scalar(`SELECT purchase_history_count FROM customers WHERE id = 'cust-ref'`), 1,
      'history: seed 1, +1 at settlement, -1 at refund');
    assert.equal(f.scalar(`SELECT overage_balance_kobo FROM customers WHERE id = 'cust-ref'`), 500,
      'the clawback removes only the credit this sale created (none for a Mall order)');
    // THE LOCK (line 529 Sale Refund movement): the refund returns the cash
    // actually collected (12000), leaving the correct account.
    assert.equal(f.scalar(`SELECT amount_kobo FROM money_movements WHERE id = 'mm-refund-sale-${id}'`), 12000,
      'the refund movement equals the cash collected');
    assert.equal(f.scalar(`SELECT source_account FROM money_movements WHERE id = 'mm-refund-sale-${id}'`), 'Physical Cash');
    // THE LOCK (line 512 netRefundAmount = paidKobo / 100): 120 naira in the refund record.
    const refunds = JSON.parse(String(f.scalar(`SELECT refunds_json FROM sales WHERE id = 'sale-${id}'`)));
    assert.equal(refunds[0].netRefundAmount, 120, 'netRefundAmount is the paid kobo converted to naira');
  });

  test(`${runtime}: collect-payment amount bounds are exact — zero/negative rejected, over-total rejected, boundary accepted`, async t => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    f.db.prepare(`INSERT INTO customers (id, name, phone, email, address, purchase_history_count,
      outstanding_balance_kobo, loyalty_points, lifetime_value_kobo, created_at)
      VALUES ('cust-bounds', 'Ada', '08031234567', '', '', 0, 0, 0, 0, '2026-01-01')`).run();
    assert.equal((await f.checkout()).status, 201);
    await f.op('confirm', {});
    // THE LOCK (line 302 `amountKobo <= 0`): zero AND negative are both refused.
    assert.equal((await f.op('collect-payment', { paymentMethod: 'Cash', amountKobo: 0 })).status, 400);
    assert.equal((await f.op('collect-payment', { paymentMethod: 'Cash', amountKobo: -5000 })).status, 400);
    // THE LOCK (line 303 `amountKobo > totalKobo`): one kobo over is refused, the
    // exact total is accepted.
    assert.equal((await f.op('collect-payment', { paymentMethod: 'Cash', amountKobo: 20001 })).status, 400);
    assert.equal((await f.op('collect-payment', { paymentMethod: 'Cash', amountKobo: 20000 })).status, 200);
    // THE LOCK (line 349 `dueKobo > 0 ? 'partial' : 'paid'`): a full settlement
    // is 'paid', a part payment is 'partial' — flipping the comparison swaps them.
    assert.equal(f.scalar("SELECT status FROM payments WHERE order_id = '" + f.id() + "'"), 'paid');
    assert.equal(f.scalar("SELECT outstanding_balance_kobo FROM customers WHERE id = 'cust-bounds'"), 0,
      'a full payment books no debt');
    // Boundary: exactly one kobo short is still a part payment.
    const session2 = sid('bounds-2');
    f.fill(session2);
    assert.equal((await f.checkout(key(), {}, session2)).status, 201);
    const secondId = String(f.scalar("SELECT id FROM mall_orders ORDER BY rowid DESC LIMIT 1"));
    await f.opId(secondId, 'confirm');
    assert.equal((await f.opId(secondId, 'collect-payment', { paymentMethod: 'Cash', amountKobo: 19999 })).status, 200);
    assert.equal(f.scalar("SELECT status FROM payments WHERE order_id = '" + secondId + "'"), 'partial');
    assert.equal(f.scalar("SELECT outstanding_balance_kobo FROM customers WHERE id = 'cust-bounds'"), 1,
      'one kobo of debt from the one-kobo-short settlement');
  });

  test(`${runtime}: payment method routes the treasury account and the refund reverses into the same account`, async t => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    assert.equal((await f.checkout()).status, 201);
    let id = f.id();
    await f.op('confirm', {});
    // THE LOCK (paymentDestination, line 249-251): Cash -> Physical Cash,
    // everything else -> Biz Account.
    assert.equal((await f.op('collect-payment', { paymentMethod: 'Cash', amountKobo: 20000 })).status, 200);
    assert.equal(f.scalar("SELECT dest_account FROM money_movements WHERE id = 'mm-sale-" + id + "'"), 'Physical Cash',
      'Cash settles into the till');
    assert.equal((await f.op('refund', { reason: 'R', returnStock: false })).status, 200);
    assert.equal(f.scalar("SELECT source_account FROM money_movements WHERE id = 'mm-refund-sale-" + id + "'"), 'Physical Cash',
      'a Cash refund leaves the till');
    // Card settles through the Biz Account, both ways.
    const session3 = sid('bounds-card');
    f.fill(session3);
    assert.equal((await f.checkout(key(), {}, session3)).status, 201);
    id = String(f.scalar("SELECT id FROM mall_orders ORDER BY rowid DESC LIMIT 1"));
    await f.opId(id, 'confirm');
    assert.equal((await f.opId(id, 'collect-payment', { paymentMethod: 'Card', amountKobo: 20000 })).status, 200);
    assert.equal(f.scalar("SELECT dest_account FROM money_movements WHERE id = 'mm-sale-" + id + "'"), 'Biz Account',
      'Card settles into the Biz Account');
    assert.equal((await f.opId(id, 'refund', { reason: 'R', returnStock: false })).status, 200);
    assert.equal(f.scalar("SELECT source_account FROM money_movements WHERE id = 'mm-refund-sale-" + id + "'"), 'Biz Account',
      'a Card refund leaves the Biz Account');
  });
}
