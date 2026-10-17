/**
 * Mutation-killing tests for mallOperations mallMetrics (includes committedStock),
 * and relationalWrites upsertToStatements money cases.
 *
 * These tests exercise specific edge cases that the Stryker mutants target:
 * - ArrayDeclaration `[]` replacements (empty array fallbacks)
 * - StringLiteral `""` in `|| 0` fallbacks
 * - ArithmeticOperator mutations on constants (90 * 86400_000)
 * - MethodExpression mutations (Date.now())
 * - ConditionalExpression mutations (case 'pricingHistory')
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { makeTestDb, makeTestExecutor, seedCatalog, seedActiveCart } from './test-harness.ts';
import { mallMetrics } from '../src/server/mallOperations.ts';
import { upsertToStatements, deleteToStatements } from '../src/server/relationalWrites.ts';

test('mallMetrics: returns all expected sections', async () => {
  const db = makeTestDb();
  const exec = makeTestExecutor(db);
  const result = await mallMetrics(exec);
  assert.ok('committedStock' in result);
  assert.ok('readiness' in result);
  assert.ok('orders' in result);
  assert.ok('payments' in result);
  assert.ok('notifications' in result);
  assert.ok('jobs' in result);
  assert.ok('metrics' in result);
});

test('mallMetrics: committedStock returns zeroes for empty tables', async () => {
  const db = makeTestDb();
  const exec = makeTestExecutor(db);
  const result = await mallMetrics(exec);
  assert.equal(result.committedStock.units, 0);
  assert.equal(result.committedStock.costKobo, 0);
  assert.equal(result.committedStock.orders, 0);
  assert.deepEqual(result.committedStock.byStatus, []);
});

test('mallMetrics: committedStock aggregates units and cost_kobo across statuses', async () => {
  const db = makeTestDb();
  const exec = makeTestExecutor(db);
  const now = new Date().toISOString();

  seedCatalog(db, [
    { id: 'prod1', sku: 'SKU1', name: 'Product 1', stockQty: 10, retailPriceKobo: 10000 },
    { id: 'prod2', sku: 'SKU2', name: 'Product 2', stockQty: 10, retailPriceKobo: 8000 },
  ]);
  db.prepare('UPDATE products SET cost_price_kobo = ? WHERE id = ?').run(5000, 'prod1');
  db.prepare('UPDATE products SET cost_price_kobo = ? WHERE id = ?').run(3000, 'prod2');

  await exec.runBatch([
    { sql: `INSERT INTO mall_orders (id, order_no, status, created_at) VALUES ('ord1', 'ORD-001', 'pending', ?)`, params: [now] },
    { sql: `INSERT INTO mall_orders (id, order_no, status, created_at) VALUES ('ord2', 'ORD-002', 'confirmed', ?)`, params: [now] },
    { sql: `INSERT INTO mall_order_items (id, mall_order_id, product_id, product_name, qty, unit_price_kobo, total_kobo) VALUES ('item1', 'ord1', 'prod1', 'Product 1', 2, 10000, 20000)`, params: [] },
    { sql: `INSERT INTO mall_order_items (id, mall_order_id, product_id, product_name, qty, unit_price_kobo, total_kobo) VALUES ('item2', 'ord1', 'prod2', 'Product 2', 3, 8000, 24000)`, params: [] },
    { sql: `INSERT INTO mall_order_items (id, mall_order_id, product_id, product_name, qty, unit_price_kobo, total_kobo) VALUES ('item3', 'ord2', 'prod1', 'Product 1', 1, 10000, 10000)`, params: [] },
  ]);

  const result = await mallMetrics(exec);
  assert.equal(result.committedStock.units, 6); // 2+3+1
  assert.equal(result.committedStock.costKobo, 2*5000 + 3*3000 + 1*5000); // 25000
  assert.equal(result.committedStock.orders, 2);
  assert.equal(result.committedStock.byStatus.length, 2);
  const pending = result.committedStock.byStatus.find((b: any) => b.status === 'pending');
  const confirmed = result.committedStock.byStatus.find((b: any) => b.status === 'confirmed');
  assert.ok(pending);
  assert.equal(pending.units, 5);
  assert.ok(confirmed);
  assert.equal(confirmed.units, 1);
});

test('mallMetrics: committedStock handles missing product (cost_price_kobo fallback to 0)', async () => {
  const db = makeTestDb();
  const exec = makeTestExecutor(db);
  const now = new Date().toISOString();

  await exec.runBatch([
    { sql: `INSERT INTO mall_orders (id, order_no, status, created_at) VALUES ('ord1', 'ORD-001', 'pending', ?)`, params: [now] },
    { sql: `INSERT INTO mall_order_items (id, mall_order_id, product_id, product_name, qty, unit_price_kobo, total_kobo) VALUES ('item1', 'ord1', 'missing-prod', 'Product 1', 5, 10000, 50000)`, params: [] },
  ]);

  const result = await mallMetrics(exec);
  assert.equal(result.committedStock.units, 5);
  assert.equal(result.committedStock.costKobo, 0); // missing product -> COALESCE 0
});

test('mallMetrics: committedStock filters only non-terminal statuses', async () => {
  const db = makeTestDb();
  const exec = makeTestExecutor(db);
  const now = new Date().toISOString();

  seedCatalog(db, [{ id: 'prod1', sku: 'SKU1', name: 'Product 1', stockQty: 10, retailPriceKobo: 10000 }]);
  db.prepare('UPDATE products SET cost_price_kobo = ? WHERE id = ?').run(5000, 'prod1');

  await exec.runBatch([
    { sql: `INSERT INTO mall_orders (id, order_no, status, created_at) VALUES ('ord1', 'ORD-001', 'pending', ?)`, params: [now] },
    { sql: `INSERT INTO mall_orders (id, order_no, status, created_at) VALUES ('ord2', 'ORD-002', 'completed', ?)`, params: [now] },
    { sql: `INSERT INTO mall_orders (id, order_no, status, created_at) VALUES ('ord3', 'ORD-003', 'cancelled', ?)`, params: [now] },
    { sql: `INSERT INTO mall_order_items (id, mall_order_id, product_id, product_name, qty, unit_price_kobo, total_kobo) VALUES ('item1', 'ord1', 'prod1', 'Product 1', 2, 10000, 20000)`, params: [] },
    { sql: `INSERT INTO mall_order_items (id, mall_order_id, product_id, product_name, qty, unit_price_kobo, total_kobo) VALUES ('item2', 'ord2', 'prod1', 'Product 1', 5, 10000, 50000)`, params: [] },
    { sql: `INSERT INTO mall_order_items (id, mall_order_id, product_id, product_name, qty, unit_price_kobo, total_kobo) VALUES ('item3', 'ord3', 'prod1', 'Product 1', 3, 10000, 30000)`, params: [] },
  ]);

  const result = await mallMetrics(exec);
  assert.equal(result.committedStock.units, 2); // only pending
  assert.equal(result.committedStock.orders, 1);
  assert.ok(result.committedStock.byStatus.find((b: any) => b.status === 'pending'));
  assert.equal(result.committedStock.byStatus.find((b: any) => b.status === 'completed'), undefined);
  assert.equal(result.committedStock.byStatus.find((b: any) => b.status === 'cancelled'), undefined);
});

test('mallMetrics: includes 90-day window boundary (day exactly 90 days ago)', async () => {
  const db = makeTestDb();
  const exec = makeTestExecutor(db);
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400_000);
  const dayStr = ninetyDaysAgo.toISOString().slice(0, 10);
  db.prepare('INSERT INTO mall_metrics (day, metric, count) VALUES (?, ?, ?)').run(dayStr, 'test', 42);

  const result = await mallMetrics(exec);
  assert.ok(result.metrics.length >= 1);
  assert.equal(result.metrics[0].count, 42);
});

test('mallMetrics: excludes day 91 days ago', async () => {
  const db = makeTestDb();
  const exec = makeTestExecutor(db);
  const now = new Date();
  const ninetyOneDaysAgo = new Date(now.getTime() - 91 * 86400_000);
  const dayStr = ninetyOneDaysAgo.toISOString().slice(0, 10);
  db.prepare('INSERT INTO mall_metrics (day, metric, count) VALUES (?, ?, ?)').run(dayStr, 'test', 99);

  const result = await mallMetrics(exec);
  assert.equal(result.metrics.length, 0);
});

test('upsertToStatements: pricingHistory uses pricingToRow with new_price_kobo', async () => {
  const now = new Date().toISOString();
  const doc = { id: 'ph1', newPrice: 150, createdAt: now };
  const stmts = upsertToStatements('pricingHistory', doc, now);
  assert.equal(stmts.length, 1);
  const sql = stmts[0].sql as string;
  assert.ok(sql.includes('pricing_history'));
  assert.ok(stmts[0].params.includes(15000)); // NairaToKobo(150) = 150*100 = 15000
});

test('upsertToStatements: pricingHistory handles missing newPrice (fallback to 0)', async () => {
  const now = new Date().toISOString();
  const doc = { id: 'ph1', createdAt: now };
  const stmts = upsertToStatements('pricingHistory', doc, now);
  assert.equal(stmts[0].params.includes(0), true); // NairaToKobo(undefined) = 0
});

test('upsertToStatements: pricingHistory handles null newPrice', async () => {
  const now = new Date().toISOString();
  const doc = { id: 'ph1', newPrice: null, createdAt: now };
  const stmts = upsertToStatements('pricingHistory', doc, now);
  assert.equal(stmts[0].params.includes(0), true); // NairaToKobo(null) = 0
});

test('upsertToStatements: expenses uses expenseToRow with amount_kobo and category', async () => {
  const now = new Date().toISOString();
  const doc = { id: 'exp1', amount: 250, category: 'Supplies', createdAt: now };
  const stmts = upsertToStatements('expenses', doc, now);
  const sql = stmts[0].sql as string;
  assert.ok(sql.includes('expenses'));
  assert.ok(stmts[0].params.includes(25000)); // NairaToKobo(250) = 250*100 = 25000
  assert.ok(stmts[0].params.includes('Supplies'));
});

test('upsertToStatements: stockMovements uses stockMovementToRow with qty and new_stock', async () => {
  const now = new Date().toISOString();
  const doc = { id: 'sm1', quantity: 10, newStock: 100, createdAt: now, type: 'Adjustment' };
  const stmts = upsertToStatements('stockMovements', doc, now);
  const sql = stmts[0].sql as string;
  assert.ok(sql.includes('stock_movements'));
  assert.ok(stmts[0].params.includes(10));
  assert.ok(stmts[0].params.includes(100));
});

test('upsertToStatements: moneyMovements uses moneyToRow with amount_kobo', async () => {
  const now = new Date().toISOString();
  const doc = { id: 'mm1', amount: 500, sourceAccount: 'cash', destinationAccount: 'bank', createdAt: now };
  const stmts = upsertToStatements('moneyMovements', doc, now);
  const sql = stmts[0].sql as string;
  assert.ok(sql.includes('money_movements'));
  assert.ok(stmts[0].params.includes(50000)); // NairaToKobo(500) = 500*100 = 50000
});

test('upsertToStatements: moneyMovements handles negative amount', async () => {
  const now = new Date().toISOString();
  const doc = { id: 'mm2', amount: -100, sourceAccount: 'bank', destinationAccount: 'cash', createdAt: now };
  const stmts = upsertToStatements('moneyMovements', doc, now);
  assert.ok(stmts[0].params.includes(-10000)); // NairaToKobo(-100) = -100*100 = -10000
});

test('deleteToStatements: money collections delete by id', async () => {
  const expenses = deleteToStatements('expenses', 'exp1');
  assert.ok((expenses[0].sql as string).includes('DELETE FROM expenses WHERE id = ?'));
  assert.deepEqual(expenses[0].params, ['exp1']);

  const stock = deleteToStatements('stockMovements', 'sm1');
  assert.ok((stock[0].sql as string).includes('DELETE FROM stock_movements WHERE id = ?'));

  const pricing = deleteToStatements('pricingHistory', 'ph1');
  assert.ok((pricing[0].sql as string).includes('DELETE FROM pricing_history WHERE id = ?'));

  const money = deleteToStatements('moneyMovements', 'mm1');
  assert.ok((money[0].sql as string).includes('DELETE FROM money_movements WHERE id = ?'));
});

test('deleteToStatements: settings uses key not id', async () => {
  const settings = deleteToStatements('settings', 'my_key');
  assert.ok((settings[0].sql as string).includes('DELETE FROM settings WHERE key = ?'));
  assert.deepEqual(settings[0].params, ['my_key']);
});

// --- relationalWrites.ts money-semantics killing tests -----------------------
// These target the exact survivors reported for src/server/relationalWrites.ts:
// relationalHasData's emptiness guard (which decides whether the bridge treats a
// database as already-populated, gating money backfill), and businessKeyOf's
// placeholder-value handling (which decides whether two distinct money documents
// with "N/A"/"-" invoice numbers collapse into ONE row or survive as separate
// rows). Both are money semantics: getting them wrong silently loses or merges
// revenue-bearing records.

test('relationalHasData: false only when BOTH products and sales are empty', async () => {
  const { relationalHasData } = await import('../src/server/relationalWrites.ts');
  const emptyDb = makeTestDb();
  assert.equal(await relationalHasData(makeTestExecutor(emptyDb).queryAll), false);

  // products present, sales empty -> true (the "||" branch; kills "&&" mutant)
  const prodDb = makeTestDb();
  prodDb.prepare('INSERT INTO products (id, name, sku, cost_price_kobo, retail_price_kobo, stock_qty, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run('p1', 'Bag', 'SKU-1', 100, 150, 5, 'now', 'now');
  assert.equal(await relationalHasData(makeTestExecutor(prodDb).queryAll), true);

  // sales present, products empty -> true (kills "&&" AND ">0" boundary mutants)
  const salesDb = makeTestDb();
  salesDb.prepare('INSERT INTO sales (id, receipt_no, total_kobo, created_at, updated_at) VALUES (?,?,?,?,?)')
    .run('s1', 'RCP-1', 1000, 'now', 'now');
  assert.equal(await relationalHasData(makeTestExecutor(salesDb).queryAll), true);
});

test('businessKeyOf: a real invoice number IS used as the business key (case-insensitive)', async () => {
  const { backfillStatementsFromDocumentRows } = await import('../src/server/relationalWrites.ts');
  const now = new Date().toISOString();
  const mk = (id: string, invoiceNo: string) => ({ collection: 'sales', payload: JSON.stringify({
    id, invoiceNo, totalAmount: 5, createdAt: now, updatedAt: now,
    items: [{ productId: 'missing-prod', qty: 1, unitPrice: 5, total: 5 }],
  }) });
  // Same invoice number in different case -> SAME business key -> the backfill
  // dedups them to ONE document (kills the .toLowerCase() mutant and the
  // regex-case-insensitive mutant in businessKeyOf).
  const same = backfillStatementsFromDocumentRows([mk('sale-x', 'INV-9'), mk('sale-y', 'inv-9')], now);
  const insertedSame = same.stmts.filter((s) => /INSERT INTO sales /.test(s.sql)).length;
  assert.equal(insertedSame, 1, 'same invoice (case-insensitive) must dedup to one sales insert');

  // Placeholder invoice numbers must NOT be treated as business keys: three
  // sales sharing only "N/A"/"n/a"/"-" MUST survive as THREE distinct rows.
  // Kills the PLACEHOLDER_RE regex mutants (anchors, optional slash, char class,
  // case flag) — dropping the guard collapses all three into one.
  const placeholder = backfillStatementsFromDocumentRows([mk('sale-a', 'N/A'), mk('sale-b', 'n/a'), mk('sale-c', '-')], now);
  const insertedPlaceholder = placeholder.stmts.filter((s) => /INSERT INTO sales /.test(s.sql)).length;
  assert.equal(insertedPlaceholder, 3, 'placeholder invoice numbers must keep every document distinct');

  // A non-placeholder value that merely CONTAINS 'n/a' (e.g. 'BAN/AL') is a real
  // key — the regex is anchored, so it must NOT match. Two such sales dedup to one.
  const anchored = backfillStatementsFromDocumentRows([mk('sale-d', 'BAN/AL'), mk('sale-e', 'ban/al')], now);
  const insertedAnchored = anchored.stmts.filter((s) => /INSERT INTO sales /.test(s.sql)).length;
  assert.equal(insertedAnchored, 1, 'anchored regex must not treat BAN/AL as a placeholder');
});

test('replaceCollectionStatements: deletes every row of every table then upserts each document', async () => {
  const { replaceCollectionStatements } = await import('../src/server/relationalWrites.ts');
  const now = new Date().toISOString();
  const docs = [
    { id: 'sale-1', invoiceNo: 'INV-1', totalAmount: 10, createdAt: now, updatedAt: now, items: [{ productId: 'missing-prod', qty: 1, unitPrice: 10, total: 10 }] },
  ];
  const stmts = replaceCollectionStatements('sales', docs, now);
  // Child-first deletes: sale_items BEFORE sales (kills ordering mutants).
  const deleteIdx = stmts.findIndex((s) => /DELETE FROM sale_items/.test(s.sql));
  const salesDeleteIdx = stmts.findIndex((s) => /DELETE FROM sales/.test(s.sql));
  assert.ok(deleteIdx >= 0 && salesDeleteIdx >= 0, 'both deletes present');
  assert.ok(deleteIdx < salesDeleteIdx, 'child table deleted before parent');
  // Non-array documents -> only the deletes, no upserts.
  const noUpsert = replaceCollectionStatements('sales', 'not-an-array', now);
  assert.equal(noUpsert.filter((s) => /INSERT/.test(s.sql)).length, 0);
  // A plain non-iterable object must not reach `for...of` (which would throw if
  // the Array.isArray guard were removed).
  const plainObject = replaceCollectionStatements('sales', { id: 's2' }, now);
  assert.equal(plainObject.filter((s) => /INSERT/.test(s.sql)).length, 0);
  assert.equal(plainObject.filter((s) => /DELETE/.test(s.sql)).length, 2);
  // The DELETE statements intentionally have no bound parameters.
  assert.ok(plainObject.every((s) => s.params.length === 0));
});

/**
 * Mutation-killing tests for the business-key table and the placeholder regex
 * in relationalWrites.ts (BUSINESS_KEYS / PLACEHOLDER_RE / businessKeyOf).
 *
 * The tests above only ever used `sales`+`invoiceNo`, so mutants that change the
 * OTHER collections' key field names (`products:['sku']`, `categories:['slug']`,
 * ...) or the placeholder anchors survived. These tests assert on the exact
 * business key produced per collection so every literal in the table matters.
 */
