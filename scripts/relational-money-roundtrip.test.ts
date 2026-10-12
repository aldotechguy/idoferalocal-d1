/**
 * In-memory SQLite integration suite for money- and stock-critical paths.
 *
 * Runs the REAL production pipeline against real tables — no mocks of the
 * write/read logic itself:
 *   relationalMapper.ts -> relationalWrites.ts -> relationalSnapshot.ts
 * for round-trip fidelity, and the live Mall API
 * (mallApi checkout / mallOrderAdminApi / mallOperations) for POS <-> Mall
 * stock & order reconciliation.
 *
 * Every scenario states the business risk it guards (Naira<->Kobo drift,
 * orphaned sale/purchase lines, double-counted stock, stale Mall totals).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { ensureRelationalSchemaNode, makeNodeAdapter, makeNodeMallExecutor } from '../src/server/nodeAdapter.ts';
import { buildSnapshot } from '../src/server/relationalSnapshot.ts';
import { upsertToStatements } from '../src/server/relationalWrites.ts';
import { handleMallApi } from '../src/server/mallApi.ts';
import { handleStaffMallApi, type StaffActor } from '../src/server/mallOrderAdminApi.ts';
import { mallOrderIdForSale, syncMallOrderFromPos } from '../src/shared/posMallSync.ts';

const actor: StaffActor = { id: 'staff-1', displayName: 'Test Manager', role: 'Administrator' };

/** Fresh schema + adapters. Each test gets an isolated in-memory database. */
function freshDb() {
  const db = new DatabaseSync(':memory:');
  ensureRelationalSchemaNode(db);
  return { db, tx: makeNodeAdapter(db), exec: makeNodeMallExecutor(db) };
}

/** Apply document -> SQL statements exactly like server.ts does (atomic, committed). */
function push(db: DatabaseSync, collection: string, document: unknown, nowIso: string): number {
  const stmts = upsertToStatements(collection, document, nowIso);
  db.exec('BEGIN;');
  try {
    let touched = 0;
    for (const st of stmts) {
      const result = db.prepare(st.sql).run(...((st.params ?? []) as any[])) as unknown as { changes?: number };
      touched += Number(result?.changes ?? 0);
    }
    db.exec('COMMIT;');
    return touched;
  } catch (error) {
    try { db.exec('ROLLBACK;'); } catch { /* transaction already rolled back */ }
    throw error;
  }
}

const snapshotStores = async (tx: ReturnType<typeof makeNodeAdapter>) => (await buildSnapshot(tx.queryAll)).stores;
const scalar = (db: DatabaseSync, sql: string, ...params: unknown[]) => (db.prepare(sql).get(...(params as any[])) as any);
const count = (db: DatabaseSync, sql: string, ...params: unknown[]) => Number(scalar(db, sql, ...params)?.n ?? 0);
const naira = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;
const kobo = (v: unknown) => Math.round((Number(v) || 0) * 100);
/** Sum of integer kobo the way a ledger does it: exact integer arithmetic. */
const sumKobo = (rows: any[], field: string) => rows.reduce((sum, row) => sum + Number(row[field] || 0), 0);
const NOW = '2026-10-10T10:00:00.000Z';

// ---------------------------------------------------------------------------
// 1. Round-trip fidelity: mapper -> writes -> snapshot
// ---------------------------------------------------------------------------

test('product prices and stock round-trip through SQLite with zero Naira-to-Kobo drift', async () => {
  const { db, tx } = freshDb();
  // Fractions chosen to catch naive truncation/float drift (…995, 0.1+0.2-style).
  const doc = {
    id: 'prod-money', sku: 'SKU-MONEY', name: 'Money Round-trip',
    category: 'Packaging', brand: 'Idofera', supplierName: 'Acme',
    costPrice: 123.45, retailPrice: 199.995, wholesalePrice: 180.25,
    minimumSellingPrice: 150.5, mallPrice: 199.99, currentStock: 42,
    minimumStockLevel: 5, minWholesaleQty: 10, unit: 'pcs', status: 'Active',
    images: ['https://cdn.example.com/bag.png'], createdAt: NOW, updatedAt: NOW,
  };
  push(db, 'products', doc, NOW);

  // Storage contract: naira floats are INTEGER kobo on disk, and rounding is
  // Math.round — 199.995 lands at 20,000 kobo (not 19,999 via truncation).
  const row = scalar(db, 'SELECT * FROM products WHERE id = ?', doc.id);
  assert.equal(row.cost_price_kobo, 12345);
  assert.equal(row.retail_price_kobo, 20000, '199.995 naira rounds to 20000 kobo, never truncates to 19999');
  assert.equal(row.wholesale_price_kobo, 18025);
  assert.equal(row.min_selling_price_kobo, 15050);
  assert.equal(row.mall_price_kobo, 19999);
  assert.equal(row.stock_qty, 42);

  // Read-back contract: buildSnapshot returns the exact naira values pushed.
  const stores = await snapshotStores(tx);
  const out = stores.products.find((p: any) => p.id === doc.id);
  assert.ok(out, 'the product survives the round trip');
  assert.equal(out.costPrice, doc.costPrice);
  assert.equal(out.retailPrice, 200, 'the snapshot reports the rounded value the store actually holds');
  assert.equal(out.wholesalePrice, doc.wholesalePrice);
  assert.equal(out.minimumSellingPrice, doc.minimumSellingPrice);
  assert.equal(out.mallPrice, doc.mallPrice);
  assert.equal(out.currentStock, doc.currentStock);
  // Zero-drift property for every representable (2-dp) money field: pushing the
  // snapshot value back yields the identical integer kobo — no cumulative drift.
  for (const field of ['costPrice', 'wholesalePrice', 'minimumSellingPrice', 'mallPrice'] as const) {
    assert.equal(kobo(out[field]), kobo(doc[field]), `${field} drifted across the Naira<->Kobo round trip`);
    const rePushed = { ...doc, [field]: out[field] };
    push(db, 'products', rePushed, NOW);
    assert.equal(scalar(db, 'SELECT * FROM products WHERE id = ?', doc.id)[`${field === 'mallPrice' ? 'mall_price' : field === 'costPrice' ? 'cost_price' : field === 'wholesalePrice' ? 'wholesale_price' : 'min_selling_price'}_kobo`], kobo(doc[field]), `${field} drifted on a second push`);
  }
});


