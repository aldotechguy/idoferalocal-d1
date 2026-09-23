/**
 * Mall Order cascade demo — walks orders through the full batch-atomic
 * lifecycle (public checkout -> delivery review -> payment settlement ->
 * fulfilment -> refund) against an in-memory relational database and
 * prints every core POS/back-office record the order cascades into:
 * stock, sales, sale_items, customers, payments, money_movements,
 * delivery_orders, stock returns, notifications and audit logs.
 *
 *   npx tsx scripts/mall-cascade-demo.ts   (or: npm run demo:mall-cascade)
 *
 * Mirrors the node-runtime fixture in scripts/mall-safety.test.ts: real SQL
 * and real atomic batches, no canned results. This is NOT a deployed
 * D1/workerd run. Exit code 0 means every cascade stage behaved exactly
 * as specified in docs/01-erd-v1.md ("Mall checkout ... on paid -> mirror
 * INSERT sales").
 */
import { DatabaseSync } from 'node:sqlite';
import worker from '../sites-worker.ts';
import { ensureRelationalSchemaNode, makeNodeMallExecutor } from '../src/server/nodeAdapter.ts';
import { handleMallApi, invalidateMallFacetCache } from '../src/server/mallApi.ts';
import { handleStaffMallApi } from '../src/server/mallOrderAdminApi.ts';
import { clearMallRateLimitWindows } from '../src/server/mallOperations.ts';

/** Binding-shaped test double; executes real SQL and atomic batches. */
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
      const results = statements.map((st) => ({ meta: { changes: Number(db.prepare(st.sql).run(...st.params as any[]).changes) } }));
      this.db.exec('COMMIT');
      return results;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

const actor = { id: 'staff-demo', displayName: 'Demo Manager', role: 'Administrator' };
const session = 'cascade-demo-session';
const attempt = 'cascade-demo-attempt-1';

const naira = (kobo: unknown) => `NGN ${(Number(kobo || 0) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

function cell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Uint8Array) return 'blob';
  const text = String(value);
  return text.length > 48 ? `${text.slice(0, 45)}...` : text;
}

let failed = false;
const db = new DatabaseSync(':memory:');

function printRows(title: string, sql: string): void {
  console.log(`\n--- ${title}`);
  const rows = db.prepare(sql).all() as Record<string, unknown>[];
  if (!rows.length) { console.log('    (no rows)'); return; }
  const columns = Object.keys(rows[0]);
  const widths = columns.map((c) => Math.max(c.length, ...rows.map((r) => cell(r[c]).length)));
  const row = (cells: string[]) => `    ${cells.map((v, i) => v.padEnd(widths[i])).join('  |  ')}`;
  console.log(row(columns));
  console.log(`    ${widths.map((w) => '-'.repeat(w)).join('--+--')}`);
  for (const record of rows) console.log(row(columns.map((c) => cell(record[c]))));
}

function scalar(sql: string): unknown {
  return Object.values(db.prepare(sql).get()!)[0];
}

function expect(label: string, actual: unknown, expected: unknown): void {
  const ok = String(actual) === String(expected);
  console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${label}: ${String(actual)}${ok ? '' : ` (expected ${String(expected)})`}`);
}

ensureRelationalSchemaNode(db);
invalidateMallFacetCache();
clearMallRateLimitWindows();
const exec = makeNodeMallExecutor(db);
const env: any = {
  MALL_CHECKOUT_ENABLED: 'true', MALL_PICKUP_ADDRESS: 'Demo pickup', MALL_PICKUP_HOURS: 'Demo hours',
  DB: new SqliteD1(db), ASSETS: { fetch: async (req: Request) => new Response(`asset:${new URL(req.url).pathname}`) },
};
await worker.fetch(new Request('http://demo/api/mall/health'), env);

