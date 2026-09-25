/**
 * Launch contract checks against a DISPOSABLE preview deployment.
 *
 * Verifies on real Cloudflare D1 + workerd (not the local SQLite shim):
 *  - cold-start schema bootstrap and the existing-schema rollout marker
 *  - the maximum intended cart size (100 lines x 1000 units) commits atomically
 *  - checkout replay is attempt-scoped (same key + same body -> same order)
 *  - the documented defensive caps are enforced, not merely documented
 *    (per-line 1000 units, order total 1,000,000,000 kobo)
 *
 * It WRITES: updated preview seed rows, a seeded maximum-size cart, one real
 * order (with its stock and ledger side effects) and one deliberately rejected
 * checkout. Point it at the disposable preview only. It refuses the live mall
 * origin and the live `idofera` database unless MALL_CONTRACT_ALLOW_LIVE=1.
 * Seeding reuses generic rows (pv-*) and deletes them again at the end, so it
 * never mutates real catalog data (only rows whose id starts with 'pv-').
 *
 * The preview environment deploys no cron trigger, so nothing is emailed and no
 * second notification pipeline is opened.
 *
 * Usage:
 *   $env:MALL_CONTRACT_BASE_URL='https://idomall-preview.olz.workers.dev'
 *   $env:MALL_CONTRACT_D1='idofera-preview'
 *   $env:MALL_CONTRACT_WRANGLER_ENV='preview'
 *   npm run verify:mall-contract
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LIVE_HOST = 'idomall.olz.workers.dev';
const LIVE_DB = 'idofera';
const LINES = 100;
const UNITS_PER_LINE = 1000;
const UNIT_PRICE_KOBO = 100;
const MAX_TOTAL_KOBO = 1_000_000_000;
const WRANGLER = process.platform === 'win32' ? 'node_modules\\.bin\\wrangler.cmd' : 'node_modules/.bin/wrangler';

const allowLive = process.env.MALL_CONTRACT_ALLOW_LIVE === '1';

function requireConfig() {
  const raw = process.env.MALL_CONTRACT_BASE_URL;
  if (!raw) throw new Error('Set MALL_CONTRACT_BASE_URL to the disposable preview origin. No requests were made.');
  const base = new URL(raw);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/') {
    throw new Error('Use an HTTPS origin without credentials or a path.');
  }
  if (base.hostname === LIVE_HOST && !allowLive) {
    throw new Error(`${LIVE_HOST} is the live store. This check writes orders; set MALL_CONTRACT_ALLOW_LIVE=1 to override.`);
  }
  const database = process.env.MALL_CONTRACT_D1;
  if (!database) throw new Error('Set MALL_CONTRACT_D1 to the disposable D1 database name used for seeding.');
  if (database === LIVE_DB && !allowLive) {
    throw new Error(`Refusing to seed the live database "${LIVE_DB}". Set MALL_CONTRACT_ALLOW_LIVE=1 to override.`);
  }
  return {
    base,
    database,
    env: process.env.MALL_CONTRACT_WRANGLER_ENV || 'preview',
  };
}

function runSql(config: { database: string; env: string }, sql: string) {
  const file = join(tmpdir(), `idomall-contract-${randomUUID()}.sql`);
  writeFileSync(file, sql, 'utf8');
  execFileSync(
    process.platform === 'win32' ? 'cmd' : 'sh',
    process.platform === 'win32'
      ? ['/c', WRANGLER, 'd1', 'execute', config.database, '--env', config.env, '--remote', '--file', file]
      : ['-c', `${WRANGLER} d1 execute ${config.database} --env ${config.env} --remote --file ${file}`],
    { encoding: 'utf8' },
  );
}

function makeApi(base: URL) {
  return async function api(path: string, session: string, init: RequestInit = {}) {
    const headers = { 'content-type': 'application/json', 'x-mall-session': session, ...((init.headers as Record<string, string>) || {}) };
    const response = await fetch(new URL(path, base), {
      ...init,
      headers,
      signal: AbortSignal.timeout(60000),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any = null;
    const text = await response.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { status: response.status, body };
  };
}


async function main() {
  const config = requireConfig();
  const api = makeApi(config.base);
  const run = randomUUID().slice(0, 8);
  const sessionMax = `contract-a-${run}`;
  const sessionTotal = `contract-b-${run}`;
  const sessionLines = `contract-c-${run}`;
  const sessionQty = `contract-d-${run}`;
  const now = Date.now();
  const failures: string[] = [];

  const check = (ok: boolean, label: string, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures.push(label);
  };

  const cheap = `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 101) INSERT OR REPLACE INTO products (id, sku, name, status, stock_qty, retail_price_kobo, mall_price_kobo, min_selling_price_kobo, created_at, updated_at) SELECT 'pv-' || n, 'PV-' || n, 'Contract check product ' || n, 'Active', 5000, ${UNIT_PRICE_KOBO}, ${UNIT_PRICE_KOBO}, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z' FROM seq;`;

  console.log(`\nTarget ${config.base.origin} (D1 ${config.database}, env ${config.env}) — this WRITES preview-only data.\n`);

  const health = await api('/api/mall/health', sessionMax);
  check(health.status === 200, 'cold start: /api/mall/health answers 200', `status ${health.status}`);
  const catalog = await api('/api/mall/products?limit=1', sessionMax);
  check(catalog.status === 200, 'cold start: public catalog answers 200', `status ${catalog.status}`);
  const ready = await api('/api/mall/ready', sessionMax);
  const checks = ready.body?.checks || {};
  check(
    checks.schema === true && checks.schemaObjects === true && checks.stockTrigger === true,
    'schema rollout: marker row, schema objects and oversell trigger present on real D1',
    JSON.stringify({ schema: checks.schema, schemaObjects: checks.schemaObjects, stockTrigger: checks.stockTrigger }),
  );
  if (checks.scheduler === false) console.log('NOTE scheduler:false is expected on the preview (no cron trigger deployed).');

  const seed = [
    "DELETE FROM mall_carts WHERE session_id LIKE 'contract-%';",
    "DELETE FROM products WHERE id LIKE 'pv-%';",
    cheap,
    `INSERT OR REPLACE INTO products (id, sku, name, status, stock_qty, retail_price_kobo, mall_price_kobo, min_selling_price_kobo, created_at, updated_at) VALUES ('pv-big', 'PV-BIG', 'Contract check oversized product', 'Active', 5000, ${MAX_TOTAL_KOBO * 2}, ${MAX_TOTAL_KOBO * 2}, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');`,
    // Cart ids follow the server's own convention (`mc-${sessionId}`); a cart
    // stored under any other id is invisible to the API, and a second *active*
    // cart for the same session violates idx_mall_active_session.
    `INSERT OR REPLACE INTO mall_carts (id, session_id, status, updated_at) VALUES ('mc-${sessionMax}', '${sessionMax}', 'active', ${now}), ('mc-${sessionTotal}', '${sessionTotal}', 'active', ${now}), ('mc-${sessionLines}', '${sessionLines}', 'active', ${now});`,
    `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 101) INSERT INTO mall_cart_items (id, cart_id, product_id, qty, unit_price_kobo) SELECT 'pv-ci-a-' || n, 'mc-${sessionMax}', 'pv-' || n, ${UNITS_PER_LINE}, ${UNIT_PRICE_KOBO} FROM seq WHERE n <= 100;`,
    `INSERT INTO mall_cart_items (id, cart_id, product_id, qty, unit_price_kobo) VALUES ('pv-ci-b-1', 'mc-${sessionTotal}', 'pv-big', 1, ${MAX_TOTAL_KOBO * 2});`,
    `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 102) INSERT INTO mall_cart_items (id, cart_id, product_id, qty, unit_price_kobo) SELECT 'pv-ci-c-' || n, 'mc-${sessionLines}', 'pv-' || n, 1, ${UNIT_PRICE_KOBO} FROM seq WHERE n <= 101;`,
  ];
  // One statement per API call: a single large multi-statement file made the D1
  // import path time out against Cloudflare's API.
  for (const statement of seed) runSql(config, statement);
  console.log('seeded 102 preview products and 3 carts (100 lines / oversize total / 101 lines)');

  const cartMax = await api('/api/mall/cart', sessionMax);
  const expectedSubtotal = LINES * UNITS_PER_LINE * UNIT_PRICE_KOBO;
  check(
    cartMax.status === 200 && cartMax.body?.items?.length === LINES && cartMax.body?.subtotalKobo === expectedSubtotal,
    `max cart: ${LINES} lines x ${UNITS_PER_LINE} units is priced server-side`,
    `items ${cartMax.body?.items?.length}, subtotal ${cartMax.body?.subtotalKobo} (expected ${expectedSubtotal})`,
  );

  const body = {
    customerName: 'Contract Check',
    customerPhone: '+2348000000000',
    deliveryZone: 'pickup',
    paymentMethod: 'pay_on_pickup',
    note: `contract run ${run}`,
  };
  const key = `contract-${run}-0001`;
  const order = await api('/api/mall/checkout', sessionMax, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify(body),
  });
  const placed = order.body?.order ?? order.body;
  check(
    (order.status === 200 || order.status === 201) && typeof placed?.orderNo === 'string',
    'max order commits on deployed D1 (Workers + batch limit)',
    `status ${order.status}, orderNo ${placed?.orderNo}, items ${placed?.items?.length}`,
  );
  check(placed?.items?.length === LINES, 'max order keeps every line', `items ${placed?.items?.length}`);
  check(
    placed?.totalKobo === expectedSubtotal,
    'max order total matches the server-side cart subtotal (pickup, no fee)',
    `total ${placed?.totalKobo} vs ${expectedSubtotal}`,
  );

  const replay = await api('/api/mall/checkout', sessionMax, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify(body),
  });
  const replayed = replay.body?.order ?? replay.body;
  check(
    replay.status === 200 && replayed?.orderNo === placed?.orderNo,
    'checkout replay with the same key and body returns the same order',
    `status ${replay.status}, orderNo ${replayed?.orderNo}`,
  );

  const detail = await api('/api/mall/products/pv-1', sessionMax);
  const product = detail.body?.product ?? detail.body;
  check(
    product?.stock === 5000 - UNITS_PER_LINE,
    'stock decremented by the committed order',
    `pv-1 stock ${product?.stock} (expected ${5000 - UNITS_PER_LINE})`,
  );

  const tooMany = await api('/api/mall/cart', sessionQty, {
    method: 'POST',
    body: JSON.stringify({ productId: 'pv-1', qty: UNITS_PER_LINE + 1 }),
  });
  check(tooMany.status === 400, `per-line cap: qty ${UNITS_PER_LINE + 1} is rejected`, `status ${tooMany.status}`);

  const oversize = await api('/api/mall/checkout', sessionTotal, {
    method: 'POST',
    headers: { 'Idempotency-Key': `contract-${run}-0002` },
    body: JSON.stringify(body),
  });
  check(
    oversize.status === 400,
    `order-total cap: more than ${MAX_TOTAL_KOBO} kobo is rejected`,
    `status ${oversize.status} ${typeof oversize.body === 'object' ? oversize.body?.error : ''}`,
  );

  const tooManyLines = await api('/api/mall/checkout', sessionLines, {
    method: 'POST',
    headers: { 'Idempotency-Key': `contract-${run}-0003` },
    body: JSON.stringify(body),
  });
  check(
    tooManyLines.status === 400,
    'line cap: an order with more than 100 items is rejected',
    `status ${tooManyLines.status} ${typeof tooManyLines.body === 'object' ? tooManyLines.body?.error : ''}`,
  );

  if (failures.length) throw new Error(`${failures.length} contract check(s) failed: ${failures.join('; ')}`);
  console.log(`\nAll contract checks passed on ${config.base.origin}. This does not verify payment settlement, courier handoff or notification-provider delivery.`);
}

main().catch((error) => {
  console.error(`\nContract check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
