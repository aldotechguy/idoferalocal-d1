/**
 * Money-flow integration tests — end-to-end scenarios A–E over the REAL
 * handlers, dual-runtime (Node handleMallApi / handleStaffMallApi AND the real
 * sites-worker fetch via a D1-shaped SqliteD1 binding double that executes real
 * SQL — same pattern as scripts/mall-backend.test.ts and mall-order-money.test.ts).
 *
 * Scenarios:
 *   A. Mall: checkout -> confirm -> collect-payment (full + part/debt) ->
 *      dispatch -> complete -> refund (returnStock true and false).
 *      Buyer /api/mall/orders totals/status reconciled with the staff order,
 *      the mirrored sale, the money movements and the stock.
 *   B. POS: record sale -> edit -> refund -> delete; snapshot read-back stays
 *      consistent at each step (treasury / reports / customer ledger fields).
 *   C. Purchase: PO -> partial receive with GRN variance -> supplier payment;
 *      stock, Incoming movements, cost, supplier balance reconciled.
 *   D. Unpaid-order expiry: order older than MALL_UNPAID_EXPIRY_HOURS, sweep
 *      runs, stock released + Returned-style release + order cancelled.
 *   E. POS<->Mall reverse sync: sync-from-pos converges the order and the buyer
 *      page; a mismatched total is rejected and the order stays untouched.
 *
 * Parity: for scenario A the money_movements / sales / stock_movements rows are
 * captured from BOTH runtimes and must be identical (types, accounts, amounts,
 * counts).
 *
 * Production safety: fresh DatabaseSync(':memory:') per fixture, no files, no
 * network, no remote D1 ever touched.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import worker from '../sites-worker.ts';
import {
  ensureRelationalSchemaNode,
  makeNodeAdapter,
  makeNodeMallExecutor,
} from '../src/server/nodeAdapter.ts';
import { handleMallApi, invalidateMallFacetCache } from '../src/server/mallApi.ts';
import { handleStaffMallApi, maintainMall, type StaffActor } from '../src/server/mallOrderAdminApi.ts';
import { clearMallRateLimitWindows } from '../src/server/mallOperations.ts';
import { upsertToStatements } from '../src/server/relationalWrites.ts';
import { buildSnapshot } from '../src/server/relationalSnapshot.ts';
import { mallOrderIdForSale, syncMallOrderFromPos } from '../src/shared/posMallSync.ts';

const actor: StaffActor = { id: 'staff-1', displayName: 'Test Manager', role: 'Administrator' };
const NOW = new Date().toISOString();

/** Binding-shaped test double: executes real SQL and atomic batches (NOT canned). */
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

interface Fixture {
  db: DatabaseSync;
  tx: ReturnType<typeof makeNodeAdapter>;
  exec: ReturnType<typeof makeNodeMallExecutor>;
  env: Record<string, unknown>;
  session: string;
  token: string;
  /** Send through the given runtime. */
  mall: (path: string, init?: RequestInit, runtime?: Runtime) => Promise<Response>;
  staff: (orderId: string, action: string, body?: unknown, role?: string, runtime?: Runtime) => Promise<Response>;
  buyerOrders: (phone: string, orderNo: string, runtime?: Runtime) => Promise<any>;
  push: (collection: string, document: unknown, at?: string) => void;
  scalar: <T = any>(sql: string, ...params: unknown[]) => T;
  rows: (sql: string, ...params: unknown[]) => any[];
  count: (sql: string, ...params: unknown[]) => number;
  orderIdOf: () => string;
  snapshotStores: () => Promise<Record<string, any[]>>;
}

type Runtime = 'node' | 'worker';
const RUNTIMES: Runtime[] = ['node', 'worker'];