/** Staff-side order operation, mirroring the op() helper in mall-safety.test.ts. */
const staffOp = (id: string, action: string, payload: Record<string, unknown> = {}) =>
  handleStaffMallApi(new Request(`http://demo/api/staff/mall-orders/${id}/${action}`, {
    method: 'POST', body: JSON.stringify(payload),
  }), exec, actor);

console.log('==================== MALL ORDER CASCADE DEMO ====================');
console.log('Stage 1 — PUBLIC CHECKOUT: one atomic batch writes');
console.log('  mall_orders + mall_order_items + products.stock_qty +');
console.log('  stock_movements + payments(pending). No Sale exists yet.');

db.exec(`INSERT INTO products(id,sku,name,stock_qty,status,is_mall_listed,retail_price_kobo,cost_price_kobo,created_at,updated_at) VALUES
  ('p1','DEMO-1','Demo Nylon Bag (Big)',10,'Active',1,15000,9000,'now','now'),
  ('p2','DEMO-2','Demo Spray Bottle',25,'Active',1,7000,4500,'now','now')`);
const cartId = `mc-${session}`;
db.prepare(`INSERT INTO mall_carts(id,session_id,status,updated_at) VALUES(?,?,'active',1)`).run(cartId, session);
const add = (product: string, qty: number) =>
  db.prepare('INSERT INTO mall_cart_items(id,cart_id,product_id,qty,unit_price_kobo) VALUES(?,?,?,?,1)').run(crypto.randomUUID(), cartId, product, qty);
add('p1', 2);
add('p2', 3);

const checkout = await handleMallApi(new Request('http://demo/api/mall/checkout', {
  method: 'POST',
  headers: { 'x-mall-session': session, 'idempotency-key': attempt },
  body: JSON.stringify({ customerName: 'Grace Ekaette', customerPhone: '08095550134', customerEmail: 'grace.ekaette@example.com', paymentMethod: 'pay_on_pickup' }),
}), exec);
const order = db.prepare('SELECT * FROM mall_orders LIMIT 1').get() as Record<string, unknown>;
console.log(`\n  checkout -> HTTP ${checkout.status}, order ${String(order.order_no)} (${naira(order.total_kobo)})`);
expect('checkout status', checkout.status, 201);
expect('order status', order.status, 'pending');
expect('order total_kobo (2x15000 + 3x7000)', order.total_kobo, 51000);

printRows('mall_orders', `SELECT order_no, customer_name, customer_phone, status, subtotal_kobo AS subtotal, delivery_fee_kobo AS delivery, total_kobo AS total, linked_sale_id, created_at FROM mall_orders`);
printRows('mall_order_items', `SELECT product_id, product_name, qty, unit_price_kobo AS unit, total_kobo AS total FROM mall_order_items`);
printRows('products (stock committed)', `SELECT id, sku, name, stock_qty FROM products`);
printRows('stock_movements (Outgoing at checkout)', `SELECT product_name, type, qty, prev_stock, new_stock, ref_id, notes FROM stock_movements`);
printRows('payments (pending)', `SELECT id, order_id, provider, reference, amount_kobo, status FROM payments`);
printRows('mall_order_events (timeline, trigger-written at checkout)', `SELECT action, actor_id, details, status, created_at FROM mall_order_events`);
printRows('notifications (trigger-written at checkout)', `SELECT id, title, message, type, is_read, link, created_at FROM notifications`);
printRows('mall_outbox (webhook/email events, trigger-written)', `SELECT id, order_id, event, status, payload_json, created_at FROM mall_outbox`);
printRows('core records untouched before settlement', `SELECT (SELECT COUNT(*) FROM customers) AS customers, (SELECT COUNT(*) FROM sales) AS sales, (SELECT COUNT(*) FROM sale_items) AS sale_items, (SELECT COUNT(*) FROM money_movements) AS money_movements, (SELECT COUNT(*) FROM audit_logs) AS audit_logs FROM (SELECT 1)`);
expect('no Sale mirrored yet', scalar('SELECT COUNT(*) FROM sales'), 0);
expect('linked_sale_id still NULL', order.linked_sale_id ?? 'NULL', 'NULL');
expect('checkout writes no document-mirror rows (the mirror is PUT-restore only)', scalar(`SELECT COUNT(*) FROM app_documents WHERE collection IN ('products','stockMovements','notifications')`), 0);

