/**
 * Golden / approval suite for the money paths.
 *
 * Each canonical scenario runs through the real handlers / write router, then
 * the resulting sales / sale_items / stock_movements / money_movements rows are
 * serialised DETERMINISTICALLY (stable sort key, timestamps/UUIDs/ids replaced
 * by stable placeholders) and compared against a committed JSON fixture under
 * scripts/regression/__golden__/<scenario>.json.
 *
 * The golden file is human-readable so a PR diff shows exactly which row changed.
 * On mismatch the suite prints a unified diff and fails. Set UPDATE_GOLDEN=1 to
 * re-approve (rewrite) the fixtures after an INTENDED behavior change — never to
 * paper over a regression.
 *
 * After every scenario the coarse money-invariant reconciliation checks also run,
 * so the golden net (fine-grained) and the invariants (coarse) both hold.
 *
 * Production safety: :memory: only — assertNotProduction guards every fixture;
 * MALL_CONTRACT_ALLOW_LIVE is never set.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  makeTestDb, makeTestExecutor, seedCatalog, seedActiveCart, moneyTotals, assertNotProduction,
} from '../test-harness.ts';
import { handleMallApi } from '../../src/server/mallApi.ts';
import { handleStaffMallApi } from '../../src/server/mallOrderAdminApi.ts';
import { upsertToStatements, deleteToStatements } from '../../src/server/relationalWrites.ts';
import { makeNodeAdapter } from '../../src/server/nodeAdapter.ts';
import { refundSale } from '../../src/shared/posLedger.ts';

const GOLDEN_DIR = path.resolve(import.meta.dirname ?? '.', '__golden__');
const UPDATE_GOLDEN = process.env.UPDATE_GOLDEN === '1';

// ---------------------------------------------------------------------------
// Deterministic serialisation
// ---------------------------------------------------------------------------


const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_RE = /^\d{13}$/;

/** Replace timestamps, epoch-ms, and random id fragments with fixed placeholders. */
function scrubValue(value: unknown): unknown {
  if (typeof value === 'string') {
    if (ISO_RE.test(value)) return '<timestamp>';
    if (DATE_RE.test(value)) return '<date>';
    let out = value
      // Timestamps embedded INSIDE JSON strings (refunds_json etc.).
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, '<timestamp>')
      // Random UUIDs embedded in server-generated ids (mo-<uuid>, sale-mo-<uuid>…).
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
      // Random uppercase suffixes after a yyyymmdd date (DEL-/INV- refs).
      .replace(/\d{8}-[A-Z0-9]{4,}/g, '<date>-<rand>');
    return out;
  }
  if (typeof value === 'number' && MS_RE.test(String(value))) return '<epoch-ms>';
  return value;
}

type Row = Record<string, unknown>;

/** Whitelisted columns per table — the shape that matters for money review. */
const COLUMNS: Record<string, string[]> = {
  sales: ['id', 'receipt_no', 'customer_name', 'total_kobo', 'paid_kobo', 'subtotal_kobo', 'discount_kobo',
    'delivery_fee_kobo', 'payment_method', 'status', 'is_historical', 'total_refunded_kobo', 'refunds_json'],
  sale_items: ['id', 'sale_id', 'product_id', 'product_name', 'qty', 'unit_price_kobo', 'cost_price_kobo',
    'total_kobo', 'returned_qty'],
  stock_movements: ['id', 'product_id', 'type', 'qty', 'prev_stock', 'new_stock', 'ref_id'],
  money_movements: ['id', 'type', 'subtype', 'source_account', 'dest_account', 'amount_kobo', 'ref_no', 'ref_id'],
};

/** Sort key per table: stable, business-meaningful ordering. */
const SORT_KEYS: Record<string, string[]> = {
  sales: ['id'],
  sale_items: ['sale_id', 'id'],
  stock_movements: ['product_id', 'type', 'qty'],
  money_movements: ['type', 'ref_id', 'amount_kobo', 'subtype'],
};

/** Serialize a table to sorted, scrubbed, column-projected rows. */
function serializeTable(db: DatabaseSync, table: string): Row[] {
  const columns = COLUMNS[table];
  const rows = db.prepare(`SELECT * FROM ${table}`).all() as any[];
  const projected = rows.map((raw) => {
    const out: Row = {};
    for (const column of columns) {
      if (!(column in raw)) continue;
      out[column] = scrubValue(raw[column]);
    }
    return out;
  });
  projected.sort((a, b) => {
    for (const key of SORT_KEYS[table]) {
      const av = String(a[key] ?? '');
      const bv = String(b[key] ?? '');
      if (av !== bv) return av < bv ? -1 : 1;
    }
    return 0;
  });
  return projected;
}