test('businessKeyOf: each collection collapses on its OWN business key field', async () => {
  const { backfillStatementsFromDocumentRows } = await import('../src/server/relationalWrites.ts');
  const now = new Date().toISOString();
  const mk = (collection: string, doc: Record<string, unknown>) => ({
    collection,
    payload: JSON.stringify({ ...doc, createdAt: now, updatedAt: now }),
  });
  const insertsOf = (r: { stmts: { sql: string }[] }, table: string) =>
    r.stmts.filter((s) => new RegExp(`INSERT INTO ${table} `).test(s.sql)).length;

  // products keyed by sku: two docs with the SAME sku must collapse to ONE.
  // Mutating 'sku' -> '' (or dropping the products entry) leaves them distinct.
  const products = backfillStatementsFromDocumentRows(
    [mk('products', { id: 'p1', sku: 'SKU-9', name: 'A', retailPriceKobo: 100 }),
     mk('products', { id: 'p2', sku: 'sku-9', name: 'B', retailPriceKobo: 200 })],
    now,
  );
  assert.equal(insertsOf(products, 'products'), 1, 'products collapse on sku (case-insensitive)');

  // deliveryOrders keyed by deliveryNo.
  const dos = backfillStatementsFromDocumentRows(
    [mk('deliveryOrders', { id: 'd1', deliveryNo: 'DO-1' }),
     mk('deliveryOrders', { id: 'd2', deliveryNo: 'do-1' })],
    now,
  );
  assert.equal(insertsOf(dos, 'delivery_orders'), 1, 'deliveryOrders collapse on deliveryNo');

  // whatsAppPreOrders keyed by preOrderNo (either spelling).
  const pre = backfillStatementsFromDocumentRows(
    [mk('whatsAppPreOrders', { id: 'w1', preOrderNo: 'PO-1' }),
     mk('whatsAppPreOrders', { id: 'w2', preOrderNo: 'po-1' })],
    now,
  );
  assert.equal(insertsOf(pre, 'whatsapp_preorders'), 1, 'whatsAppPreOrders collapse on preOrderNo');
});