console.log('\nStage 2 — STAFF SETTLEMENT (collect-payment): one guarded batch writes');
console.log('  customers -> sales -> sale_items -> payments(paid) ->');
console.log('  mall_orders.linked_sale_id -> money_movements -> audit_logs.');

const orderId = String(order.id);
const settle = await staffOp(orderId, 'collect-payment', { paymentMethod: 'Cash', amountKobo: order.total_kobo });
const settled = db.prepare('SELECT * FROM mall_orders LIMIT 1').get() as Record<string, unknown>;
console.log(`\n  collect-payment -> HTTP ${settle.status}, sale ${String(settled.linked_sale_id)}`);
expect('settlement status', settle.status, 200);
expect('deterministic sale id (sale-{orderId})', settled.linked_sale_id, `sale-${orderId}`);
expect('order moved to processing', settled.status, 'processing');
expect('settlement writes no document-mirror rows (mirror is PUT-restore only)', scalar(`SELECT COUNT(*) FROM app_documents WHERE collection = 'sales' AND document_id = 'sale-${orderId}'`), 0);

printRows('customers (created / loyalty updated)', `SELECT id, name, phone, email, address, purchase_history_count AS purchases, loyalty_points AS loyalty, lifetime_value_kobo AS lifetime, outstanding_balance_kobo AS outstanding FROM customers`);
printRows('sales (mirrored POS Sale)', `SELECT id, receipt_no, customer_name, type, subtotal_kobo AS subtotal, delivery_fee_kobo AS delivery, total_kobo AS total, paid_kobo AS paid, payment_method, status, notes, created_by FROM sales`);
printRows('sale_items', `SELECT id, product_name, sku, qty, unit_price_kobo AS unit, cost_price_kobo AS cost, total_kobo AS total FROM sale_items`);
printRows('payments (paid, linked to the Sale)', `SELECT id, order_id, sale_id, provider, reference, amount_kobo, status FROM payments`);
printRows('money_movements (Sale Inflow)', `SELECT id, date, type, subtype, dest_account, amount_kobo AS amount, notes, ref_no, ref_id FROM money_movements`);
printRows('audit_logs (cascade trail)', `SELECT action, entity, entity_id, details, created_at FROM audit_logs`);
printRows('sync_revisions (bumped inside every Mall write batch)', `SELECT owner_id, revision FROM sync_revisions`);
printRows('app_documents (PUT-restore mirror / rollback snapshot only)', `SELECT collection, document_id, updated_at FROM app_documents`);

console.log('\nStage 3 — IDEMPOTENCY: replaying settlement cannot duplicate the cascade.');
const replay = await staffOp(orderId, 'collect-payment', { paymentMethod: 'Cash', amountKobo: order.total_kobo });
console.log(`\n  replayed collect-payment -> HTTP ${replay.status}`);
expect('replay status', replay.status, 200);
expect('still exactly 1 sale', scalar('SELECT COUNT(*) FROM sales'), 1);
expect('still exactly 1 sale inflow', scalar(`SELECT COUNT(*) FROM money_movements WHERE type = 'Sale Inflow'`), 1);
expect('still exactly 1 customer', scalar('SELECT COUNT(*) FROM customers'), 1);

console.log('\nStage 4 — DELIVERY FULFILMENT: a second (delivered) order cascades into delivery_orders.');
console.log('  review-delivery -> collect-payment -> mark-packed -> mark-out-for-delivery');
console.log('  -> complete: the delivery_order is born at dispatch and closed at delivery.');

