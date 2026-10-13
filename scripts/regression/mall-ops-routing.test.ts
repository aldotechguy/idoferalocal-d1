/**
 * @regression:F4/F5/F6 — operational + routing + catalog locks.
 *
 * F4 (fix fa9ae7e): readiness 'scheduler' must key off the DRAIN cron's
 *   'maintenance' marker only — letting the hourly sweep refresh it kept
 *   readiness green while the drain cron was down.
 * F5 (fix fa9ae7e): catalog browse must drop the sold_qty join (reporting
 *   sold: 0 from cheap columns) and only pay the join for sort=popular, where
 *   it ranks by REAL sale quantities — the bug made popular inert and browse
 *   paid the join on every request.
 * F6 (fix fa9ae7e): an unknown /api/* path must 404 like any other missing
 *   route — returning 401 leaked that a private API namespace exists.
 *
 * All in-memory via scripts/test-harness.ts (worker leg uses a SqliteD1 double).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import worker from '../../sites-worker.ts';
import {
  makeTestDb, makeTestExecutor, seedCatalog, seedActiveCart, assertNotProduction,
} from '../test-harness.ts';
import { handleMallApi, invalidateMallFacetCache } from '../../src/server/mallApi.ts';
import { handleStaffMallApi } from '../../src/server/mallOrderAdminApi.ts';
import { runMallMaintenance, mallReadiness } from '../../src/server/mallOperations.ts';

const actor = { id: 'staff-reg', displayName: 'Regression Manager', role: 'Administrator' };

class SqliteD1 {
  constructor(readonly db: DatabaseSync) { }
  prepare(sql: string) {
    const db = this.db;
    return {
      sql, params: [] as unknown[],
      bind(...p: unknown[]) { this.params = p; return this; },
      async all() { return { results: db.prepare(this.sql).all(...(this.params as any[])) }; },
      async run() { return { meta: { changes: Number(db.prepare(this.sql).run(...(this.params as any[])).changes) } }; },
    };
  }
  async batch(sts: ReturnType<SqliteD1['prepare']>[]) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = sts.map((st) => ({ meta: { changes: Number(this.db.prepare(st.sql).run(...(st.params as any[])).changes) } }));
      this.db.exec('COMMIT'); return r;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
}

/** Mall fixture against the shared in-memory harness (node leg) or the worker. */
async function mallFixture(runtime: 'node' | 'worker') {
  assertNotProduction(':memory: regression F4/F5/F6');
  const db = makeTestDb();
  const exec = makeTestExecutor(db);
  const env: any = {
    MALL_CHECKOUT_ENABLED: 'true', MALL_PICKUP_ADDRESS: 'Reg pickup', MALL_PICKUP_HOURS: '9-5',
    DB: new SqliteD1(db), ASSETS: { fetch: async (req: Request) => new Response(`asset:${new URL(req.url).pathname}`) },
  };
  const send = (request: Request) => runtime === 'worker' ? worker.fetch(request, env) : handleMallApi(request, exec);
  await worker.fetch(new Request('http://test/api/mall/health'), env);
  const session = `reg-${runtime}-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
  seedCatalog(db, { id: 'p', retailPriceKobo: 10000, stockQty: 10 });
  seedActiveCart(db, session, [{ productId: 'p', qty: 2, unitPriceKobo: 1 }]);
  invalidateMallFacetCache();
  const checkout = async () => send(new Request('http://test/api/mall/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mall-session': session, 'idempotency-key': `reg-${session}` },
    body: JSON.stringify({ customerName: 'Ada', customerPhone: '08031234567', paymentMethod: 'pay_on_pickup' }),
  }));
  const pay = async () => {
    const id = String((db.prepare('SELECT id FROM mall_orders LIMIT 1').get() as any).id);
    return handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/collect-payment`, {
      method: 'POST', headers: { cookie: 'idofera_session=reg' }, body: JSON.stringify({ paymentMethod: 'Cash', amountKobo: 20000 }),
    }), exec, actor);
  };
  return { db, exec, checkout, pay };
}