test('editing a sale deletes orphaned lines, updates survivors in place, and re-pushing identical data touches zero rows', async () => {
  const { db, tx } = freshDb();
  const sale = {
    id: 'sale-roundtrip', invoiceNo: 'INV-RT-1', customerName: 'Ada',
    type: 'Retail', status: 'Completed', paymentMethod: 'Cash',
    subtotal: 500.5, discount: 25.5, tax: 0, deliveryFee: 30.25,
    totalAmount: 505.25, paidAmount: 250, // partial payment
    createdAt: NOW, updatedAt: NOW,
    items: [
      { productId: 'prod-a', productName: 'Alpha', sku: 'A', quantity: 2, unitPrice: 100.25, costPrice: 60, total: 200.5 },
      { productId: 'prod-b', productName: 'Beta', sku: 'B', quantity: 1, unitPrice: 150, costPrice: 90, total: 150 },
      { productId: 'prod-c', productName: 'Gamma', sku: 'C', quantity: 1, unitPrice: 150, costPrice: 90, total: 150 },
    ],
  };
  push(db, 'sales', sale, NOW);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM sale_items WHERE sale_id = ?', sale.id), 3);

  const stores0 = await snapshotStores(tx);
  const out0 = stores0.sales.find((s: any) => s.id === sale.id);
  assert.equal(out0.totalAmount, 505.25, 'header total reads back exactly');
  assert.equal(out0.paidAmount, 250, 'partial payment reads back exactly');
  assert.equal(out0.discount, 25.5);
  assert.equal(out0.deliveryFee, 30.25);
  // Line totals sum to the subtotal exactly (naira sum = subtotal; kobo sum = 50050).
  assert.equal(naira(sumKobo(out0.items, 'total')), 500.5, 'line totals sum to the subtotal');
  assert.equal(kobo(sumKobo(out0.items, 'total')), 50050, 'line totals sum to the subtotal in kobo');
  // The stored rows are integers — the snapshot naira conversion is lossless.
  const storedLines = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id) as any[];
  assert.equal(sumKobo(storedLines, 'total_kobo'), 50050, 'line totals are stored as exact integer kobo');

  // Edit: drop Gamma (orphan), change Beta's quantity, change payment and time.
  const edited = {
    ...sale,
    paidAmount: 455.25,
    createdAt: '2026-10-11T09:30:00.000Z',
    updatedAt: '2026-10-11T09:30:00.000Z',
    items: [
      { productId: 'prod-a', productName: 'Alpha', sku: 'A', quantity: 2, unitPrice: 100.25, costPrice: 60, total: 200.5 },
      { productId: 'prod-b', productName: 'Beta', sku: 'B', quantity: 3, unitPrice: 150, costPrice: 90, total: 450 },
    ],
  };
  push(db, 'sales', edited, NOW);

  // Orphan Gamma line is gone; survivors keep their deterministic ids (in-place update).
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM sale_items WHERE sale_id = ?', sale.id), 2, 'the removed line is deleted, not left orphaned');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM sale_items WHERE sale_id = ? AND id = ?', sale.id, `${sale.id}-item-2`), 0, 'the orphan line id no longer exists');
  const survivorIds = db.prepare('SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id').all(sale.id).map((r: any) => r.id);
  assert.deepEqual(survivorIds, [`${sale.id}-item-0`, `${sale.id}-item-1`], 'remaining lines are updated in place under stable ids');

  const stores1 = await snapshotStores(tx);
  const out1 = stores1.sales.find((s: any) => s.id === sale.id);
  assert.equal(out1.paidAmount, 455.25, 'the edited payment reads back');
  assert.equal(out1.createdAt, edited.createdAt, 'the editable transaction time (SalesView createdAt) persists');
  assert.equal(out1.items.length, 2);
  assert.equal(out1.items.find((i: any) => i.productId === 'prod-b').quantity, 3, 'quantity change reads back');
  assert.equal(out1.items.find((i: any) => i.productId === 'prod-b').total, 450);

  // No-op guard: re-pushing the IDENTICAL document must touch zero rows.
  const touched = push(db, 'sales', edited, NOW);
  assert.equal(touched, 0, 'the IS NOT guard reports no writes for an identical re-push (automatic-save batches cost a lookup, not a write)');

  // Failure case: a placeholder receipt must not collide on the UNIQUE receipt_no.
  const walkin1 = { id: 'sale-w1', invoiceNo: 'N/A', customerName: 'Walk-in', type: 'Retail', status: 'Completed', subtotal: 10, discount: 0, tax: 0, deliveryFee: 0, totalAmount: 10, paidAmount: 10, paymentMethod: 'Cash', createdAt: NOW, items: [{ productId: 'p', productName: 'P', sku: 'P', quantity: 1, unitPrice: 10, costPrice: 5, total: 10 }] };
  const walkin2 = { ...walkin1, id: 'sale-w2', invoiceNo: '-' };
  push(db, 'sales', walkin1, NOW);
  push(db, 'sales', walkin2, NOW);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM sales WHERE id IN (?, ?)', walkin1.id, walkin2.id), 2, 'two placeholder-receipt sales coexist: receipt_no falls back to the sale id instead of colliding');
  const receipts = db.prepare('SELECT receipt_no FROM sales WHERE id IN (?, ?) ORDER BY id').all(walkin1.id, walkin2.id).map((r: any) => r.receipt_no);
  assert.deepEqual(receipts, [walkin1.id, walkin2.id]);
});