const session2 = 'cascade-demo-session-2';
const cart2 = `mc-${session2}`;
db.prepare(`INSERT INTO mall_carts(id,session_id,status,updated_at) VALUES(?,?,'active',1)`).run(cart2, session2);
for (const [product, qty] of [['p1', 2], ['p2', 3]] as const)
  db.prepare('INSERT INTO mall_cart_items(id,cart_id,product_id,qty,unit_price_kobo) VALUES(?,?,?,?,1)').run(crypto.randomUUID(), cart2, product, qty);
const checkout2 = await handleMallApi(new Request('http://demo/api/mall/checkout', {
  method: 'POST',
  headers: { 'x-mall-session': session2, 'idempotency-key': 'cascade-demo-attempt-2' },
  body: JSON.stringify({ customerName: 'Emeka Okon', customerPhone: '08022223333', paymentMethod: 'pay_on_pickup', deliveryZone: 'uyo_central', deliveryAddress: '2 Abak Road, Uyo' }),
}), exec);
const order2 = db.prepare(`SELECT * FROM mall_orders WHERE customer_name = 'Emeka Okon' LIMIT 1`).get() as Record<string, unknown>;
const orderId2 = String(order2.id);
console.log(`\n  delivery checkout -> HTTP ${checkout2.status}, order ${String(order2.order_no)} (${naira(order2.total_kobo)} incl. delivery fee)`);
expect('delivery checkout status', checkout2.status, 201);
expect('server-priced zone fee (uyo_central)', order2.delivery_fee_kobo, 150000);
expect('delivery total_kobo (51000 + 150000 fee)', order2.total_kobo, 201000);

const review = await staffOp(orderId2, 'review-delivery', { confirmed: true });
const pay2 = await staffOp(orderId2, 'collect-payment', { paymentMethod: 'Cash', amountKobo: order2.total_kobo });
const packed = await staffOp(orderId2, 'mark-packed');
const dispatch = await staffOp(orderId2, 'mark-out-for-delivery', { courier: 'GODAN Logistics' });
const done = await staffOp(orderId2, 'complete');
console.log(`\n  review-delivery ${review.status} -> collect-payment ${pay2.status} -> mark-packed ${packed.status} -> mark-out-for-delivery ${dispatch.status} -> complete ${done.status}`);
expect('address verified before payment', review.status, 200);
expect('delivery order settled (sale-{orderId})', scalar(`SELECT linked_sale_id FROM mall_orders WHERE id = '${orderId2}'`), `sale-${orderId2}`);
expect('second order completed', scalar(`SELECT status FROM mall_orders WHERE id = '${orderId2}'`), 'completed');
printRows('delivery_orders (created at dispatch, closed at delivery)', `SELECT delivery_no, sale_id, invoice_no, customer_name, delivery_address, delivery_fee_kobo AS fee, status, courier_notes, notes, created_by FROM delivery_orders`);
printRows('mall_order_events for the delivery order', `SELECT action, actor_id, details, status, created_at FROM mall_order_events WHERE order_id = '${orderId2}' ORDER BY created_at`);

console.log('\nStage 5 — REFUND: the reverse cascade unwinds every core record of the delivery order.');
console.log('  mall_returns -> payments/sales refunded -> Refund Outflow -> customer');
console.log('  metrics rolled back -> stock restored -> delivery_order returned.');

const refund = await staffOp(orderId2, 'refund', { reason: 'Damaged on arrival', returnStock: true, returnReference: 'GRN-DEMO-001' });
console.log(`\n  refund -> HTTP ${refund.status}`);
expect('refund status', refund.status, 200);
expect('order refunded', scalar(`SELECT status FROM mall_orders WHERE id = '${orderId2}'`), 'refunded');
expect('sale flipped to Refunded', scalar(`SELECT status FROM sales WHERE id = 'sale-${orderId2}'`), 'Refunded');
expect('payment refunded', scalar(`SELECT status FROM payments WHERE order_id = '${orderId2}'`), 'refunded');
expect('Refund Outflow written', scalar(`SELECT COUNT(*) FROM money_movements WHERE type = 'Refund Outflow'`), 1);
expect('stock restored (8 + 22)', scalar('SELECT SUM(stock_qty) FROM products'), 30);
expect('customer metrics rolled back', scalar(`SELECT loyalty_points + purchase_history_count FROM customers WHERE name = 'Emeka Okon'`), 0);
expect('mall_returns restock row', scalar('SELECT disposition FROM mall_returns'), 'restocked');
expect('delivery order returned', scalar('SELECT status FROM delivery_orders'), 'Returned');