test('@regression:F4 — readiness scheduler keys off the drain cron marker, never the sweep', async () => {
  const f = await mallFixture('node');
  await f.checkout();
  // A sweep that JUST ran must NOT keep readiness green by itself.
  f.db.exec("DELETE FROM mall_job_runs");
  f.db.exec("INSERT INTO mall_job_runs(name,last_success_at) VALUES ('sweep', '" + new Date().toISOString() + "')");
  const ready = await mallReadiness(f.exec);
  // THE LOCK: with only a fresh 'sweep' marker and no 'maintenance' marker, the
  // scheduler check must report down. The F4 bug counted any recent marker.
  assert.equal(ready.checks.scheduler, false,
    'a fresh sweep marker must not keep readiness.scheduler green when the drain cron is silent');
  // The drain marker (name='maintenance') restored green.
  f.db.exec("INSERT INTO mall_job_runs(name,last_success_at) VALUES ('maintenance', '" + new Date().toISOString() + "')");
  const readyAfterDrain = await mallReadiness(f.exec);
  assert.equal(readyAfterDrain.checks.scheduler, true, 'a fresh drain marker is what readiness keys on');
  f.db.close();
});

test('@regression:F4b — the sweep never writes the drain readiness marker', async () => {
  const f = await mallFixture('node');
  await f.checkout();
  // Age the order past the expiry window so the sweep has work to do.
  f.db.prepare('UPDATE mall_orders SET created_at = ?').run(new Date(Date.now() - 72 * 3600_000).toISOString());
  f.db.exec("DELETE FROM mall_job_runs");
  const expire = (id: string) => handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/cancel`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'Expired unpaid' }),
  }), f.exec, actor);
  await runMallMaintenance(f.exec, expire, undefined, { mode: 'sweep' });
  const marker = f.db.prepare('SELECT name FROM mall_job_runs').get() as any;
  assert.ok(marker, 'the sweep writes its own marker');
  // THE LOCK: the marker name is 'sweep', never 'maintenance'.
  assert.equal(marker.name, 'sweep', 'the sweep must not write the drain readiness marker');
  f.db.close();
});

test('@regression:F5 — catalog browse reports sold:0 without the sold join; popular ranks by real sales', async () => {
  const f = await mallFixture('node');
  const queries: string[] = [];
  const instrumented = { ...f.exec, queryAll: async (sql: string, params: unknown[]) => { queries.push(sql); return f.exec.queryAll(sql, params); } };
  const catalog = async (query: string) => (await (await handleMallApi(new Request(`http://test/api/mall/products?${query}`), instrumented as any)).json()) as any;

  queries.length = 0;
  const browse = await catalog('limit=5');
  // THE LOCK part 1: browse reports sold: 0 and pays NO sale_items join.
  assert.equal(browse.products[0].sold, 0, 'default catalog rows report sold: 0');
  assert.equal(queries.filter((sql) => sql.includes('FROM sale_items')).length, 0,
    'browse must not pay the sold_qty join');

  queries.length = 0;
  const popular = await catalog('limit=5&sort=popular');
  assert.equal(popular.sort, 'popular');
  assert.equal(popular.products[0].sold, 0, 'no canonical sale yet');
  // THE LOCK part 2: popular DOES pay the join — otherwise the sort is inert.
  assert.equal(queries.filter((sql) => sql.includes('FROM sale_items')).length, 1,
    'popularity must rank by the real sold join');

  // After settlement the popular sort ranks by real quantities.
  await f.checkout();
  await f.pay();
  invalidateMallFacetCache();
  const popularAfter = await catalog('limit=5&sort=popular');
  assert.equal(popularAfter.products[0].sold, 2, 'popular ranks by real sold quantities after settlement');
  f.db.close();
});

test('@regression:F6 — an unknown /api/* path is 404 for everyone, never 401', async () => {
  const f = await mallFixture('node');
  const env = { DB: new SqliteD1(f.db), ASSETS: { fetch: async () => new Response(null, { status: 404 }) } } as any;
  for (const path of ['/api/missing-endpoint', '/api/mall/no-such-route', '/api/totally-unknown']) {
    const response = await worker.fetch(new Request(`http://test${path}`), env);
    // THE LOCK: 401 would leak that a private namespace exists behind the path.
    assert.equal(response.status, 404, `${path} must 404 like any other missing route`);
  }
  f.db.close();
});
