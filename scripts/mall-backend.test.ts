import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { ensureRelationalSchemaNode, makeNodeMallExecutor } from '../src/server/nodeAdapter.ts';
import { handleMallApi } from '../src/server/mallApi.ts';
import { handleStaffMallApi } from '../src/server/mallOrderAdminApi.ts';
import { revisionBumpStatement } from '../src/server/mallSafety.ts';

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

test('checkout validates and stores the optional customer email', async () => {
  const bad = fixture();
  const rejected = await checkout(bad.exec, bad.session, { customerEmail: 'not-an-email' });
  assert.equal(rejected.response.status, 400);
  assert.equal(rejected.body.fields.customerEmail, 'Enter a valid email address.');
  assert.equal((bad.db.prepare('SELECT COUNT(*) AS n FROM mall_orders').get() as any).n, 0);

  const good = fixture();
  const placed = await checkout(good.exec, good.session, { customerEmail: '  ADA@Example.COM ' });
  assert.equal(placed.response.status, 201);
  assert.equal(placed.body.customerEmail, 'ada@example.com', 'the email is normalized (trimmed, lowercased) on the server');
  const row = good.db.prepare('SELECT customer_email FROM mall_orders').get() as any;
  assert.equal(row.customer_email, 'ada@example.com');

  // Omitting the email keeps checkout working (operator-only notifications).
  const noEmail = fixture();
  const bare = await checkout(noEmail.exec, noEmail.session);
  assert.equal(bare.response.status, 201);
  assert.equal(bare.body.customerEmail, undefined);
});

test('customer lookup recognises a returning buyer by phone and leaks no PII', async () => {
  const { db, exec, session } = fixture();
  const lookup = (phone: string, headers: Record<string, string> = { 'x-mall-session': session }) =>
    handleMallApi(new Request(`http://test/api/mall/customer/lookup?phone=${encodeURIComponent(phone)}`, { headers }), exec);
  db.prepare(`INSERT INTO customers (id, name, phone, email, address, purchase_history_count, outstanding_balance_kobo, loyalty_points, lifetime_value_kobo, created_at)
    VALUES ('cust-known', 'Idongesit Michael', '+2348063766861', 'buyer@example.com', '16 Atakpo Street, Uyo', 3, 50000, 1055, 10550000, '2026-01-01')`).run();

  // A known number, matched with the same normalization the fulfilment path uses.
  const hit = await lookup('08063766861');
  assert.equal(hit.status, 200);
  const body = await hit.json() as any;
  assert.equal(body.known, true);
  assert.equal(body.firstName, 'Idongesit');
  assert.equal(body.address, '16 Atakpo Street, Uyo');
  // Privacy contract: hints only. No id, no phone echo, no email, no balances.
  assert.deepEqual(Object.keys(body).sort(), ['address', 'firstName', 'known']);

  // An unknown number is a legitimate "not recognised", never an error.
  const miss = await lookup('08030000000');
  assert.equal(miss.status, 200);
  assert.deepEqual(await miss.json(), { known: false });

  // A malformed number must not 5xx and must not match.
  const junk = await lookup('not-a-phone');
  assert.equal(junk.status, 200);
  assert.deepEqual(await junk.json(), { known: false });

  // It is session-bound like the other money/session routes.
  const noSession = await handleMallApi(new Request('http://test/api/mall/customer/lookup?phone=08063766861'), exec);
  assert.equal(noSession.status, 400);
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

test('every mall write batch bumps the sync revision', async () => {
  const { db, exec, session } = fixture();
  const revision = () => Number(JSON.parse(String((db.prepare(`SELECT value_json FROM settings WHERE key = 'sync_watermark'`).get() as any)?.value_json ?? '0')) || 0);
  assert.equal(revision(), 0, 'a fresh database starts with no watermark row');
  await checkout(exec, session);
  const afterCheckout = revision();
  assert.ok(afterCheckout > 0, 'checkout bumps the revision (stock + stock_movements changed)');
  const id = (db.prepare('SELECT id FROM mall_orders LIMIT 1').get() as any).id;
  await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/confirm`, { method: 'POST', body: '{}' }), exec, actor);
  const afterConfirm = revision();
  assert.ok(afterConfirm > afterCheckout, 'confirmation bumps the revision (audit_logs changed)');
  await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/collect-payment`, {
    method: 'POST', body: JSON.stringify({ paymentMethod: 'Cash', amountKobo: 20000 }),
  }), exec, actor);
  assert.ok(revision() > afterConfirm, 'settlement bumps the revision so guarded snapshot clients re-read the mirrored sale');
});