test('purchase orders with GRN history round-trip exactly and clean up orphaned lines and receipts on edit', async () => {
  const { db, tx } = freshDb();
  const po = {
    id: 'po-roundtrip', poNumber: 'PO-RT-1', supplierId: 'sup-1', supplierName: 'Acme',
    paymentStatus: 'Partial', deliveryStatus: 'Received',
    deliveryFee: 45.5, localLogisticsFee: 10.25,
    totalAmount: 1055.75, paidAmount: 400,
    expectedDelivery: '2026-10-15', createdBy: 'Admin', createdAt: NOW, updatedAt: NOW,
    items: [
      { productId: 'prod-a', productName: 'Alpha', sku: 'A', quantity: 10, unitCost: 50.5, total: 505, receivedQuantity: 10, acceptedQuantity: 9, damagedQuantity: 1, shortageQuantity: 1, excessQuantity: 0 },
      { productId: 'prod-b', productName: 'Beta', sku: 'B', quantity: 5, unitCost: 100, total: 500, receivedQuantity: 5, acceptedQuantity: 5, damagedQuantity: 0, shortageQuantity: 0, excessQuantity: 2 },
      { productId: 'prod-d', productName: 'Delta', sku: 'D', quantity: 1, unitCost: 50.25, total: 50.25, receivedQuantity: 0, acceptedQuantity: 0, damagedQuantity: 0 },
    ],
    receivingHistory: [
      { id: 'grn-1', grnNumber: 'GRN-1', receivedAt: NOW, receivedBy: 'Admin', notes: 'First delivery', itemsReceived: [{ productId: 'prod-a', quantityReceived: 10 }] },
      { id: 'grn-2', grnNumber: 'GRN-2', receivedAt: NOW, receivedBy: 'Admin', notes: 'Second delivery', itemsReceived: [{ productId: 'prod-b', quantityReceived: 5 }] },
    ],
  };
  push(db, 'purchases', po, NOW);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM purchase_items WHERE purchase_id = ?', po.id), 3);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM receiving_history WHERE purchase_id = ?', po.id), 2);

  const stores0 = await snapshotStores(tx);
  const out0 = stores0.purchases.find((p: any) => p.id === po.id);
  assert.equal(out0.totalAmount, 1055.75, 'header total reads back exactly');
  assert.equal(out0.paidAmount, 400);
  assert.equal(out0.deliveryFee, 45.5);
  assert.equal(out0.localLogisticsFee, 10.25);
  // Line totals (naira from snapshot) equal the header total; stored kobo is exact.
  assert.equal(naira(sumKobo(out0.items, 'total')), 1055.25, 'line totals sum to the header total');
  assert.equal(sumKobo(db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(po.id) as any[], 'total_kobo'), 105525, 'line totals are stored as exact integer kobo');
  assert.equal(out0.receivingHistory?.length, 2, 'both GRNs read back');

  // Edit: drop Delta line + GRN-2, change Alpha's cost/qty.
  const edited = {
    ...po,
    totalAmount: 550.75, paidAmount: 550.75,
    updatedAt: '2026-10-12T12:00:00.000Z',
    items: [
      { productId: 'prod-a', productName: 'Alpha', sku: 'A', quantity: 10, unitCost: 55, total: 550, receivedQuantity: 10, acceptedQuantity: 10, damagedQuantity: 0, shortageQuantity: 0, excessQuantity: 0 },
      { productId: 'prod-b', productName: 'Beta', sku: 'B', quantity: 5, unitCost: 100, total: 500, receivedQuantity: 5, acceptedQuantity: 5, damagedQuantity: 0, shortageQuantity: 0, excessQuantity: 2 },
    ],
    receivingHistory: [
      { id: 'grn-1', grnNumber: 'GRN-1', receivedAt: NOW, receivedBy: 'Admin', notes: 'First delivery', itemsReceived: [{ productId: 'prod-a', quantityReceived: 10 }] },
    ],
  };
  push(db, 'purchases', edited, NOW);

  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM purchase_items WHERE purchase_id = ?', po.id), 2, 'the removed purchase line is deleted');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM purchase_items WHERE purchase_id = ? AND id = ?', po.id, `${po.id}-item-2`), 0, 'no orphaned purchase line survives');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM receiving_history WHERE purchase_id = ?', po.id), 1, 'the removed GRN is deleted');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM receiving_history WHERE purchase_id = ? AND id = ?', po.id, 'grn-2'), 0, 'no orphaned GRN survives');

  const stores1 = await snapshotStores(tx);
  const out1 = stores1.purchases.find((p: any) => p.id === po.id);
  assert.equal(out1.totalAmount, 550.75, 'the edited total reads back exactly (no kobo drift)');
  assert.equal(out1.paidAmount, 550.75, 'the edited payment reads back exactly');
  assert.equal(out1.items.length, 2);
  assert.equal(out1.items.find((i: any) => i.productId === 'prod-a').unitCost, 55, 'cost edit reads back');
  assert.equal(out1.receivingHistory?.length, 1, 'only the surviving GRN reads back');
  assert.equal(out1.receivingHistory?.[0].id, 'grn-1');
  // Re-pushing the edited document is a no-op (orphan cleanup is idempotent).
  assert.equal(push(db, 'purchases', edited, NOW), 0, 'an identical re-push touches zero rows');

  // Failure case: pushing a purchase with NO lines wipes children but leaves no orphans.
  push(db, 'purchases', { ...edited, items: [], receivingHistory: [], totalAmount: 0, paidAmount: 0 }, NOW);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM purchase_items WHERE purchase_id = ?', po.id), 0);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM receiving_history WHERE purchase_id = ?', po.id), 0);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM purchases WHERE id = ?', po.id), 1, 'the header row survives an empty-items edit');
});