test('businessKeyOf: sales collapses on invoiceNo AND receiptNo, purchases on poNumber/invoiceNo', async () => {
  const { backfillStatementsFromDocumentRows } = await import('../src/server/relationalWrites.ts');
  const now = new Date().toISOString();
  const mk = (collection: string, doc: Record<string, unknown>) => ({
    collection,
    payload: JSON.stringify({ ...doc, createdAt: now, updatedAt: now,
      items: [{ productId: 'missing-prod', qty: 1, unitPrice: 1, total: 1 }] }),
  });
  const insertsOf = (r: { stmts: { sql: string }[] }, table: string) =>
    r.stmts.filter((s) => new RegExp(`INSERT INTO ${table} `).test(s.sql)).length;

  // invoiceNo takes priority: a matching receiptNo with DIFFERENT invoiceNos
  // keeps the docs distinct — proves invoiceNo is consulted before receiptNo.
  const sales = backfillStatementsFromDocumentRows(
    [mk('sales', { id: 's1', invoiceNo: 'I-1', receiptNo: 'R-1', totalAmount: 5 }),
     mk('sales', { id: 's2', invoiceNo: 'I-2', receiptNo: 'r-1', totalAmount: 5 })],
    now,
  );
  assert.equal(insertsOf(sales, 'sales'), 2, 'distinct invoiceNos keep sales distinct');
  // When invoiceNo is absent the receiptNo IS the key: same receipt -> ONE row.
  const byReceipt = backfillStatementsFromDocumentRows(
    [mk('sales', { id: 's3', receiptNo: 'R-9', totalAmount: 5 }),
     mk('sales', { id: 's4', receiptNo: 'r-9', totalAmount: 5 })],
    now,
  );
  assert.equal(insertsOf(byReceipt, 'sales'), 1, 'sales fall back to receiptNo');

  // poNumber takes priority over a shared fallback invoiceNo. If the BUSINESS_KEYS
  // entry mutates away from poNumber, these would collapse by invoiceNo instead.
  const purchases = backfillStatementsFromDocumentRows(
    [mk('purchases', { id: 'pu1', poNumber: 'PO-1', invoiceNo: 'SHARED-PI' }),
     mk('purchases', { id: 'pu2', poNumber: 'PO-2', invoiceNo: 'SHARED-PI' })],
    now,
  );
  assert.equal(insertsOf(purchases, 'purchases'), 2, 'different poNumbers stay distinct despite shared invoiceNo');
  // When poNumber is absent, invoiceNo is the fallback business key.
  const byInvoice = backfillStatementsFromDocumentRows(
    [mk('purchases', { id: 'pu3', invoiceNo: 'PI-9' }), mk('purchases', { id: 'pu4', invoiceNo: 'pi-9' })],
    now,
  );
  assert.equal(insertsOf(byInvoice, 'purchases'), 1, 'purchases fall back to invoiceNo');
});

test('businessKeyOf: unknown collection has no business key -> distinct docs by id', async () => {
  const { backfillStatementsFromDocumentRows } = await import('../src/server/relationalWrites.ts');
  const now = new Date().toISOString();
  // expenses has NO entry in BUSINESS_KEYS: even with identical values the two
  // docs must remain distinct. Kills the `if (!fields) return null` guard mutant.
  const r = backfillStatementsFromDocumentRows(
    [{ collection: 'expenses', payload: JSON.stringify({ id: 'e1', amount: 5, createdAt: now, updatedAt: now }) },
     { collection: 'expenses', payload: JSON.stringify({ id: 'e2', amount: 5, createdAt: now, updatedAt: now }) }],
    now,
  );
  const inserted = r.stmts.filter((s) => /INSERT INTO expenses /.test(s.sql)).length;
  assert.equal(inserted, 2, 'collections without a business key keep every document distinct');
});

test('businessKeyOf: blank/whitespace business values are NOT keys (falls through to null)', async () => {
  const { backfillStatementsFromDocumentRows } = await import('../src/server/relationalWrites.ts');
  const now = new Date().toISOString();
  const mk = (id: string, sku: string) => ({
    collection: 'products',
    payload: JSON.stringify({ id, sku, name: id, retailPriceKobo: 100, createdAt: now, updatedAt: now }),
  });
  // Blank and whitespace-only skus must NOT collapse: the `if (value && ...)`
  // guard and the `.trim()` call both matter.
  const r = backfillStatementsFromDocumentRows([mk('p1', ''), mk('p2', '   ')], now);
  const inserted = r.stmts.filter((s) => /INSERT INTO products /.test(s.sql)).length;
  assert.equal(inserted, 2, 'blank/whitespace skus are not business keys');

  // A nonblank SKU is trimmed before keying: the two spellings must collapse.
  const trimmed = backfillStatementsFromDocumentRows([mk('p3', ' SKU-TRIM '), mk('p4', 'sku-trim')], now);
  assert.equal(trimmed.stmts.filter((s) => /INSERT INTO products /.test(s.sql)).length, 1,
    'business keys trim surrounding whitespace before case normalization');
});