test('settlement persists the buyer email and address on the new customer record', async () => {
  const { db, exec, session } = fixture();
  await checkout(exec, session, { customerEmail: 'ada@example.com', deliveryAddress: '1 Test Road, Uyo' });
  const id = (db.prepare('SELECT id FROM mall_orders LIMIT 1').get() as any).id;
  await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/confirm`, { method: 'POST', body: '{}' }), exec, actor);
  const paid = await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/collect-payment`, {
    method: 'POST', body: JSON.stringify({ paymentMethod: 'Cash', amountKobo: 20000 }),
  }), exec, actor);
  assert.equal(paid.status, 200);
  const cust = db.prepare('SELECT * FROM customers').get() as any;
  assert.equal(cust.id, `cust-${id}`);
  assert.equal(cust.email, 'ada@example.com', 'the checkout email cascades into the customer record');
  assert.equal(cust.address, '1 Test Road, Uyo', 'the order address cascades into the customer record');
  assert.equal(cust.purchase_history_count, 1);
  assert.equal(cust.lifetime_value_kobo, 20000);
  assert.equal(cust.loyalty_points, 2);
});

test('settlement matches returning buyers by phone, bumps counters and fills blank profile fields', async () => {
  const { db, exec, session } = fixture();
  db.prepare(`INSERT INTO customers (id, name, phone, email, address, purchase_history_count, outstanding_balance_kobo, loyalty_points, lifetime_value_kobo, created_at)
    VALUES ('cust-1', 'Ada Existing', '+234 803 123 4567', '', '', 2, 0, 7, 30000, '2026-01-01T00:00:00.000Z')`).run();
  await checkout(exec, session, { customerEmail: 'ada@example.com', deliveryAddress: '1 Test Road, Uyo' });
  const id = (db.prepare('SELECT id FROM mall_orders LIMIT 1').get() as any).id;
  await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/confirm`, { method: 'POST', body: '{}' }), exec, actor);
  const paid = await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/collect-payment`, {
    method: 'POST', body: JSON.stringify({ paymentMethod: 'Cash', amountKobo: 20000 }),
  }), exec, actor);
  assert.equal(paid.status, 200);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM customers').get() as any).n, 1, 'the phone match reuses the existing customer instead of minting a new one');
  const cust = db.prepare('SELECT * FROM customers').get() as any;
  assert.equal(cust.id, 'cust-1');
  assert.equal(cust.name, 'Ada Existing', 'a staff-maintained name is never overwritten by the order');
  assert.equal(cust.email, 'ada@example.com', 'the blank email is filled from the order');
  assert.equal(cust.address, '1 Test Road, Uyo', 'the blank address is filled from the order');
  assert.equal(cust.purchase_history_count, 3);
  assert.equal(cust.lifetime_value_kobo, 50000);
  assert.equal(cust.loyalty_points, 9);
  assert.equal((db.prepare('SELECT customer_id FROM mall_orders').get() as any).customer_id, 'cust-1', 'the order links back to the existing customer');
});