// ---------------------------------------------------------------------------
// 2. POS <-> Mall stock & order sync
// ---------------------------------------------------------------------------

/** Seed a listed product + an active cart so checkout can run against real API. */
function mallFixture() {
  const { db, tx, exec } = freshDb();
  db.prepare(`INSERT INTO products (id, sku, name, description, category_name, brand, supplier_name, images_json,
    cost_price_kobo, retail_price_kobo, wholesale_price_kobo, min_wholesale_qty, min_selling_price_kobo,
    stock_qty, low_stock_threshold, unit, status, is_mall_listed, mall_price_kobo, created_at, updated_at)
    VALUES ('prod-mall', 'SKU-MALL', 'Mall Product', '', 'Test', 'Test', '', '[]', 5000, 10000, 9000, 10, 5000,
    10, 2, 'pcs', 'Active', 1, 10000, ?, ?)`).run(NOW, NOW);
  const session = 'money-roundtrip-session-1234';
  const cartId = `mc-${session}`;
  db.prepare(`INSERT INTO mall_carts (id, session_id, status, updated_at) VALUES (?, ?, 'active', ?)`).run(cartId, session, Date.now());
  // 2 x prod-mall = 20000 kobo.
  db.prepare(`INSERT INTO mall_cart_items (id, cart_id, product_id, qty, unit_price_kobo) VALUES ('ci-1', ?, 'prod-mall', 2, 10000)`).run(cartId);
  return { db, tx, exec, session };
}

async function checkout(exec: ReturnType<typeof makeNodeMallExecutor>, session: string, overrides: Record<string, unknown> = {}) {
  const response = await handleMallApi(new Request('http://test/api/mall/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mall-session': session, 'idempotency-key': `attempt-${session}` },
    body: JSON.stringify({ customerName: 'Ada', customerPhone: '08031234567', paymentMethod: 'pay_on_pickup', ...overrides }),
  }), exec);
  return { response, body: await response.json() as any };
}

const orderIdOf = (db: DatabaseSync) => scalar(db, 'SELECT id FROM mall_orders LIMIT 1').id as string;
const staff = (path: string, body: unknown = {}) => new Request(`http://test/api/staff/mall-orders${path}`, { method: 'POST', body: JSON.stringify(body) });
const ops = async (exec: ReturnType<typeof makeNodeMallExecutor>) => (await (await handleStaffMallApi(new Request('http://test/api/staff/mall-orders/operations'), exec, actor)).json()) as any;

/** staffMallClient reads browser storage before fetching; Node has neither store. */
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