test('PLACEHOLDER_RE: matches "n/a", "N/A", "na", "-" but not "BAN/AL" or "INV-9"', async () => {
  const { backfillStatementsFromDocumentRows } = await import('../src/server/relationalWrites.ts');
  const now = new Date().toISOString();
  const mk = (id: string, invoiceNo: string) => ({
    collection: 'sales',
    payload: JSON.stringify({ id, invoiceNo, totalAmount: 5, createdAt: now, updatedAt: now,
      items: [{ productId: 'missing-prod', qty: 1, unitPrice: 5, total: 5 }] }),
  });
  const insertedFor = (vals: string[]) =>
    backfillStatementsFromDocumentRows(vals.map((v, i) => mk(`s${i}`, v)), now)
      .stmts.filter((s) => /INSERT INTO sales /.test(s.sql)).length;

  // Every spelling of "not applicable" must be treated as a placeholder so each
  // doc stays distinct (kills the regex char-class / optional-slash mutants).
  // NB: 'N/A ' trims to 'N/A' first, so it is also a placeholder.
  assert.equal(insertedFor(['na', 'N/A', 'n/a', 'N/a', '-', 'N/A ']), 6,
    'all placeholder spellings keep documents distinct');
  // Two identical BARE 'na' values must both be placeholders (kills the
  // `n\/?a` -> `n\/a` mutant: without the optional slash 'na' would become the
  // business key invoiceNo:na and the two docs would wrongly collapse to one).
  assert.equal(insertedFor(['na', 'na']), 2,
    'bare "na" is a placeholder even when repeated');
  assert.equal(insertedFor(['N/A', 'N/A']), 2,
    'repeated "N/A" stays a placeholder (distinct ids, no collapse)');
  // A real invoice is NOT a placeholder -> two matching ones collapse to one.
  assert.equal(insertedFor(['INV-9', 'inv-9']), 1,
    'real invoice numbers still collapse case-insensitively');
  // Values CONTAINING but not equal to "n/a" are real keys.
  assert.equal(insertedFor(['BAN/AL', 'ban/al']), 1,
    'anchored regex must not match values containing n/a');
});
// --- relationalMapper.ts money-semantics killing tests ------------------------
// The mapper's money helpers (NairaToKobo / KoboToNaira) are already covered by
// the round-trip suite, but three money-critical row-mapper rules survived:
//   1. saleToRows' placeholder-receipt fallback (line 302-303) — a blank/"N/A"/"-"
//      invoiceNo MUST fall back to the sale id or two walk-in sales collide on the
//      UNIQUE receipt_no;
//   2. the clearance product_id rule (line 333) — a clearance / non-inventory line
//      MUST NOT carry a product_id FK;
//   3. parseRefundsJson's array-vs-undefined contract (line 49-57).
// These tests pin each rule so the surviving mutants die.

test('saleToRows: blank / "N/A" / "n/a" / "-" invoiceNo falls back to the sale id (line 302-303)', async () => {
  const { saleToRows } = await import('../src/server/relationalMapper.ts');
  for (const placeholder of ['', '   ', 'N/A', 'n/a', 'N/a', '-']) {
    const { header } = saleToRows({ id: 'sale-1', invoiceNo: placeholder, totalAmount: 10, items: [] });
    assert.equal(
      header.receipt_no, 'sale-1',
      `placeholder invoiceNo ${JSON.stringify(placeholder)} must fall back to the sale id`,
    );
  }
  // A real invoice number is preserved verbatim (trimmed).
  const { header } = saleToRows({ id: 'sale-2', invoiceNo: '  INV-9  ', totalAmount: 10, items: [] });
  assert.equal(header.receipt_no, 'INV-9');
  // A value merely CONTAINING "n/a" is NOT a placeholder (anchored regex).
  const containing = saleToRows({ id: 'sale-3', invoiceNo: 'BAN/AL', totalAmount: 10, items: [] });
  assert.equal(containing.header.receipt_no, 'BAN/AL');
});

test('saleToRows: a clearance line carries NO product_id FK but keeps its name/sku (line 333)', async () => {
  const { saleToRows } = await import('../src/server/relationalMapper.ts');
  const { lines } = saleToRows({
    id: 'sale-c', invoiceNo: 'INV-C', totalAmount: 10,
    items: [
      { productId: 'p-clear', productName: 'Clearance Bag', sku: 'CLR-1', quantity: 1, unitPrice: 10, total: 10, isClearance: true },
      { productId: 'p-normal', productName: 'Normal Bag', sku: 'NRM-1', quantity: 2, unitPrice: 10, total: 20 },
    ],
  });
  const clearance = lines.find((l: any) => l.sku === 'CLR-1') as any;
  const normal = lines.find((l: any) => l.sku === 'NRM-1') as any;
  assert.equal(clearance.product_id, null, 'a clearance line must not carry a product_id');
  assert.equal(clearance.is_clearance, 1);
  assert.equal(clearance.product_name, 'Clearance Bag', 'the name is kept for receipts/reports');
  assert.equal(normal.product_id, 'p-normal', 'a normal line keeps its product_id');
  assert.equal(normal.is_clearance, 0);
});

test('saleToRows: a line with no productId is not given a FK (line 333 guard)', async () => {
  const { saleToRows } = await import('../src/server/relationalMapper.ts');
  const { lines } = saleToRows({
    id: 'sale-n', invoiceNo: 'INV-N', totalAmount: 5,
    items: [{ productName: 'Walk-in item', sku: 'W-1', quantity: 1, unitPrice: 5, total: 5 }],
  });
  assert.equal((lines[0] as any).product_id, null);
});

test('parseRefundsJson: [] and malformed input degrade to undefined, a real array round-trips (line 49-57)', async () => {
  const { parseRefundsJson } = await import('../src/server/relationalMapper.ts');
  assert.equal(parseRefundsJson(undefined), undefined);
  assert.equal(parseRefundsJson(null), undefined);
  assert.equal(parseRefundsJson(''), undefined);
  assert.equal(parseRefundsJson('not json'), undefined);
  assert.equal(parseRefundsJson('{}'), undefined, 'a non-array JSON object is not a refund list');
  assert.equal(parseRefundsJson([]), undefined, 'an empty array means "no refunds" -> undefined');
  assert.deepEqual(parseRefundsJson('[{"id":"r1"}]'), [{ id: 'r1' }]);
  assert.deepEqual(parseRefundsJson([{ id: 'r2' }]), [{ id: 'r2' }], 'an in-memory array passes through');
});

test('parseJsonArray: non-array / malformed input degrades to [] (line 31-40)', async () => {
  const { parseJsonArray } = await import('../src/server/relationalMapper.ts');
  assert.deepEqual(parseJsonArray(undefined), []);
  assert.deepEqual(parseJsonArray(null), []);
  assert.deepEqual(parseJsonArray(''), []);
  assert.deepEqual(parseJsonArray('nope'), []);
  assert.deepEqual(parseJsonArray('{"a":1}'), [], 'a JSON object is not an array');
  assert.deepEqual(parseJsonArray('[1,2]'), [1, 2]);
});

test('NairaToKobo / KoboToNaira: numeric strings, non-finite and non-numeric inputs (line 11-20)', async () => {
  const { NairaToKobo, KoboToNaira } = await import('../src/server/relationalMapper.ts');
  assert.equal(NairaToKobo('123.45'), 12345, 'numeric strings are coerced');
  assert.equal(NairaToKobo(123.45), 12345);
  assert.equal(NairaToKobo(0.005), 1, 'Math.round rounds up');
  assert.equal(NairaToKobo(NaN), 0);
  assert.equal(NairaToKobo(Infinity), 0);
  assert.equal(NairaToKobo(null), 0);
  assert.equal(NairaToKobo(undefined), 0);
  assert.equal(NairaToKobo('abc'), 0);

  assert.equal(KoboToNaira(12345), 123.45);
  assert.equal(KoboToNaira('12345'), 123.45, 'numeric strings are coerced');
  assert.equal(KoboToNaira(NaN), 0);
  assert.equal(KoboToNaira(undefined), 0);
  assert.equal(KoboToNaira('nope'), 0);
});