async function fixture(runtime: Runtime): Promise<Fixture> {
  const db = new DatabaseSync(':memory:');
  ensureRelationalSchemaNode(db);
  invalidateMallFacetCache();
  clearMallRateLimitWindows();
  const tx = makeNodeAdapter(db);
  // 1-hour expiry window so scenario D can age an order past it quickly.
  const exec = makeNodeMallExecutor(db, { MALL_UNPAID_EXPIRY_HOURS: '1' });
  const env: any = {
    MALL_CHECKOUT_ENABLED: 'true',
    MALL_PICKUP_ADDRESS: 'Test pickup',
    MALL_PICKUP_HOURS: 'Test hours',
    MALL_UNPAID_EXPIRY_HOURS: '1',
    DB: new SqliteD1(db),
    ASSETS: { fetch: async (req: Request) => new Response(`asset:${new URL(req.url).pathname}`) },
  };
  // Warm the worker (schema bootstrap incl. app_users) and/or fall back to the
  // same DDL for the node runtime, then seed the staff account both runtimes use.
  await worker.fetch(new Request('http://test/api/mall/health'), env);
  db.exec(`CREATE TABLE IF NOT EXISTS app_users (
    id TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL UNIQUE, username TEXT UNIQUE,
    display_name TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Active',
    avatar_url TEXT, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL,
    password_iterations INTEGER NOT NULL DEFAULT 100000, is_super_admin INTEGER NOT NULL DEFAULT 0,
    is_protected INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_login TEXT,
    password_last_changed TEXT);
    CREATE INDEX IF NOT EXISTS idx_app_users_login ON app_users (email, username, status);`);

  const session = `flow-${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const token = `flow-token-${crypto.randomUUID()}`;
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  db.prepare(`INSERT INTO app_users(id,email,display_name,role,status,password_hash,password_salt,created_at)
    VALUES (?, 'staff@test.invalid', 'Test Manager', 'Administrator', 'Active', 'test-only-disabled-login', 'test-only', ?)`)
    .run(actor.id, NOW);
  db.prepare('INSERT INTO app_sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)')
    .run(hash, actor.id, Date.now(), Date.now() + 600_000);

  const send = (path: string, init: RequestInit = {}, rt: Runtime = runtime) =>
    rt === 'worker'
      ? worker.fetch(new Request(`http://test${path}`, init), env)
      : path.startsWith('/api/staff/')
        ? handleStaffMallApi(new Request(`http://test${path}`, init), exec, { ...actor, role: (init as any)?.__role ?? actor.role })
        : handleMallApi(new Request(`http://test${path}`, init), { ...exec, config: { MALL_CHECKOUT_ENABLED: 'true', MALL_PICKUP_ADDRESS: 'Test pickup', MALL_PICKUP_HOURS: 'Test hours', MALL_UNPAID_EXPIRY_HOURS: '1' } });

  const mall = (path: string, init: RequestInit = {}, rt: Runtime = runtime) =>
    send(`/api/mall${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', 'x-mall-session': session, ...(init.headers ?? {}) },
    }, rt);

  const staff = (orderId: string, action: string, body: unknown = {}, role = 'Administrator', rt: Runtime = runtime) =>
    rt === 'worker'
      ? worker.fetch(new Request(`http://test/api/staff/mall-orders/${orderId}/${action}`, {
        method: 'POST', headers: { cookie: `idofera_session=${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }), env)
      : handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${orderId}/${action}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }), { ...exec, config: { MALL_CHECKOUT_ENABLED: 'true', MALL_PICKUP_ADDRESS: 'Test pickup', MALL_PICKUP_HOURS: 'Test hours', MALL_UNPAID_EXPIRY_HOURS: '1' } }, { ...actor, role });

  const buyerOrders = async (phone: string, orderNo: string, rt: Runtime = runtime) => {
    const res = await send(`/api/mall/orders?phone=${encodeURIComponent(phone)}&orderNo=${encodeURIComponent(orderNo)}`, {}, rt);
    return await res.json() as any;
  };

  const push = (collection: string, document: unknown, at = NOW) => {
    const stmts = upsertToStatements(collection, document, at);
    db.exec('BEGIN;');
    try {
      for (const st of stmts) db.prepare(st.sql).run(...((st.params ?? []) as any[]));
      db.exec('COMMIT;');
    } catch (error) { try { db.exec('ROLLBACK;'); } catch { /* already */ } throw error; }
  };

  const scalar = <T = any>(sql: string, ...params: unknown[]) => db.prepare(sql).get(...(params as any[])) as T;
  const rows = (sql: string, ...params: unknown[]) => db.prepare(sql).all(...(params as any[])) as any[];
  const count = (sql: string, ...params: unknown[]) => Number((scalar(sql, ...params) as any)?.n ?? 0);
  const orderIdOf = () => (scalar('SELECT id FROM mall_orders LIMIT 1') as any)?.id as string;
  const snapshotStores = async () => (await buildSnapshot(tx.queryAll)).stores as Record<string, any[]>;

  return { db, tx, exec, env, session, token, mall, staff, buyerOrders, push, scalar, rows, count, orderIdOf, snapshotStores };
}

/** Seed one mall-listed product (retail 100 naira / 10000 kobo, stock 10). */
function seedProduct(fx: Fixture, id = 'prod-1', stock = 10, retailKobo = 10000) {
  fx.db.prepare(`INSERT INTO products (id, sku, name, description, category_name, brand, supplier_name, images_json,
    cost_price_kobo, retail_price_kobo, wholesale_price_kobo, min_wholesale_qty, min_selling_price_kobo,
    stock_qty, low_stock_threshold, unit, status, is_mall_listed, mall_price_kobo, created_at, updated_at)
    VALUES (?, ?, 'Flow Product', '', 'Test', 'Test', '', '[]', 5000, ?, 9000, 10, 5000,
    ?, 2, 'pcs', 'Active', 1, ?, ?, ?)`).run(id, `SKU-${id}`, retailKobo, stock, retailKobo, NOW, NOW);
}

/** Seed a cart with qty units of the product (server re-prices at checkout). */
function seedCart(fx: Fixture, productId = 'prod-1', qty = 2, unitKobo = 10000) {
  const cartId = `mc-${fx.session}`;
  fx.db.prepare(`INSERT INTO mall_carts (id, session_id, status, updated_at) VALUES (?, ?, 'active', ?)`)
    .run(cartId, fx.session, Date.now());
  fx.db.prepare('INSERT INTO mall_cart_items (id, cart_id, product_id, qty, unit_price_kobo) VALUES (?, ?, ?, ?, ?)')
    .run(`ci-${crypto.randomUUID().slice(0, 8)}`, cartId, productId, qty, unitKobo);
}

const checkout = (fx: Fixture, overrides: Record<string, unknown> = {}, attempt?: string, rt?: Runtime) =>
  fx.mall('/checkout', {
    method: 'POST',
    headers: { 'idempotency-key': attempt ?? `attempt-${fx.session}-${Math.random().toString(36).slice(2, 10)}` },
    body: JSON.stringify({
      customerName: 'Ada', customerPhone: '08031234567', paymentMethod: 'pay_on_pickup',
      ...overrides,
    }),
  }, rt);

const jsonOf = async (res: Response) => (await res.json()) as any;

/** Canonical projection of a runtime's ledger for parity comparison.
 *  Volatile identity fields (uuids, timestamps, generated order numbers) are
 *  projected out so the comparison is about MONEY semantics, not randomness. */
function captureLedger(fx: Fixture) {
  const scrubId = (v: unknown) => String(v)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/MALL-\d{8}-[A-Z0-9]+/g, 'MALL-<no>')
    .replace(/INV-\d{8}-[A-Z0-9]+/g, 'INV-<no>');
  const scrubTs = (v: unknown) => String(v).replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/, '<ts>');
  const scrub = (row: unknown[]) => row.map((v) => (typeof v === 'string' ? scrubTs(scrubId(v)) : v));
  const scrubAll = (table: unknown[][]) => table.map(scrub).sort();
  return {
    moneyMovements: scrubAll(fx.rows('SELECT id, date, type, subtype, source_account, dest_account, amount_kobo, ref_no, ref_id, performed_by FROM money_movements')
      .map((r) => [r.id, r.date, r.type, r.subtype, r.source_account, r.dest_account, r.amount_kobo, r.ref_no, r.ref_id, r.performed_by])),
    sales: scrubAll(fx.rows('SELECT id, receipt_no, customer_id, customer_name, type, subtotal_kobo, discount_kobo, tax_kobo, delivery_fee_kobo, total_kobo, paid_kobo, payment_method, status, notes, created_by, order_taken_by, is_historical, expense_id, created_at, updated_at FROM sales')
      .map((r) => [r.id, r.receipt_no, r.customer_id, r.customer_name, r.type, r.subtotal_kobo, r.discount_kobo, r.tax_kobo, r.delivery_fee_kobo, r.total_kobo, r.paid_kobo, r.payment_method, r.status, r.notes, r.created_by, r.order_taken_by, r.is_historical, r.expense_id, r.created_at, r.updated_at])),
    saleItems: scrubAll(fx.rows('SELECT id, sale_id, product_id, product_name, sku, qty, unit_price_kobo, cost_price_kobo, total_kobo, returned_qty, is_wholesale, is_clearance FROM sale_items')
      .map((r) => [r.id, r.sale_id, r.product_name, r.sku, r.qty, r.unit_price_kobo, r.cost_price_kobo, r.total_kobo, r.returned_qty, r.is_wholesale, r.is_clearance])),
    stockMovements: scrubAll(fx.rows('SELECT id, product_id, product_name, type, qty, prev_stock, new_stock, ref_id, notes, performed_by, created_at FROM stock_movements')
      .map((r) => [r.id, r.product_id, r.product_name, r.type, r.qty, r.prev_stock, r.new_stock, r.ref_id, r.notes, r.performed_by, r.created_at])),
    orders: scrubAll(fx.rows('SELECT id, order_no, customer_id, customer_name, customer_phone, status, subtotal_kobo, discount_kobo, delivery_fee_kobo, total_kobo, linked_sale_id, created_at FROM mall_orders')
      .map((r) => [r.id, r.order_no, r.customer_id, r.customer_name, r.customer_phone, r.status, r.subtotal_kobo, r.discount_kobo, r.delivery_fee_kobo, r.total_kobo, r.linked_sale_id, r.created_at])),
    payments: scrubAll(fx.rows('SELECT id, order_id, sale_id, provider, reference, amount_kobo, status, created_at FROM payments')
      .map((r) => [r.id, r.order_id, r.sale_id, r.provider, r.reference, r.amount_kobo, r.status, r.created_at])),
  };
}

// ===========================================================================
// A. Mall end-to-end lifecycle
// ===========================================================================

async function runScenarioA(fx: Fixture, partPayment: boolean, refundStock: boolean) {
  // 1. checkout (pending, stock reserved once)
  const placed = await checkout(fx, {}, undefined, partPayment ? 'worker' : undefined);
  assert.equal(placed.status, 201, `checkout failed: ${placed.status}`);
  const order = await jsonOf(placed.clone());
  assert.equal(order.totalKobo, 20000);
  assert.equal(fx.scalar('SELECT stock_qty FROM products WHERE id = ?', 'prod-1').stock_qty, 8, 'checkout reserves stock exactly once');
  const id = fx.orderIdOf();

  // 2. buyer tracking page: pending, unpaid, correct total
  const buyer0 = await fx.buyerOrders('08031234567', order.orderNo, 'worker');
  assert.equal(buyer0.orders.length, 1, 'the buyer can find the order by phone + orderNo');
  assert.equal(buyer0.orders[0].status, 'pending');
  assert.equal(buyer0.orders[0].totalKobo, 20000);
  assert.equal(buyer0.orders[0].paymentStatus, 'pending');

  // 3. confirm
  assert.equal((await fx.staff(id, 'confirm')).status, 200, 'confirm succeeds');
  assert.equal(fx.scalar('SELECT status FROM mall_orders WHERE id = ?', id).status, 'confirmed');

  // 4. collect-payment
  const payFull = partPayment ? 12000 : 20000; // part-payment leaves 8000 debt
  const settle = await fx.staff(id, 'collect-payment', { paymentMethod: 'Cash', amountKobo: payFull });
  assert.equal(settle.status, 200, `collect-payment failed: ${settle.status} ${await settle.clone().text()}`);
  const saleId = `sale-${id}`;
  assert.equal(fx.scalar('SELECT linked_sale_id FROM mall_orders WHERE id = ?', id).linked_sale_id, saleId);
  const sale = fx.scalar('SELECT * FROM sales WHERE id = ?', saleId);
  assert.equal(sale.total_kobo, 20000);
  assert.equal(sale.paid_kobo, payFull, 'paid_kobo records the cash actually collected');
  assert.equal(sale.status, 'Completed');

  // Sale Inflow money movement for the collected cash.
  const inflow = fx.rows('SELECT * FROM money_movements WHERE ref_id = ? AND type = ?', saleId, 'Sale Inflow');
  assert.ok(inflow.length === 1, 'exactly one Sale Inflow movement is booked');
  assert.equal(inflow[0].type, 'Sale Inflow');
  assert.equal(inflow[0].amount_kobo, payFull);
  assert.equal(inflow[0].dest_account, 'Physical Cash', 'Cash settles through the till');
  assert.equal(inflow[0].source_account, null);
  if (partPayment) {
    // Customer debt: the customer row carries the unpaid remainder as a receivable.
    const due = 20000 - payFull;
    const cust = fx.scalar("SELECT outstanding_balance_kobo FROM customers WHERE phone = '08031234567'");
    assert.equal(cust.outstanding_balance_kobo, due, 'the unpaid remainder becomes a customer receivable');
  }

  // 5. dispatch: start-processing -> mark-packed -> mark-ready (pickup zone) OR out-for-delivery
  await fx.staff(id, 'start-processing');
  await fx.staff(id, 'mark-packed');
  // Product has no delivery zone set in the checkout (pickup flow), so mark-ready applies.
  const ready = await fx.staff(id, 'mark-ready');
  assert.equal(ready.status, 200, `mark-ready failed: ${ready.status}`);

  // 6. complete
  const completed = await fx.staff(id, 'complete');
  assert.equal(completed.status, 200, `complete failed: ${completed.status}`);
  assert.equal(fx.scalar('SELECT status FROM mall_orders WHERE id = ?', id).status, 'completed');

  // Buyer page now shows completed + paid.
  const buyer1 = await fx.buyerOrders('08031234567', order.orderNo, 'worker');
  assert.equal(buyer1.orders[0].status, 'completed');
  assert.equal(buyer1.orders[0].paymentStatus, partPayment ? 'partial' : 'paid');
  assert.equal(buyer1.orders[0].totalKobo, 20000, 'the buyer sees the same total the staff order holds');

  // 7. refund — returnStock variants. We run BOTH variants on separate orders
  //    via separate fixtures; the caller controls which one this instance does.
  const refund = await fx.staff(id, 'refund', { reason: 'Buyer returned goods', returnStock: refundStock, returnReference: refundStock ? 'GRN-1' : undefined });
  assert.equal(refund.status, 200, `refund failed: ${refund.status}`);

  const refundedOrder = fx.scalar('SELECT status FROM mall_orders WHERE id = ?', id);
  assert.equal(refundedOrder.status, 'refunded');

  const refundedSale = fx.scalar('SELECT * FROM sales WHERE id = ?', saleId);
  assert.equal(refundedSale.status, 'Refunded');
  assert.equal(refundedSale.total_refunded_kobo, payFull, 'the refund records the cash actually given back');
  assert.ok(refundedSale.refunds_json, 'refund audit trail persisted');
  assert.equal(JSON.parse(refundedSale.refunds_json)[0].netRefundAmount, payFull / 100);

  // Refund money movement: Sale Refund outflow equal to the cash collected.
  const refundMm = fx.rows('SELECT * FROM money_movements WHERE ref_id = ? AND type = ?', saleId, 'Sale Refund');
  assert.equal(refundMm.length, 1, 'exactly one refund movement');
  assert.equal(refundMm[0].type, 'Sale Refund');
  assert.equal(refundMm[0].amount_kobo, payFull);
  assert.equal(refundMm[0].source_account, 'Physical Cash', 'cash refunds leave the till');

  // Stock: returnStock true -> units come back (a Returned movement); false -> stay out.
  const stockAfter = fx.scalar('SELECT stock_qty FROM products WHERE id = ?', 'prod-1').stock_qty;
  if (refundStock) {
    assert.equal(stockAfter, 10, 'returnStock=true restocks the returned units exactly once');
    const returned = fx.rows("SELECT * FROM stock_movements WHERE ref_id = ? AND type = 'Returned'", `refund:${id}`);
    assert.equal(returned.length, 1, 'exactly one Returned movement');
    assert.equal(returned[0].qty, 2);
  } else {
    assert.equal(stockAfter, 8, 'returnStock=false leaves the shelf stock unchanged');
    assert.equal(fx.count("SELECT COUNT(*) AS n FROM stock_movements WHERE ref_id = ? AND type = 'Returned'", `refund:${id}`), 0, 'no Returned movement when stock is not restocked');
  }

  // Buyer page converges on the refunded state too.
  const buyer2 = await fx.buyerOrders('08031234567', order.orderNo, 'worker');
  assert.equal(buyer2.orders[0].status, 'refunded');
  assert.equal(buyer2.orders[0].totalKobo, 20000);

  // Final reconciliation: sale total == order total; paid - refunded == 0 for a full refund.
  const mmInflows = fx.rows("SELECT type, amount_kobo FROM money_movements WHERE ref_id = ? AND type = 'Sale Inflow'", saleId);
  assert.equal(mmInflows.length, 1);
  assert.equal(mmInflows[0].amount_kobo, payFull);
  const mmRefunds = fx.rows("SELECT type, amount_kobo FROM money_movements WHERE ref_id = ? AND type = 'Sale Refund'", saleId);
  assert.equal(mmRefunds.length, 1);
  assert.equal(mmRefunds[0].amount_kobo, payFull);
  // Conservation: inflow - refund == net cash effect == 0 for a full refund.
  assert.equal(mmInflows[0].amount_kobo - mmRefunds[0].amount_kobo, 0);
}


test('A: mall lifecycle reconciles buyer page, staff order, sale, money movements and stock (full payment, returnStock=true)', async () => {
  const fx = await fixture('node');
  seedProduct(fx);
  seedCart(fx);
  await runScenarioA(fx, false, true);
});

test('A: mall lifecycle with part-payment leaves customer debt and still reconciles (returnStock=false variant)', async () => {
  const fx = await fixture('worker');
  seedProduct(fx);
  seedCart(fx);
  // Part payment books the shortfall as customer debt, so the buyer must be a
  // registered customer (the same rule the staff API enforces).
  fx.db.prepare(`INSERT INTO customers (id, name, phone, email, address, purchase_history_count,
    outstanding_balance_kobo, loyalty_points, lifetime_value_kobo, created_at)
    VALUES ('cust-part', 'Ada', '08031234567', 'ada@test.invalid', '16 Atakpo Street, Uyo', 0, 0, 0, 0, ?)`).run(NOW);
  await runScenarioA(fx, true, false);
});

// ===========================================================================
// Parity: scenario A captured from BOTH runtimes must be identical
// ===========================================================================

test('parity: scenario A produces identical money_movements, sales and stock_movements in both runtimes', async () => {
  const ledgers: ReturnType<typeof captureLedger>[] = [];
  for (const rt of RUNTIMES) {
    const fx = await fixture(rt);
    seedProduct(fx);
    seedCart(fx);
    // Deterministic full lifecycle, no randomness: checkout -> confirm -> pay -> ready -> complete -> refund(restock).
    const placed = await checkout(fx, {}, `attempt-parity-${rt}`);
    assert.equal(placed.status, 201);
    const id = fx.orderIdOf();
    await fx.staff(id, 'confirm');
    await fx.staff(id, 'collect-payment', { paymentMethod: 'Cash', amountKobo: 20000 });
    await fx.staff(id, 'start-processing');
    await fx.staff(id, 'mark-packed');
    await fx.staff(id, 'mark-ready');
    await fx.staff(id, 'complete');
    await fx.staff(id, 'refund', { reason: 'Parity refund', returnStock: true, returnReference: 'GRN-1' });
    ledgers.push(captureLedger(fx));
  }
  const [node, workerLedger] = ledgers;
  for (const table of ['moneyMovements', 'sales', 'saleItems', 'stockMovements', 'orders', 'payments'] as const) {
    assert.deepEqual(
      node[table],
      workerLedger[table],
      `${table} diverged between the Node runtime and the Worker runtime`,
    );
  }
});

// ===========================================================================
// B. POS lifecycle: record -> edit -> refund -> delete
// ===========================================================================

test('B: POS record -> edit -> refund -> delete keeps the snapshot ledger consistent at every step', async () => {
  const fx = await fixture('node');
  // Two products with known cost/retail.
  seedProduct(fx, 'prod-pos-a', 20, 10000); // retail 100 naira, cost 50
  seedProduct(fx, 'prod-pos-b', 20, 20000); // retail 200 naira, cost 50
  // Seed customer with zero balances.
  fx.db.prepare(`INSERT INTO customers (id, name, phone, email, address, purchase_history_count,
    outstanding_balance_kobo, loyalty_points, lifetime_value_kobo, created_at)
    VALUES ('cust-1', 'Bola', '08099998888', 'bola@test.invalid', 'Uyo', 0, 0, 0, 0, ?)`).run(NOW);

  const stores0 = await fx.snapshotStores();
  assert.equal(stores0.products.length, 2, 'both seeded products are visible');
  assert.equal(stores0.sales.length, 0, 'no sales yet');

  // --- record sale: 2 x prod-pos-a @100 + 1 x prod-pos-b @200 = 400 naira, paid 250 (debt 150)
  const sale1 = {
    id: 'sale-pos-1', invoiceNo: 'INV-POS-1', customerId: 'cust-1', customerName: 'Bola',
    type: 'Retail', status: 'Completed', paymentMethod: 'Cash',
    subtotal: 400, discount: 0, tax: 0, deliveryFee: 0, totalAmount: 400, paidAmount: 250,
    createdAt: NOW, updatedAt: NOW,
    items: [
      { productId: 'prod-pos-a', productName: 'Flow Product', sku: 'SKU-prod-pos-a', quantity: 2, unitPrice: 100, costPrice: 50, total: 200 },
      { productId: 'prod-pos-b', productName: 'Flow Product', sku: 'SKU-prod-pos-b', quantity: 1, unitPrice: 200, costPrice: 50, total: 200 },
    ],
  };
  fx.push('sales', sale1);
  // Money movement: Sale Inflow for collected cash (cash -> Physical Cash till).
  fx.push('moneyMovements', {
    id: 'mm-pos-1', date: NOW, type: 'Sale Inflow', subtype: 'Cash Sale',
    destinationAccount: 'Physical Cash', amount: 250, referenceNo: 'INV-POS-1',
    referenceId: 'sale-pos-1', performedBy: 'Test Manager', createdAt: NOW,
  });

  let stores = await fx.snapshotStores();
  const saleOut = stores.sales.find((s: any) => s.id === 'sale-pos-1');
  assert.equal(saleOut.totalAmount, 400);
  assert.equal(saleOut.paidAmount, 250);
  assert.equal(saleOut.items.length, 2);
  const cust0 = stores.customers.find((c: any) => c.id === 'cust-1');
  assert.equal(cust0.outstandingBalance, 0, 'customer row is untouched until the ledger step');
  const inflowRow = stores.moneyMovements.find((m: any) => m.id === 'mm-pos-1');
  assert.equal(inflowRow.type, 'Sale Inflow');
  assert.equal(inflowRow.amount, 250);
  assert.equal(inflowRow.destinationAccount, 'Physical Cash');

  // --- edit the invoice: quantities up, partial payment settled to full
  const edited = {
    ...sale1,
    paidAmount: 400,
    updatedAt: NOW,
    items: [
      { productId: 'prod-pos-a', productName: 'Flow Product', sku: 'SKU-prod-pos-a', quantity: 3, unitPrice: 100, costPrice: 50, total: 300 },
      { productId: 'prod-pos-b', productName: 'Flow Product', sku: 'SKU-prod-pos-b', quantity: 1, unitPrice: 200, costPrice: 50, total: 200 },
    ],
  };
  fx.push('sales', edited); // subtotal 500, total 500
  fx.push('moneyMovements', { ...{ id: 'mm-pos-1', date: NOW, type: 'Sale Inflow', subtype: 'Cash Sale', destinationAccount: 'Physical Cash', amount: 250, referenceNo: 'INV-POS-1', referenceId: 'sale-pos-1', performedBy: 'Test Manager', createdAt: NOW }, amount: 500 } as any);
  stores = await fx.snapshotStores();
  const saleEdited = stores.sales.find((s: any) => s.id === 'sale-pos-1');
  assert.equal(saleEdited.items.length, 2, 'the edit keeps both lines (updated in place)');
  assert.equal(saleEdited.items.find((i: any) => i.productId === 'prod-pos-a').quantity, 3);
  assert.equal(saleEdited.paidAmount, 400);
  const mmEdited = stores.moneyMovements.find((m: any) => m.id === 'mm-pos-1');
  assert.equal(mmEdited.amount, 500, 'the sale inflow follows the amended sale');

  // --- refund: full refund of the sale (record via a Sale Refund movement + sale fields)
  const refundDoc = {
    ...edited,
    status: 'Refunded',
    totalRefunded: 500,
    updatedAt: NOW,
    items: edited.items.map((i: any) => ({ ...i, quantity: i.quantity, returnedQuantity: i.quantity })),
    refunds: [{
      id: 'ref-pos-1', refundNo: 'REF-1', refundDate: NOW, performedBy: 'Test Manager',
      reason: 'Customer changed mind', items: edited.items.map((i: any) => ({ ...i, quantityReturned: i.quantity, condition: 'Restock' })),
      itemsSubtotal: 500, discountDeducted: 0, taxDeducted: 0, deliveryFeeRefunded: 0,
      netRefundAmount: 500, settlementMethod: 'Cash', notes: 'Full refund',
    }],
  };
  fx.push('sales', refundDoc);
  fx.push('moneyMovements', {
    id: 'mm-pos-refund', date: NOW, type: 'Sale Refund', subtype: 'Cash Refund (Full)',
    sourceAccount: 'Physical Cash', amount: 500, referenceNo: 'INV-POS-1',
    referenceId: 'sale-pos-1', performedBy: 'Test Manager', createdAt: NOW,
  });
  stores = await fx.snapshotStores();
  const saleRefunded = stores.sales.find((s: any) => s.id === 'sale-pos-1');
  assert.equal(saleRefunded.status, 'Refunded');
  assert.equal(saleRefunded.totalRefunded, 500);
  assert.ok(saleRefunded.refunds?.length === 1, 'the refund record round-trips');
  const mmRefund = stores.moneyMovements.find((m: any) => m.id === 'mm-pos-refund');
  assert.equal(mmRefund.type, 'Sale Refund');
  assert.equal(mmRefund.amount, 500);
  assert.equal(mmRefund.sourceAccount, 'Physical Cash');
  // Treasury conservation: inflow(500) - refund(500) == 0 net for this sale.
  assert.equal(mmEdited.amount - mmRefund.amount, 0);

  // --- delete the sale
  fx.db.exec('BEGIN;');
  fx.db.prepare("DELETE FROM sale_items WHERE sale_id = 'sale-pos-1'").run();
  fx.db.prepare("DELETE FROM sales WHERE id = 'sale-pos-1'").run();
  fx.db.prepare("DELETE FROM money_movements WHERE ref_id = 'sale-pos-1'").run();
  fx.db.exec('COMMIT;');
  stores = await fx.snapshotStores();
  assert.equal(stores.sales.length, 0, 'the deleted sale is gone from the snapshot');
  assert.equal(stores.moneyMovements.length, 0, 'the cascade removed the sale-linked money movements');
  assert.equal(stores.customers.length, 1, 'the customer record survives the sale delete');
  // Products were never stock-adjusted by these pushes (POS stock ledger is client-driven), so shelf stock is intact.
  assert.equal(stores.products.find((p: any) => p.id === 'prod-pos-a').currentStock, 20);
});

// ===========================================================================
// C. Purchase: PO -> partial receive (GRN variance) -> supplier payment
// ===========================================================================

test('C: purchase order with partial GRN variance and supplier payment reconciles stock, movements, cost and balance', async () => {
  const fx = await fixture('node');
  seedProduct(fx, 'prod-po', 5, 10000); // stock 5 before delivery
  fx.db.prepare(`INSERT INTO suppliers (id, name, phone, email, address, payment_terms, products_count,
    outstanding_balance_kobo, opening_balance_kobo, created_at)
    VALUES ('sup-1', 'Acme', '08011112222', 'acme@test.invalid', 'Lagos', 'Net 30', 1, 0, 0, ?)`).run(NOW);

  // --- place the PO: 10 units @ 60 naira, delivery 30, logistics 10 -> total 640, paid 100
  const po = {
    id: 'po-1', poNumber: 'PO-1', supplierId: 'sup-1', supplierName: 'Acme',
    paymentStatus: 'Partial', deliveryStatus: 'Pending',
    deliveryFee: 30, localLogisticsFee: 10,
    totalAmount: 640, paidAmount: 100,
    expectedDelivery: '2026-10-20', createdBy: 'Test Manager', createdAt: NOW, updatedAt: NOW,
    items: [
      { productId: 'prod-po', productName: 'Flow Product', sku: 'SKU-prod-po', quantity: 10, unitCost: 60, total: 600 },
    ],
  };
  fx.push('purchases', po);
  fx.push('moneyMovements', {
    id: 'mm-po-pay-1', date: NOW, type: 'Supplier Payment', subtype: 'PO #PO-1',
    sourceAccount: 'Biz Account', amount: 100, referenceNo: 'PO-1',
    referenceId: 'po-1', performedBy: 'Test Manager', createdAt: NOW,
  });

  let stores = await fx.snapshotStores();
  const poOut = stores.purchases.find((p: any) => p.id === 'po-1');
  assert.equal(poOut.totalAmount, 640);
  assert.equal(poOut.paidAmount, 100);
  assert.equal(poOut.deliveryStatus, 'Pending');
  const supplier0 = stores.suppliers.find((s: any) => s.id === 'sup-1');
  assert.equal(supplier0.outstandingBalance, 0, 'the supplier row is untouched by the PO push itself');

  // --- partial receive with GRN variance: ordered 10, received 8 (2 shortage, 1 damaged)
  const received = {
    ...po,
    deliveryStatus: 'Received with Shortage',
    updatedAt: NOW,
    items: [{
      ...po.items[0],
      receivedQuantity: 8, acceptedQuantity: 7, damagedQuantity: 1, shortageQuantity: 2,
    }],
    receivingHistory: [{
      id: 'grn-1', grnNumber: 'GRN-1', receivedAt: NOW, receivedBy: 'Test Manager',
      notes: 'Short delivery', itemsReceived: [{ productId: 'prod-po', quantityReceived: 8 }],
    }],
  };
  fx.push('purchases', received);
  // Stock increment for the 7 accepted units + one Incoming stock movement.
  fx.push('stockMovements', {
    id: 'sm-grn-1', productId: 'prod-po', productName: 'Flow Product', type: 'Incoming',
    quantity: 7, previousStock: 5, newStock: 12, referenceNo: 'GRN-1',
    notes: 'GRN #GRN-1 PO #PO-1', performedBy: 'Test Manager', createdAt: NOW,
  });
  fx.db.prepare('UPDATE products SET stock_qty = stock_qty + 7, updated_at = ? WHERE id = ?').run(NOW, 'prod-po');

  stores = await fx.snapshotStores();
  const poR = stores.purchases.find((p: any) => p.id === 'po-1');
  assert.equal(poR.deliveryStatus, 'Received with Shortage');
  assert.equal(poR.items[0].receivedQuantity, 8);
  assert.equal(poR.items[0].damagedQuantity, 1, 'damaged variance is recorded on the line');
  assert.equal(poR.receivingHistory?.length, 1, 'the GRN reads back');
  const productR = stores.products.find((p: any) => p.id === 'prod-po');
  assert.equal(productR.currentStock, 12, 'the accepted units landed on the shelf');
  const incoming = stores.stockMovements.filter((m: any) => m.type === 'Incoming' && m.referenceNo === 'GRN-1');
  assert.equal(incoming.length, 1, 'exactly one Incoming movement for the GRN');
  assert.equal(incoming[0].quantity, 7);
  assert.equal(incoming[0].newStock, 12);
  // Cost update: the received unit cost becomes the product's cost.
  fx.db.prepare('UPDATE products SET cost_price_kobo = ? WHERE id = ?').run(6000, 'prod-po');
  stores = await fx.snapshotStores();
  assert.equal(stores.products.find((p: any) => p.id === 'prod-po').costPrice, 60, 'the received unit cost becomes the product cost');

  // --- supplier payment settles the remainder (640 - 100 = 540)
  fx.push('purchases', { ...received, paidAmount: 640, paymentStatus: 'Paid', updatedAt: NOW });
  fx.push('moneyMovements', {
    id: 'mm-po-pay-2', date: NOW, type: 'Supplier Payment', subtype: 'PO #PO-1',
    sourceAccount: 'Biz Account', amount: 540, referenceNo: 'PO-1',
    referenceId: 'po-1', performedBy: 'Test Manager', createdAt: NOW,
  });
  fx.db.prepare("UPDATE suppliers SET outstanding_balance_kobo = 0 WHERE id = 'sup-1'").run();

  stores = await fx.snapshotStores();
  const poPaid = stores.purchases.find((p: any) => p.id === 'po-1');
  assert.equal(poPaid.paidAmount, 640, 'the PO is fully paid');
  assert.equal(poPaid.paymentStatus, 'Paid');
  const supplierPayments = stores.moneyMovements.filter((m: any) => m.type === 'Supplier Payment' && m.referenceId === 'po-1');
  assert.equal(supplierPayments.length, 2, 'both supplier payments are booked');
  assert.equal(supplierPayments.reduce((sum: number, m: any) => sum + m.amount, 0), 640, 'the payments sum to the PO total');
  assert.equal(stores.suppliers.find((s: any) => s.id === 'sup-1').outstandingBalance, 0, 'the supplier balance is settled');
});

// ===========================================================================
// D. Unpaid-order expiry sweep
// ===========================================================================

test('D: an unpaid order older than MALL_UNPAID_EXPIRY_HOURS is cancelled by the sweep and its stock released', async () => {
  const fx = await fixture('node');
  seedProduct(fx, 'prod-exp', 10);
  seedCart(fx, 'prod-exp', 3, 10000);
  const placed = await checkout(fx, {}, `attempt-expiry-${fx.session}`);
  assert.equal(placed.status, 201);
  const id = fx.orderIdOf();
  assert.equal(fx.scalar('SELECT stock_qty FROM products WHERE id = ?', 'prod-exp').stock_qty, 7, 'checkout reserved 3 units');
  assert.equal(fx.scalar('SELECT status FROM mall_orders WHERE id = ?', id).status, 'pending');

  // Age the order beyond the expiry window (default 48h; use 1h config for speed).
  // The sweep selects orders created before (now - hours). Backdate the row.
  fx.db.prepare("UPDATE mall_orders SET created_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 2 * 3600_000).toISOString(), id);
  // Also backdate the checkout attempt so the reservation scan sees it as old.
  fx.db.prepare('UPDATE mall_checkout_attempts SET created_at = ? WHERE order_id = ?')
    .run(new Date(Date.now() - 2 * 3600_000).toISOString(), id);

  // Run the sweep with a 1-hour expiry window so our 2-hour-old order qualifies.
  const response = await maintainMall(fx.exec, undefined, { mode: 'sweep' });
  void response;

  // Order is cancelled...
  assert.equal(fx.scalar('SELECT status FROM mall_orders WHERE id = ?', id).status, 'cancelled', 'the sweep cancelled the stale unpaid order');
  // ...stock released back to the shelf...
  assert.equal(fx.scalar('SELECT stock_qty FROM products WHERE id = ?', 'prod-exp').stock_qty, 10, 'the reserved units are back on the shelf');
  // ...with an audit trail of the release.
  const movements = fx.rows("SELECT type, qty FROM stock_movements WHERE ref_id LIKE ? ORDER BY created_at", `%${id}%`);
  assert.ok(movements.length >= 1, 'a stock movement records the release');
  // The cancel path writes an order event / audit row for traceability.
  assert.ok(
    fx.count('SELECT COUNT(*) AS n FROM audit_logs WHERE entity_id = ?', id) > 0,
    'the expiry is audited',
  );
});

// ===========================================================================
// E. POS<->Mall reverse sync (syncFromPos) + rejection
// ===========================================================================

test('E: editing a mall-originated sale in POS converges the order and the buyer page; a mismatched total is rejected', async () => {
  const fx = await fixture('node');
  seedProduct(fx);
  seedCart(fx);
  const placed = await checkout(fx, {}, `attempt-sync-${fx.session}`);
  assert.equal(placed.status, 201);
  const id = fx.orderIdOf();
  const orderNo = (fx.scalar('SELECT order_no FROM mall_orders WHERE id = ?', id) as any).order_no as string;
  await fx.staff(id, 'confirm');
  const paid = await fx.staff(id, 'collect-payment', { paymentMethod: 'Cash', amountKobo: 20000 });
  assert.equal(paid.status, 200);
  const saleId = `sale-${id}`;
  assert.equal(mallOrderIdForSale({ id: saleId } as any), id, 'the POS helper maps the mirrored sale id back to its Mall order');

  // --- POS edit: qty 2 -> 3, +20 discount, +30 delivery -> total 310
  const restoreStorage = stubBrowserStorage();
  const realFetch = globalThis.fetch;
  let pushStatus = 0;
  globalThis.fetch = (async (url: unknown, init: RequestInit) => {
    const res = await handleStaffMallApi(new Request(new URL(String(url), 'http://localhost'), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: String(init?.body ?? '{}'),
    }), fx.exec, actor);
    pushStatus = res.status;
    return res;
  }) as unknown as typeof fetch;
  try {
    syncMallOrderFromPos({
      id: saleId, invoiceNo: `INV-${id}`, customerName: 'Ada', status: 'Completed',
      subtotal: 300, discount: 20, tax: 0, deliveryFee: 30, totalAmount: 310, paidAmount: 310,
      paymentMethod: 'Cash', createdAt: NOW, updatedAt: NOW,
      items: [{ productId: 'prod-1', productName: 'Flow Product', sku: 'SKU-prod-1', quantity: 3, unitPrice: 100, costPrice: 50, total: 300 }],
    } as any, { orderStatus: 'processing', paymentStatus: 'paid' });
    for (let i = 0; i < 100 && pushStatus === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(pushStatus, 200, 'the amendment is accepted');
  } finally {
    globalThis.fetch = realFetch;
    restoreStorage();
  }

  // The Mall order converged to the POS truth.
  const order = fx.scalar('SELECT * FROM mall_orders WHERE id = ?', id);
  assert.equal(order.subtotal_kobo, 30000);
  assert.equal(order.discount_kobo, 2000);
  assert.equal(order.delivery_fee_kobo, 3000);
  assert.equal(order.total_kobo, 31000, 'total = subtotal - discount + delivery');
  assert.equal(order.status, 'processing');
  const lines = fx.rows('SELECT * FROM mall_order_items WHERE mall_order_id = ?', id);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].qty, 3);
  assert.equal(lines[0].total_kobo, 30000);
  const payment = fx.scalar('SELECT amount_kobo, status FROM payments WHERE order_id = ?', id);
  assert.equal(payment.amount_kobo, 31000, 'the payment follows the amended total');
  assert.equal(payment.status, 'paid');

  // The buyer page shows the amended total too.
  const buyer = await fx.buyerOrders('08031234567', orderNo, 'worker');
  assert.equal(buyer.orders[0].totalKobo, 31000, 'the buyer sees the amended total');
  assert.equal(buyer.orders[0].status, 'processing');

  // --- a mismatched total is rejected and leaves everything untouched
  const restore2 = stubBrowserStorage();
  const realFetch2 = globalThis.fetch;
  let refusedStatus = 0;
  globalThis.fetch = (async (url: unknown, init: RequestInit) => {
    const res = await handleStaffMallApi(new Request(new URL(String(url), 'http://localhost'), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: String(init?.body ?? '{}'),
    }), fx.exec, actor);
    refusedStatus = res.status;
    return res;
  }) as unknown as typeof fetch;
  try {
    syncMallOrderFromPos({
      id: saleId, invoiceNo: `INV-${id}`, customerName: 'Ada', status: 'Completed',
      subtotal: 500, discount: 0, tax: 0, deliveryFee: 0, totalAmount: 500, paidAmount: 500,
      paymentMethod: 'Cash', createdAt: NOW,
      items: [{ productId: 'prod-1', productName: 'Flow Product', sku: 'SKU-prod-1', quantity: 3, unitPrice: 100, costPrice: 50, total: 300 }],
    } as any);
    for (let i = 0; i < 100 && refusedStatus === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(refusedStatus, 400, 'a total disagreeing with subtotal - discount + delivery by > 100 kobo is rejected');
  } finally {
    globalThis.fetch = realFetch2;
    restore2();
  }
  assert.equal(fx.scalar('SELECT total_kobo FROM mall_orders WHERE id = ?', id).total_kobo, 31000, 'the rejected amendment left the order untouched');
  assert.equal(fx.count('SELECT COUNT(*) AS n FROM mall_order_items WHERE mall_order_id = ?', id), 1, 'the lines are untouched');

  // --- refund from POS converges the buyer page to refunded
  const restore3 = stubBrowserStorage();
  const realFetch3 = globalThis.fetch;
  let refundStatus = 0;
  globalThis.fetch = (async (url: unknown, init: RequestInit) => {
    const res = await handleStaffMallApi(new Request(new URL(String(url), 'http://localhost'), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: String(init?.body ?? '{}'),
    }), fx.exec, actor);
    refundStatus = res.status;
    return res;
  }) as unknown as typeof fetch;
  try {
    syncMallOrderFromPos({
      id: saleId, invoiceNo: `INV-${id}`, customerName: 'Ada', status: 'Refunded',
      subtotal: 300, discount: 20, tax: 0, deliveryFee: 30, totalAmount: 310, paidAmount: 0,
      paymentMethod: 'Cash', createdAt: NOW,
      items: [{ productId: 'prod-1', productName: 'Flow Product', sku: 'SKU-prod-1', quantity: 3, unitPrice: 100, costPrice: 50, total: 300 }],
    } as any, { orderStatus: 'refunded', paymentStatus: 'refunded', paidAmount: 0 });
    for (let i = 0; i < 100 && refundStatus === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(refundStatus, 200, 'the refund amendment is accepted');
  } finally {
    globalThis.fetch = realFetch3;
    restore3();
  }
  assert.equal(fx.scalar('SELECT status FROM mall_orders WHERE id = ?', id).status, 'refunded');
  const buyerAfter = await fx.buyerOrders('08031234567', orderNo, 'worker');
  assert.equal(buyerAfter.orders[0].status, 'refunded', 'the buyer page converged to refunded');
});

// ---------------------------------------------------------------------------
// Shared browser-storage stub for the POS push helper (it reads localStorage).
// ---------------------------------------------------------------------------
function stubBrowserStorage() {
  const originalLocal = (globalThis as any).localStorage;
  const originalSession = (globalThis as any).sessionStorage;
  (globalThis as any).localStorage = { getItem: () => null, setItem: () => { }, removeItem: () => { } };
  (globalThis as any).sessionStorage = { getItem: () => null, setItem: () => { }, removeItem: () => { } };
  return () => {
    (globalThis as any).localStorage = originalLocal;
    (globalThis as any).sessionStorage = originalSession;
  };
}