test('unpaid and active Mall orders reserve stock once, and converting to a POS sale does not double-count', async () => {
  const { db, exec, session } = mallFixture();

  // Checkout decrements shelf stock exactly once (reservation).
  const placed = await checkout(exec, session);
  assert.equal(placed.response.status, 201);
  assert.equal(scalar(db, 'SELECT stock_qty FROM products WHERE id = ?', 'prod-mall').stock_qty, 8, 'checkout reserves 2 units off the shelf');
  assert.equal(scalar(db, 'SELECT status FROM mall_orders LIMIT 1').status, 'pending');

  let metrics = await ops(exec);
  assert.equal(metrics.committedStock.units, 2, 'an unpaid pending order commits 2 units of escrow stock');
  assert.equal(metrics.committedStock.costKobo, 2 * 5000, 'committed stock is valued at cost price in kobo');
  assert.equal(metrics.committedStock.orders, 1);

  // Confirm keeps it active (still reserved).
  const id = orderIdOf(db);
  assert.equal((await handleStaffMallApi(staff(`/${id}/confirm`), exec, actor)).status, 200);
  metrics = await ops(exec);
  assert.equal(metrics.committedStock.units, 2, 'a confirmed order still reserves its units');
  assert.equal(scalar(db, 'SELECT status FROM mall_orders WHERE id = ?', id).status, 'confirmed');

  // Settle into a POS sale (`sale-<mallOrderId>`): stock must NOT be decremented again.
  const settle = await handleStaffMallApi(staff(`/${id}/collect-payment`, { paymentMethod: 'Cash', amountKobo: 20000 }), exec, actor);
  assert.equal(settle.status, 200);
  assert.equal(scalar(db, 'SELECT linked_sale_id FROM mall_orders WHERE id = ?', id).linked_sale_id, `sale-${id}`, 'settlement creates the deterministic sale id');
  assert.equal(scalar(db, 'SELECT stock_qty FROM products WHERE id = ?', 'prod-mall').stock_qty, 8, 'converting the Mall order into a POS sale does not double-count stock');

  // Still committed while in the fulfilment pipeline (processing) — counted once.
  metrics = await ops(exec);
  assert.equal(metrics.committedStock.units, 2, 'the settled order remains committed exactly once while processing');
  assert.equal(metrics.committedStock.orders, 1);

  // Walk to out_for_delivery ("dispatched"): still active, still one reservation.
  assert.equal((await handleStaffMallApi(staff(`/${id}/start-processing`), exec, actor)).status, 200);
  assert.equal((await handleStaffMallApi(staff(`/${id}/mark-packed`), exec, actor)).status, 200);
  const dispatched = await handleStaffMallApi(staff(`/${id}/mark-out-for-delivery`, { courier: 'Bike 1' }), exec, actor);
  assert.equal(dispatched.status, 409, 'a pickup-zone order cannot enter the dispatch branch (zone rule)');
  metrics = await ops(exec);
  assert.equal(metrics.committedStock.units, 2, 'a packed-but-not-dispatched order still holds its reservation');
  assert.equal(scalar(db, 'SELECT stock_qty FROM products WHERE id = ?', 'prod-mall').stock_qty, 8, 'the refused dispatch does not touch shelf stock');

  // Ready-for-pickup (pickup zone path) on a second order.
  const pick = mallFixture();
  await checkout(pick.exec, pick.session);
  const id2 = orderIdOf(pick.db);
  await handleStaffMallApi(staff(`/${id2}/confirm`), pick.exec, actor);
  await handleStaffMallApi(staff(`/${id2}/collect-payment`, { paymentMethod: 'Cash', amountKobo: 20000 }), pick.exec, actor);
  await handleStaffMallApi(staff(`/${id2}/start-processing`), pick.exec, actor);
  await handleStaffMallApi(staff(`/${id2}/mark-packed`), pick.exec, actor);
  assert.equal((await handleStaffMallApi(staff(`/${id2}/mark-ready`), pick.exec, actor)).status, 200);
  assert.equal(scalar(pick.db, 'SELECT stock_qty FROM products WHERE id = ?', 'prod-mall').stock_qty, 8, 'the pickup reservation also decrements exactly once');
  const pickMetrics = await ops(pick.exec);
  assert.equal(pickMetrics.committedStock.units, 2, 'ready_for_pickup is an active reserved status');
});

/** Checkout + confirm + settle, returning the order id and its linked sale id. */
async function settledOrder() {
  const fx = mallFixture();
  await checkout(fx.exec, fx.session);
  const id = orderIdOf(fx.db);
  await handleStaffMallApi(staff(`/${id}/confirm`), fx.exec, actor);
  await handleStaffMallApi(staff(`/${id}/collect-payment`, { paymentMethod: 'Cash', amountKobo: 20000 }), fx.exec, actor);
  return { ...fx, id };
}