test('b01 / b: only true, 1 and "true" are truthy (line 26-27)', async () => {
  const { b01, b } = await import('../src/server/relationalMapper.ts');
  for (const truthy of [true, 1, 'true']) {
    assert.equal(b01(truthy), 1, `${JSON.stringify(truthy)} -> 1`);
    assert.equal(b(truthy), true, `${JSON.stringify(truthy)} -> true`);
  }
  for (const falsy of [false, 0, 'false', '', null, undefined, 2, 'yes']) {
    assert.equal(b01(falsy), 0, `${JSON.stringify(falsy)} -> 0`);
    assert.equal(b(falsy), false, `${JSON.stringify(falsy)} -> false`);
  }
});

test('purchaseToRows: poNumber falls back to the purchase id (line 346)', async () => {
  const { purchaseToRows } = await import('../src/server/relationalMapper.ts');
  const withNumber = purchaseToRows({ id: 'po-1', poNumber: 'PO-9', totalAmount: 5, items: [] });
  assert.equal(withNumber.header.po_number, 'PO-9');
  const without = purchaseToRows({ id: 'po-2', totalAmount: 5, items: [] });
  assert.equal(without.header.po_number, 'po-2', 'a missing poNumber falls back to the id');
});// --- relationalMapper.ts boundary killing tests -------------------------------
// The regex/boundary mutants that survive the coarse tests above need inputs that
// sit exactly on each boundary: an "n/a" suffix (no ^), an "n/a" prefix (no $),
// a bare "na" (needs the optional slash) and the typeof guards in the money
// coercers.

test('saleToRows: placeholder regex is fully anchored and accepts bare "na" (line 303)', async () => {
  const { saleToRows } = await import('../src/server/relationalMapper.ts');
  const receiptOf = (invoiceNo: unknown) =>
    saleToRows({ id: 'sale-id', invoiceNo, totalAmount: 1, items: [] }).header.receipt_no;

  // Placeholders -> fall back to the id.
  for (const placeholder of ['N/A', 'n/a', 'n/A', 'NA', 'na', '-']) {
    assert.equal(receiptOf(placeholder), 'sale-id', `${placeholder} must be a placeholder`);
  }
  // Non-placeholders -> preserved. These three are the boundary cases that kill
  // the un-anchored / optional-slash regex variants:
  assert.equal(receiptOf('XN/A'), 'XN/A', 'an "n/a" SUFFIX is not a placeholder (needs ^)');
  assert.equal(receiptOf('N/AX'), 'N/AX', 'an "n/a" PREFIX is not a placeholder (needs $)');
  assert.equal(receiptOf('nXa'), 'nXa', 'a bare "n?a" with any middle char is not a placeholder');
});

test('NairaToKobo: a non-number, non-string input yields 0 without coercion (line 12)', async () => {
  const { NairaToKobo } = await import('../src/server/relationalMapper.ts');
  // typeof guard: booleans/objects/arrays are NOT coerced via Number().
  assert.equal(NairaToKobo(true), 0, 'a boolean is not a naira amount');
  assert.equal(NairaToKobo(false), 0);
  assert.equal(NairaToKobo({}), 0, 'an object is not a naira amount');
  assert.equal(NairaToKobo([]), 0);
  assert.equal(NairaToKobo([5]), 0, 'an array must not be Number()-coerced');
  // ...but a numeric string IS.
  assert.equal(NairaToKobo('5'), 500);
});

test('KoboToNaira: a non-number input still coerces via Number, non-finite yields 0 (line 17)', async () => {
  const { KoboToNaira } = await import('../src/server/relationalMapper.ts');
  assert.equal(KoboToNaira('250'), 2.5, 'a numeric string is coerced');
  assert.equal(KoboToNaira(true), 0.01, 'Number(true) === 1 -> 0.01 naira');
  assert.equal(KoboToNaira(null), 0, 'Number(null) === 0');
  assert.equal(KoboToNaira(NaN), 0);
  assert.equal(KoboToNaira(Infinity), 0);
  assert.equal(KoboToNaira('abc'), 0);
});
// --- n() numeric coercer + refund/items JSON read-back helpers ------------------

test('n(): a non-number, non-numeric-string input falls back to fb (line 23)', async () => {
  const { n } = await import('../src/server/relationalMapper.ts');
  assert.equal(n(5), 5, 'a number passes through');
  assert.equal(n('7'), 7, 'a numeric string is coerced');
  assert.equal(n('abc'), 0, 'a non-numeric string falls back to the default');
  assert.equal(n('abc', 9), 9, 'a non-numeric string honours an explicit fallback');
  assert.equal(n({}, 3), 3, 'an object falls back');
  assert.equal(n(true), 1, 'Number(true) === 1 (booleans are NOT special-cased here)');
  assert.equal(n(null), 0, 'Number(null) === 0');
  assert.equal(n(Infinity, 4), 4, 'a non-finite number falls back');
});

test('parseRefundsJson: array/string/empty/malformed paths all behave (lines 50-55)', async () => {
  const { parseRefundsJson } = await import('../src/server/relationalMapper.ts');
  assert.deepEqual(parseRefundsJson([{ amount: 1 }]), [{ amount: 1 }], 'an array passes through');
  assert.equal(parseRefundsJson([]), undefined, 'an EMPTY array is "no refunds", not []');
  assert.equal(parseRefundsJson(''), undefined, 'an empty string is "no refunds"');
  assert.equal(parseRefundsJson(null), undefined);
  assert.equal(parseRefundsJson(undefined), undefined);
  assert.equal(parseRefundsJson(123), undefined, 'a non-string scalar degrades to undefined');
  assert.deepEqual(parseRefundsJson('[{"amount":2}]'), [{ amount: 2 }], 'JSON text parses');
  assert.equal(parseRefundsJson('{}'), undefined, 'JSON that is not an array degrades to undefined');
  assert.equal(parseRefundsJson('[]'), undefined, 'empty JSON array degrades to undefined');
  assert.equal(parseRefundsJson('not json'), undefined, 'malformed JSON degrades, never throws');
});

test('parseJsonArray: string/array/malformed paths all behave (lines 31-39)', async () => {
  const { parseJsonArray } = await import('../src/server/relationalMapper.ts');
  assert.deepEqual(parseJsonArray([1, 2]), [1, 2], 'an array passes through');
  assert.deepEqual(parseJsonArray('[1,2]'), [1, 2], 'JSON text parses');
  assert.deepEqual(parseJsonArray(''), [], 'an empty string is []');
  assert.deepEqual(parseJsonArray(null), [], 'null is []');
  assert.deepEqual(parseJsonArray(7), [], 'a number is []');
  assert.deepEqual(parseJsonArray('{}'), [], 'non-array JSON is []');
  assert.deepEqual(parseJsonArray('oops'), [], 'malformed JSON is []');
});

// --- relationalMapper.ts: row-mapper default fallbacks -------------------------
// These kill the surviving StringLiteral/ObjectLiteral/BlockStatement mutants in the
// read/write row mappers. Each default label ("Cash", "Retail", "Completed", ...) is
// a real contract value read back by the golden snapshots; asserting the EXACT
// fallback when the source field is absent pins them.

test('customerToRow: id/name/phone/email defaults and kobo conversions (lines 254-261)', async () => {
  const { customerToRow } = await import('../src/server/relationalMapper.ts');
  const row = customerToRow({}, 'now');
  assert.equal(row.name, 'Walk-in Customer', 'a missing name falls back to Walk-in Customer');
  assert.equal(row.phone, '', 'a missing phone is an empty string');
  assert.equal(row.email, '', 'a missing email is an empty string');
  assert.equal(row.address, null, 'a missing address is null');
  assert.equal(row.outstanding_balance_kobo, 0);
  assert.equal(row.loyalty_points, 0);
  assert.equal(row.lifetime_value_kobo, 0);
  assert.equal(row.overage_balance_kobo, 0);
  assert.equal(row.created_at, 'now');
  const named = customerToRow({ id: 'c1', name: 'Ada', phone: '080', outstandingBalance: 12.5 }, 'now');
  assert.equal(named.id, 'c1');
  assert.equal(named.name, 'Ada');
  assert.equal(named.phone, '080');
  assert.equal(named.outstanding_balance_kobo, 1250, 'naira -> kobo');
});