function serializeScenario(db: DatabaseSync): Record<string, Row[]> {
  const out: Record<string, Row[]> = {};
  for (const table of ['money_movements', 'sales', 'sale_items', 'stock_movements']) {
    out[table] = serializeTable(db, table);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Diff helpers (readable unified diff on mismatch)
// ---------------------------------------------------------------------------

function asText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function unifiedDiff(expected: string, actual: string, context = 3): string {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  const lines: string[] = [`--- golden fixture (committed)`, `+++ actual (in-memory)`];
  let i = 0, j = 0;
  while (i < expectedLines.length || j < actualLines.length) {
    if (expectedLines[i] === actualLines[j]) { i++; j++; continue; }
    const startI = Math.max(0, i - context), startJ = Math.max(0, j - context);
    // Find the next re-sync point.
    let endI = i, endJ = j;
    while (endI < expectedLines.length && endJ < actualLines.length && expectedLines[endI] !== actualLines[endJ]) {
      endI++; endJ++;
    }
    // Scan forward for equal run.
    let syncLen = 0;
    while (endI + syncLen < expectedLines.length && endJ + syncLen < actualLines.length
      && expectedLines[endI + syncLen] === actualLines[endJ + syncLen]) syncLen++;
    lines.push(`@@ -${startI + 1} +${startJ + 1} @@`);
    for (let k = startI; k < Math.min(endI + Math.min(syncLen, context), expectedLines.length); k++) {
      if (k < i) { lines.push(`  ${expectedLines[k]}`); continue; }
      lines.push(k < endI ? `- ${expectedLines[k]}` : `  ${expectedLines[k]}`);
    }
    for (let k = startJ; k < Math.min(endJ + Math.min(syncLen, context), actualLines.length); k++) {
      if (k < j) continue;
      lines.push(k < endJ ? `+ ${actualLines[k]}` : `  ${actualLines[k]}`);
    }
    i = Math.min(endI + Math.min(syncLen, context), expectedLines.length);
    j = Math.min(endJ + Math.min(syncLen, context), actualLines.length);
    if (syncLen === 0 && i >= expectedLines.length && j >= actualLines.length) break;
  }
  return lines.join('\n');
}

/**
 * Compare one scenario against its committed golden fixture.
 * UPDATE_GOLDEN=1 rewrites the fixture (re-approval).
 */
function assertGolden(scenario: string, actual: Record<string, Row[]>): void {
  const file = path.join(GOLDEN_DIR, `${scenario}.json`);
  if (UPDATE_GOLDEN) {
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    fs.writeFileSync(file, `${asText(actual)}\n`);
    console.warn(`[golden] re-approved ${file}`);
    return;
  }
  assert.ok(fs.existsSync(file),
    `golden fixture missing for ${scenario}: ${file}. Run UPDATE_GOLDEN=1 npm run test:regression once to seed it.`);
  const committed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, Row[]>;
  const expectedText = asText(committed);
  const actualText = asText(actual);
  if (expectedText === actualText) return;
  const diff = unifiedDiff(expectedText, actualText);
  assert.fail(
    `GOLDEN MISMATCH for ${scenario}. The money-path output changed.\n`
    + `If this change is INTENDED, re-approve with UPDATE_GOLDEN=1 npm run test:regression\n`
    + `and review the fixture diff in the PR. Otherwise, this is a regression.\n\n${diff}`,
  );
}

// ---------------------------------------------------------------------------
// Shared drivers (same write shapes the real flows commit — see
// scripts/money-invariants.test.ts for the full commentary on why the POS side
// is driven through the real sync-bridge write router).
// ---------------------------------------------------------------------------

const actor = { id: 'staff-golden', displayName: 'Golden Manager', role: 'Administrator' };

function row(db: DatabaseSync, sql: string, ...params: any[]) { return db.prepare(sql).get(...params) as any; }
function count(db: DatabaseSync, sql: string, ...params: any[]) {
  return Number((db.prepare(sql).all(...params)[0] as any)?.n ?? 0);
}

function push(db: DatabaseSync, collection: string, document: any): void {
  const tx = makeNodeAdapter(db);
  for (const st of upsertToStatements(collection, document, new Date().toISOString())) tx.run(st.sql, st.params);
}
function remove(db: DatabaseSync, collection: string, id: string): void {
  const tx = makeNodeAdapter(db);
  for (const st of deleteToStatements(collection, id)) tx.run(st.sql, st.params);
}

type SaleLineLike = { productId: string; productName: string; sku: string; quantity: number; unitPrice: number; costPrice: number; total: number };
type Channel = 'Cash' | 'Card' | 'Mobile Transfer' | 'Bank Transfer' | 'Split';

/**
 * Deterministic per-scenario id counters. Golden output must be reviewable in a
 * PR, so random UUIDs are replaced by stable sequence ids keyed on the
 * (table, business context) — `mm-1`, `mv-2`, etc. — which stay identical
 * across runs and across machines.
 */
const idCounters = new WeakMap<DatabaseSync, Map<string, number>>();
function stableDbId(db: DatabaseSync, table: string, context: string): string {
  void context;
  let counters = idCounters.get(db);
  if (!counters) { counters = new Map(); idCounters.set(db, counters); }
  // One global counter per table: ids must be unique within the scenario,
  // otherwise two rows sharing an id collapse in the relational upsert.
  const next = (counters.get(table) ?? 0) + 1;
  counters.set(table, next);
  return `${table}-${next}`;
}

/** Mirror processSale() exactly (see money-invariants.test.ts for the rationale). */
function posSale(db: DatabaseSync, lines: SaleLineLike[], method: Channel, paidAmount: number,
  breakdown?: Record<string, number>, opts: { isHistorical?: boolean } = {}): string {
  const id = stableDbId(db, 'sale', 'pos');
  const subtotal = lines.reduce((a, l) => a + l.total, 0);
  const now = new Date().toISOString();
  push(db, 'sales', {
    id, invoiceNo: `INV-${id.toUpperCase()}`, customerName: 'Walk-in Customer',
    items: lines.map((l) => ({ ...l, returnedQuantity: 0 })),
    subtotal, discount: 0, tax: 0, deliveryFee: 0,
    totalAmount: subtotal, paidAmount, paymentMethod: method,
    paymentBreakdown: method === 'Split' ? breakdown : undefined,
    status: 'Completed', createdBy: 'GoldenRunner', createdAt: now, isHistorical: opts.isHistorical === true,
  });
  if (opts.isHistorical !== true) {
    for (const line of lines) {
      const current = row(db, 'SELECT stock_qty FROM products WHERE id = ?', line.productId);
      push(db, 'products', { id: line.productId, sku: line.sku, name: line.productName, unit: 'pcs', status: 'Active', isMallListed: true, retailPrice: 100, costPrice: line.costPrice, currentStock: current.stock_qty - line.quantity });
      push(db, 'stockMovements', {
        id: stableDbId(db, 'mv', `sale-${id}-${line.productId}`), productId: line.productId, productName: line.productName,
        type: 'Outgoing', quantity: line.quantity, previousStock: current.stock_qty, newStock: current.stock_qty - line.quantity,
        notes: `POS Sale INV-${id}`, performedBy: 'GoldenRunner', createdAt: now,
      });
    }
  }
  if (opts.isHistorical === true) return id;
  const insertInflow = (sub: string, account: 'Physical Cash' | 'Biz Account', amount: number) => {
    push(db, 'moneyMovements', {
      id: stableDbId(db, 'mm', `inflow-${id}-${account}`), date: now, type: 'Sale Inflow', subtype: sub,
      destinationAccount: account, amount, referenceNo: `INV-${id.toUpperCase()}`, referenceId: id,
      performedBy: 'GoldenRunner', notes: `${sub} sale`, createdAt: now,
    });
  };
  if (method === 'Cash') insertInflow('Cash Sale', 'Physical Cash', paidAmount);
  else if (method !== 'Split') insertInflow(method, 'Biz Account', paidAmount);
  else {
    const cashPart = Math.max(0, Number(breakdown?.['Cash']) || 0);
    const bizPart = Math.max(0, (Number(breakdown?.['Mobile Transfer']) || 0) + (Number(breakdown?.['Bank Transfer']) || 0) + (Number(breakdown?.['Card']) || 0));
    if (cashPart > 0) insertInflow('Split - Cash Portion', 'Physical Cash', cashPart);
    if (bizPart > 0) insertInflow('Split - Transfer/Card Portion', 'Biz Account', bizPart);
  }
  return id;
}

/** Mirror refundSale() cascade. */
function posRefund(db: DatabaseSync, saleId: string, lines: SaleLineLike[], quantities: readonly number[],
  settlement: 'Cash' | 'Biz Account', returnStock: boolean): number {
  const result = refundSale(lines, lines.map((l, i) => ({ ...l, quantity: quantities[i] })));
  const net = result.netRefundAmount;
  const now = new Date().toISOString();
  if (returnStock) {
    lines.forEach((line, i) => {
      if (quantities[i] <= 0) return;
      const current = row(db, 'SELECT stock_qty FROM products WHERE id = ?', line.productId);
      push(db, 'products', { id: line.productId, sku: line.sku, name: line.productName, unit: 'pcs', status: 'Active', isMallListed: true, retailPrice: 100, costPrice: line.costPrice, currentStock: current.stock_qty + quantities[i] });
      push(db, 'stockMovements', {
        id: stableDbId(db, 'mv', `refund-${saleId}-${line.productId}`), productId: line.productId, productName: line.productName,
        type: 'Returned', quantity: quantities[i], previousStock: current.stock_qty, newStock: current.stock_qty + quantities[i],
        notes: 'Refund return', performedBy: 'GoldenRunner', createdAt: now,
      });
    });
  }
  push(db, 'moneyMovements', {
    id: stableDbId(db, 'mm', `refund-${saleId}-${settlement}`), date: now, type: 'Sale Refund',
    subtype: `${settlement} Refund (${quantities.reduce((a, q) => a + q, 0) === lines.reduce((a, l) => a + l.quantity, 0) ? 'Full' : 'Partial'})`,
    sourceAccount: settlement === 'Cash' ? 'Physical Cash' : 'Biz Account',
    amount: net, referenceNo: `REF-${saleId}`, referenceId: saleId, performedBy: 'GoldenRunner', createdAt: now,
  });
  const raw = saleRaw(db, saleId);
  push(db, 'sales', {
    ...raw, totalRefunded: (Number(raw.totalRefunded) || 0) + net,
    status: 'Refunded',
    refunds: [...(raw.refunds || []), { id: `ref-${saleId}-${raw.refunds?.length ?? 0}`, netRefundAmount: net }],
  });
  return net;
}

/** Raw sale row → document shape (naira units). */
function saleRaw(db: DatabaseSync, saleId: string): any {
  const s = row(db, 'SELECT * FROM sales WHERE id = ?', saleId);
  const items = (db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId) as any[]).map((it) => ({
    productId: it.product_id, productName: it.product_name, sku: it.sku, quantity: it.qty,
    unitPrice: it.unit_price_kobo / 100, costPrice: it.cost_price_kobo / 100, total: it.total_kobo / 100,
    returnedQuantity: it.returned_qty,
  }));
  return {
    id: s.id, invoiceNo: s.receipt_no, customerId: s.customer_id, customerName: s.customer_name,
    items, subtotal: s.subtotal_kobo / 100, discount: s.discount_kobo / 100, tax: s.tax_kobo / 100,
    deliveryFee: s.delivery_fee_kobo / 100, totalAmount: s.total_kobo / 100, paidAmount: s.paid_kobo / 100,
    paymentMethod: s.payment_method, status: s.status, createdBy: s.created_by, createdAt: s.created_at,
    isHistorical: s.is_historical === 1, totalRefunded: s.total_refunded_kobo / 100,
    refunds: s.refunds_json ? JSON.parse(s.refunds_json) : [],
    paymentBreakdown: s.payment_breakdown_json ? JSON.parse(s.payment_breakdown_json) : undefined,
  };
}

function markReturned(db: DatabaseSync, saleId: string, qty: number): void {
  const line = row(db, 'SELECT id, returned_qty FROM sale_items WHERE sale_id = ? LIMIT 1', saleId);
  db.prepare('UPDATE sale_items SET returned_qty = ? WHERE sale_id = ? AND id = ?').run(
    (Number(line.returned_qty) || 0) + qty, saleId, line.id);
}

function addExpenseLike(db: DatabaseSync, amount: number, category: string, isHistorical = false): string {
  const id = stableDbId(db, 'exp', category);
  const now = new Date().toISOString();
  push(db, 'expenses', {
    id, title: `Golden ${category}`, category, amount, description: 'golden expense',
    paidBy: 'GoldenRunner', paymentMethod: 'Cash', date: now.slice(0, 10), isHistorical, createdAt: now,
  });
  if (isHistorical !== true && amount > 0) {
    push(db, 'moneyMovements', {
      id: `mm-exp-${id}`, date: now, type: 'Expense Outflow', subtype: category,
      sourceAccount: 'Physical Cash', amount, referenceNo: `Golden ${category}`, referenceId: id,
      performedBy: 'GoldenRunner', createdAt: now,
    });
  }
  return id;
}
function deleteExpenseLike(db: DatabaseSync, id: string): void {
  const movements = (db.prepare('SELECT id FROM money_movements WHERE ref_id = ?').all(id) as any[]).map((m) => String(m.id));
  remove(db, 'expenses', id);
  for (const mmId of movements) remove(db, 'moneyMovements', mmId);
}

// ---------------------------------------------------------------------------
// Mall fixture + drivers (real handlers)
// ---------------------------------------------------------------------------

async function staff(ctx: any, action: string, body: Record<string, unknown> = {}, role = 'Administrator', id?: string) {
  const oid = id ?? String((ctx.db.prepare('SELECT id FROM mall_orders LIMIT 1').get() as any).id);
  return handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${oid}/${action}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), ctx.exec, { ...actor, role });
}

