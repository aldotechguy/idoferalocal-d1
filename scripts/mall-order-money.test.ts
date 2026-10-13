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
}