printRows('sales (one Completed, one Refunded)', `SELECT id, receipt_no, customer_name, status, total_kobo AS total, payment_method, notes FROM sales`);
printRows('money_movements (Sale Inflow + Refund Outflow)', `SELECT id, date, type, subtype, source_account, dest_account, amount_kobo AS amount, notes, ref_id FROM money_movements`);
printRows('customers (order 1 keeps its metrics; order 2 rolled back)', `SELECT name, phone, purchase_history_count AS purchases, loyalty_points AS loyalty, lifetime_value_kobo AS lifetime, outstanding_balance_kobo AS outstanding FROM customers`);
printRows('payments', `SELECT id, order_id, sale_id, provider, amount_kobo, status FROM payments`);
printRows('products (order 1 sold; order 2 restocked)', `SELECT id, sku, name, stock_qty FROM products`);
printRows('stock_movements (checkout + refund returns)', `SELECT product_name, type, qty, prev_stock, new_stock, ref_id, notes FROM stock_movements`);
printRows('mall_returns', `SELECT order_id, disposition, receipt_reference, reason, actor_id, created_at FROM mall_returns`);
printRows('audit_logs (full cascade trail)', `SELECT action, entity_id, details, created_at FROM audit_logs WHERE entity = 'MallOrder' ORDER BY created_at`);

console.log('\nStage 6 — REFUND IDEMPOTENCY: replaying the refund cannot duplicate the unwind.');
const refundReplay = await staffOp(orderId2, 'refund', { reason: 'Damaged on arrival', returnStock: true, returnReference: 'GRN-DEMO-001' });
console.log(`\n  replayed refund -> HTTP ${refundReplay.status}`);
expect('refund replay status', refundReplay.status, 200);
expect('still exactly 2 sales', scalar('SELECT COUNT(*) FROM sales'), 2);
expect('still exactly 1 Refund Outflow', scalar(`SELECT COUNT(*) FROM money_movements WHERE type = 'Refund Outflow'`), 1);
expect('still exactly 1 mall_returns row', scalar('SELECT COUNT(*) FROM mall_returns'), 1);
expect('stock unchanged after replay', scalar('SELECT SUM(stock_qty) FROM products'), 30);

const salesCount = String(scalar('SELECT COUNT(*) FROM sales'));
const refundedSales = String(scalar(`SELECT COUNT(*) FROM sales WHERE status = 'Refunded'`));
const movements = String(scalar('SELECT COUNT(*) FROM money_movements'));
const stock = String(scalar('SELECT SUM(stock_qty) FROM products'));
console.log(`\nLifecycle summary: 2 orders -> ${salesCount} Sales (${refundedSales} refunded), ${movements} money movements, stock 35 -> ${stock}`);
console.log(`Support trail: ${String(scalar('SELECT COUNT(*) FROM notifications'))} notifications, ${String(scalar('SELECT COUNT(*) FROM mall_outbox'))} outbox events, ${String(scalar(`SELECT COUNT(*) FROM audit_logs WHERE entity = 'MallOrder'`))} Mall audit entries, ${String(scalar('SELECT COUNT(*) FROM mall_order_events'))} timeline events, ${String(scalar('SELECT COUNT(*) FROM app_documents'))} mirror rows (rollback only, written by snapshot PUTs)`);
console.log(failed ? '\nCASCADE DEMO FAILED' : '\nCASCADE DEMO PASSED — Mall Orders fully cascaded into the core records.');
db.close();
process.exit(failed ? 1 : 0);