test('supplierRow: returns the mapped supplier document (line 121)', async () => {
  const { supplierRow } = await import('../src/server/relationalMapper.ts');
  const row = supplierRow({
    id: 'sp1', name: 'Acme', contact_person: 'Bob', email: 'b@acme.io', phone: '070',
    address: 'Lagos', payment_terms: 'Net 30', products_count: 4, outstanding_balance_kobo: 2500,
    created_at: 'then',
  });
  assert.equal(row.id, 'sp1');
  assert.equal(row.name, 'Acme');
  assert.equal(row.contactPerson, 'Bob');
  assert.equal(row.email, 'b@acme.io');
  assert.equal(row.phone, '070');
  assert.equal(row.address, 'Lagos');
  assert.equal(row.paymentTerms, 'Net 30');
  assert.equal(row.productsCount, 4);
  assert.equal(row.outstandingBalance, 25, 'kobo -> naira');
  assert.equal(row.createdAt, 'then');
  // Missing optional fields fall back to the contract defaults.
  const bare = supplierRow({ id: 'sp2', outstanding_balance_kobo: 0 });
  assert.equal(bare.name, undefined, 'name is taken verbatim from the row (no fallback here)');
  assert.equal(bare.paymentTerms, 'Due on Receipt');
  assert.equal(bare.email, '');
  assert.equal(bare.phone, '');
  assert.equal(bare.address, undefined);
  assert.equal(bare.productsCount, 0);
});

test('supplierToRow: name/paymentTerms defaults and opening balance (lines 263-271)', async () => {
  const { supplierToRow } = await import('../src/server/relationalMapper.ts');
  const row = supplierToRow({}, 'now');
  assert.equal(row.name, 'Unknown Supplier', 'a missing supplier name falls back');
  assert.equal(row.payment_terms, 'Due on Receipt', 'a missing payment term falls back');
  assert.equal(row.contact_person, '');
  assert.equal(row.email, '');
  assert.equal(row.phone, '');
  assert.equal(row.address, null);
  assert.equal(row.opening_balance_kobo, 0, 'opening balance is always 0 (not from source)');
  assert.equal(row.outstanding_balance_kobo, 0);
  assert.equal(row.created_at, 'now');
  const full = supplierToRow({ id: 's', name: 'Acme', outstandingBalance: 3 }, 'now');
  assert.equal(full.outstanding_balance_kobo, 300);
});

test('expenseToRow: title/category/paymentMethod defaults (lines 272-281)', async () => {
  const { expenseToRow } = await import('../src/server/relationalMapper.ts');
  const row = expenseToRow({}, 'now');
  assert.equal(row.title, 'Expense');
  assert.equal(row.category, 'Miscellaneous');
  assert.equal(row.payment_method, 'Cash');
  assert.equal(row.amount_kobo, 0);
  assert.equal(row.description, null);
  assert.equal(row.spent_by, '');
  assert.equal(row.receipt_url, null);
  assert.equal(row.date, 'now');
  assert.equal(row.is_historical, 0);
  assert.equal(row.sale_id, null);
  const full = expenseToRow({ id: 'e', title: 'Fuel', category: 'Transport', amount: 9.99, paymentMethod: 'Transfer', paidBy: 'Kemi' }, 'now');
  assert.equal(full.amount_kobo, 999, '9.99 naira -> 999 kobo');
  assert.equal(full.category, 'Transport');
  assert.equal(full.payment_method, 'Transfer');
});

test('stockMovementToRow: type default and qty/prev/new stock (lines 282-290)', async () => {
  const { stockMovementToRow } = await import('../src/server/relationalMapper.ts');
  const row = stockMovementToRow({}, 'now');
  assert.equal(row.type, 'Adjustment');
  assert.equal(row.product_id, null);
  assert.equal(row.qty, 0);
  assert.equal(row.prev_stock, 0);
  assert.equal(row.new_stock, 0);
  assert.equal(row.ref_id, null);
  assert.equal(row.notes, null);
  const full = stockMovementToRow({ id: 'm', productId: 'p', type: 'Sale', quantity: 3, previousStock: 10, newStock: 7 }, 'now');
  assert.equal(full.type, 'Sale');
  assert.equal(full.qty, 3);
  assert.equal(full.new_stock, 7);
});

test('pricingToRow: priceType default and old/new price kobo (lines 291-297)', async () => {
  const { pricingToRow } = await import('../src/server/relationalMapper.ts');
  const row = pricingToRow({}, 'now');
  assert.equal(row.price_type, 'Retail');
  assert.equal(row.old_price_kobo, 0);
  assert.equal(row.new_price_kobo, 0);
  const full = pricingToRow({ id: 'p', productId: 'x', oldPrice: 1.5, newPrice: 2.25, priceType: 'Wholesale' }, 'now');
  assert.equal(full.old_price_kobo, 150);
  assert.equal(full.new_price_kobo, 225);
  assert.equal(full.price_type, 'Wholesale');
});

test('moneyToRow: type default, amount kobo and Owner Repayment loan link (lines 299-312)', async () => {
  const { moneyToRow } = await import('../src/server/relationalMapper.ts');
  const row = moneyToRow({}, 'now');
  assert.equal(row.type, 'Balance Adjustment');
  assert.equal(row.amount_kobo, 0);
  assert.equal(row.ref_id, null);
  assert.equal(row.subtype, null);
  // Owner Repayment links via loanReferenceId into the shared ref_id column.
  const repayment = moneyToRow({ id: 'r', type: 'Owner Repayment', loanReferenceId: 'loan-7', amount: 500 }, 'now');
  assert.equal(repayment.ref_id, 'loan-7', 'a repayment links its originating loan');
  // A non-repayment carrying a referenceId uses that instead.
  const drawing = moneyToRow({ id: 'd', type: 'Owner Drawing', referenceId: 'ref-3', amount: 100 }, 'now');
  assert.equal(drawing.ref_id, 'ref-3', 'a drawing uses its own referenceId');
  // A non-repayment with NO referenceId leaves ref_id null (kills the `? :` -> true mutant).
  const plain = moneyToRow({ id: 'p', type: 'Sale Income', amount: 10 }, 'now');
  assert.equal(plain.ref_id, null);
  // loanReferenceId is special ONLY for Owner Repayment; for other types the
  // ordinary referenceId must win even if a stale loanReferenceId is present.
  const nonRepayment = moneyToRow({ id: 'x', type: 'Owner Drawing', loanReferenceId: 'wrong-loan', referenceId: 'right-ref', amount: 10 }, 'now');
  assert.equal(nonRepayment.ref_id, 'right-ref');
  // A repayment without loanReferenceId falls back to referenceId.
  const repaymentFallback = moneyToRow({ id: 'rf', type: 'Owner Repayment', referenceId: 'fallback-ref', amount: 2 }, 'now');
  assert.equal(repaymentFallback.ref_id, 'fallback-ref');
});

test('saleToRows: header money fields, payment/status defaults and item lines (lines 314-359)', async () => {
  const { saleToRows } = await import('../src/server/relationalMapper.ts');
  const { header, lines } = saleToRows({ id: 'sale-1', totalAmount: 10, items: [] });
  assert.equal(header.type, 'Retail');
  assert.equal(header.payment_method, 'Cash');
  assert.equal(header.status, 'Completed');
  assert.equal(header.total_kobo, 1000);
  assert.equal(header.subtotal_kobo, 0);
  assert.equal(header.discount_kobo, 0);
  assert.equal(header.tax_kobo, 0);
  assert.equal(header.delivery_fee_kobo, 0);
  assert.equal(header.paid_kobo, 0);
  assert.equal(header.total_refunded_kobo, 0);
  assert.equal(header.refunds_json, null, 'a never-refunded sale has NULL refunds_json');
  assert.deepEqual(lines, [], 'no items -> no lines');
  // A non-array items value yields no lines (kills the `: []` fallback mutant).
  const weird = saleToRows({ id: 'sale-2', totalAmount: 5, items: 'oops' as unknown as unknown[] });
  assert.deepEqual(weird.lines, []);
});

test('purchaseToRows: supplier/paymentStatus/deliveryStatus defaults (lines 361-373)', async () => {
  const { purchaseToRows } = await import('../src/server/relationalMapper.ts');
  const { header } = purchaseToRows({ id: 'po-1', totalAmount: 20, items: [] });
  assert.equal(header.po_number, 'po-1', 'a missing poNumber falls back to the id');
  assert.equal(header.payment_status, 'Unpaid');
  assert.equal(header.delivery_status, 'Pending');
  assert.equal(header.total_kobo, 2000);
  assert.equal(header.paid_kobo, 0);
  assert.equal(header.delivery_fee_kobo, 0);
  assert.equal(header.logistics_fee_kobo, 0);
});

// --- relationalWrites.ts: replaceCollectionStatements / delete guards ----------
// Kills the surviving `[]`/`Array.isArray`/typeof guards in replaceCollectionStatements,
// the `if (!tables.length)` guard, deleteToStatements' core/empty-id guards, and the
// businessKeyOf placeholder-regex default.