test('editing a sale-<mallOrderId> in POS reconciles the mall_orders row, its lines and the payment', async () => {
  const { db, exec, id } = await settledOrder();

  // The mirrored sale exists and matches the checkout-time order.
  const saleId = `sale-${id}`;
  assert.equal(scalar(db, 'SELECT id FROM sales WHERE id = ?', saleId).id, saleId);
  assert.equal(scalar(db, 'SELECT total_kobo FROM mall_orders WHERE id = ?', id).total_kobo, 20000);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM mall_order_items WHERE mall_order_id = ?', id), 1);

  // POS edit: quantity up, a discount and a delivery fee applied — push via the
  // same client helper AppContext calls, wired to the REAL server handler.
  const restoreStorage = stubBrowserStorage();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init: RequestInit) => handleStaffMallApi(new Request(new URL(String(url), 'http://localhost'), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: String(init?.body ?? '{}'),
  }), exec, actor)) as unknown as typeof fetch;
  try {
    const editedSale = {
      id: saleId, invoiceNo: `INV-${id}`, customerName: 'Ada', status: 'Completed',
      subtotal: 300, discount: 20, tax: 0, deliveryFee: 30, totalAmount: 310, paidAmount: 310,
      paymentMethod: 'Cash', createdAt: NOW, updatedAt: NOW,
      items: [
        { productId: 'prod-mall', productName: 'Mall Product', sku: 'SKU-MALL', quantity: 3, unitPrice: 100, costPrice: 50, total: 300 },
      ],
    };
    syncMallOrderFromPos(editedSale as any, { orderStatus: 'processing', paymentStatus: 'paid' });
    await new Promise((resolve) => setImmediate(resolve)); // the push is best-effort/non-blocking
    // Wait until the server actually answered (the fetch stub resolves before this).
    for (let i = 0; i < 50 && scalar(db, 'SELECT subtotal_kobo FROM mall_orders WHERE id = ?', id).subtotal_kobo === 20000; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  } finally {
    globalThis.fetch = realFetch;
  }

  // The Mall order now reflects the POS truth, in exact integer kobo.
  const order = scalar(db, 'SELECT * FROM mall_orders WHERE id = ?', id);
  assert.equal(order.subtotal_kobo, 30000, 'subtotal follows the POS edit');
  assert.equal(order.discount_kobo, 2000, 'discount is carried over in kobo');
  assert.equal(order.delivery_fee_kobo, 3000, 'delivery fee is carried over in kobo');
  assert.equal(order.total_kobo, 31000, 'total = subtotal - discount + delivery fee');
  assert.equal(order.status, 'processing');
  const lines = db.prepare('SELECT * FROM mall_order_items WHERE mall_order_id = ?').all(id) as any[];
  assert.equal(lines.length, 1, 'lines are replaced wholesale');
  assert.equal(lines[0].qty, 3, 'quantity edit reaches the Mall order');
  assert.equal(lines[0].unit_price_kobo, 10000);
  assert.equal(lines[0].total_kobo, 30000, 'line total recomputed as qty * unit');
  const payment = scalar(db, 'SELECT amount_kobo, status FROM payments WHERE order_id = ?', id);
  assert.equal(payment.amount_kobo, 31000, 'the payment amount follows the amended total');
  assert.equal(payment.status, 'paid');
  // The audit row drives the buyer's amendment email.
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'AMEND_MALL_ORDER_FROM_POS' AND entity_id = ?", id), 1);

  // Failure: an amendment whose lines and total disagree is refused, leaving the order intact.
  const realFetch2 = globalThis.fetch;
  let refused: Response | null = null;
  globalThis.fetch = (async (url: unknown, init: RequestInit) => {
    refused = await handleStaffMallApi(new Request(new URL(String(url), 'http://localhost'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: String(init?.body ?? '{}') }), exec, actor);
    return refused;
  }) as unknown as typeof fetch;
  try {
    syncMallOrderFromPos({ id: saleId, invoiceNo: `INV-${id}`, customerName: 'Ada', status: 'Completed', subtotal: 500, discount: 0, tax: 0, deliveryFee: 0, totalAmount: 500, paidAmount: 500, paymentMethod: 'Cash', createdAt: NOW, items: [{ productId: 'prod-mall', productName: 'Mall Product', sku: 'SKU-MALL', quantity: 3, unitPrice: 10000, costPrice: 50, total: 3000000 }] } as any);
    for (let i = 0; i < 50 && !refused; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  } finally {
    globalThis.fetch = realFetch2;
  }
  assert.equal(refused?.status, 400, 'a total that does not match its line items is rejected');
  assert.equal(scalar(db, 'SELECT total_kobo FROM mall_orders WHERE id = ?', id).total_kobo, 31000, 'the rejected amendment leaves the order total untouched');
  restoreStorage();
});