test('settlement never overwrites profile details staff already maintain', async () => {
  const { db, exec, session } = fixture();
  db.prepare(`INSERT INTO customers (id, name, phone, email, address, purchase_history_count, outstanding_balance_kobo, loyalty_points, lifetime_value_kobo, created_at)
    VALUES ('cust-1', 'Ada Existing', '+234 803 123 4567', 'vip@shop.ng', '2 Legacy Close, Uyo', 0, 0, 0, 0, '2026-01-01T00:00:00.000Z')`).run();
  await checkout(exec, session, { customerEmail: 'ada@example.com', deliveryAddress: '1 New Road, Uyo' });
  const id = (db.prepare('SELECT id FROM mall_orders LIMIT 1').get() as any).id;
  await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/confirm`, { method: 'POST', body: '{}' }), exec, actor);
  const paid = await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/collect-payment`, {
    method: 'POST', body: JSON.stringify({ paymentMethod: 'Cash', amountKobo: 20000 }),
  }), exec, actor);
  assert.equal(paid.status, 200);
  const cust = db.prepare('SELECT * FROM customers').get() as any;
  assert.equal(cust.email, 'vip@shop.ng', 'an existing email is preserved');
  assert.equal(cust.address, '2 Legacy Close, Uyo', 'an existing address is preserved');
  assert.equal(cust.purchase_history_count, 1, 'counters still cascade');
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
  const movement = db.prepare(`SELECT type, source_account, dest_account FROM money_movements WHERE id = ?`).get(`mm-refund-sale-${id}`) as any;
  // A refund is an outflow of one liquid account: the money leaves the Biz
  // Account (Card settles there) and there is no destination account.
  assert.equal(movement.type, 'Sale Refund');
  assert.equal(movement.source_account, 'Biz Account');
  assert.equal(movement.dest_account, null);
  assert.equal((await refund()).status, 200);
  assert.equal((db.prepare(`SELECT stock_qty FROM products WHERE id = 'prod-1'`).get() as any).stock_qty, 10);
});

test('dispatch books the Logistics expense and its Expense Outflow movement; refund voids both', async () => {
  const { db, exec, session } = fixture();
  // A fixed outer-zone delivery carries a server-priced fee at checkout.
  const placed = await checkout(exec, session, { deliveryZone: 'uyo_outer', deliveryAddress: 'Shelter Afrique, Uyo' });
  assert.equal(placed.response.status, 201);
  assert.equal(placed.body.deliveryFeeKobo, 250000);
  const id = (db.prepare('SELECT id FROM mall_orders LIMIT 1').get() as any).id;
  await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/review-delivery`, { method: 'POST', body: JSON.stringify({ confirmed: true }) }), exec, actor);
  await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/confirm`, { method: 'POST', body: '{}' }), exec, actor);
  await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/collect-payment`, { method: 'POST', body: JSON.stringify({ paymentMethod: 'Cash', amountKobo: 270000 }) }), exec, actor);
  await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/mark-packed`, { method: 'POST', body: '{}' }), exec, actor);
  await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/mark-out-for-delivery`, { method: 'POST', body: JSON.stringify({ courier: 'Test courier' }) }), exec, actor);

  // The delivery fee is a real cash outflow: one Expense Outflow money movement.
  const mm = db.prepare(`SELECT type, subtype, source_account, amount_kobo FROM money_movements WHERE id = ?`).get(`mm-exp-mall-del-${id}`) as any;
  assert.equal(mm.type, 'Expense Outflow');
  assert.equal(mm.subtype, 'Logistics');
  assert.equal(mm.source_account, 'Physical Cash');
  assert.equal(mm.amount_kobo, 250000);

  const refund = () => handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/refund`, { method: 'POST', body: JSON.stringify({ reason: 'Returned goods', returnStock: true, returnReference: 'GRN-TEST' }) }), exec, actor);
  assert.equal((await refund()).status, 200);
  // The voided expense must unwind its outflow too, or the refund leaves the
  // courier cost as a permanent outflow on the ledger.
  assert.equal((db.prepare(`SELECT amount_kobo FROM money_movements WHERE id = ?`).get(`mm-exp-mall-del-${id}`) as any).amount_kobo, 0);
  assert.equal((db.prepare(`SELECT amount_kobo FROM expenses WHERE id = ?`).get(`exp-mall-del-${id}`) as any).amount_kobo, 0);
});

test('mall checkout records an Outgoing stock movement in the POS vocabulary', async () => {
  const { db, exec, session } = fixture();
  await checkout(exec, session);
  const movement = db.prepare(`SELECT type, qty, notes FROM stock_movements LIMIT 1`).get() as any;
  assert.equal(movement.type, 'Outgoing');
  assert.equal(movement.qty, -2);
  assert.match(movement.notes, /Mall order/);
});