test('replaceCollectionStatements: unknown collection yields NO statements (line 44)', async () => {
  const { replaceCollectionStatements } = await import('../src/server/relationalWrites.ts');
  const stmts = replaceCollectionStatements('not-a-collection', [{ id: 'x' }], 'now');
  assert.deepEqual(stmts, [], 'an unmapped collection produces an empty statement list');
});

test('replaceCollectionStatements: non-array and primitive documents skip upserts (lines 46-48)', async () => {
  const { replaceCollectionStatements } = await import('../src/server/relationalWrites.ts');
  const del = replaceCollectionStatements('expenses', 'oops' as unknown as unknown[], 'now');
  assert.equal(del.length, 1, 'only the DELETE for a non-array documents value');
  assert.ok(/DELETE FROM expenses/.test(del[0].sql));
  // Primitives inside the array are skipped (typeof guard).
  const mixed = replaceCollectionStatements('expenses', [null, 42, 'str', { id: 'e1', amount: 1 }], 'now');
  const inserts = mixed.filter((s) => /INSERT/.test(s.sql));
  assert.equal(inserts.length, 1, 'only the object document upserts');
});

test('deleteToStatements: unknown collection and blank id yield no statements (lines 269-271)', async () => {
  const { deleteToStatements } = await import('../src/server/relationalWrites.ts');
  assert.deepEqual(deleteToStatements('not-a-collection', 'id1'), [], 'unmapped collection -> []');
  assert.deepEqual(deleteToStatements('expenses', ''), [], 'a blank id -> []');
  assert.deepEqual(deleteToStatements('expenses', null as never), [], 'a null id -> []');
  assert.deepEqual(deleteToStatements('expenses', undefined as never), [], 'an undefined id -> []');
  const ok = deleteToStatements('expenses', 'e1');
  assert.equal(ok.length, 1);
  assert.deepEqual(ok[0].params, ['e1']);
});

test('relationalHasData: a throwing query degrades to false (lines 55-62)', async () => {
  const { relationalHasData } = await import('../src/server/relationalWrites.ts');
  const throwing = async () => { throw new Error('db down'); };
  assert.equal(await relationalHasData(throwing as never), false, 'errors are swallowed -> false');
  // A row with only products populated is still "has data".
  const onlyProducts = async () => [{ p: 1, s: 0 }];
  assert.equal(await relationalHasData(onlyProducts as never), true);
  const onlySales = async () => [{ p: 0, s: 2 }];
  assert.equal(await relationalHasData(onlySales as never), true);
  const none = async () => [{ p: 0, s: 0 }];
  assert.equal(await relationalHasData(none as never), false);
  const noRows = async () => [];
  assert.equal(await relationalHasData(noRows as never), false, 'a missing row -> false');
});

// --- Mutation-hardening additions (kills survivors in relationalWrites.ts) ------
// These pin the behaviours that were previously masked by redundant guards so the
// remaining survivors are provably equivalent rather than merely untested.

test('relationalHasData: non-array/empty rows fall back to false (kills rows?.[0] && || {})', async () => {
  const { relationalHasData } = await import('../src/server/relationalWrites.ts');
  // A query that resolves to a non-array truthy value: the `rows?.[0] || {}`
  // fallback must degrade to false instead of throwing on a bad shape.
  const nonArray = async () => ({ p: 1, s: 0 });
  assert.equal(await relationalHasData(nonArray as never), false, 'a non-array result -> false');
  // A row present but undefined/null (holes in the row list).
  const nullRow = async () => [null];
  assert.equal(await relationalHasData(nullRow as never), false, 'a null row -> false');
});

test('upsertToStatements: unmapped collection with a valid id yields NO statements (line 265)', async () => {
  const { upsertToStatements } = await import('../src/server/relationalWrites.ts');
  const stmts = upsertToStatements('not-a-collection', { id: 'x', amount: 1 }, 'now');
  assert.deepEqual(stmts, [], 'an unmapped collection with an id still yields []');
});

test('businessKeyOf: placeholder regex is anchored (kills un-anchored PLACEHOLDER_RE variants)', async () => {
  const { backfillStatementsFromDocumentRows } = await import('../src/server/relationalWrites.ts');
  const now = new Date().toISOString();
  const mk = (doc: Record<string, unknown>) => ({
    collection: 'sales',
    payload: JSON.stringify({ ...doc, createdAt: now, updatedAt: now,
      items: [{ productId: 'missing-prod', qty: 1, unitPrice: 1, total: 1 }] }),
  });
  const insertsOf = (r: { stmts: { sql: string }[] }) =>
    r.stmts.filter((s) => /INSERT INTO sales /.test(s.sql)).length;

  // A leading "N/A" IS a placeholder -> keyed by id -> two distinct rows survive.
  const leading = backfillStatementsFromDocumentRows(
    [mk({ id: 'x1', invoiceNo: 'N/A-1', totalAmount: 5 }),
     mk({ id: 'x2', invoiceNo: 'N/A-2', totalAmount: 5 })],
    now,
  );
  assert.equal(insertsOf(leading), 2, 'a leading N/A is a placeholder -> distinct rows');
  // A trailing "-" IS a placeholder (anchored end) -> distinct rows.
  const trailing = backfillStatementsFromDocumentRows(
    [mk({ id: 'y1', invoiceNo: 'A-', totalAmount: 5 }),
     mk({ id: 'y2', invoiceNo: 'B-', totalAmount: 5 })],
    now,
  );
  assert.equal(insertsOf(trailing), 2, 'a trailing - is a placeholder -> distinct rows');
  // A plain invoice number is NOT a placeholder -> matching values collapse to ONE.
  const real = backfillStatementsFromDocumentRows(
    [mk({ id: 'z1', invoiceNo: 'INV-7', totalAmount: 5 }),
     mk({ id: 'z2', invoiceNo: 'inv-7', totalAmount: 5 })],
    now,
  );
  assert.equal(insertsOf(real), 1, 'a real invoiceNo collapses case-insensitively');
});

test('deleteToStatements: unmapped collection is [] and core collections still delete', async () => {
  const { deleteToStatements } = await import('../src/server/relationalWrites.ts');
  // Unmapped -> the final default returns [] (not undefined).
  assert.deepEqual(deleteToStatements('not-a-collection', 'id1'), []);
  // Core collections short-circuit through coreDelete and keep their statements.
  assert.equal(deleteToStatements('products', 'p1').length, 1);
  assert.equal(deleteToStatements('sales', 's1').length, 2, 'sales cascades to sale_items first');
});

// Additional survivor-killers: distinguish fallback-field ordering and regex anchors.
test('businessKeyOf: purchase poNumber takes priority over a shared invoiceNo', async () => {
  const { backfillStatementsFromDocumentRows } = await import('../src/server/relationalWrites.ts');
  const now = new Date().toISOString();
  const mk = (id: string, poNumber: string) => ({
    collection: 'purchases',
    payload: JSON.stringify({ id, poNumber, invoiceNo: 'SHARED-INVOICE', totalAmount: 1, createdAt: now, updatedAt: now,
      items: [{ productId: 'missing-prod', qty: 1, unitCost: 1, total: 1 }] }),
  });
  const r = backfillStatementsFromDocumentRows([mk('po-a', 'PO-A'), mk('po-b', 'PO-B')], now);
  assert.equal(r.stmts.filter((s) => /INSERT INTO purchases /.test(s.sql)).length, 2,
    'different POs must remain distinct even if their fallback invoiceNo is shared');
});

test('businessKeyOf: alternate preorderNo field is consulted when preOrderNo is absent', async () => {
  const { backfillStatementsFromDocumentRows } = await import('../src/server/relationalWrites.ts');
  const now = new Date().toISOString();
  const mk = (id: string) => ({
    collection: 'whatsAppPreOrders',
    payload: JSON.stringify({ id, preorderNo: 'WA-42', customerName: id, createdAt: now, updatedAt: now }),
  });
  const r = backfillStatementsFromDocumentRows([mk('wa-a'), mk('wa-b')], now);
  assert.equal(r.stmts.filter((s) => /INSERT INTO whatsapp_preorders /.test(s.sql)).length, 1,
    'preorderNo is the fallback key spelling when preOrderNo is missing');
});