async function mallFixture(deliveryZone?: string) {
  assertNotProduction(':memory: golden mall');
  const db = makeTestDb();
  const exec = makeTestExecutor(db);
  const opening = new Map<string, number>([['p', 10]]);
  seedCatalog(db, { id: 'p', retailPriceKobo: 10000, stockQty: 10 });
  const session = `golden-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
  seedActiveCart(db, session, [{ productId: 'p', qty: 2, unitPriceKobo: 1 }]);
  const placed = await handleMallApi(new Request('http://test/api/mall/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mall-session': session, 'idempotency-key': `golden-${session}` },
    body: JSON.stringify({
      customerName: 'Ada', customerPhone: '08031234567', paymentMethod: 'pay_on_pickup',
      ...(deliveryZone ? { deliveryZone, deliveryAddress: '12 Market Road, Uyo' } : {}),
    }),
  }), exec);
  assert.equal(placed.status, 201);
  return { db, exec, opening };
}

// ---------------------------------------------------------------------------
// Canonical scenarios — each: run → golden compare → invariants
// ---------------------------------------------------------------------------

/** The invariant helpers, imported from the money-invariants suite shape. */
function assertStockReconciles(db: DatabaseSync, opening: Map<string, number>, msg = ''): void {
  const rows = db.prepare(`
    SELECT p.id AS id, p.stock_qty AS stock, COALESCE(SUM(sm.signed_qty), 0) AS moves
    FROM products p LEFT JOIN (
      SELECT product_id, qty,
        CASE WHEN qty < 0 THEN qty
             WHEN type IN ('Outgoing', 'Damaged', 'Discard') THEN -qty
             ELSE qty END AS signed_qty
      FROM stock_movements WHERE product_id IS NOT NULL
    ) sm ON sm.product_id = p.id
    GROUP BY p.id`).all() as any[];
  for (const r of rows) {
    const open = opening.get(String(r.id)) ?? Number(r.stock);
    assert.equal(Number(r.stock), open + Number(r.moves), `${msg}stock does not reconcile for ${r.id}`);
  }
}

function assertSaleInflowsReconcile(db: DatabaseSync, msg = ''): void {
  const sales = db.prepare('SELECT id, total_kobo, paid_kobo, total_refunded_kobo, status, is_historical FROM sales').all() as any[];
  for (const sale of sales) {
    const inflows = db.prepare(
      'SELECT type, SUM(amount_kobo) AS sum FROM money_movements WHERE ref_id = ? GROUP BY type',
    ).all(sale.id) as any[];
    const inflowSum = inflows.filter((r) => r.type === 'Sale Inflow').reduce((a, r) => a + Number(r.sum), 0);
    const refundSum = inflows.filter((r) => r.type === 'Sale Refund').reduce((a, r) => a + Number(r.sum), 0);
    if (Number(sale.is_historical) === 1) {
      assert.equal(inflows.length, 0, `${msg}historical sale ${sale.id} books no movements`);
      continue;
    }
    if (sale.status !== 'Completed') continue;
    const isMallOrigin = (db.prepare('SELECT COUNT(*) AS n FROM mall_orders WHERE linked_sale_id = ?').get(sale.id) as any).n > 0;
    // Split sales book TWO inflows whose SUM equals the total; the breakdown is
    // on the sale header. Store-credit sales collect less cash than the total
    // (the difference is overage, not cash) and settle the rest from credit.
    const overageCreated = (db.prepare('SELECT overage_created_kobo FROM sales WHERE id = ?').get(sale.id) as any)?.overage_created_kobo;
    const overageApplied = (db.prepare('SELECT overage_applied_kobo FROM sales WHERE id = ?').get(sale.id) as any)?.overage_applied_kobo;
    const expected = isMallOrigin ? Number(sale.paid_kobo)
      // Store-credit sales: cash landed = total − overage held as credit.
      // Debt-settled sales book their money as a Customer Debt Payment
      // (ref_id = the CUSTOMER, not the sale), so the invoice carries no new
      // Sale Inflow and the per-sale rule is simply total − overage − debtSettled.
      : Number(sale.paid_kobo) - Number(overageCreated ?? 0) - Number(overageApplied ?? 0)
      - Number((db.prepare(`SELECT COALESCE(SUM(m.amount_kobo), 0) AS n FROM money_movements m
          JOIN sales s2 ON s2.id = ? WHERE m.type = 'Customer Debt Payment' AND m.ref_id = s2.customer_id`).get(sale.id) as any).n);
    assert.equal(inflowSum, expected, `${msg}sale ${sale.id} inflow ${inflowSum} != expected ${expected}`);
    if (Number(sale.total_refunded_kobo) > 0 || refundSum > 0) {
      assert.equal(refundSum, Number(sale.total_refunded_kobo), `${msg}sale ${sale.id} refund sum mismatch`);
    }
  }
}

function assertExpenseOutflowsReconcile(db: DatabaseSync, msg = ''): void {
  for (const exp of db.prepare('SELECT id, amount_kobo, is_historical FROM expenses').all() as any[]) {
    const out = db.prepare(
      "SELECT COALESCE(SUM(amount_kobo), 0) AS sum FROM money_movements WHERE type = 'Expense Outflow' AND ref_id = ?",
    ).get(exp.id) as any;
    if (Number(exp.is_historical) === 1) {
      assert.equal(Number(out.sum), 0, `${msg}historical expense ${exp.id} books no movement`);
      continue;
    }
    assert.equal(Number(out.sum), Number(exp.amount_kobo), `${msg}expense ${exp.id} outflow mismatch`);
  }
}

const KNOWN_TYPES = new Set([
  'Opening Balance', 'Balance Adjustment', 'Sale Inflow', 'Sale Refund', 'Refund Outflow',
  'Expense Outflow', 'Supplier Payment', 'Customer Debt Payment', 'Internal Transfer',
  'Owner Drawing', 'Owner Repayment',
]);
const ACCOUNTS = new Set(['Biz Account', 'Physical Cash']);

function assertLiquidLedger(db: DatabaseSync, msg = ''): void {
  for (const mm of db.prepare('SELECT id, type, source_account, dest_account FROM money_movements').all() as any[]) {
    assert.ok(KNOWN_TYPES.has(String(mm.type)), `${msg}unknown movement type ${mm.type}`);
    for (const acc of [mm.source_account, mm.dest_account]) {
      if (acc === null || acc === undefined) continue;
      assert.ok(ACCOUNTS.has(String(acc)), `${msg}illegal account ${acc} on ${mm.id}`);
    }
  }
  const totals = moneyTotals(db);
  assert.equal(totals.salesTotalKobo, Number((db.prepare('SELECT COALESCE(SUM(total_kobo),0) AS n FROM sales').get() as any).n),
    `${msg}salesTotalKobo must match the sales table`);
}

function assertAllInvariants(db: DatabaseSync, opening: Map<string, number>, msg = ''): void {
  assertStockReconciles(db, opening, msg);
  assertSaleInflowsReconcile(db, msg);
  assertExpenseOutflowsReconcile(db, msg);
  assertLiquidLedger(db, msg);
}

const LINE: SaleLineLike = { productId: 'p', productName: 'Golden Product', sku: 'p', quantity: 2, unitPrice: 100, costPrice: 50, total: 200 };

// -- POS sale per channel ----------------------------------------------------

for (const channel of ['Cash', 'Card', 'Mobile Transfer', 'Bank Transfer', 'Split'] as Channel[]) {
  test(`golden: POS sale ${channel}`, () => {
    assertNotProduction(':memory: golden POS sale');
    const db = makeTestDb();
    const opening = new Map<string, number>([['p', 10]]);
    seedCatalog(db, { id: 'p', retailPriceKobo: 10000, stockQty: 10 });
    posSale(db, [LINE], channel, 200, channel === 'Split' ? { 'Cash': 120, 'Card': 80 } : undefined);
    assertGolden(`pos-sale-${channel.toLowerCase().replaceAll(' ', '-')}`, serializeScenario(db));
    assertAllInvariants(db, opening, `POS sale ${channel}: `);
    db.close();
  });
}

// -- POS refunds ---------------------------------------------------------------

for (const [label, settlement, quantities, returnStock] of [
  ['full-cash-restock', 'Cash', [2], true],
  ['full-cash-norestock', 'Cash', [2], false],
  ['partial-biz-restock', 'Biz Account', [1], true],
  ['partial-biz-norestock', 'Biz Account', [1], false],
] as const) {
  test(`golden: POS refund ${label}`, () => {
    assertNotProduction(':memory: golden POS refund');
    const db = makeTestDb();
    const opening = new Map<string, number>([['p', 10]]);
    seedCatalog(db, { id: 'p', retailPriceKobo: 10000, stockQty: 10 });
    const saleId = posSale(db, [LINE], settlement === 'Cash' ? 'Cash' : 'Card', 200);
    if (returnStock) markReturned(db, saleId, quantities[0]);
    posRefund(db, saleId, [LINE], quantities, settlement, returnStock);
    assertGolden(`pos-refund-${label}`, serializeScenario(db));
    assertAllInvariants(db, opening, `POS refund ${label}: `);
    db.close();
  });
}

// -- Store credit sale ---------------------------------------------------------

test('golden: store credit sale (over-settle clamped, no phantom credit)', () => {
  assertNotProduction(':memory: golden store credit');
  const db = makeTestDb();
  const opening = new Map<string, number>([['p', 10]]);
  seedCatalog(db, { id: 'p', retailPriceKobo: 10000, stockQty: 10 });
  // A customer with 300 owed pays 400: 300 settles the debt, 100 becomes store
  // credit (overage) — the sale documents exactly that split relationally.
  db.prepare(`INSERT INTO customers (id, name, phone, email, address, purchase_history_count, outstanding_balance_kobo, loyalty_points, lifetime_value_kobo, created_at)
    VALUES ('cust-sc', 'Ada Credit', '08031111111', '', '', 1, 30000, 0, 30000, '2026-01-01T00:00:00.000Z')`).run();
  const now = new Date().toISOString();
  const saleId = 'sale-storecredit';
  push(db, 'sales', {
    id: saleId, invoiceNo: 'INV-STORECREDIT', customerId: 'cust-sc', customerName: 'Ada Credit',
    items: [{ ...LINE, quantity: 3, total: 300, returnedQuantity: 0 }],
    subtotal: 300, discount: 0, tax: 0, deliveryFee: 0, totalAmount: 300, paidAmount: 400,
    overageApplied: 0, overageCreated: 100,
    paymentMethod: 'Cash', status: 'Completed', createdBy: 'GoldenRunner', createdAt: now,
  });
  push(db, 'products', { id: 'p', sku: 'p', name: 'Golden Product', unit: 'pcs', status: 'Active', isMallListed: true, retailPrice: 100, costPrice: 50, currentStock: 7 });
  push(db, 'stockMovements', {
    id: 'mv-storecredit', productId: 'p', productName: 'Golden Product', type: 'Outgoing',
    quantity: 3, previousStock: 10, newStock: 7, notes: 'POS Sale INV-STORECREDIT', performedBy: 'GoldenRunner', createdAt: now,
  });
  // Sale Inflow records the cash that actually landed (300); the 100 overage is
  // store credit, NOT cash — no movement for it.
  push(db, 'moneyMovements', {
    id: 'mm-storecredit', date: now, type: 'Sale Inflow', subtype: 'Cash Sale',
    destinationAccount: 'Physical Cash', amount: 300, referenceNo: 'INV-STORECREDIT', referenceId: saleId,
    performedBy: 'GoldenRunner', notes: 'Cash sale with 100 overage held as store credit', createdAt: now,
  });
  db.prepare('UPDATE customers SET outstanding_balance_kobo = 0, overage_balance_kobo = 10000 WHERE id = ?').run('cust-sc');
  assertGolden('store-credit-sale', serializeScenario(db));
  assertAllInvariants(db, opening, 'store credit: ');
  db.close();
});

// -- Mall lifecycle: checkout -> payment -> dispatch -> refund -> cancel --------

test('golden: mall checkout -> payment -> dispatch -> refund (cancel rejects a refunded order)', () => {
  return mallLifecycleGolden('mall-lifecycle-refund');
});

async function mallLifecycleGolden(scenario: string): Promise<void> {
  const ctx = await mallFixture('uyo_outer');
  const opening = ctx.opening;
  assert.equal((await staff(ctx, 'review-delivery', { confirmed: true })).status, 200);
  assert.equal((await staff(ctx, 'confirm')).status, 200);
  // subtotal 20000 + outer fee 250000 = 270000
  assert.equal((await staff(ctx, 'collect-payment', { paymentMethod: 'Cash', amountKobo: 270000 })).status, 200);
  assert.equal((await staff(ctx, 'mark-packed')).status, 200);
  assert.equal((await staff(ctx, 'mark-out-for-delivery', { courier: 'Golden courier' })).status, 200);
  assert.equal((await staff(ctx, 'refund', { reason: 'Golden refund', returnStock: true, returnReference: 'GRN-GOLDEN' })).status, 200);
  // A refunded order cannot be cancelled — the cancel branch stays inert.
  assert.equal((await staff(ctx, 'cancel', { reason: 'Too late' })).status, 409);
  assertGolden(scenario, serializeScenario(ctx.db));
  assertAllInvariants(ctx.db, opening, 'mall lifecycle: ');
  ctx.db.close();
}

// -- Mall part-payment -> customer debt -----------------------------------------

test('golden: mall part-payment books the customer debt', async () => {
  const ctx = await mallFixture();
  const opening = ctx.opening;
  ctx.db.prepare(`INSERT INTO customers (id, name, phone, email, address, purchase_history_count, outstanding_balance_kobo, loyalty_points, lifetime_value_kobo, created_at)
    VALUES ('cust-golden', 'Ada Mall', '+234 803 123 4567', '', '', 0, 0, 0, 0, '2026-01-01T00:00:00.000Z')`).run();
  assert.equal((await staff(ctx, 'confirm')).status, 200);
  assert.equal((await staff(ctx, 'collect-payment', { paymentMethod: 'Cash', amountKobo: 8000 })).status, 200);
  assert.equal(Number((row(ctx.db, 'SELECT outstanding_balance_kobo FROM customers WHERE id = ?', 'cust-golden').outstanding_balance_kobo)), 12000);
  assertGolden('mall-part-payment', serializeScenario(ctx.db));
  assertAllInvariants(ctx.db, opening, 'part payment: ');
  ctx.db.close();
});

// -- Expense add then delete -----------------------------------------------------

test('golden: expense add then delete', () => {
  assertNotProduction(':memory: golden expense');
  const db = makeTestDb();
  const opening = new Map<string, number>();
  const expId = addExpenseLike(db, 50, 'Logistics');
  assertGolden('expense-added', serializeScenario(db));
  deleteExpenseLike(db, expId);
  assertGolden('expense-deleted', serializeScenario(db));
  assertAllInvariants(db, opening, 'expense: ');
  db.close();
});

// -- Purchases: receive (+ GRN variance), supplier payment, customer debt payment -

test('golden: purchase receive with GRN variance + supplier payment', () => {
  assertNotProduction(':memory: golden purchase');
  const db = makeTestDb();
  const opening = new Map<string, number>([['p', 10], ['p2', 5]]);
  seedCatalog(db, [
    { id: 'p', retailPriceKobo: 10000, stockQty: 10 },
    { id: 'p2', retailPriceKobo: 20000, stockQty: 5 },
  ]);
  const now = new Date().toISOString();
  const poId = 'po-golden';
  push(db, 'purchases', {
    id: poId, poNumber: 'PO-GOLDEN', supplierName: 'Golden Supplier',
    items: [
      { productId: 'p', productName: 'Golden Product', quantity: 10, unitCost: 40, total: 400, receivedQuantity: 10, acceptedQuantity: 10, damagedQuantity: 0, shortageQuantity: 0, excessQuantity: 0 },
      { productId: 'p2', productName: 'Golden Product 2', quantity: 10, unitCost: 80, total: 800, receivedQuantity: 6, acceptedQuantity: 6, damagedQuantity: 0, shortageQuantity: 4, excessQuantity: 0 },
    ],
    totalAmount: 1200, paidAmount: 0, paymentStatus: 'Unpaid', deliveryStatus: 'Partial',
    createdBy: 'GoldenRunner', createdAt: now,
    receivingHistory: [{ id: `${poId}-grn-0`, grnNumber: 'GRN-GOLDEN-0001', receivedBy: 'GoldenRunner', receivedAt: now, itemsReceived: [] }],
  });
  // Receipts: p1 +10, p2 +6 with stock movements.
  for (const [pid, add, prev, name] of [['p', 10, 10, 'Golden Product'], ['p2', 6, 5, 'Golden Product 2']] as const) {
    push(db, 'products', { id: pid, sku: pid, name, unit: 'pcs', status: 'Active', isMallListed: false, retailPrice: pid === 'p' ? 100 : 200, costPrice: pid === 'p' ? 40 : 80, currentStock: prev + add });
    push(db, 'stockMovements', {
      id: `mv-grn-${pid}`, productId: pid, productName: name, type: 'Incoming',
      quantity: add, previousStock: prev, newStock: prev + add, notes: `GRN-GOLDEN-0001 ${pid}`,
      performedBy: 'GoldenRunner', createdAt: now,
    });
  }
  // Supplier payment against the PO.
  push(db, 'moneyMovements', {
    id: `mm-sup-${poId}`, date: now, type: 'Supplier Payment', subtype: 'PO #PO-GOLDEN',
    sourceAccount: 'Physical Cash', amount: 600, referenceNo: 'PO-GOLDEN', referenceId: poId,
    performedBy: 'GoldenRunner', notes: 'Supplier payment', createdAt: now,
  });
  assertGolden('purchase-receive-supplier-payment', serializeScenario(db));
  assertAllInvariants(db, opening, 'purchase: ');
  db.close();
});

test('golden: customer debt payment', () => {
  assertNotProduction(':memory: golden debt payment');
  const db = makeTestDb();
  const opening = new Map<string, number>([['p', 10]]);
  seedCatalog(db, { id: 'p', retailPriceKobo: 10000, stockQty: 10 });
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO customers (id, name, phone, email, address, purchase_history_count, outstanding_balance_kobo, loyalty_points, lifetime_value_kobo, created_at)
    VALUES ('c1', 'Ada Debt', '08031111111', '', '', 1, 50000, 0, 50000, '2026-01-01T00:00:00.000Z')`).run();
  push(db, 'sales', {
    id: 's-debt', invoiceNo: 'INV-DEBT', customerId: 'c1', customerName: 'Ada Debt',
    items: [{ productId: 'p', productName: 'Golden Product', sku: 'p', quantity: 5, unitPrice: 100, costPrice: 50, total: 500, returnedQuantity: 0 }],
    subtotal: 500, discount: 0, tax: 0, deliveryFee: 0, totalAmount: 500, paidAmount: 0,
    paymentMethod: 'Cash', status: 'Completed', createdBy: 'GoldenRunner', createdAt: now,
  });
  // Settlement: the invoice reconciles to the collected cash, the balance zeroes,
  // and one Customer Debt Payment movement lands in the paying account.
  db.prepare('UPDATE sales SET paid_kobo = 50000 WHERE id = ?').run('s-debt');
  db.prepare('UPDATE customers SET outstanding_balance_kobo = 0 WHERE id = ?').run('c1');
  push(db, 'moneyMovements', {
    id: 'mm-debt-golden', date: now, type: 'Customer Debt Payment', subtype: 'Cash',
    destinationAccount: 'Physical Cash', amount: 500, referenceNo: 'Ada Debt', referenceId: 'c1',
    performedBy: 'GoldenRunner', notes: 'Customer debt settled by Ada Debt: 500.00 via Cash', createdAt: now,
  });
  assertGolden('customer-debt-payment', serializeScenario(db));
  assertAllInvariants(db, opening, 'debt payment: ');
  db.close();
});

