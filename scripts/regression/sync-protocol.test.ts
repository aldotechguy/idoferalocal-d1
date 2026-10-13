/**
 * @regression:N1/N2 — sync-protocol locks.
 *
 * N1 (fix fa9ae7e): the sync watermark must stay monotonic even when two mall
 *   writes land in the same millisecond — a non-monotonic watermark made
 *   guarded-snapshot clients re-fetch (or skip) revisions out of order.
 * N2 (fix bc088af): sync-from-pos must derive the order total from its own
 *   line items and reject an inconsistent client total — trusting the client
 *   total let a tampered amendment rewrite the order value while the lines
 *   (and the buyer's email) said otherwise.
 *
 * All in-memory via scripts/test-harness.ts — no network, no remote D1.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  makeTestDb, makeTestExecutor, seedCatalog, seedActiveCart, assertNotProduction,
} from '../test-harness.ts';
import { handleMallApi } from '../../src/server/mallApi.ts';
import { handleStaffMallApi } from '../../src/server/mallOrderAdminApi.ts';
import { revisionBumpStatement } from '../../src/server/mallSafety.ts';

const actor = { id: 'staff-reg', displayName: 'Regression Manager', role: 'Administrator' };

function fixture() {
  assertNotProduction(':memory: regression N1/N2');
  const db = makeTestDb();
  const exec = makeTestExecutor(db);
  const session = `reg-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
  seedCatalog(db, { id: 'p', retailPriceKobo: 10000, stockQty: 10 });
  seedActiveCart(db, session, [{ productId: 'p', qty: 2, unitPriceKobo: 1 }]);
  const response = handleMallApi(new Request('http://test/api/mall/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mall-session': session, 'idempotency-key': `reg-${session}` },
    body: JSON.stringify({ customerName: 'Ada', customerPhone: '08031234567', paymentMethod: 'pay_on_pickup' }),
  }), exec);
  return { db, exec, response, session } as any;
}

async function paidOrder(ctx: any): Promise<string> {
  await ctx.response;
  const id = String((ctx.db.prepare('SELECT id FROM mall_orders LIMIT 1').get() as any).id);
  await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/confirm`, { method: 'POST', body: '{}' }), ctx.exec, actor);
  await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/collect-payment`, {
    method: 'POST', body: JSON.stringify({ paymentMethod: 'Cash', amountKobo: 20000 }),
  }), ctx.exec, actor);
  return id;
}

test('@regression:N1 — the sync watermark is monotonic even for same-millisecond writes', async () => {
  const ctx = fixture();
  await ctx.response;
  const read = () => Number(JSON.parse(String(
    (ctx.db.prepare(`SELECT value_json FROM settings WHERE key = 'sync_watermark'`).get() as any)?.value_json ?? '0',
  )) || 0);
  // Freeze the clock so both bumps share the same millisecond — exactly the
  // N1 bug's precondition.
  const frozen = Date.now();
  const originalNow = Date.now;
  (Date as any).now = () => frozen;
  try {
    await ctx.exec.runBatch([revisionBumpStatement()]);
    const first = read();
    await ctx.exec.runBatch([revisionBumpStatement()]);
    const second = read();
    assert.ok(first > 0, 'the first bump sets the watermark');
    // THE LOCK: second must still be strictly greater than first. The N1 bug
    // produced an equal (non-advancing) watermark for same-ms writes.
    assert.ok(second > first, 'a same-millisecond write must still advance the watermark');
  } finally {
    (Date as any).now = originalNow;
  }
  ctx.db.close();
});

test('@regression:N2 — sync-from-pos rejects a total that does not match its line items', async () => {
  const ctx = fixture();
  const id = await paidOrder(ctx);
  assert.equal((ctx.db.prepare('SELECT total_kobo FROM mall_orders WHERE id = ?').get(id) as any).total_kobo, 20000);

  // Lines sum to 30000 (3 × 10000) but the client claims 50000 total and 50000
  // paid. THE LOCK: the amendment must be rejected, not applied.
  const mismatched = await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/sync-from-pos`, {
    method: 'POST',
    body: JSON.stringify({
      subtotalKobo: 30000, totalKobo: 50000, discountKobo: 0, deliveryFeeKobo: 0, paidKobo: 50000,
      orderStatus: 'processing', paymentStatus: 'paid',
      items: [{ productId: 'p', name: 'P', qty: 3, unitPriceKobo: 10000 }],
    }),
  }), ctx.exec, actor);
  assert.equal(mismatched.status, 400, 'an inconsistent total must be rejected outright');

  // The order keeps its pre-amendment truth: lines and totals unchanged.
  assert.equal((ctx.db.prepare('SELECT total_kobo FROM mall_orders WHERE id = ?').get(id) as any).total_kobo, 20000,
    'the rejected amendment must not rewrite the order total');
  assert.equal((ctx.db.prepare('SELECT COUNT(*) AS n FROM mall_order_items WHERE mall_order_id = ?').get(id) as any).n, 1,
    'the original line survives a rejected amendment');
  assert.equal((ctx.db.prepare('SELECT total_kobo FROM mall_order_items WHERE mall_order_id = ?').get(id) as any).total_kobo, 20000);

  // A consistent amendment (within the 1-naira tolerance) still applies.
  const consistent = await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/sync-from-pos`, {
    method: 'POST',
    body: JSON.stringify({
      subtotalKobo: 30000, totalKobo: 30000, discountKobo: 0, deliveryFeeKobo: 0, paidKobo: 30000,
      orderStatus: 'processing', paymentStatus: 'paid',
      items: [{ productId: 'p', name: 'P', qty: 3, unitPriceKobo: 10000 }],
    }),
  }), ctx.exec, actor);
  assert.equal(consistent.status, 200, 'a consistent amendment still applies');
  assert.equal((ctx.db.prepare('SELECT total_kobo FROM mall_orders WHERE id = ?').get(id) as any).total_kobo, 30000);
  ctx.db.close();
});