test('the sync watermark is monotonic even when two mall writes share a millisecond', async () => {
  const { db, exec } = fixture();
  const read = () => Number(JSON.parse(String((db.prepare(`SELECT value_json FROM settings WHERE key = 'sync_watermark'`).get() as any)?.value_json ?? '0')) || 0);
  const frozen = Date.now();
  const originalNow = Date.now;
  (Date as any).now = () => frozen;
  try {
    await exec.runBatch([revisionBumpStatement()]);
    const first = read();
    await exec.runBatch([revisionBumpStatement()]);
    const second = read();
    assert.ok(first > 0, 'the first bump sets the watermark');
    assert.ok(second > first, 'a same-millisecond write must still advance the watermark');
  } finally {
    (Date as any).now = originalNow;
  }
});

test('a POS amendment cannot empty the order or carry malformed lines', async () => {
  const { db, exec, session } = fixture();
  const id = await paidOrder(exec, db, session);
  const body = (items: unknown) => JSON.stringify({ subtotalKobo: 30000, totalKobo: 30000, discountKobo: 0, deliveryFeeKobo: 0, paidKobo: 30000, orderStatus: 'processing', paymentStatus: 'paid', items });
  // Empty items must be rejected, not turn into a wholesale line wipe.
  const empty = await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/sync-from-pos`, { method: 'POST', body: body([]) }), exec, actor);
  assert.equal(empty.status, 400);
  // A line with a non-positive quantity or missing product id is malformed.
  const zeroQty = await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/sync-from-pos`, { method: 'POST', body: body([{ productId: 'prod-1', name: 'X', qty: 0, unitPriceKobo: 10000 }]) }), exec, actor);
  assert.equal(zeroQty.status, 400);
  const noProduct = await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/sync-from-pos`, { method: 'POST', body: body([{ name: 'X', qty: 1, unitPriceKobo: 10000 }]) }), exec, actor);
  assert.equal(noProduct.status, 400);
  // The original lines must survive the rejected amendments.
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM mall_order_items WHERE mall_order_id = ?').get(id) as any).n, 1);
});
/** Settle a checked-out order into a linked sale so the POS-sync tests have a target. */
async function paidOrder(exec: ReturnType<typeof makeNodeMallExecutor>, db: InstanceType<typeof DatabaseSync>, session: string) {
  await checkout(exec, session);
  const id = (db.prepare('SELECT id FROM mall_orders LIMIT 1').get() as any).id as string;
  await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/confirm`, { method: 'POST', body: '{}' }), exec, actor);
  await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/collect-payment`, {
    method: 'POST', body: JSON.stringify({ paymentMethod: 'Cash', amountKobo: 20000 }),
  }), exec, actor);
  return id;
}

const syncBody = (overrides: Record<string, unknown> = {}) => ({
  subtotalKobo: 30000, totalKobo: 30000, discountKobo: 0, deliveryFeeKobo: 0, paidKobo: 30000,
  orderStatus: 'processing', paymentStatus: 'paid',
  items: [{ productId: 'prod-1', name: 'Mall Product', qty: 3, unitPriceKobo: 10000 }],
  ...overrides,
});

test('a POS amendment reconciles the Mall order, its lines and the buyer notification', async () => {
  const { db, exec, session } = fixture();
  const id = await paidOrder(exec, db, session);
  assert.equal((db.prepare('SELECT total_kobo FROM mall_orders WHERE id = ?').get(id) as any).total_kobo, 20000);

  const synced = await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/sync-from-pos`, {
    method: 'POST', body: JSON.stringify(syncBody()),
  }), exec, actor);
  assert.equal(synced.status, 200);

  const order = db.prepare('SELECT total_kobo, status FROM mall_orders WHERE id = ?').get(id) as any;
  assert.equal(order.total_kobo, 30000, 'the buyer-visible total follows the counter edit');
  assert.equal(order.status, 'processing');
  const lines = db.prepare('SELECT product_id, qty, unit_price_kobo, total_kobo FROM mall_order_items WHERE mall_order_id = ?').all(id) as any[];
  assert.equal(lines.length, 1);
  assert.equal(lines[0].qty, 3);
  assert.equal(lines[0].total_kobo, 30000, 'line totals are recomputed from qty x unit');
  const payment = db.prepare('SELECT amount_kobo, status FROM payments WHERE order_id = ?').get(id) as any;
  assert.equal(payment.amount_kobo, 30000);
  assert.equal(payment.status, 'paid');
  // The audit row is what the outbox trigger turns into the buyer's amendment email.
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'AMEND_MALL_ORDER_FROM_POS'`).get() as any).n, 1);
});

test('a POS amendment replaces lines wholesale and is idempotent on replay', async () => {
  const { db, exec, session } = fixture();
  const id = await paidOrder(exec, db, session);

  await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/sync-from-pos`, {
    method: 'POST', body: JSON.stringify(syncBody({ items: [
      { productId: 'prod-1', name: 'Mall Product', qty: 1, unitPriceKobo: 10000 },
      { productId: 'prod-2', name: 'Added Item', qty: 2, unitPriceKobo: 5000 },
    ], subtotalKobo: 20000, totalKobo: 20000, paidKobo: 20000 })),
  }), exec, actor);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM mall_order_items WHERE mall_order_id = ?').get(id) as any).n, 2);

  // Replaying with a single line must drop the second, not leave it orphaned.
  await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/sync-from-pos`, {
    method: 'POST', body: JSON.stringify(syncBody()),
  }), exec, actor);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM mall_order_items WHERE mall_order_id = ?').get(id) as any).n, 1);
  assert.equal((db.prepare('SELECT total_kobo FROM mall_orders WHERE id = ?').get(id) as any).total_kobo, 30000);
});

test('a POS amendment is refused for an unpaid order and for non-operating roles', async () => {
  const { db, exec, session } = fixture();
  await checkout(exec, session);
  const id = (db.prepare('SELECT id FROM mall_orders LIMIT 1').get() as any).id as string;

  // No linked sale yet: nothing to reconcile.
  const unpaid = await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/sync-from-pos`, {
    method: 'POST', body: JSON.stringify(syncBody()),
  }), exec, actor);
  assert.equal(unpaid.status, 409);

  const id2 = await paidOrder(exec, db, session);
  const accountant = { ...actor, role: 'Accountant' };
  const forbidden = await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id2}/sync-from-pos`, {
    method: 'POST', body: JSON.stringify(syncBody()),
  }), exec, accountant);
  assert.equal(forbidden.status, 403);
});

test('committed Mall stock reports the escrow units and their at-cost value', async () => {
  const { db, exec, session } = fixture();
  // A second, higher-cost product so the valuation is not a single-line artefact.
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO products (id, sku, name, description, category_name, brand, supplier_name, images_json,
    cost_price_kobo, retail_price_kobo, wholesale_price_kobo, min_wholesale_qty, min_selling_price_kobo,
    stock_qty, low_stock_threshold, unit, status, is_mall_listed, mall_price_kobo, created_at, updated_at)
    VALUES ('prod-2', 'SKU2', 'Costly Product', '', 'Test', 'Test', '', '[]', 7000, 12000, 11000, 10, 7000, 5, 2, 'pcs', 'Active', 1, 12000, ?, ?)`).run(now, now);

  await checkout(exec, session); // 2 x prod-1 = 2 units @ 5000 cost = 10000 kobo
  const metrics = (await (await handleStaffMallApi(new Request('http://test/api/staff/mall-orders/operations', { method: 'GET' }), exec, actor)).json()) as any;
  assert.equal(metrics.committedStock.units, 2);
  assert.equal(metrics.committedStock.costKobo, 10000);
  assert.equal(metrics.committedStock.orders, 1);
  assert.equal(metrics.committedStock.byStatus[0].status, 'pending');
});

test('committed Mall stock falls to zero once the order settles into a sale', async () => {
  const { db, exec, session } = fixture();
  const id = await paidOrder(exec, db, session);
  // Paid but not yet fulfilled: still committed (in the fulfilment pipeline).
  let metrics = (await (await handleStaffMallApi(new Request('http://test/api/staff/mall-orders/operations', { method: 'GET' }), exec, actor)).json()) as any;
  assert.equal(metrics.committedStock.units, 2);

  await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/refund`, {
    method: 'POST', body: JSON.stringify({ reason: 'Returned', returnStock: true, returnReference: 'GRN-1' }),
  }), exec, actor);
  metrics = (await (await handleStaffMallApi(new Request('http://test/api/staff/mall-orders/operations', { method: 'GET' }), exec, actor)).json()) as any;
  assert.equal(metrics.committedStock.units, 0, 'a refunded order no longer holds committed stock');
});