// -- Treasury: transfer, owner drawing, owner repayment ---------------------------

test('golden: treasury transfer, owner drawing, owner repayment', () => {
  assertNotProduction(':memory: golden treasury');
  const db = makeTestDb();
  const opening = new Map<string, number>([['p', 10]]);
  seedCatalog(db, { id: 'p', retailPriceKobo: 10000, stockQty: 10 });
  const saleId = posSale(db, [LINE], 'Cash', 200);
  void saleId;
  const now = new Date().toISOString();
  push(db, 'moneyMovements', {
    id: 'mm-trf-golden', date: now, type: 'Internal Transfer', subtype: 'Till to Bank',
    sourceAccount: 'Physical Cash', destinationAccount: 'Biz Account', amount: 120,
    referenceNo: 'TRF-GOLDEN', performedBy: 'GoldenRunner', notes: 'Deposited cash from till', createdAt: now,
  });
  push(db, 'moneyMovements', {
    id: 'mm-drw-golden', date: now, type: 'Owner Drawing', subtype: 'Owner Loan',
    sourceAccount: 'Physical Cash', amount: 80, referenceNo: 'DRW-GOLDEN', performedBy: 'Owner',
    notes: 'Owner loan drawing', createdAt: now,
  });
  push(db, 'moneyMovements', {
    id: 'mm-rep-golden', date: now, type: 'Owner Repayment', subtype: 'Owner Loan Repayment',
    destinationAccount: 'Biz Account', amount: 50, referenceNo: 'REP-GOLDEN', loanReferenceId: 'mm-drw-golden',
    performedBy: 'Owner', notes: 'Owner loan repayment', createdAt: now,
  });
  assertGolden('treasury-transfer-drawing-repayment', serializeScenario(db));
  assertAllInvariants(db, opening, 'treasury: ');
  db.close();
});

// -- Historical sale + expense ------------------------------------------------------

test('golden: historical sale and expense book nothing', () => {
  assertNotProduction(':memory: golden historical');
  const db = makeTestDb();
  const opening = new Map<string, number>([['p', 10]]);
  seedCatalog(db, { id: 'p', retailPriceKobo: 10000, stockQty: 10 });
  posSale(db, [LINE], 'Cash', 200, undefined, { isHistorical: true });
  addExpenseLike(db, 50, 'Logistics', true);
  assertGolden('historical-sale-and-expense', serializeScenario(db));
  assertAllInvariants(db, opening, 'historical: ');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM money_movements'), 0);
  db.close();
});
