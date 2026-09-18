import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { ensureRelationalSchemaNode, makeNodeMallExecutor } from '../src/server/nodeAdapter.ts';
import { handleMallApi } from '../src/server/mallApi.ts';
import { handleStaffMallApi } from '../src/server/mallOrderAdminApi.ts';

const actor = { id: 'staff-1', displayName: 'Test Manager', role: 'Administrator' };

function fixture() {
  const db = new DatabaseSync(':memory:');
  ensureRelationalSchemaNode(db);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO products (id, sku, name, description, category_name, brand, supplier_name, images_json,
    cost_price_kobo, retail_price_kobo, wholesale_price_kobo, min_wholesale_qty, min_selling_price_kobo,
    stock_qty, low_stock_threshold, unit, status, is_mall_listed, mall_price_kobo, created_at, updated_at)
    VALUES ('prod-1', 'SKU1', 'Mall Product', '', 'Test', 'Test', '', '[]', 5000, 10000, 9000, 10, 5000, 10, 2, 'pcs', 'Active', 1, 10000, ?, ?)`).run(now, now);
  const session = 'mall-test-session-1234';
  const cartId = `mc-${session}`;
  db.prepare(`INSERT INTO mall_carts (id, session_id, status, updated_at) VALUES (?, ?, 'active', ?)`).run(cartId, session, Date.now());
  db.prepare(`INSERT INTO mall_cart_items (id, cart_id, product_id, qty, unit_price_kobo) VALUES ('ci-1', ?, 'prod-1', 2, 1)`).run(cartId);
  return { db, exec: makeNodeMallExecutor(db), session };
}

async function checkout(exec: ReturnType<typeof makeNodeMallExecutor>, session: string, overrides: Record<string, unknown> = {}) {
  const response = await handleMallApi(new Request('http://test/api/mall/checkout', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-mall-session': session, 'idempotency-key': `test-attempt-${session}` },
    body: JSON.stringify({ customerName: 'Ada', customerPhone: '08031234567', paymentMethod: 'pay_on_pickup', deliveryFeeNaira: 99999, ...overrides }),
  }), exec);
  return { response, body: await response.json() as any };
}

test('checkout is server-priced, pending, fee-safe and idempotent', async () => {
  const { db, exec, session } = fixture();
  const first = await checkout(exec, session);
  assert.equal(first.response.status, 201);
  assert.equal(first.body.totalKobo, 20000);
  assert.equal(first.body.paidKobo, 0);
  assert.equal(first.body.paymentStatus, 'pending');
  assert.equal((db.prepare(`SELECT stock_qty FROM products WHERE id = 'prod-1'`).get() as any).stock_qty, 8);
  const second = await checkout(exec, session);
  assert.equal(second.body.orderNo, first.body.orderNo);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM mall_orders').get() as any).n, 1);
  assert.equal((db.prepare(`SELECT stock_qty FROM products WHERE id = 'prod-1'`).get() as any).stock_qty, 8);
});

test('fixed delivery zones are server-priced and require an address', async () => {
  const central = fixture();
  assert.equal((await checkout(central.exec, central.session, { deliveryZone: 'invented_free_zone' })).response.status, 400);
  assert.equal((await checkout(central.exec, central.session, { deliveryZone: 'uyo_central' })).response.status, 400);
  const outer = fixture();
  const placed = await checkout(outer.exec, outer.session, { deliveryZone: 'uyo_outer', deliveryAddress: 'Shelter Afrique, Uyo', deliveryFeeNaira: 1 });
  assert.equal(placed.response.status, 201);
  assert.equal(placed.body.deliveryFeeKobo, 250000);
  assert.equal(placed.body.totalKobo, 270000);
  const row = outer.db.prepare('SELECT delivery_fee_kobo, total_kobo FROM mall_orders').get() as any;
  assert.equal(row.delivery_fee_kobo, 250000);
  assert.equal(row.total_kobo, 270000);
});

test('other locations require a manager quote before confirmation or payment', async () => {
  const { db, exec, session } = fixture();
  const placed = await checkout(exec, session, { deliveryZone: 'other', deliveryAddress: 'Calabar, Cross River' });
  assert.equal(placed.body.quoteRequired, true);
  const id = (db.prepare('SELECT id FROM mall_orders LIMIT 1').get() as any).id;
  const unauthorizedQuote = await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/quote-delivery`, { method: 'POST', body: JSON.stringify({ feeKobo: 1 }) }), exec, { ...actor, role: 'Sales Staff' });
  assert.equal(unauthorizedQuote.status, 403);
  const confirmBeforeQuote = await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/confirm`, { method: 'POST', body: '{}' }), exec, actor);
  assert.equal(confirmBeforeQuote.status, 409);
  const payBeforeQuote = await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/collect-payment`, { method: 'POST', body: JSON.stringify({ paymentMethod: 'Cash', amountKobo: 320000 }) }), exec, actor);
  assert.equal(payBeforeQuote.status, 409);
  const quoted = await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/quote-delivery`, { method: 'POST', body: JSON.stringify({ feeKobo: 300000 }) }), exec, actor);
  assert.equal(quoted.status, 200);
  const row = db.prepare('SELECT delivery_fee_kobo, total_kobo FROM mall_orders WHERE id = ?').get(id) as any;
  assert.equal(row.delivery_fee_kobo, 300000);
  assert.equal(row.total_kobo, 320000);
  assert.equal((db.prepare('SELECT amount_kobo FROM payments WHERE order_id = ?').get(id) as any).amount_kobo, 320000);
  assert.equal((await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/review-delivery`, {method:'POST',body:JSON.stringify({confirmed:true})}),exec,actor)).status,200);
  assert.equal((await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/confirm`, { method: 'POST', body: '{}' }), exec, actor)).status, 200);
});

test('staff payment creates one canonical sale without deducting stock twice', async () => {
  const { db, exec, session } = fixture();
  await checkout(exec, session);
  const id = (db.prepare('SELECT id FROM mall_orders LIMIT 1').get() as any).id;
  await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/confirm`, { method: 'POST', body: '{}' }), exec, actor);
  const paid = await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/collect-payment`, {
    method: 'POST', body: JSON.stringify({ paymentMethod: 'Cash', amountKobo: 20000 }),
  }), exec, actor);
  assert.equal(paid.status, 200);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM sales').get() as any).n, 1);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM money_movements').get() as any).n, 1);
  assert.equal((db.prepare(`SELECT stock_qty FROM products WHERE id = 'prod-1'`).get() as any).stock_qty, 8);
  const retry = await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/collect-payment`, {
    method: 'POST', body: JSON.stringify({ paymentMethod: 'Cash', amountKobo: 20000 }),
  }), exec, actor);
  assert.equal(retry.status, 200);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM sales').get() as any).n, 1);
});