test('refunding a sale-<mallOrderId> reconciles paid totals, line returns and releases committed stock', async () => {
  const { db, exec, id } = await settledOrder();
  const saleId = `sale-${id}`;

  // Baseline: paid, committed, shelf stock still reserved at 8.
  assert.equal(scalar(db, 'SELECT status FROM sales WHERE id = ?', saleId).status, 'Completed');
  assert.equal(scalar(db, 'SELECT total_refunded_kobo FROM sales WHERE id = ?', saleId).total_refunded_kobo, 0);
  assert.equal((await ops(exec)).committedStock.units, 2);
  assert.equal(scalar(db, 'SELECT stock_qty FROM products WHERE id = ?', 'prod-mall').stock_qty, 8);

  // Refund with stock returned — Administrator role (the refund gate).
  const refund = await handleStaffMallApi(staff(`/${id}/refund`, { reason: 'Damaged on arrival', returnStock: true, returnReference: 'GRN-1' }), exec, actor);
  assert.equal(refund.status, 200);

  // Mall order flips to refunded and stops committing escrow stock.
  assert.equal(scalar(db, 'SELECT status FROM mall_orders WHERE id = ?', id).status, 'refunded');
  assert.equal((await ops(exec)).committedStock.units, 0, 'a refunded order releases its committed stock');

  // Shelf stock is restored exactly once (not double-counted on top of the sale).
  assert.equal(scalar(db, 'SELECT stock_qty FROM products WHERE id = ?', 'prod-mall').stock_qty, 10, 'refund restocks the returned units');
  const returned = db.prepare("SELECT qty, prev_stock, new_stock FROM stock_movements WHERE ref_id = ? AND type = 'Returned'").all(`refund:${id}`) as any[];
  assert.equal(returned.length, 1, 'exactly one restock movement is written');
  assert.equal(returned[0].qty, 2);

  // The mirrored sale records the refund in kobo and marks every line returned.
  const sale = scalar(db, 'SELECT * FROM sales WHERE id = ?', saleId);
  assert.equal(sale.status, 'Refunded');
  assert.equal(sale.total_refunded_kobo, 20000, 'the refunded amount equals the cash collected, in kobo');
  assert.ok(sale.refunds_json, 'the refund audit trail is persisted');
  const refundRecord = JSON.parse(sale.refunds_json);
  assert.equal(refundRecord[0].netRefundAmount, 200, 'net refund reads back in naira');
  const saleLines = db.prepare('SELECT qty, returned_qty FROM sale_items WHERE sale_id = ?').all(saleId) as any[];
  assert.ok(saleLines.every((line) => line.returned_qty === line.qty), 'every line is marked fully returned');

  // Payment and money movement unwind.
  assert.equal(scalar(db, 'SELECT status FROM payments WHERE order_id = ?', id).status, 'refunded');
  const movement = scalar(db, 'SELECT amount_kobo FROM money_movements WHERE id = ?', `mm-refund-${saleId}`);
  assert.equal(movement?.amount_kobo, 20000, 'a Sale Refund outflow equal to the cash received is booked');

  // Replaying the refund is idempotent (no second restock, no double unwind).
  const replay = await handleStaffMallApi(staff(`/${id}/refund`, { reason: 'Damaged on arrival', returnStock: true, returnReference: 'GRN-1' }), exec, actor);
  assert.equal(replay.status, 200, 'a replayed refund returns the current state');
  assert.equal(scalar(db, 'SELECT stock_qty FROM products WHERE id = ?', 'prod-mall').stock_qty, 10, 'the replay does not restock a second time');
  assert.equal((await ops(exec)).committedStock.units, 0);

  // Failure: Accountant cannot amend a Mall order from the POS (403 on sync-from-pos).
  const acct = mallFixture();
  await checkout(acct.exec, acct.session);
  const acctId = orderIdOf(acct.db);
  const forbidden = await handleStaffMallApi(staff(`/${acctId}/sync-from-pos`, { totalKobo: 1, paidKobo: 1, items: [{ productId: 'p', name: 'x', qty: 1, unitPriceKobo: 1 }] }), acct.exec, { ...actor, role: 'Accountant' });
  assert.equal(forbidden.status, 403, 'only roles that can edit a sale may push POS amendments');
});