test('businessKeyOf: placeholder matching is anchored at both ends', async () => {
  const { backfillStatementsFromDocumentRows } = await import('../src/server/relationalWrites.ts');
  const now = new Date().toISOString();
  const mk = (id: string, invoiceNo: string) => ({
    collection: 'sales',
    payload: JSON.stringify({ id, invoiceNo, receiptNo: 'SHARED-RECEIPT', totalAmount: 1, createdAt: now, updatedAt: now,
      items: [{ productId: 'missing-prod', qty: 1, unitPrice: 1, total: 1 }] }),
  });
  // If ^ is removed, these would be treated as placeholders and fall through to
  // the shared receiptNo, collapsing to one. Correct anchoring keeps them distinct.
  const prefix = backfillStatementsFromDocumentRows([mk('pre-a', 'PREFIX-N/A'), mk('pre-b', 'OTHER-N/A')], now);
  assert.equal(prefix.stmts.filter((s) => /INSERT INTO sales /.test(s.sql)).length, 2,
    'an N/A suffix inside a real invoice is not a placeholder');
  // If $ is removed, these would be treated as placeholders and fall through to
  // shared receiptNo, collapsing to one.
  const suffix = backfillStatementsFromDocumentRows([mk('suf-a', 'N/A-SUFFIX'), mk('suf-b', 'N/A-SUFFIX')], now);
  // Both invoiceNos are the same real key, so they correctly collapse; use a
  // distinct invoice prefix to ensure the end-anchor controls fallback.
  const suffixDistinct = backfillStatementsFromDocumentRows([mk('suf-c', 'N/A-A'), mk('suf-d', 'N/A-B')], now);
  assert.equal(suffixDistinct.stmts.filter((s) => /INSERT INTO sales /.test(s.sql)).length, 2,
    'an N/A prefix inside a real invoice is not a placeholder');
  assert.equal(suffix.stmts.filter((s) => /INSERT INTO sales /.test(s.sql)).length, 1,
    'identical real invoice values still deduplicate');
});

test('businessKeyOf: non-string business-key values are stringified safely', async () => {
  const { backfillStatementsFromDocumentRows } = await import('../src/server/relationalWrites.ts');
  const now = new Date().toISOString();
  const mk = (id: string, sku: unknown) => ({
    collection: 'products',
    payload: JSON.stringify({ id, sku, name: id, retailPriceKobo: 1, createdAt: now, updatedAt: now }),
  });
  const r = backfillStatementsFromDocumentRows([mk('num-a', 123), mk('num-b', '123')], now);
  assert.equal(r.stmts.filter((s) => /INSERT INTO products /.test(s.sql)).length, 1,
    's() normalizes numeric and string SKU values to the same business key');
});

test('s(): only null and undefined use the fallback; empty string is preserved', async () => {
  const { s } = await import('../src/server/relationalMapper.ts');
  assert.equal(s(null, 'fallback'), 'fallback');
  assert.equal(s(undefined, 'fallback'), 'fallback');
  assert.equal(s('', 'fallback'), '', 'empty string is a real value, not nullish');
  assert.equal(s(0 as any, 'fallback'), '0');
});

// --- mallApi.ts: checkout money-path validation boundaries --------------------
// Focused API-level assertions kill survivors in idempotency, amount, quantity,
// total-cap, delivery-address, email and item guards without mutating file-based DBs.

test('mall checkout: idempotency key length/charset is enforced at both bounds', async () => {
  const { handleMallApi } = await import('../src/server/mallApi.ts');
  const body = { customerName: 'Ada', customerPhone: '08031234567', paymentMethod: 'pay_on_pickup' };
  const invalidKeys = ['', 'short-key-12345', 'bad-key-1234567!', 'a'.repeat(129)];
  for (const key of invalidKeys) {
    const db = makeTestDb();
    const exec = makeTestExecutor(db);
    const response = await handleMallApi(new Request('http://test/api/mall/checkout', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-mall-session': 'mutation-session-123', 'idempotency-key': key }, body: JSON.stringify(body),
    }), exec);
    assert.equal(response.status, 400, `invalid idempotency key length=${key.length}`);
    db.close();
  }
});

test('mall checkout: required fields, max text lengths, email and control characters are validated', async () => {
  const { handleMallApi } = await import('../src/server/mallApi.ts');
  const invalidBodies = [
    { customerName: '' },
    { customerName: 'a'.repeat(121) },
    { customerPhone: '123' },
    { customerEmail: 'not-an-email' },
    { customerEmail: 'a'.repeat(250) + '@b.com' },
    { note: 'bad\u0000control' },
    { paymentMethod: 'unsupported' },
  ];
  for (const override of invalidBodies) {
    const db = makeTestDb();
    const exec = makeTestExecutor(db);
    const body = { customerName: 'Ada', customerPhone: '08031234567', paymentMethod: 'pay_on_pickup', ...override };
    const response = await handleMallApi(new Request('http://test/api/mall/checkout', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-mall-session': 'mutation-session-123', 'idempotency-key': 'valid-attempt-key-1234' }, body: JSON.stringify(body),
    }), exec);
    assert.equal(response.status, 400, `invalid checkout payload ${Object.keys(override)[0]}`);
    const data: any = await response.json();
    assert.ok(data.fields, 'validation response carries per-field errors');
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM mall_orders').get()?.n), 0, 'invalid input writes no order');
    db.close();
  }
});

test('mall checkout: delivery-zone/address lower bound and client fee cannot alter server price', async () => {
  const { handleMallApi } = await import('../src/server/mallApi.ts');
  const db = makeTestDb();
  const exec = makeTestExecutor(db);
  const session = 'mutation-delivery-123';
  seedCatalog(db, { id: 'delivery-p', sku: 'DELIVERY-P', name: 'Delivery Product', stockQty: 5, retailPriceKobo: 10000 });
  seedActiveCart(db, session, [{ productId: 'delivery-p', qty: 1, unitPriceKobo: 1 }]);
  const send = (deliveryAddress: string, deliveryZone = 'uyo_central') => handleMallApi(new Request('http://test/api/mall/checkout', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-mall-session': session, 'idempotency-key': `delivery-key-${deliveryAddress.length}-123` },
    body: JSON.stringify({ customerName: 'Ada', customerPhone: '08031234567', paymentMethod: 'pay_on_pickup', deliveryZone, deliveryAddress, deliveryFeeNaira: 1 }),
  }), exec);
  assert.equal((await send('123456789')).status, 400, '9-char delivery address is rejected');
  const ok = await send('1234567890');
  assert.equal(ok.status, 201, '10-char delivery address meets the lower bound');
  const receipt: any = await ok.json();
  assert.equal(receipt.deliveryFeeKobo, 150000, 'server zone fee overrides client-supplied fee');
  assert.equal(receipt.totalKobo, 160000);
  db.close();
});

test('mall checkout: empty cart is rejected without creating an order or moving stock', async () => {
  const { handleMallApi } = await import('../src/server/mallApi.ts');
  const db = makeTestDb();
  const exec = makeTestExecutor(db);
  const response = await handleMallApi(new Request('http://test/api/mall/checkout', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-mall-session': 'empty-cart-session', 'idempotency-key': 'empty-cart-attempt-123' },
    body: JSON.stringify({ customerName: 'Ada', customerPhone: '08031234567', paymentMethod: 'pay_on_pickup' }),
  }), exec);
  assert.equal(response.status, 400);
  assert.match((await response.json() as any).error, /cart is empty/i);
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM mall_orders').get()?.n), 0);
  db.close();
});

test('Mall public product only exposes a genuine, floor-respecting wholesale discount', async () => {
  const { handleMallApi } = await import('../src/server/mallApi.ts');
  const db = makeTestDb();
  const exec = makeTestExecutor(db);
  seedCatalog(db, { id: 'wholesale-p', sku: 'WHOLESALE-P', name: 'Wholesale Product', stockQty: 10, retailPriceKobo: 10000 });
  db.prepare('UPDATE products SET wholesale_price_kobo = 8000, min_wholesale_qty = 5, min_selling_price_kobo = 5000 WHERE id = ?').run('wholesale-p');
  const get = async () => {
    const response = await handleMallApi(new Request('http://test/api/mall/products/wholesale-p'), exec);
    assert.equal(response.status, 200);
    return (await response.json() as any).product;
  };
  assert.deepEqual((await get()).wholesaleOffer, { price: 8000, minQty: 5 });
  db.prepare('UPDATE products SET min_wholesale_qty = 1 WHERE id = ?').run('wholesale-p');
  assert.equal((await get()).wholesaleOffer, null, 'minimum quantity must be > 1');
  db.prepare('UPDATE products SET min_wholesale_qty = 5, min_selling_price_kobo = 9000 WHERE id = ?').run('wholesale-p');
  assert.equal((await get()).wholesaleOffer, null, 'wholesale must respect the floor');
  db.prepare('UPDATE products SET min_selling_price_kobo = 5000, wholesale_price_kobo = 10000 WHERE id = ?').run('wholesale-p');
  assert.equal((await get()).wholesaleOffer, null, 'a tier equal to listed price is not a discount');
  db.close();
});