test('staff cancellation restores committed stock exactly once', async () => {
  const { db, exec, session } = fixture();
  await checkout(exec, session);
  const id = (db.prepare('SELECT id FROM mall_orders LIMIT 1').get() as any).id;
  const cancel = () => handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/cancel`, {
    method: 'POST', body: JSON.stringify({ reason: 'Test cancellation' }),
  }), exec, actor);
  assert.equal((await cancel()).status, 200);
  assert.equal((db.prepare(`SELECT stock_qty FROM products WHERE id = 'prod-1'`).get() as any).stock_qty, 10);
  assert.equal((await cancel()).status, 200);
  assert.equal((db.prepare(`SELECT stock_qty FROM products WHERE id = 'prod-1'`).get() as any).stock_qty, 10);
});

test('paid orders follow the guarded fulfilment state machine', async () => {
  const { db, exec, session } = fixture();
  await checkout(exec, session);
  const id = (db.prepare('SELECT id FROM mall_orders LIMIT 1').get() as any).id;
  await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/confirm`, { method: 'POST', body: '{}' }), exec, actor);
  const unpaid = await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/start-processing`, { method: 'POST', body: '{}' }), exec, actor);
  assert.equal(unpaid.status, 409);
  assert.equal((db.prepare('SELECT status FROM mall_orders WHERE id = ?').get(id) as any).status, 'confirmed');
  await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/collect-payment`, { method: 'POST', body: JSON.stringify({ paymentMethod: 'Cash', amountKobo: 20000 }) }), exec, actor);
  const actions = ['mark-packed', 'mark-ready', 'complete'];
  for (const action of actions) {
    const response = await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/${action}`, { method: 'POST', body: '{}' }), exec, actor);
    assert.equal(response.status, 200);
  }
  assert.equal((db.prepare('SELECT status FROM mall_orders WHERE id = ?').get(id) as any).status, 'completed');
  const invalid = await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/mark-packed`, { method: 'POST', body: '{}' }), exec, actor);
  assert.equal(invalid.status, 409);
});

test('delivery fulfilment links into deliveries and refunds restore stock once', async () => {
  const { db, exec, session } = fixture();
  await checkout(exec, session);
  const id = (db.prepare('SELECT id FROM mall_orders LIMIT 1').get() as any).id;
  db.exec(`UPDATE mall_orders SET delivery_address_json=json_set(delivery_address_json,'$.zone','uyo_central')`);
  assert.equal((await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/review-delivery`, {method:'POST',body:JSON.stringify({confirmed:true})}),exec,actor)).status,200);
  await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/confirm`, { method: 'POST', body: '{}' }), exec, actor);
  await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/collect-payment`, { method: 'POST', body: JSON.stringify({ paymentMethod: 'Card', amountKobo: 20000 }) }), exec, actor);
  await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/mark-packed`, { method: 'POST', body: '{}' }), exec, actor);
  await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/mark-out-for-delivery`, { method: 'POST', body: JSON.stringify({courier:'Test courier'}) }), exec, actor);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM delivery_orders WHERE sale_id = ?').get(`sale-${id}`) as any).n, 1);
  const refund = () => handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/refund`, { method: 'POST', body: JSON.stringify({ reason: 'Returned goods', returnStock: true, returnReference:'GRN-TEST' }) }), exec, actor);
  assert.equal((await refund()).status, 200);
  assert.equal((db.prepare(`SELECT stock_qty FROM products WHERE id = 'prod-1'`).get() as any).stock_qty, 10);
  assert.equal((db.prepare(`SELECT status FROM sales WHERE id = ?`).get(`sale-${id}`) as any).status, 'Refunded');
  const movement = db.prepare(`SELECT source_account, dest_account FROM money_movements WHERE id = ?`).get(`mm-refund-sale-${id}`) as any;
  assert.equal(movement.source_account, 'Biz Account');
  assert.equal(movement.dest_account, 'Card');
  assert.equal((await refund()).status, 200);
  assert.equal((db.prepare(`SELECT stock_qty FROM products WHERE id = 'prod-1'`).get() as any).stock_qty, 10);
});