test('sync-from-pos refuses unpaid, cancelled or malformed amendments and keeps the order intact', async () => {
  // Unpaid order: no linked sale, nothing to reconcile (409).
  const unpaid = mallFixture();
  await checkout(unpaid.exec, unpaid.session);
  const unpaidId = orderIdOf(unpaid.db);
  const unpaidResp = await handleStaffMallApi(staff(`/${unpaidId}/sync-from-pos`, {
    subtotalKobo: 20000, totalKobo: 20000, discountKobo: 0, deliveryFeeKobo: 0, paidKobo: 20000,
    items: [{ productId: 'prod-mall', name: 'Mall Product', qty: 2, unitPriceKobo: 10000 }],
  }), unpaid.exec, actor);
  assert.equal(unpaidResp.status, 409, 'an unpaid order has no linked sale to amend');
  assert.equal(scalar(unpaid.db, 'SELECT total_kobo FROM mall_orders WHERE id = ?', unpaidId).total_kobo, 20000, 'the unpaid order is untouched');

  // Cancelled order: refused (409).
  const cancelled = mallFixture();
  await checkout(cancelled.exec, cancelled.session);
  const cancelledId = orderIdOf(cancelled.db);
  assert.equal((await handleStaffMallApi(staff(`/${cancelledId}/cancel`, { reason: 'Buyer changed mind' }), cancelled.exec, { ...actor, role: 'Store Manager' })).status, 200);
  const cancelledResp = await handleStaffMallApi(staff(`/${cancelledId}/sync-from-pos`, {
    subtotalKobo: 20000, totalKobo: 20000, discountKobo: 0, deliveryFeeKobo: 0, paidKobo: 20000,
    items: [{ productId: 'prod-mall', name: 'Mall Product', qty: 2, unitPriceKobo: 10000 }],
  }), cancelled.exec, actor);
  assert.equal(cancelledResp.status, 409, 'a cancelled Mall order cannot be amended');

  // Settled order: malformed amendments (empty / zero-qty / missing product / bad total).
  const { db, exec, id } = await settledOrder();
  const amend = (body: unknown) => handleStaffMallApi(staff(`/${id}/sync-from-pos`, body), exec, actor);
  const base = { subtotalKobo: 20000, totalKobo: 20000, discountKobo: 0, deliveryFeeKobo: 0, paidKobo: 20000, orderStatus: 'processing', paymentStatus: 'paid' };

  assert.equal((await amend({ ...base, items: [] })).status, 400, 'an empty item list must not wipe the order');
  assert.equal((await amend({ ...base, items: [{ productId: 'prod-mall', name: 'X', qty: 0, unitPriceKobo: 10000 }] })).status, 400, 'a non-positive quantity is malformed');
  assert.equal((await amend({ ...base, items: [{ name: 'X', qty: 2, unitPriceKobo: 10000 }] })).status, 400, 'a line without a product id is malformed');
  const mismatch = await amend({ ...base, totalKobo: 50000, paidKobo: 50000, items: [{ productId: 'prod-mall', name: 'X', qty: 2, unitPriceKobo: 10000 }] });
  assert.equal(mismatch.status, 400, 'a total that disagrees with its lines is refused');

  // Every rejection left the original order untouched.
  const order = scalar(db, 'SELECT total_kobo, status FROM mall_orders WHERE id = ?', id);
  assert.equal(order.total_kobo, 20000, 'rejected amendments never change the stored total');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM mall_order_items WHERE mall_order_id = ?', id), 1, 'rejected amendments never change the stored lines');

  // A rounding-level discrepancy (within the 100-kobo tolerance) IS accepted.
  const tolerant = await amend({ ...base, totalKobo: 20050, paidKobo: 20050, items: [{ productId: 'prod-mall', name: 'Mall Product', qty: 2, unitPriceKobo: 10000 }] });
  assert.equal(tolerant.status, 200, 'a one-naira-level rounding drift is absorbed');
  // The derived total is authoritative: lines - discount + delivery.
  assert.equal(scalar(db, 'SELECT total_kobo FROM mall_orders WHERE id = ?', id).total_kobo, 20000, 'the total is derived from the lines, not trusted from the client');
});

test('the POS helper maps sale ids to Mall orders and converts naira to exact kobo on the wire', async () => {
  // Pure id contract: only `sale-<orderId>` maps; walk-ins do not.
  const restoreStorage = stubBrowserStorage();
  assert.equal(mallOrderIdForSale({ id: 'sale-ord_9' } as any), 'ord_9');
  assert.equal(mallOrderIdForSale({ id: 'walkin-1' } as any), null, 'a POS walk-in sale has no Mall order to sync');
  assert.equal(mallOrderIdForSale(null), null);

  // A walk-in sale must not attempt any network push.
  const realFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = (async () => { called += 1; return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
  try {
    syncMallOrderFromPos({ id: 'walkin-1', items: [] } as any);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(called, 0, 'no Mall push is attempted for a walk-in sale');
  } finally {
    globalThis.fetch = realFetch;
  }

  // Mall-originated sale: payload carries exact integer kobo for every money field.
  const bodies: any[] = [];
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? '{}')));
    return new Response(JSON.stringify({ order: { id: 'ord_9' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  try {
    syncMallOrderFromPos({
      id: 'sale-ord_9', invoiceNo: 'INV-9', customerName: 'Ada', status: 'Completed',
      subtotal: 123.45, discount: 10.5, deliveryFee: 20.75, totalAmount: 133.7, paidAmount: 50.1,
      items: [{ productId: 'p1', productName: 'Widget', sku: 'W1', quantity: 3, unitPrice: 12.5, costPrice: 5, total: 37.5 }],
    } as any, { orderStatus: 'refunded', paymentStatus: 'refunded', paidAmount: 0 });
    for (let i = 0; i < 50 && bodies.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(bodies.length, 1, 'exactly one push is made');
  const body = bodies[0];
  assert.equal(body.subtotalKobo, 12345, 'subtotal converted to integer kobo');
  assert.equal(body.discountKobo, 1050, 'discount converted to integer kobo');
  assert.equal(body.deliveryFeeKobo, 2075, 'delivery fee converted to integer kobo');
  assert.equal(body.totalKobo, 13370, 'total converted to integer kobo');
  assert.equal(body.paidKobo, 0, 'an explicit paidAmount override wins over the sale field (refund)');
  assert.equal(body.orderStatus, 'refunded');
  assert.equal(body.paymentStatus, 'refunded');
  assert.equal(body.items[0].unitPriceKobo, 1250, 'line unit price converted to integer kobo');
  assert.equal(body.items[0].qty, 3);

  // Without an override the sale's paidAmount is used.
  const bodies2: any[] = [];
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    bodies2.push(JSON.parse(String(init?.body ?? '{}')));
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  try {
    syncMallOrderFromPos({ id: 'sale-ord_9', subtotal: 10, discount: 0, deliveryFee: 0, totalAmount: 10, paidAmount: 7.5, items: [] } as any);
    for (let i = 0; i < 50 && bodies2.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(bodies2[0].paidKobo, 750, 'without an override the sale paidAmount is used');
  restoreStorage();
});

