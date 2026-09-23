import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import worker from '../sites-worker.ts';
import { ensureRelationalSchemaNode, makeNodeMallExecutor } from '../src/server/nodeAdapter.ts';
import { handleMallApi, invalidateMallFacetCache, type MallExecutor } from '../src/server/mallApi.ts';
import { handleStaffMallApi } from '../src/server/mallOrderAdminApi.ts';
import { handleStaffMallListingApi } from '../src/server/mallListingApi.ts';
import { handleStaffProductImageApi, handlePublicImageRequest } from '../src/server/productImageApi.ts';
import { decodeBase64Image, imageKeyFromUrl, imageUrl, newProductImageKey } from '../src/server/imageStore.ts';
import { makeNodeImageStore } from '../src/server/nodeImageStore.ts';
import { bootstrapAdmin } from '../src/server/adminBootstrap.ts';
import { handleMallWebhook } from '../src/server/mallWebhook.ts';
import { drainMallOutbox, signMallWebhook, mallReadiness, runMallMaintenance, mallRateLimitFor, mallRateLimitGroup, MALL_RATE_LIMITS, MALL_OPERATIONS_DDL, MALL_SCHEMA_VERSION, clearMallRateLimitWindows } from '../src/server/mallOperations.ts';
import { normalizeMallPhone, normalizedPhoneSql } from '../src/shared/mallPhone.ts';
import { SNAPSHOT_PUSH_DOC_LIMIT } from '../src/server/relationalSnapshot.ts';

/** Binding-shaped test double; executes real SQL and atomic batches, not canned results.
 * This is NOT a deployed D1/workerd test. */
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

const actor = { id: 'staff-test', displayName: 'Manager', role: 'Administrator' };
const session = 'safety-session-123';
const body = { customerName: 'Ada', customerPhone: '08031234567', paymentMethod: 'pay_on_pickup' };
const attempt = 'safety-attempt-12345678';

async function fixture(runtime: 'node' | 'worker') {
  const db = new DatabaseSync(':memory:');
  ensureRelationalSchemaNode(db);
  // The mall facet cache is module-global and shared across fixtures in this
  // process; reset it so every test reads counts from its own database.
  invalidateMallFacetCache();
  // Same for the sampled rate limiter's in-process counters: they are keyed
  // group+window (group-global by design), so without this reset a checkout
  // in one test would eat the allowance of every later test in the minute.
  clearMallRateLimitWindows();
  const exec = makeNodeMallExecutor(db);
  const env: any = { MALL_CHECKOUT_ENABLED: 'true', MALL_PICKUP_ADDRESS: 'Test pickup', MALL_PICKUP_HOURS: 'Test hours', DB: new SqliteD1(db), ASSETS: { fetch: async (req: Request) => new Response(`asset:${new URL(req.url).pathname}`) } };
  const send = (request: Request) => runtime === 'worker' ? worker.fetch(request, env) : handleMallApi(request, exec);
  await worker.fetch(new Request('http://test/api/mall/health'), env);
  const token = 'test-staff-session-token';
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  db.prepare(`INSERT INTO app_users(id,email,display_name,role,status,password_hash,password_salt,created_at) VALUES (?, 'staff@test.invalid', 'Manager', 'Administrator', 'Active', 'test-only-disabled-login', 'test-only', 'now')`).run(actor.id);
  db.prepare('INSERT INTO app_sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)').run(hash, actor.id, Date.now(), Date.now() + 60000);
  db.exec(`INSERT INTO products(id,sku,name,stock_qty,status,is_mall_listed,retail_price_kobo,created_at,updated_at)
    VALUES('p','p','Product',10,'Active',1,10000,'now','now');`);
  const fill = (sid = session) => {
    db.prepare(`INSERT OR IGNORE INTO mall_carts(id,session_id,status,updated_at) VALUES(?,?,'active',1)`).run(`mc-${sid}`, sid);
    db.prepare('INSERT INTO mall_cart_items(id,cart_id,product_id,qty,unit_price_kobo) VALUES(?,?,?,2,1)').run(crypto.randomUUID(), `mc-${sid}`, 'p');
  };
  fill();
  const checkout = (key = attempt, overrides: Record<string, unknown> = {}, sid = session) => send(new Request('http://test/api/mall/checkout', {
    method: 'POST', headers: { 'x-mall-session': sid, 'idempotency-key': key }, body: JSON.stringify({ ...body, ...overrides }),
  }));
  const id = () => (db.prepare('SELECT id FROM mall_orders LIMIT 1').get() as any).id as string;
  const op = (action: string, payload: Record<string, unknown> = {}, role = 'Administrator') => {
    const request = new Request(`http://test/api/staff/mall-orders/${id()}/${action}`, {
      method: 'POST', headers: { cookie: `idofera_session=${token}` }, body: JSON.stringify(payload),
    });
    if (runtime === 'worker') {
      db.prepare('UPDATE app_users SET role = ? WHERE id = ?').run(role, actor.id);
      return worker.fetch(request, env);
    }
    return handleStaffMallApi(request, exec, { ...actor, role });
  };
  const scalar = (sql: string) => Object.values(db.prepare(sql).get()!)[0];
  const pay = () => op('collect-payment', { paymentMethod: 'Cash', amountKobo: 20000 });
  return { db, exec, env, send, fill, checkout, id, op, pay, scalar, token };
}

for (const runtime of ['node', 'worker'] as const) {
  test(`${runtime}: homepage rows use the whole catalog and browser-scoped paid history`, async t => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    const home = async (sid = session) => {
      // Raw SQL mutations below bypass the API write paths that normally drop
      // the rail cache, so every scenario step must recompute from scratch.
      invalidateMallFacetCache();
      const response = await f.send(new Request('http://test/api/mall/home', { headers: { 'x-mall-session': sid } }));
      assert.equal(response.status, 200);
      return response.json() as Promise<any>;
    };
    for (let i = 0; i < 75; i++) {
      f.db.prepare(`INSERT INTO products(id,sku,name,stock_qty,status,retail_price_kobo,mall_price_kobo,created_at,updated_at)
        VALUES(?,?,?,0,'Active',10000,9000,?,?)`).run(`home-${i}`, `home-${i}`, `Home ${i}`, `2026-01-${String(i % 28 + 1).padStart(2, '0')}`, '2026-01-01');
    }
    f.db.exec("UPDATE products SET created_at='2020-01-01' WHERE id='p'");
    const initial = await home();
    assert.equal(initial.flashSales.length, 10);
    assert.equal(initial.topSellers.length, 2);
    assert.deepEqual(initial.newArrivals, [], 'Creation dates alone do not qualify as restocks');
    const movement = (id: string, product: string, type: string, at: string, qty = 5) => f.db.prepare(
      'INSERT INTO stock_movements(id,product_id,type,qty,prev_stock,new_stock,created_at) VALUES(?,?,?,?,0,?,?)'
    ).run(id, product, type, qty, qty, at);
    for (let i = 0; i < 15; i++) movement(`restock-${i}`, `home-${i}`, 'Incoming', `2026-02-${String(i + 1).padStart(2, '0')}`);
    movement('repeat-restock', 'home-0', 'Incoming', '2026-03-01');
    movement('return', 'home-70', 'Returned', '2026-04-01');
    movement('adjustment', 'home-71', 'Adjustment', '2026-04-01');
    movement('zero-receipt', 'home-72', 'Incoming', '2026-04-01', 0);
    movement('negative-receipt', 'home-73', 'Incoming', '2026-04-01', -1);
    f.db.exec("UPDATE products SET status='Archived' WHERE id='home-14'; UPDATE products SET updated_at='2026-05-01' WHERE id='home-1'");
    const restocked = (await home()).newArrivals;
    assert.deepEqual(restocked.map((p: any) => p.id), ['home-0']);
    assert.equal(new Set(restocked.map((p: any) => p.id)).size, 1);
    // Regression guard (live incident): the restock rail once returned only raw
    // columns, so publicProduct mapped price_kobo -> 0 -> "Price unavailable"
    // on every New Arrivals card even with valid mall prices in the database.
    assert.equal(restocked[0].price, 9000, 'New Arrivals rows must carry the effective mall price');
    assert.equal(restocked[0].retailPriceKobo, 10000);
    assert.ok(restocked.every((p: any) => !p.available), 'Restocked products remain visible after selling out');
    assert.ok(initial.flashSales.every((p: any) => p.stock === 0 && !p.available));
    // In-stock candidates beyond the original LIMIT must backfill the rails.
    f.db.exec("UPDATE products SET stock_qty=5 WHERE id IN ('home-0','home-1','home-2','home-3','home-4','home-5','home-6','home-7','home-8','home-9','home-10','home-11','home-12','home-13','home-70','home-71'); UPDATE products SET mall_price_kobo=NULL WHERE id='home-0'");
    const mixed = await home();
    assert.equal(mixed.flashSales.length, 10);
    assert.equal(mixed.topSellers.length, 12);
    assert.equal(mixed.newArrivals.length, 12);
    // A NULL mall price must fall back to the retail price (the live catalog state).
    assert.ok(mixed.newArrivals.every((p: any) => p.price > 0 && p.available),
      'Every in-stock New Arrivals row is priced and purchasable');
    assert.equal(mixed.newArrivals.find((p: any) => p.id === 'home-0')?.price, 10000,
      'A NULL mall price falls back to the retail price');
    for (const rail of [mixed.topSellers, mixed.newArrivals]) {
      assert.ok(rail.filter((p: any) => p.stock <= 0).length <= 1);
      assert.equal(new Set(rail.map((p: any) => p.id)).size, rail.length);
      assert.ok(rail.every((p: any) => p.id !== 'home-14'));
    }
    assert.deepEqual(initial.buyAgain, []);
    assert.equal((await f.checkout()).status, 201);
    assert.deepEqual((await home()).buyAgain, [], 'Pending orders are not purchases');
    assert.equal((await f.pay()).status, 200);
    f.db.exec("UPDATE products SET stock_qty=0, mall_price_kobo=12345 WHERE id='p'");
    const purchased = await home();
    assert.equal(purchased.buyAgain.length, 1);
    assert.equal(purchased.buyAgain[0].id, 'p');
    assert.equal(purchased.buyAgain[0].price, 12345);
    assert.equal(purchased.buyAgain[0].available, false);
    assert.equal(purchased.topSellers[0].id, 'p');
    assert.deepEqual((await home('another-browser-session')).buyAgain, []);
    f.db.exec("UPDATE products SET status='Archived' WHERE id='p'");
    assert.deepEqual((await home()).buyAgain, []);
    assert.ok((await home()).topSellers.every((p: any) => p.id !== 'p'));
    f.db.exec("UPDATE products SET status='Active' WHERE id='p'; UPDATE mall_orders SET status='refunded'");
    assert.deepEqual((await home()).buyAgain, []);
    assert.equal((await f.send(new Request('http://test/api/mall/home'))).status, 400);
  });

  test(`${runtime}: wholesale tier prices cart lines and checkout at the quantity threshold`, async t => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    f.db.exec("UPDATE products SET wholesale_price_kobo=8000, min_wholesale_qty=5 WHERE id='p'");
    const cart = async () => (await (await f.send(new Request('http://test/api/mall/cart', { headers: { 'x-mall-session': session } }))).json()) as Promise<any>;
    const setQty = (qty: number) => f.send(new Request('http://test/api/mall/cart/qty', {
      method: 'POST', headers: { 'x-mall-session': session }, body: JSON.stringify({ productId: 'p', qty }),
    }));
    const detail = async () => ((await (await f.send(new Request('http://test/api/mall/products/p'))).json()) as any).product;
    assert.deepEqual((await detail()).wholesaleOffer, { price: 8000, minQty: 5 });
    await setQty(4);
    let c = await cart();
    assert.equal(c.items[0].price, 10000);
    assert.equal(c.items[0].listPrice, 10000);
    assert.equal(c.subtotalKobo, 40000);
    assert.deepEqual(c.items[0].wholesaleOffer, { price: 8000, minQty: 5 }, 'cart lines carry the tier for the Order Summary CTA');
    await setQty(5);
    c = await cart();
    assert.equal(c.items[0].price, 8000, 'the tier applies at the minimum wholesale quantity');
    assert.equal(c.items[0].listPrice, 10000, 'the listed price remains visible for the Wholesale badge');
    assert.equal(c.subtotalKobo, 40000);
    assert.deepEqual(c.items[0].wholesaleOffer, { price: 8000, minQty: 5 }, 'the offer survives past the threshold for the applied state');
    f.db.exec('UPDATE products SET min_selling_price_kobo=9000');
    assert.equal((await detail()).wholesaleOffer, null, 'a tier below the floor is never exposed');
    c = await cart();
    assert.equal(c.items[0].price, 10000, 'a tier below the floor never applies');
    assert.equal(c.items[0].wholesaleOffer, null, 'an invalid tier is not exposed on cart lines');
    f.db.exec('UPDATE products SET min_selling_price_kobo=0');
    f.db.exec("UPDATE products SET wholesale_price_kobo=10000 WHERE id='p'");
    c = await cart();
    assert.equal(c.items[0].price, 10000, 'a tier that is not a genuine discount never applies');
    f.db.exec("UPDATE products SET wholesale_price_kobo=8000 WHERE id='p'");
    const response = await f.checkout('wholesale-attempt-12345');
    assert.equal(response.status, 201);
    const order: any = await response.json();
    assert.equal(order.items[0].price, 8000);
    assert.equal(order.subtotalKobo, 40000);
    assert.equal(f.scalar('SELECT unit_price_kobo FROM mall_order_items'), 8000, 'the order line records the tier unit price');
    assert.equal(f.scalar('SELECT total_kobo FROM mall_order_items'), 40000);
  });

  test(`${runtime}: product promotional price applies only behind MALL_HONOR_POS_PROMOS`, async t => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    f.db.exec("UPDATE products SET promo_price_kobo=8000 WHERE id='p'");
    const price = async () => ((await (await f.send(new Request('http://test/api/mall/products/p'))).json()) as any).product.price;
    const staffDetail = async () => (await (await (runtime === 'worker'
      ? worker.fetch(new Request('http://test/api/staff/mall-listings/p', { headers: { cookie: `idofera_session=${f.token}` } }), f.env)
      : handleStaffMallListingApi(new Request('http://test/api/staff/mall-listings/p'), f.exec, actor))).json()) as Promise<any>;
    assert.equal(await price(), 10000, 'default OFF: the POS promotional price changes nothing');
    let staff = await staffDetail();
    assert.equal(staff.posPromosEnabled, false);
    assert.equal(staff.listing.posPromoPriceKobo, 8000, 'staff can review what enabling would change while it is still OFF');
    if (runtime === 'worker') f.env.MALL_HONOR_POS_PROMOS = 'true';
    else f.exec.config = { MALL_HONOR_POS_PROMOS: 'true' };
    assert.equal(await price(), 8000, 'honored when enabled');
    staff = await staffDetail();
    assert.equal(staff.posPromosEnabled, true);
    assert.equal(staff.listing.posPromoPriceKobo, 8000, 'the review field still reports the POS-promo price while ON');
    invalidateMallFacetCache();
    const home: any = await (await f.send(new Request('http://test/api/mall/home', { headers: { 'x-mall-session': session } }))).json();
    assert.ok(home.flashSales.some((p: any) => p.id === 'p'), 'an enabled POS promo feeds the flash-sales rail');
    f.db.exec('UPDATE products SET min_selling_price_kobo=9000');
    assert.equal(await price(), 10000, 'a POS promo below the floor is never honored');
    f.db.exec('UPDATE products SET min_selling_price_kobo=0, promo_price_kobo=12000');
    assert.equal(await price(), 10000, 'a POS promo above the current price never raises it');
    f.db.exec("UPDATE products SET promo_price_kobo=9000, mall_price_kobo=8500");
    assert.equal(await price(), 8500, 'an explicit Mall price beats the POS promo');
    f.db.exec('UPDATE products SET mall_price_kobo=NULL, mall_promo_price_kobo=7000, mall_promo_start=NULL, mall_promo_end=NULL');
    assert.equal(await price(), 7000, 'an active windowed Mall promo beats the POS promo');
  });

  test(`${runtime}: stock-first catalog ordering spans pages and preserves secondary sorts`, async t => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    f.db.exec("UPDATE products SET status='Archived' WHERE id='p'");
    for (let i = 0; i < 25; i++) {
      f.db.prepare(`INSERT INTO products(id,sku,name,brand,stock_qty,status,retail_price_kobo,created_at,updated_at)
        VALUES(?,?,?,'Test',?,'Active',?,'now','now')`).run(`stock-${i}`, `stock-${i}`, `Stock product ${i}`, i < 12 ? 0 : 5, (i + 1) * 100);
    }
    for (const search of ['', '&q=Stock']) {
      for (const sort of ['price_asc', 'price_desc']) {
        const products: any[] = [];
        for (const offset of [0, 10, 20]) {
          const response = await f.send(new Request(`http://test/api/mall/products?stockFirst=1&brand=Test&sort=${sort}&limit=10&offset=${offset}${search}`));
          assert.equal(response.status, 200);
          const page: any = await response.json();
          assert.equal(page.total, 25);
          products.push(...page.products);
        }
        assert.equal(new Set(products.map(p => p.id)).size, 25);
        assert.ok(products.slice(0, 13).every(p => p.stock > 0));
        assert.ok(products.slice(13).every(p => p.stock === 0));
        for (const group of [products.slice(0, 13), products.slice(13)]) {
          const prices = group.map(p => p.price);
          assert.deepEqual(prices, [...prices].sort((a, b) => sort === 'price_asc' ? a - b : b - a));
        }
      }
    }
    const ordinary: any = await (await f.send(new Request('http://test/api/mall/products?sort=price_asc'))).json();
    assert.equal(ordinary.products[0].stock, 0, 'Other catalogs keep their normal ordering');
    assert.equal((await f.send(new Request('http://test/api/mall/products?stockFirst=invalid'))).status, 400);
  });

  test(`${runtime}: unpriced products stay visible but cannot be purchased`, async t => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    f.db.exec('UPDATE products SET retail_price_kobo=0');
    const catalog: any = await (await f.send(new Request('http://test/api/mall/products'))).json();
    assert.equal(catalog.total, 1);
    assert.equal(catalog.products[0].available, false);
    const detail: any = await (await f.send(new Request('http://test/api/mall/products/p'))).json();
    assert.equal(detail.product.available, false);
    const cart: any = await (await f.send(new Request('http://test/api/mall/cart', { headers: { 'x-mall-session': session } }))).json();
    assert.equal(cart.items[0].available, false);
    for (const path of ['/cart', '/cart/qty']) {
      const response = await f.send(new Request(`http://test/api/mall${path}`, { method: 'POST', headers: { 'x-mall-session': session }, body: JSON.stringify({ productId: 'p', qty: 1 }) }));
      assert.equal(response.status, 409);
    }
    assert.equal((await f.checkout()).status, 409);
    assert.equal(f.scalar('SELECT COUNT(*) FROM mall_orders'), 0);
    assert.equal(f.scalar('SELECT stock_qty FROM products'), 10);
    f.db.exec('UPDATE products SET mall_price_kobo=500');
    const priced: any = await (await f.send(new Request('http://test/api/mall/products/p'))).json();
    assert.equal(priced.product.available, true);
  });
  test(`${runtime}: forgiving search ranks, paginates, filters and labels typo fallback`, async t => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    f.db.exec("UPDATE products SET name='Spray Bottle 500 ml', brand='Acme', category_name='Packaging'; INSERT INTO products(id,sku,name,brand,stock_qty,status,is_mall_listed,retail_price_kobo,created_at,updated_at) VALUES('p2','p2','Spray Bottle','Other',0,'Active',1,500,'now','now')");
    const search = async (query: string, extra = '') => {
      const response = await f.send(new Request(`http://test/api/mall/products?q=${encodeURIComponent(query)}${extra}`));
      assert.equal(response.status, 200);
      return await response.json() as any;
    };
    for (const query of ['spraybottle', 'bottle spray', 'spray   bottle', 'bot tle']) {
      const result = await search(query);
      assert.equal(result.total, 2, query);
      assert.equal(result.search.approximate, false);
    }
    const exact = await search('Spray Bottle', '&limit=1');
    assert.equal(exact.products[0].id, 'p2');
    assert.equal(exact.total, 2);
    assert.equal((await search('Spray Bottle', '&limit=1&offset=1')).products[0].id, 'p');
    const fuzzy = await search('spray bottel');
    assert.equal(fuzzy.total, 2);
    assert.equal(fuzzy.search.approximate, true);
    assert.equal(fuzzy.brands.length, 2);
    assert.equal((await search('spray bottel', '&brand=Acme')).total, 1);
    assert.equal((await search('spray bottel', '&inStock=1')).total, 1);
    assert.equal((await search('500ml botle')).total, 1);
    assert.equal((await search('5000ml bottle')).total, 0);
    assert.equal((await search('spraybottle', '&sort=price_asc')).products[0].id, 'p2');
    f.db.exec("UPDATE products SET name='Spray Bottel' WHERE id='p2'");
    const strong = await search('spray bottel');
    assert.equal(strong.total, 1);
    assert.equal(strong.search.approximate, false);
  });

  test(`${runtime}: live search matches categories and escapes wildcard characters`, async t => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    f.db.exec("UPDATE products SET category_name='Special Bottles 100%_safe', stock_qty=0");
    for (const q of ['special bottles', '100%_safe']) {
      const response = await f.send(new Request(`http://test/api/mall/products?q=${encodeURIComponent(q)}&limit=6`));
      assert.equal(response.status, 200);
      const result: any = await response.json();
      assert.equal(result.total, 1);
      assert.equal(result.products[0].id, 'p');
      assert.equal(result.products[0].available, false);
      assert.equal(result.products[0].costPrice, undefined);
    }
    const unmatched: any = await (await f.send(new Request('http://test/api/mall/products?q=100X'))).json();
    assert.equal(unmatched.total, 0);
    f.db.exec("UPDATE products SET status='Archived'");
    const archived: any = await (await f.send(new Request('http://test/api/mall/products?q=bottles'))).json();
    assert.equal(archived.total, 0);
  });

  test(`${runtime}: catalog, direct detail, description, pagination and cart concurrency`, async t => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    f.db.exec("UPDATE products SET mall_description='Public description',mall_price_kobo=12000; INSERT INTO products(id,sku,name,stock_qty,status,is_mall_listed,retail_price_kobo,created_at,updated_at) VALUES('hidden','hidden','Hidden',10,'Active',0,100,'now','now')");
    const detail: any = await (await f.send(new Request('http://test/api/mall/products/p'))).json();
    assert.equal(detail.product.description, 'Public description'); assert.equal(detail.product.price, 12000);
    assert.equal((await f.send(new Request('http://test/api/mall/products/hidden'))).status, 200);
    const catalog: any = await (await f.send(new Request('http://test/api/mall/products?limit=1&offset=1&q=Product'))).json();
    assert.equal(catalog.total, 1); assert.equal(catalog.products.length, 0);
    const add = () => f.send(new Request('http://test/api/mall/cart', { method: 'POST', headers: { 'x-mall-session': session }, body: JSON.stringify({ productId: 'p', qty: 1 }) }));
    const responses = await Promise.all([add(), add()]); assert.ok(responses.every(r => r.ok));
    assert.equal(f.scalar('SELECT qty FROM mall_cart_items'), 4);
    const cart: any = await (await f.send(new Request('http://test/api/mall/cart', { headers: { 'x-mall-session': session } }))).json();
    assert.equal(cart.subtotalKobo, 48000);
  });

  test(`${runtime}: private tracking, reference search, timeline and normalized matching`, async t => {
    const f = await fixture(runtime); t.after(() => f.db.close()); const receipt: any = await (await f.checkout()).json();
    assert.equal((await f.send(new Request('http://test/api/mall/orders?phone=08031234567'))).status, 400);
    const track = async (phone: string) => (await (await f.send(new Request(`http://test/api/mall/orders?orderNo=${receipt.orderNo}&phone=${encodeURIComponent(phone)}`))).json()) as any;
    assert.equal((await track('+2348031234567')).orders.length, 1);
    assert.equal((await track('+2348031234568')).orders.length, 0);
    const search = await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders?q=${receipt.paymentReference}`), f.exec, actor);
    assert.equal((await search.json() as any).total, 1);
    await f.op('confirm'); await f.pay();
    const result: any = await (await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${f.id()}`), f.exec, actor)).json();
    assert.equal(result.order.timeline.length, 3);
    assert.ok(result.order.timeline.every((event: any) => event.createdAt && event.actorId));
    assert.equal(f.scalar('SELECT COUNT(*) FROM notifications'), 1);
    assert.equal(f.scalar('SELECT COUNT(*) FROM mall_outbox'), 3);
  });

  test(`${runtime}: maximum supported cart commits atomically`, async t => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    f.db.exec('DELETE FROM mall_cart_items');
    for (let i = 0; i < 100; i++) {
      f.db.prepare("INSERT INTO products(id,sku,name,stock_qty,status,is_mall_listed,retail_price_kobo,created_at,updated_at) VALUES(?,?,?,2,'Active',1,100,'now','now')").run(`max-${i}`, `max-${i}`, `Max ${i}`);
      f.db.prepare('INSERT INTO mall_cart_items(id,cart_id,product_id,qty,unit_price_kobo) VALUES(?,?,?,1,100)').run(`max-${i}`, `mc-${session}`, `max-${i}`);
    }
    assert.equal((await f.checkout()).status, 201);
    assert.equal(f.scalar('SELECT COUNT(*) FROM mall_order_items'), 100);
    assert.equal(f.scalar('SELECT COUNT(*) FROM stock_movements'), 100);
  });

  test(`${runtime}: serviceability, dispatch, delivery and return record stay synchronized`, async t => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    assert.equal((await f.checkout(attempt, { deliveryZone: 'uyo_central', deliveryAddress: 'Test street, central Uyo' })).status, 201);
    assert.equal((await f.op('confirm')).status, 409);
    assert.equal((await f.op('review-delivery', { confirmed: true }, 'Sales Staff')).status, 403);
    assert.equal((await f.op('review-delivery', { confirmed: true })).status, 200);
    assert.equal((await f.op('confirm')).status, 200);
    assert.equal((await f.op('collect-payment', { paymentMethod: 'Cash', amountKobo: 170000 })).status, 200);
    assert.equal((await f.op('mark-packed')).status, 200);
    assert.equal((await f.op('mark-ready')).status, 409);
    assert.equal((await f.op('mark-out-for-delivery')).status, 400);
    assert.equal((await f.op('mark-out-for-delivery', { courier: 'Test courier' })).status, 200);
    assert.equal(f.scalar('SELECT status FROM delivery_orders'), 'In Transit');
    assert.throws(() => f.db.exec("UPDATE delivery_orders SET status='Delivered'"));
    assert.equal((await f.op('complete')).status, 200);
    assert.equal(f.scalar('SELECT status FROM delivery_orders'), 'Delivered');
    assert.equal((await f.op('refund', { reason: 'Return', returnStock: true })).status, 400);
    assert.equal((await f.op('refund', { reason: 'Return', returnStock: true, returnReference: 'GRN-TEST' })).status, 200);
    assert.equal(f.scalar('SELECT status FROM delivery_orders'), 'Returned');
    assert.equal(f.scalar('SELECT receipt_reference FROM mall_returns'), 'GRN-TEST');
    assert.equal(f.scalar('SELECT stock_qty FROM products'), 10);
  });

  test(`${runtime}: mall writes bump the sync revision so a guarded snapshot returns the mirrored sale`, async t => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    await f.checkout();
    const guardedGet = (guard?: string) => worker.fetch(new Request('http://test/api/storage/snapshot?fresh=true', {
      headers: { cookie: `idofera_session=${f.token}`, ...(guard ? { 'if-none-match': `"${guard}"` } : {}) },
    }), f.env);
    const before = await guardedGet();
    assert.equal(before.status, 200);
    const beforeBody = await before.json() as any;
    assert.ok(beforeBody.revision > 0, 'checkout already bumped the revision (stock and movements are client-visible)');
    const guard = `${beforeBody.revision}-${beforeBody.backend}`;
    await f.pay();
    const stale = await guardedGet(guard);
    assert.equal(stale.status, 200, 'settlement bumped the revision: the pre-settlement guard must not 304');
    const staleBody = await stale.json() as any;
    const sale = (staleBody.stores.sales || []).find((s: any) => s.id === `sale-${f.id()}`);
    assert.ok(sale, 'the re-read returns the relational Sale');
    assert.equal(sale.status, 'Completed');
    const fresh = await guardedGet(`${staleBody.revision}-${staleBody.backend}`);
    assert.equal(fresh.status, 304, 'the post-settlement guard 304s until the next write');
  });

  test(`${runtime}: legacy ?since= watermarks are ignored — every read is a full snapshot`, async t => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    await f.checkout();
    await f.pay();
    // Option B: a stale composite watermark must not shrink the read. The
    // endpoint serves the full snapshot, so an open workspace converges on the
    // settlement without a delta envelope.
    const legacy = await worker.fetch(new Request('http://test/api/storage/snapshot?since=' + encodeURIComponent(JSON.stringify({ ms: 0, collection: '', documentId: '' })), {
      headers: { cookie: `idofera_session=${f.token}` },
    }), f.env);
    assert.equal(legacy.status, 200);
    const body = await legacy.json() as any;
    assert.equal(body.delta, undefined, 'no delta envelope anymore');
    assert.equal(body.cursor, undefined, 'the server no longer issues keyset cursors');
    assert.equal(body.bounded, undefined, 'a full read is never page-bounded');
    const sale = (body.stores.sales || []).find((s: any) => s.id === `sale-${f.id()}`);
    assert.ok(sale, 'the full read delivers the settlement Sale');
    assert.ok(sale.invoiceNo.startsWith('INV-'), 'the sale keeps the snapshot sale shape');
    assert.equal(sale.totalAmount, 200, 'the sale is in naira like every other sale doc');
    assert.ok((body.stores.customers || []).some((c: any) => c.id === `cust-${f.id()}`), 'the settlement customer is delivered');
    assert.ok((body.stores.moneyMovements || []).some((m: any) => m.id === `mm-sale-${f.id()}`), 'the Sale Inflow is delivered');
    assert.ok((body.stores.products || []).some((p: any) => p.id === 'p' && p.currentStock === 8), 'the checkout stock change is delivered');
    assert.ok((body.stores.stockMovements || []).some((m: any) => String(m.referenceNo) === `checkout:${f.id()}`), 'the checkout stock movement is delivered');
    assert.ok((body.stores.notifications || []).some((x: any) => x.id === `mall:${f.id()}`), 'the new-order notification is delivered');
  });
  test(`${runtime}: simultaneous checkout retries return one order; new attempt permits repeat purchase`, async (t) => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    const responses = await Promise.all([f.checkout(), f.checkout()]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 201]);
    const orders = await Promise.all(responses.map((r) => r.json() as Promise<any>));
    assert.equal(orders[0].orderNo, orders[1].orderNo);
    assert.equal(f.scalar('SELECT COUNT(*) FROM payments'), 1);
    assert.equal(f.scalar('SELECT stock_qty FROM products'), 8);
    assert.equal((await f.checkout(attempt, { customerName: 'Someone else' })).status, 409);
    assert.equal((await f.checkout(attempt, {}, 'different-session')).status, 409);
    await f.pay();
    const replay: any = await (await f.checkout()).json();
    assert.equal(replay.paymentStatus, 'paid'); assert.equal(replay.paidKobo, 20000); assert.equal(replay.amountDueKobo, 0);
    f.fill();
    assert.equal((await f.checkout('second-attempt-12345678')).status, 201);
    assert.equal(f.scalar('SELECT COUNT(*) FROM mall_orders'), 2);
    assert.equal(f.scalar('SELECT stock_qty FROM products'), 6);
  });

  test(`${runtime}: competing checkout sessions cannot oversell`, async (t) => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    f.db.exec('UPDATE products SET stock_qty = 2'); f.fill('other-session-123');
    const responses = await Promise.all([f.checkout(), f.checkout('other-attempt-12345678', {}, 'other-session-123')]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
    assert.equal(f.scalar('SELECT stock_qty FROM products'), 0);
    assert.equal(f.scalar('SELECT COUNT(*) FROM mall_orders'), 1);
    assert.equal(f.scalar('SELECT COUNT(*) FROM mall_checkout_attempts'), 1);
  });

  test(`${runtime}: payment racing cancellation never produces paid, restored stock`, async (t) => {
    const f = await fixture(runtime); t.after(() => f.db.close()); await f.checkout();
    const results = await Promise.all([f.pay(), f.op('cancel', { reason: 'Cancelled' })]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const paid = f.scalar('SELECT status FROM payments') === 'paid';
    assert.equal(f.scalar('SELECT stock_qty FROM products'), paid ? 8 : 10);
    assert.equal(f.scalar('SELECT COUNT(*) FROM sales'), paid ? 1 : 0);
    assert.equal(f.scalar('SELECT COUNT(*) FROM money_movements'), paid ? 1 : 0);
  });

  test(`${runtime}: duplicate payment/cancel/refund operations commit once`, async (t) => {
    const f = await fixture(runtime); t.after(() => f.db.close()); await f.checkout();
    const payments = await Promise.all([f.pay(), f.pay()]);
    assert.ok(payments.every((r) => r.status === 200));
    assert.equal(f.scalar('SELECT COUNT(*) FROM sales'), 1);
    assert.equal(f.scalar('SELECT COUNT(*) FROM money_movements'), 1);
    assert.equal((await f.op('refund', { reason: 'Return' })).status, 400);
    const refunds = await Promise.all([f.op('refund', { reason: 'Return', returnStock: true }), f.op('refund', { reason: 'Return', returnStock: true })]);
    assert.ok(refunds.every((r) => r.status === 200));
    assert.equal(f.scalar('SELECT stock_qty FROM products'), 10);
    assert.equal(f.scalar("SELECT COUNT(*) FROM money_movements WHERE type = 'Refund Outflow'"), 1);
    assert.equal((await f.op('mark-packed')).status, 409);
    const c = await fixture(runtime); t.after(() => c.db.close()); await c.checkout();
    const cancellations = await Promise.all([c.op('cancel'), c.op('cancel')]);
    assert.ok(cancellations.every((r) => r.status === 200));
    assert.equal(c.scalar('SELECT stock_qty FROM products'), 10);
  });

  test(`${runtime}: explicit no-restock refund preserves inventory`, async (t) => {
    const f = await fixture(runtime); t.after(() => f.db.close()); await f.checkout(); await f.pay();
    assert.equal((await f.op('refund', { reason: 'Damaged goods', returnStock: false })).status, 200);
    assert.equal(f.scalar('SELECT stock_qty FROM products'), 8);
  });

  test(`${runtime}: refund racing dispatch cannot overwrite the winning state`, async (t) => {
    const f = await fixture(runtime); t.after(() => f.db.close()); await f.checkout(); await f.pay();
    f.db.exec(`UPDATE mall_orders SET delivery_address_json=json_set(delivery_address_json,'$.zone','uyo_central')`);
    await f.op('mark-packed');
    const results = await Promise.all([f.op('refund', { reason: 'Returned', returnStock: true }), f.op('mark-out-for-delivery', { courier: 'Test courier' })]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const refunded = f.scalar('SELECT status FROM mall_orders') === 'refunded';
    assert.equal(f.scalar('SELECT stock_qty FROM products'), refunded ? 10 : 8);
    assert.equal(f.scalar('SELECT COUNT(*) FROM delivery_orders'), refunded ? 0 : 1);
  });

  test(`${runtime}: complete catalog pages in batches of ten without omitting sold-out items`, async (t) => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    const insert = f.db.prepare(`INSERT INTO products(id,sku,name,stock_qty,status,is_mall_listed,retail_price_kobo,created_at,updated_at)
      VALUES(?,?,?,?, 'Active',0,10000,'now','now')`);
    for (let i = 0; i < 25; i += 1) insert.run(`page-${i}`, `PAGE-${i}`, `Paged product ${i}`, i % 2);
    const ids: string[] = [];
    for (const offset of [0, 10, 20]) {
      const result = await (await f.send(new Request(`http://test/api/mall/products?q=Paged&limit=10&offset=${offset}`))).json() as any;
      assert.equal(result.total, 25);
      assert.equal(result.products.length, offset === 20 ? 5 : 10);
      ids.push(...result.products.map((p: any) => p.id));
      assert.ok(result.products.some((p: any) => !p.available));
    }
    assert.equal(new Set(ids).size, 25);
  });

  test(`${runtime}: catalog shows only Active products regardless of legacy listing approval`, async (t) => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    const insert = f.db.prepare(`INSERT INTO products(id,sku,name,stock_qty,status,is_mall_listed,retail_price_kobo,category_name,brand,created_at,updated_at)
      VALUES(?,?,?,?,?,?,10000,'Catalog','Catalog Brand','now','now')`);
    insert.run('sold-out', 'OUT', 'Sold out product', 0, 'Active', 0);
    insert.run('low-stock', 'LOW', 'Low stock product', 2, 'Active', 0);
    insert.run('archived', 'ARC', 'Archived product', 10, 'Archived', 1);
    insert.run('inactive', 'INA', 'Inactive product', 10, 'Inactive', 1);
    const catalog = await (await f.send(new Request('http://test/api/mall/products?category=Catalog'))).json() as any;
    assert.equal(catalog.total, 2);
    assert.deepEqual(catalog.products.map((p: any) => p.id).sort(), ['low-stock', 'sold-out']);
    assert.equal(catalog.products.find((p: any) => p.id === 'sold-out').available, false);
    assert.equal(catalog.products.find((p: any) => p.id === 'low-stock').available, true);
    assert.equal(catalog.categories.find((c: any) => c.name === 'Catalog').count, 2);
    assert.equal(catalog.brands.find((b: any) => b.name === 'Catalog Brand').count, 2);
    const filtered = await (await f.send(new Request('http://test/api/mall/products?category=Catalog&inStock=1'))).json() as any;
    assert.equal(filtered.total, 1);
    const page = await (await f.send(new Request('http://test/api/mall/products?category=Catalog&limit=1&offset=1'))).json() as any;
    assert.equal(page.total, 2); assert.equal(page.products.length, 1);
    assert.equal((await f.send(new Request('http://test/api/mall/products/sold-out'))).status, 200);
    assert.equal((await f.send(new Request('http://test/api/mall/products/archived'))).status, 404);
    const add = (productId: string) => f.send(new Request('http://test/api/mall/cart', {
      method: 'POST', headers: { 'x-mall-session': session }, body: JSON.stringify({ productId, qty: 1 }),
    }));
    assert.equal((await add('sold-out')).status, 409);
    assert.equal((await add('archived')).status, 404);
    assert.equal((await add('inactive')).status, 404);
    assert.equal((await f.send(new Request('http://test/api/mall/products/inactive'))).status, 404);
    assert.equal((await add('low-stock')).status, 200);
    f.db.exec("UPDATE products SET status='Inactive' WHERE id='low-stock'");
    const inactiveCart = await (await f.send(new Request('http://test/api/mall/cart', { headers: { 'x-mall-session': session } }))).json() as any;
    assert.equal(inactiveCart.items.find((p: any) => p.productId === 'low-stock').available, false);
    assert.equal((await f.checkout()).status, 409);
    assert.equal(f.scalar('SELECT COUNT(*) FROM mall_orders'), 0);
    f.db.exec("UPDATE products SET status='Active' WHERE id='low-stock'");
    f.db.exec("UPDATE products SET stock_qty=0 WHERE id='low-stock'");
    const cart = await (await f.send(new Request('http://test/api/mall/cart', { headers: { 'x-mall-session': session } }))).json() as any;
    assert.equal(cart.items.find((p: any) => p.productId === 'low-stock').available, false);
    assert.equal((await f.checkout()).status, 409);
    f.db.exec("UPDATE products SET stock_qty=2 WHERE id='low-stock'");
    assert.equal((await f.checkout()).status, 201);
  });

  test(`${runtime}: brand and availability filters, sort whitelist and pagination totals`, async (t) => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    const beta = f.db.prepare(`INSERT INTO products(id,sku,name,stock_qty,status,is_mall_listed,retail_price_kobo,created_at,updated_at,brand,mall_featured,mall_display_order)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
    beta.run('alpha-bucket', 'AB', 'Alpha Bucket', 5, 'Active', 1, 50000, '2020-01-01T00:00:00.000Z', '2026-09-18T11:00:00.000Z', 'Acme', 1, 5);
    beta.run('beta-jug', 'BJ', 'Beta Jug', 5, 'Active', 1, 10000, '2024-01-01T00:00:00.000Z', 'now', 'Beta', 0, null);
    beta.run('gamma-pail', 'GP', 'Gamma Pail', 5, 'Active', 1, 30000, '2022-01-01T00:00:00.000Z', '2026-09-18T10:00:00.000Z', 'Acme', 0, 1);
    const page = async (query: string) => (await (await f.send(new Request(`http://test/api/mall/products?${query}`))).json()) as any;
    const asc = await page('sort=price_asc');
    assert.deepEqual(asc.products.map((p: any) => p.id), ['beta-jug', 'p', 'gamma-pail', 'alpha-bucket']);
    assert.equal(asc.sort, 'price_asc');
    const desc = await page('sort=price_desc');
    assert.deepEqual(desc.products.map((p: any) => p.id), ['alpha-bucket', 'gamma-pail', 'beta-jug', 'p']);
    const relevance = await page('');
    assert.deepEqual(relevance.products.map((p: any) => p.id).slice(0, 2), ['alpha-bucket', 'gamma-pail']);
    const newest = await page('sort=newest');
    const created = (id: string) => newest.products.find((p: any) => p.id === id)?.createdAt;
    assert.ok(typeof created('beta-jug') === 'string');
    for (let i = 1; i < newest.products.length; i += 1) {
      assert.ok(newest.products[i - 1].createdAt >= newest.products[i].createdAt, 'newest sort must be descending by created_at');
    }
    const acme = await page('brand=Acme');
    assert.deepEqual(acme.products.map((p: any) => p.id).sort(), ['alpha-bucket', 'gamma-pail']);
    assert.equal(acme.total, 2);
    assert.ok(acme.brands.some((brand: any) => brand.name === 'Acme' && brand.count === 2));
    assert.equal((await page('inStock=1')).total, 4);
    assert.equal((await f.send(new Request('http://test/api/mall/products?sort=cheapest'))).status, 400);
    assert.equal((await f.send(new Request('http://test/api/mall/products?inStock=2'))).status, 400);
    assert.equal((await f.send(new Request('http://test/api/mall/products?offset=10001'))).status, 400);
    const limited = await page('limit=2&offset=1&sort=price_asc');
    assert.deepEqual(limited.products.map((p: any) => p.id), ['p', 'gamma-pail']);
    assert.equal(limited.total, 4);
  });

  test(`${runtime}: catalog page+total is one windowed query and facets come from the cache`, async (t) => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    const insert = f.db.prepare(`INSERT INTO products(id,sku,name,stock_qty,status,is_mall_listed,retail_price_kobo,category_name,brand,created_at,updated_at)
      VALUES(?,?,?,?,?,?,10000,'Catalog','Catalog Brand','now','now')`);
    for (let i = 0; i < 7; i += 1) insert.run(`win-${i}`, `WIN-${i}`, `Window product ${i}`, 5, 'Active', 1);
    const queries: string[] = [];
    const instrumented: MallExecutor = { ...f.exec, queryAll: async (sql, params) => { queries.push(sql); return f.exec.queryAll(sql, params); } };
    const catalog = async (query: string) => (await (await handleMallApi(new Request(`http://test/api/mall/products?${query}`), instrumented)).json()) as any;
    const pageQueries = () => queries.filter((sql) => sql.includes('COUNT(*) OVER()')).length;
    const facetQueries = () => queries.filter((sql) => sql.includes('GROUP BY')).length;

    queries.length = 0;
    const first = await catalog('limit=3&sort=price_asc');
    assert.equal(first.total, 8);
    assert.equal(first.products.length, 3);
    assert.equal(pageQueries(), 1);
    assert.equal(facetQueries(), 2);

    queries.length = 0;
    const second = await catalog('limit=3&sort=price_asc&offset=6');
    assert.equal(second.total, 8);
    assert.equal(second.products.length, 2);
    assert.equal(pageQueries(), 1);
    assert.equal(facetQueries(), 0);

    // Out-of-range page: the windowed query still executes (instrumentation
    // counts executions), but no row comes back so the window total is absent
    // and the plain COUNT fallback also runs. Both agree on the total.
    queries.length = 0;
    const beyond = await catalog('limit=3&offset=9&sort=price_asc');
    assert.equal(beyond.products.length, 0);
    assert.equal(beyond.total, 8);
    assert.equal(pageQueries(), 1);
    assert.equal(facetQueries(), 0);
  });

  test(`${runtime}: warm homepage serves cached rails; merchandising and checkout writes drop them`, async (t) => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    // Product 'p' has no Mall price, so seed a discount candidate for the
    // flash-sales rail.
    f.db.prepare(`INSERT INTO products(id,sku,name,stock_qty,status,is_mall_listed,retail_price_kobo,mall_price_kobo,created_at,updated_at)
      VALUES('rail-flash','RAIL-FLASH','Rail flash',5,'Active',1,10000,8000,'now','now')`).run();
    const queries: string[] = [];
    const instrumented: MallExecutor = { ...f.exec, queryAll: async (sql, params) => { queries.push(sql); return f.exec.queryAll(sql, params); } };
    const home = async () => {
      const response = await handleMallApi(new Request('http://test/api/mall/home', { headers: { 'x-mall-session': session } }), instrumented);
      assert.equal(response.status, 200);
      return await response.json() as any;
    };
    // The three shared rails: flash (marked by its discount predicate) and the
    // two ROW_NUMBER rails; buyAgain also uses ROW_NUMBER but is session-scoped.
    const railQueries = () => queries.filter((sql) =>
      (sql.includes('ROW_NUMBER() OVER') && !sql.includes('last_purchase')) || sql.includes('< retail_price_kobo')).length;

    queries.length = 0;
    const first = await home();
    assert.equal(first.flashSales.length, 1);
    assert.equal(railQueries(), 3);

    queries.length = 0;
    const warm = await home();
    assert.deepEqual(warm.flashSales.map((p: any) => p.id), first.flashSales.map((p: any) => p.id));
    assert.equal(railQueries(), 0, 'a warm homepage must serve all three shared rails from the cache');

    // A merchandising save can reshape the flash rail: 'p' gains a Mall price
    // and must appear after the write, not after the TTL.
    const listing = await handleStaffMallListingApi(
      new Request('http://test/api/staff/mall-listings/p', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mallPriceKobo: 9500 }),
      }), f.exec, actor);
    assert.equal(listing.status, 200);
    queries.length = 0;
    const postListing = await home();
    assert.equal(railQueries(), 3, 'a merchandising save must drop the rail cache');
    assert.ok(postListing.flashSales.some((p: any) => p.id === 'p'), 'the fresh rail must reflect the new Mall price');

    // Checkout changes stock and purchase counts; same invalidation contract.
    queries.length = 0;
    assert.equal(railQueries(), 0);
    assert.equal((await f.checkout()).status, 201);
    queries.length = 0;
    const postCheckout = await home();
    assert.equal(railQueries(), 3, 'a checkout must drop the rail cache');
    assert.equal(new Set(postCheckout.flashSales.map((p: any) => p.id).sort()).size, 2);
  });

  test(`${runtime}: invalid customer/payment/session and stale eligibility return HTTP errors`, async (t) => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    for (const invalid of [{ customerName: '' }, { customerPhone: '123' }, { paymentMethod: 'invented' }, { customerName: 'a'.repeat(121) }, { note: '\u0000' }]) {
      const response = await f.checkout(attempt, invalid);
      assert.equal(response.status, 400); assert.ok((await response.json() as any).fields);
    }
    assert.equal((await f.checkout('', {})).status, 400);
    assert.equal((await f.checkout(attempt, {}, 'bad')).status, 400);
    f.db.exec("UPDATE products SET status='Archived'");
    assert.equal((await f.checkout()).status, 409);
    f.db.exec("UPDATE products SET status='Active', retail_price_kobo=0");
    assert.equal((await f.checkout()).status, 409);
    assert.equal(f.scalar('SELECT COUNT(*) FROM mall_orders'), 0);
    f.db.exec('DELETE FROM mall_cart_items');
    assert.equal((await f.checkout()).status, 400);
  });

  test(`${runtime}: failures late in checkout and settlement roll back every write`, async (t) => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    f.db.exec("CREATE TRIGGER fail_payment BEFORE INSERT ON payments BEGIN SELECT RAISE(ABORT,'injected failure'); END");
    assert.equal((await f.checkout()).status, 500);
    for (const table of ['mall_orders', 'mall_order_items', 'mall_checkout_attempts', 'stock_movements', 'payments']) assert.equal(f.scalar(`SELECT COUNT(*) FROM ${table}`), 0);
    assert.equal(f.scalar('SELECT stock_qty FROM products'), 10);
    assert.equal(f.scalar('SELECT COUNT(*) FROM mall_cart_items'), 1);
    f.db.exec('DROP TRIGGER fail_payment'); await f.checkout();
    f.db.exec("CREATE TRIGGER fail_money BEFORE INSERT ON money_movements BEGIN SELECT RAISE(ABORT,'injected failure'); END");
    assert.equal((await f.pay()).status, 500);
    for (const table of ['sales', 'sale_items', 'customers', 'money_movements', 'audit_logs']) assert.equal(f.scalar(`SELECT COUNT(*) FROM ${table}`), 0);
    assert.equal(f.scalar('SELECT status FROM payments'), 'pending');
    assert.equal(f.scalar('SELECT linked_sale_id FROM mall_orders'), null);
  });

  test(`${runtime}: unauthorized staff operations and transfer permission bypass are rejected`, async (t) => {
    const f = await fixture(runtime); t.after(() => f.db.close()); await f.checkout();
    for (const action of ['confirm', 'cancel', 'collect-payment', 'verify-payment', 'refund', 'mark-packed', 'quote-delivery']) {
      assert.equal((await f.op(action, {}, 'Viewer')).status, 403);
    }
    assert.equal((await f.op('collect-payment', { paymentMethod: 'Bank Transfer', amountKobo: 20000 }, 'Sales Staff')).status, 403);
    assert.equal((await f.op('refund', { reason: 'Return', returnStock: true }, 'Store Manager')).status, 403);
    if (runtime === 'worker') assert.equal((await worker.fetch(new Request('http://test/api/staff/mall-orders'), f.env)).status, 401);
    else assert.equal((await handleStaffMallApi(new Request('http://test/api/staff/mall-orders'), f.exec, null as any)).status, 401);
  });
}

test('Worker static routes bypass Mall and unexpected async errors become safe responses', async (t) => {
  const f = await fixture('worker'); t.after(() => f.db.close());
  for (const path of ['/', '/mall', '/assets/app.js']) {
    const response = await worker.fetch(new Request(`http://test${path}`), f.env);
    assert.equal(response.status, 200); assert.match(await response.text(), /^asset:/);
  }
  f.env.DB.prepare = () => { throw new Error('database unavailable'); };
  const dbError = await worker.fetch(new Request('http://test/api/mall/products'), f.env);
  // Unexpected errors must never escape as non-Response throws: a 500 JSON
  // body with an `error` string is the contract (Mall domain errors are
  // preserved at the route handler level; this catch is the generic fallback).
  assert.equal(dbError.status, 500);
  assert.equal(dbError.headers.get('content-type'), 'application/json; charset=utf-8');
  const body = await dbError.json() as { error: string };
  assert.equal(typeof body.error, 'string');
});

test('outbox signatures, exclusive leases, retry, dead letters and readiness', async t => {
  const f = await fixture('node'); t.after(() => f.db.close());
  f.exec.config = { MALL_CHECKOUT_ENABLED: 'true', MALL_PICKUP_ADDRESS: 'Test pickup', MALL_PICKUP_HOURS: 'Test hours', MALL_BANK_NAME: 'Test bank', MALL_BANK_ACCOUNT_NAME: 'Test business', MALL_BANK_ACCOUNT_NUMBER: '0000000000', MALL_WEBHOOK_URL: 'https://notifications.example.test/mall', MALL_WEBHOOK_SECRET: 'test-secret-only-12345678901234567890' };
  await f.checkout(); let count = 0;
  const send: typeof fetch = async (_url, options) => {
    count++;
    const headers = new Headers(options?.headers); const timestamp = headers.get('x-mall-timestamp')!;
    assert.equal(headers.get('x-mall-signature'), `sha256=${await signMallWebhook(f.exec.config!.MALL_WEBHOOK_SECRET!, timestamp, String(options?.body))}`);
    return new Response(null, { status: 204 });
  };
  await Promise.all([drainMallOutbox(f.exec, send), drainMallOutbox(f.exec, send)]);
  assert.equal(count, 1); assert.equal(f.scalar("SELECT status FROM mall_outbox LIMIT 1"), 'delivered');
  await f.op('confirm');
  await drainMallOutbox(f.exec, async () => new Response(null, { status: 503 }));
  assert.equal(f.scalar("SELECT attempts FROM mall_outbox WHERE status='pending'"), 1);
  f.db.exec("UPDATE mall_outbox SET attempts=9,next_attempt_at=0 WHERE status='pending'");
  await drainMallOutbox(f.exec, async () => new Response(null, { status: 503 }));
  assert.equal(f.scalar("SELECT COUNT(*) FROM mall_outbox WHERE status='dead'"), 1);
  assert.equal((await mallReadiness(f.exec)).ready, false);
  await handleStaffMallApi(new Request('http://test/api/staff/mall-orders/retry-notifications', { method: 'POST' }), f.exec, actor);
  await runMallMaintenance(f.exec, async () => new Response(null, { status: 409 }), send);
  assert.equal((await mallReadiness(f.exec)).ready, true);
  f.db.exec('DROP TRIGGER trg_products_no_oversell');
  assert.equal((await mallReadiness(f.exec)).ready, false);
});

test('unpaid expiry restores stock once, cleans abandoned carts and emits cancellation event', async t => {
  const f = await fixture('node'); t.after(() => f.db.close()); await f.checkout();
  f.db.exec("UPDATE mall_orders SET created_at='2020-01-01T00:00:00.000Z';UPDATE mall_carts SET updated_at=0");
  const expire = (id: string) => handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: 'Expired unpaid' }) }), f.exec, actor);
  await runMallMaintenance(f.exec, expire); await runMallMaintenance(f.exec, expire);
  assert.equal(f.scalar('SELECT stock_qty FROM products'), 10);
  assert.equal(f.scalar('SELECT status FROM mall_orders'), 'cancelled');
  assert.equal(f.scalar('SELECT COUNT(*) FROM mall_carts'), 0);
  assert.equal(f.scalar("SELECT status FROM mall_order_events WHERE action='CANCEL_MALL_ORDER'"), 'cancelled');
});

test('database guards reject invalid records and legacy phone expression indexes match exact values', async t => {
  const f = await fixture('node'); t.after(() => f.db.close());
  assert.throws(() => f.db.exec('UPDATE mall_cart_items SET qty=0'));
  assert.throws(() => f.db.exec("INSERT INTO mall_cart_items(id,cart_id,product_id,qty,unit_price_kobo) SELECT 'duplicate',cart_id,product_id,qty,unit_price_kobo FROM mall_cart_items"));
  await f.checkout();
  assert.throws(() => f.db.exec("UPDATE mall_orders SET status='invented'"));
  assert.throws(() => f.db.exec('UPDATE payments SET amount_kobo=-1'));
  for (const input of ['0803 123 4567', '2348031234567', '+234 (803) 123-4567', 'invalid']) {
    const value = (f.db.prepare(`SELECT ${normalizedPhoneSql('?')} AS phone`).get(...Array((normalizedPhoneSql('?').match(/\?/g) || []).length).fill(input)) as any).phone;
    assert.equal(value, normalizeMallPhone(input));
  }
  ensureRelationalSchemaNode(f.db);
  assert.equal(f.scalar('SELECT COUNT(*) FROM mall_orders'), 1);
  assert.equal(f.scalar('SELECT COUNT(*) FROM mall_order_events'), 1);
});

test('trusted-IP rate limits and missing production configuration fail closed', async t => {
  const f = await fixture('node'); t.after(() => f.db.close()); f.exec.clientIp = 'test-client';
  for (let i = 0; i < 10; i++) await f.send(new Request('http://test/api/mall/orders'));
  const limited = await f.send(new Request('http://test/api/mall/orders'));
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60');
  f.exec.config = {};
  assert.equal((await f.checkout()).status, 503);
  assert.equal(f.scalar('SELECT COUNT(*) FROM mall_orders'), 0);
});

test('tracking limit is stricter than checkout and only the 6th request is rejected', async (t) => {
  // The tracking group serves `GET /api/mall/orders`, a phone+order-number
  // lookup that is a phone-enumeration vector, so its cap must stay below
  // checkout's. Importing the constants directly prevents silent drift.
  assert.equal(MALL_RATE_LIMITS.tracking, 5);
  assert.equal(MALL_RATE_LIMITS.checkout, 10);
  assert.ok(MALL_RATE_LIMITS.tracking < MALL_RATE_LIMITS.checkout);
  assert.equal(mallRateLimitGroup('/api/mall/orders'), 'tracking');
  assert.equal(mallRateLimitFor('/api/mall/orders'), MALL_RATE_LIMITS.tracking);
  const f = await fixture('node'); t.after(() => f.db.close()); f.exec.clientIp = 'tracking-client';
  const url = 'http://test/api/mall/orders?phone=08031234567&orderNo=ORD-TEST';
  // First five requests within the window must not be rate-limited.
  for (let i = 0; i < 5; i++) {
    const r = await f.send(new Request(url));
    assert.notEqual(r.status, 429);
  }
  // The 6th request in the same minute window is rejected with 429.
  const limited = await f.send(new Request(url));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
});

test('administrator bootstrap is disabled without explicit secrets and rejects incomplete/short credentials', () => {
  assert.equal(bootstrapAdmin({}), null);
  assert.throws(() => bootstrapAdmin({ BOOTSTRAP_ADMIN_EMAIL: 'owner@example.test' }));
  assert.throws(() => bootstrapAdmin({ BOOTSTRAP_ADMIN_EMAIL: 'owner@example.test', BOOTSTRAP_ADMIN_USERNAME: 'owner', BOOTSTRAP_ADMIN_PASSWORD: 'short' }));
  assert.equal(bootstrapAdmin({ BOOTSTRAP_ADMIN_EMAIL: 'owner@example.test', BOOTSTRAP_ADMIN_USERNAME: 'owner', BOOTSTRAP_ADMIN_PASSWORD: crypto.randomUUID() })?.superAdmin, true);
});

test('checkout revalidates price and eligibility inside the write batch', async (t) => {
  for (const mutation of ["UPDATE products SET status='Inactive'", "UPDATE products SET status='Archived'", 'UPDATE products SET retail_price_kobo=20000', 'UPDATE mall_cart_items SET qty=3']) {
    const f = await fixture('node'); t.after(() => f.db.close());
    const executor: MallExecutor = {
      ...f.exec, runBatch: async (statements) => {
        // Cart creation is now a single unconditional UPSERT that runs BEFORE
        // checkout reads the cart lines, so firing the mutation on the first
        // runBatch would mutate before the read (a fresh read is a consistent
        // write, not a race). The race this test guards lives between that
        // read and the main batch: fire only on the batch that inserts the
        // order, which is where the in-batch guards revalidate.
        if (statements.some((s) => String(s.sql).includes('INSERT INTO mall_orders'))) f.db.exec(mutation);
        return f.exec.runBatch(statements);
      }
    };
    const response = await handleMallApi(new Request('http://test/api/mall/checkout', {
      method: 'POST', headers: { 'x-mall-session': session, 'idempotency-key': attempt }, body: JSON.stringify(body),
    }), executor);
    assert.equal(response.status, 409);
    assert.equal(f.scalar('SELECT COUNT(*) FROM mall_orders'), 0);
    assert.equal(f.scalar('SELECT COUNT(*) FROM mall_checkout_attempts'), 0);
    assert.equal(f.scalar('SELECT stock_qty FROM products'), 10);
  }
});

test('staff merchandising validation, promotion windows, concurrency and roles', async (t) => {
  const f = await fixture('node'); t.after(() => f.db.close());
  const base = 'http://test/api/staff/mall-listings';
  const read = async (path: string) => handleStaffMallListingApi(new Request(`${base}${path}`), f.exec, actor);
  const write = async (id: string, body: Record<string, unknown>, role = 'Administrator') =>
    handleStaffMallListingApi(new Request(`${base}/${id}`, { method: 'PUT', body: JSON.stringify(body) }), f.exec, { ...actor, role });

  // Missing images are advisory; Active products do not need publishing approval.
  const db = f.db;
  const listed = (await (await read('?view=active')).json()) as any;
  assert.equal(listed.total, 1);
  const all = (await (await read('?view=all&limit=200')).json()) as any;
  assert.equal(all.total, 1);
  assert.ok(all.listings.some((item: any) => item.id === 'p' && item.issues.some((issue: string) => /image/i.test(issue))));
  assert.equal((await read('?view=inventory')).status, 400);
  assert.equal((await read('/missing')).status, 404);
  assert.equal((await write('p', { mallPriceKobo: 12000 })).status, 200);
  assert.equal((await write('p', { publish: false })).status, 400);
  assert.equal((await write('p', {}, 'Sales Staff')).status, 403);

  // Merchandising saves retain optimistic concurrency without changing approval flags.
  db.prepare(`INSERT INTO products(id,sku,name,stock_qty,status,is_mall_listed,retail_price_kobo,created_at,updated_at,images_json,min_selling_price_kobo)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run('sell', 'S', 'Sellable', 5, 'Active', 0, 20000, 'now', 'now', '["http://img/x.png"]', 5000);
  const merchandising = { mallPriceKobo: 15000, mallDescription: 'Fresh copy', featured: true, displayOrder: 2 };
  const first = await write('sell', merchandising);
  assert.equal(first.status, 200);
  const saved = (await first.json()) as any;
  assert.equal(saved.listing.visibleOnMall, true);
  assert.equal(saved.preview.description, 'Fresh copy');
  assert.equal(saved.preview.visibleOnMall, true);
  assert.equal(f.scalar("SELECT is_mall_listed FROM products WHERE id='sell'"), 0);
  assert.equal((await write('sell', { publish: false })).status, 400);
  const hidden = await (await read('?view=hidden')).json() as any;
  assert.equal(hidden.total, 0);
  const onePage = await (await read('?limit=1')).json() as any;
  assert.equal(onePage.total, 2);
  assert.equal(onePage.listings.length, 1);
  const racing = await Promise.all([
    write('sell', { ...merchandising, mallDescription: 'Writer A' }),
    write('sell', { ...merchandising, mallDescription: 'Writer B' }),
  ]);
  assert.deepEqual(racing.map((r) => r.status).sort(), [200, 409]);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM audit_logs WHERE action = ?').get('PUBLISH_MALL_LISTING') as any).n, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM audit_logs WHERE action = ?').get('UPDATE_MALL_LISTING') as any).n, 3);
  // Floor-price and promotion rules reject unsafe pricing.
  assert.equal((await write('sell', { mallPriceKobo: 4000 })).status, 400);

  // Floor-price and promotion rules reject unsafe pricing.
  assert.equal((await write('sell', { mallPriceKobo: 4000 })).status, 400);
  assert.equal((await write('sell', { mallPriceKobo: 15000, promoPriceKobo: 16000 })).status, 400);
  assert.equal((await write('sell', { mallPriceKobo: 15000, promoPriceKobo: 4000 })).status, 400);
  assert.equal((await write('sell', { mallPriceKobo: 15000, promoPriceKobo: 12000, promoStart: 'not-a-date' })).status, 400);
  assert.equal((await write('sell', { mallPriceKobo: 15000, promoPriceKobo: 12000, promoStart: '2026-09-20T00:00:00.000Z', promoEnd: '2026-09-10T00:00:00.000Z' })).status, 400);
  const past: any = await (await write('sell', {
    mallPriceKobo: 15000, promoPriceKobo: 12000,
    promoStart: '2020-01-01T00:00:00.000Z', promoEnd: '2020-02-01T00:00:00.000Z',
  })).json();
  assert.equal(past.listing.publicPriceKobo, 15000);
  assert.equal(past.listing.promoActive, false);
  const active: any = await (await write('sell', {
    mallPriceKobo: 15000, promoPriceKobo: 12000,
    promoStart: '2020-01-01T00:00:00.000Z', promoEnd: '2999-01-01T00:00:00.000Z',
  })).json();
  assert.equal(active.listing.publicPriceKobo, 12000);
  assert.equal(active.listing.promoActive, true);
  const catalog: any = await (await f.send(new Request('http://test/api/mall/products?q=Sellable'))).json();
  assert.equal(catalog.products[0].price, 12000);
  assert.equal(catalog.products[0].promoActive, true);
  assert.equal((await write('sell', {})).status, 200);
  assert.equal(((await (await f.send(new Request('http://test/api/mall/products?q=Sellable'))).json()) as any).total, 1);
});

test('image validation rejects forged MIME types and oversized payloads', () => {
  assert.throws(() => decodeBase64Image('image/gif', 'aGk='), /Unsupported/);
  assert.throws(() => decodeBase64Image('image/jpeg', 'iVBORw0KGgo='), /contents/);
  assert.throws(() => decodeBase64Image('image/png', '/9j/AAAA'), /contents/);
  assert.throws(() => decodeBase64Image('image/webp', 'iVBORw0KGgo='), /contents/);
  assert.throws(() => decodeBase64Image('image/avif', 'iVBORw0KGgo='), /contents/);
  assert.throws(() => decodeBase64Image('image/jpeg', ''), /required/);
  assert.throws(() => decodeBase64Image('image/jpeg', '!!!'), /base64/);
  assert.equal(imageKeyFromUrl('/mall-images/products/2026-09/x.jpg'), 'products/2026-09/x.jpg');
  assert.equal(imageKeyFromUrl('https://evil.test/x.jpg'), null);
  assert.equal(imageKeyFromUrl('/mall-images/../db'), null);
  assert.equal(imageUrl(newProductImageKey('image/webp')).startsWith('/mall-images/products/'), true);
});

test('stored images round-trip through the node store and serve immutable headers', async (t) => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'idofera-images-'));
  t.after(() => { try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ } });
  const store = makeNodeImageStore(root);
  const db = new DatabaseSync(':memory:');
  ensureRelationalSchemaNode(db);
  const exec: MallExecutor = { queryAll: async () => [], runBatch: async () => [1] };
  const webp = 'UklGRiIAAABXRUJQVlA4XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
  const created = await handleStaffProductImageApi(new Request('http://test/api/staff/product-images', {
    method: 'POST', body: JSON.stringify({ contentType: 'image/webp', dataBase64: webp }),
  }), store, exec, actor);
  assert.equal(created.status, 201);
  const { url } = (await created.json()) as any;
  assert.ok(url.startsWith('/mall-images/'));
  const served = await handlePublicImageRequest(new Request('http://test/x'), store, url.slice('/mall-images/'.length));
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(served.headers.get('content-type'), 'image/webp');
  assert.equal((await handlePublicImageRequest(new Request('http://test/x'), store, 'nope.jpg')).status, 404);
  assert.equal((await handlePublicImageRequest(new Request('http://test/x', { method: 'POST' }), store, 'x')).status, 405);
  assert.equal((await handleStaffProductImageApi(new Request('http://test/api/staff/product-images', { method: 'POST', body: '{}' }), undefined, exec, actor)).status, 503);
  assert.equal((await handleStaffProductImageApi(new Request('http://test/api/staff/product-images', { method: 'POST', body: '{}' }), store, exec, { ...actor, role: 'Sales Staff' })).status, 403);
  assert.equal((await handleStaffProductImageApi(new Request(`http://test/api/staff/product-images?url=${encodeURIComponent(url)}`, { method: 'DELETE' }), store, exec, actor)).status, 200);
  assert.equal((await handlePublicImageRequest(new Request('http://test/x'), store, url.slice('/mall-images/'.length))).status, 404);
  db.close();
});

test('Worker never provisions default users when bootstrap secrets are absent', async (t) => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const env: any = { DB: new SqliteD1(db), ASSETS: { fetch: async () => new Response('asset') } };
  const response = await worker.fetch(new Request('http://test/api/auth/session'), env);
  assert.equal(response.status, 200);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM app_users').get() as any).n, 0);
});
test('catalog visibility indexes exist once and the marker skips the bootstrap afterwards', async (t) => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const env: any = { DB: new SqliteD1(db), ASSETS: { fetch: async () => new Response('asset') } };
  // A fresh database still performs the whole additive bootstrap.
  await worker.fetch(new Request('http://test/api/mall/health'), env);
  const catalogIndexes = (db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_products_status%'",
  ).all() as any[]).map((row) => row.name).sort();
  // v9 dropped the standalone idx_products_status: it was a strict prefix of
  // the three composite (status, …) covering indexes the catalog reads plan
  // against, so it only added a row written per product status change.
  assert.deepEqual(catalogIndexes, [
    'idx_products_status_brand', 'idx_products_status_category', 'idx_products_status_created',
  ]);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('products') WHERE name = 'status'").get() as any).n, 1);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM mall_schema_versions WHERE version = ?').get(MALL_SCHEMA_VERSION) as any).n, 1);

  // The marker must let a cold isolate skip ~80 DDL statements: remove a table
  // the bootstrap would recreate and prove a second isolate leaves it missing.
  db.exec('DROP TABLE products');
  const second: any = { DB: new SqliteD1(db), ASSETS: { fetch: async () => new Response('asset') } };
  await worker.fetch(new Request('http://test/api/mall/health'), second);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'products'").get() as any).n, 0);

  // Readiness must assert the same marker the bootstrap records; a hard-coded
  // older version would report a healthy store as not ready after a deploy.
  const operations = fs.readFileSync('src/server/mallOperations.ts', 'utf8');
  assert.match(operations, /WHERE version=\?['"], \[MALL_SCHEMA_VERSION\]\)/);
  assert.doesNotMatch(operations, /WHERE version=2/);
});

test('legacy since= watermarks are ignored: the read stays one full snapshot', async (t) => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const env: any = { DB: new SqliteD1(db), ASSETS: { fetch: async () => new Response('asset') } };
  await worker.fetch(new Request('http://test/api/mall/health'), env);
  const token = 'delta-session-token';
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  db.prepare(`INSERT INTO app_users(id,email,display_name,role,status,password_hash,password_salt,created_at)
    VALUES ('delta-staff','delta@test.invalid','Manager','Administrator','Active','x','y','now')`).run();
  db.prepare('INSERT INTO app_sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)')
    .run(hash, 'delta-staff', Date.now(), Date.now() + 60000);
  db.prepare('INSERT INTO sync_revisions(owner_id,revision,updated_at) VALUES (?,?,?)')
    .run('idofera-business', 41, Date.now());
  const oldAt = Date.parse('2026-01-01T00:00:00.000Z');
  const newAt = Date.parse('2026-02-01T00:00:00.000Z');
  const product = (id: string) => JSON.stringify({
    id, sku: `SKU-${id.toUpperCase()}`, name: `Product ${id}`, category: 'Caps',
    brand: 'Brand', unit: 'pcs', status: 'Active', retailPrice: 100, currentStock: 1,
  });
  db.prepare('INSERT INTO app_documents(owner_id,collection,document_id,payload,updated_at) VALUES (?,?,?,?,?)')
    .run('idofera-business', 'products', 'old', product('old'), oldAt);
  db.prepare('INSERT INTO app_documents(owner_id,collection,document_id,payload,updated_at) VALUES (?,?,?,?,?)')
    .run('idofera-business', 'products', 'new', product('new'), newAt);
  const cookie = { cookie: `idofera_session=${token}` };
  // Two different legacy watermarks must produce the identical full read:
  // rows older than the watermark are never sliced out anymore (Option B).
  const read = async (watermark: string) => {
    const res = await worker.fetch(new Request(
      `http://test/api/storage/snapshot?since=${encodeURIComponent(watermark)}`,
      { headers: cookie },
    ), env);
    assert.equal(res.status, 200);
    return await res.json() as any;
  };
  const first = await read('2026-01-15T00:00:00.000Z');
  const second = await read('2027-01-01T00:00:00.000Z');
  assert.equal(first.delta, undefined, 'a snapshot is never a delta envelope');
  assert.equal(first.cursor, undefined, 'the server no longer issues keyset cursors');
  assert.equal(first.bounded, undefined, 'a full read is never page-bounded');
  assert.deepEqual((first.stores.products || []).map((record: any) => record.id).sort(), ['new', 'old']);
  assert.deepEqual(second.stores, first.stores, 'the watermark cannot change what is served');
  assert.equal(second.revision, first.revision, 'nor the revision');
});

test('PATCH re-push bumps the revision but never touches the document mirror', async (t) => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const env: any = { DB: new SqliteD1(db), ASSETS: { fetch: async () => new Response('asset') } };
  await worker.fetch(new Request('http://test/api/mall/health'), env);
  const token = 'delta-tie-session';
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  db.prepare(`INSERT INTO app_users(id,email,display_name,role,status,password_hash,password_salt,created_at)
    VALUES ('delta-tie','delta-tie@test.invalid','Manager','Administrator','Active','x','y','now')`).run();
  db.prepare('INSERT INTO app_sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)')
    .run(hash, 'delta-tie', Date.now(), Date.now() + 60000);
  db.prepare('INSERT INTO sync_revisions(owner_id,revision,updated_at) VALUES (?,?,?)')
    .run('idofera-business', 42, Date.now());
  // Rows sharing one millisecond both survive into the full read: there is no
  // keyset cursor that could skip the tail of a same-millisecond page anymore.
  const sharedAt = Date.parse('2026-03-01T00:00:00.000Z');
  for (const id of ['a-row', 'b-row']) {
    const payload = JSON.stringify({
      id, sku: `SKU-${id.toUpperCase()}`, name: `Product ${id}`, category: 'Caps',
      brand: 'Brand', unit: 'pcs', status: 'Active', retailPrice: 100, currentStock: 1,
    });
    db.prepare('INSERT INTO app_documents(owner_id,collection,document_id,payload,updated_at) VALUES (?,?,?,?,?)')
      .run('idofera-business', 'products', id, payload, sharedAt);
  }
  const cookie = { cookie: `idofera_session=${token}` };
  const full = await worker.fetch(new Request(
    `http://test/api/storage/snapshot?since=${encodeURIComponent(JSON.stringify({ ms: sharedAt, collection: 'products', documentId: 'a-row' }))}`,
    { headers: cookie },
  ), env);
  assert.equal(full.status, 200);
  const fullPayload = await full.json() as any;
  assert.equal(fullPayload.cursor, undefined, 'the server no longer issues keyset cursors');
  assert.deepEqual(
    (fullPayload.stores.products || []).map((record: any) => record.id).sort(),
    ['a-row', 'b-row'],
    'a legacy composite watermark cannot slice rows out of the read',
  );

  // Option B (mirror-less PATCH): a re-push writes the relational row again
  // (idempotent) and bumps the revision, but never touches the document store.
  const unchanged = await worker.fetch(new Request('http://test/api/storage/records', {
    method: 'PATCH',
    headers: { ...cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      upserts: [{
        collection: 'products', document: {
          id: 'b-row', sku: 'B-ROW', name: 'B row', category: 'Pouch', brand: 'B Brand',
          unit: 'pcs', status: 'Active', retailPrice: 100, currentStock: 1,
        }
      }], deletes: []
    }),
  }), env);
  assert.equal(unchanged.status, 200);
  const unchangedBody = await unchanged.json() as any;
  assert.equal(unchangedBody.skippedUnchanged, 0);
  assert.equal(unchangedBody.upserted, 1);
  assert.ok(unchangedBody.revision > 42, 'a written batch bumps the revision even without a mirror write');
  assert.equal(db.prepare('SELECT updated_at AS u FROM app_documents WHERE document_id = ?').get('b-row')?.u, sharedAt,
    'PATCHes must never write the document mirror; only snapshot PUTs do');
});

test('incremental mirror keeps orphans out without rewriting unchanged lines', async (t) => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const env: any = { DB: new SqliteD1(db), ASSETS: { fetch: async () => new Response('asset') } };
  await worker.fetch(new Request('http://test/api/mall/health'), env);
  const token = 'lines-session-token';
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  db.prepare(`INSERT INTO app_users(id,email,display_name,role,status,password_hash,password_salt,created_at)
    VALUES ('lines-staff','lines@test.invalid','Manager','Administrator','Active','x','y','now')`).run();
  db.prepare('INSERT INTO app_sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)')
    .run(hash, 'lines-staff', Date.now(), Date.now() + 60000);
  db.prepare('INSERT INTO sync_revisions(owner_id,revision,updated_at) VALUES (?,?,?)')
    .run('idofera-business', 43, Date.now());
  const cookie = { cookie: `idofera_session=${token}` };
  const sale = (items: { productId: string; quantity: number }[]) => ({
    id: 'sale-lines', invoiceNo: 'INV-LINES', totalAmount: 100,
    items: items.map((item) => ({ productId: item.productId, productName: item.productId, quantity: item.quantity, unitPrice: 10, total: 10 * item.quantity })),
  });
  const patch = (document: unknown) => worker.fetch(new Request('http://test/api/storage/records', {
    method: 'PATCH',
    headers: { ...cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ upserts: [{ collection: 'sales', document }], deletes: [] }),
  }), env);
  assert.equal((await patch(sale([{ productId: 'p-one', quantity: 1 }, { productId: 'p-two', quantity: 2 }]))).status, 200);
  assert.deepEqual(
    (db.prepare('SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id').all('sale-lines') as any[]).map((row) => row.id),
    ['sale-lines-item-0', 'sale-lines-item-1'],
  );
  // Removing one line deletes only its orphan; the surviving line keeps its
  // row instead of being deleted and re-inserted by a blanket wipe.
  assert.equal((await patch(sale([{ productId: 'p-one', quantity: 1 }]))).status, 200);
  assert.deepEqual(
    (db.prepare('SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id').all('sale-lines') as any[]).map((row) => row.id),
    ['sale-lines-item-0'],
  );
  // Re-pushing the identical document is idempotent under the mirror-less
  // PATCH: the relational upserts run again (no mirror probe to skip them),
  // key the same rows, and neither orphan nor rewrite any sale_items line.
  const repeat = await patch(sale([{ productId: 'p-one', quantity: 1 }]));
  assert.equal(repeat.status, 200);
  const repeatBody = await repeat.json() as any;
  assert.equal(repeatBody.skippedUnchanged, 0);
  assert.equal(repeatBody.upserted, 1);
  assert.deepEqual(
    (db.prepare('SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id').all('sale-lines') as any[]).map((row) => row.id),
    ['sale-lines-item-0'],
  );
});

test('catalog facet cache is dropped by a staff product write', async (t) => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const env: any = { DB: new SqliteD1(db), ASSETS: { fetch: async () => new Response('asset') } };
  await worker.fetch(new Request('http://test/api/mall/health'), env);
  const token = 'facet-cache-session';
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  db.prepare(`INSERT INTO app_users(id,email,display_name,role,status,password_hash,password_salt,created_at)
    VALUES ('facet-staff','facet@test.invalid','Manager','Administrator','Active','x','y','now')`).run();
  db.prepare('INSERT INTO app_sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)')
    .run(hash, 'facet-staff', Date.now(), Date.now() + 60000);
  const cookie = { cookie: `idofera_session=${token}` };
  const seed = db.prepare(
    `INSERT INTO products(id,sku,name,stock_qty,status,is_mall_listed,retail_price_kobo,category_name,brand,created_at,updated_at)
     VALUES(?,?,?,?,'Active',1,10000,?,'Facet Brand','now','now')`);
  seed.run('facet-a', 'FACET-A', 'Facet product a', 5, 'Original');
  seed.run('facet-b', 'FACET-B', 'Facet product b', 5, 'Original');
  const catalog = async () => (await (await worker.fetch(new Request('http://test/api/mall/products'), env)).json()) as any;
  // Previous tests in this process may have left facet entries in the shared
  // module cache; start from a cold cache for this fresh database.
  invalidateMallFacetCache();
  const before = await catalog();
  assert.equal(before.categories.find((c: any) => c.name === 'Original')?.count, 2);

  // A staff product write through the real storage PATCH must drop the cache:
  // within the 60s TTL the stale entry would otherwise still show the old list.
  const patch = await worker.fetch(new Request('http://test/api/storage/records', {
    method: 'PATCH',
    headers: { ...cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      upserts: [{
        collection: 'products', document: {
          id: 'facet-a', sku: 'FACET-A', name: 'Facet product a', category: 'Renamed',
          brand: 'Facet Brand', unit: 'pcs', status: 'Active', retailPrice: 100, currentStock: 5,
        }
      }], deletes: []
    }),
  }), env);
  assert.equal(patch.status, 200);
  const after = await catalog();
  const renamed = after.categories.find((c: any) => c.name === 'Renamed');
  assert.ok(renamed, 'facet cache must be invalidated by a staff product write');
  assert.equal(renamed.count, 1);
  assert.equal(after.categories.find((c: any) => c.name === 'Original')?.count, 1);
});

test('staff snapshot GET caps append-only history tables and reports the bound', async (t) => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const env: any = { DB: new SqliteD1(db), ASSETS: { fetch: async () => new Response('asset') } };
  await worker.fetch(new Request('http://test/api/mall/health'), env);
  const token = 'snapshot-cap-session';
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  db.prepare(`INSERT INTO app_users(id,email,display_name,role,status,password_hash,password_salt,created_at)
    VALUES ('cap-staff','cap@test.invalid','Manager','Administrator','Active','x','y','now')`).run();
  db.prepare('INSERT INTO app_sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)')
    .run(hash, 'cap-staff', Date.now(), Date.now() + 60000);
  const cookie = { cookie: `idofera_session=${token}` };
  // A successful snapshot PUT both fills the relational tables and flips the
  // worker onto its relational snapshot read path.
  const restore = await worker.fetch(new Request('http://test/api/storage/snapshot', {
    method: 'PUT',
    headers: { ...cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      stores: {
        products: [{
          id: 'cap-product', sku: 'CAP', name: 'Cap product', category: 'Caps', brand: 'Cap Brand',
          unit: 'pcs', status: 'Active', retailPrice: 100, currentStock: 5,
        }]
      }, expectedRevision: 0
    }),
  }), env);
  assert.equal(restore.status, 200);
  assert.equal((await restore.json() as any).relationalSynced, true, 'the relational mirror must succeed for the cap test');

  // 505 notification rows against a 500-row cap, strictly increasing timestamps
  // so "newest first" is deterministic.
  const insertNotification = db.prepare(
    'INSERT INTO notifications(id,title,message,type,is_read,created_at) VALUES (?,?,?,?,0,?)');
  const base = Date.parse('2026-06-01T00:00:00.000Z');
  for (let i = 0; i < 505; i += 1) {
    insertNotification.run(`notif-${String(i).padStart(3, '0')}`, 't', 'm', 'info',
      new Date(base + i * 60_000).toISOString());
  }
  const get = await worker.fetch(new Request('http://test/api/storage/snapshot?fresh=true', { headers: cookie }), env);
  assert.equal(get.status, 200);
  const body = await get.json() as any;
  assert.equal(body.backend, 'relational');
  assert.equal(body.stores.notifications.length, 500, 'history tables must be capped to their newest rows');
  assert.equal(body.stores.notifications[0].id, 'notif-504', 'the cap must keep the newest rows');
  assert.ok(Array.isArray(body.bounds?.capped) && body.bounds.capped.includes('notifications'),
    'the response must report which collections hit their cap');
  assert.equal(body.stores.products.length, 1, 'core collections stay uncapped');
});

test('oversized snapshot pushes are rejected before any write', async (t) => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const env: any = { DB: new SqliteD1(db), ASSETS: { fetch: async () => new Response('asset') } };
  await worker.fetch(new Request('http://test/api/mall/health'), env);
  const token = 'snapshot-push-limit-session';
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  db.prepare(`INSERT INTO app_users(id,email,display_name,role,status,password_hash,password_salt,created_at)
    VALUES ('limit-staff','limit@test.invalid','Manager','Administrator','Active','x','y','now')`).run();
  db.prepare('INSERT INTO app_sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)')
    .run(hash, 'limit-staff', Date.now(), Date.now() + 60000);
  const cookie = { cookie: `idofera_session=${token}` };


  test('email webhook verifies the signature, dedupes retries and skips heartbeats', async (t) => {
    const db = new DatabaseSync(':memory:'); t.after(() => db.close());
    const secret = 'safety-webhook-secret';
    const env: any = {
      DB: new SqliteD1(db),
      ASSETS: { fetch: async () => new Response('asset') },
      MALL_WEBHOOK_SECRET: secret,
      MALL_NOTIFY_EMAIL: 'owner@test.invalid',
      MALL_EMAIL_FROM: 'Mall Orders <orders@verified.test>',
      RESEND_API_KEY: 're_safety_key',
    };
    // Resend is an outbound HTTP call, so the only seam is global fetch.
    const sent: { from: string; to: string[]; subject: string; html: string; text: string; reply_to?: string; headers: Record<string, string> }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ id: 'resend-1' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    t.after(() => { globalThis.fetch = realFetch; });

    const post = async (
      payload: Record<string, unknown>,
      options: { secret?: string; at?: number; target?: any } = {},
    ) => {
      const raw = JSON.stringify(payload);
      const at = String(options.at ?? Math.floor(Date.now() / 1000));
      const signature = await signMallWebhook(options.secret ?? secret, at, raw);
      return worker.fetch(new Request('http://test/api/mall-webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-mall-timestamp': at, 'x-mall-signature': `sha256=${signature}` },
        body: raw,
      }), options.target ?? env);
    };

    const event = {
      id: 'created:mall-order-1',
      event: 'ORDER_RECEIVED',
      occurredAt: '2026-06-01T00:00:00.000Z',
      data: { orderNo: 'MALL-1', status: 'pending' },
      order: {
        order_no: 'MALL-1', customer_name: 'Ada', customer_phone: '08031234567',
        total_kobo: 20000, status: 'pending', payment_status: 'pending', payment_method: 'pay_on_pickup',
      },
    };

    // A forged signature and a replayed old timestamp must never reach Resend.
    assert.equal((await post(event, { secret: 'wrong-secret' })).status, 401);
    assert.equal((await post(event, { at: Math.floor(Date.now() / 1000) - 3600 })).status, 400);
    assert.equal(sent.length, 0, 'unauthenticated calls must not send email');

    const first = await post(event);
    assert.equal(first.status, 200);
    assert.equal((await first.json() as any).status, 'sent');
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ['owner@test.invalid']);
    assert.equal(sent[0].from, 'Mall Orders <orders@verified.test>', 'the From address is operator configurable');
    assert.match(sent[0].subject, /Order received . Order MALL-1/);
    assert.match(sent[0].html, /Ada/, 'the operator email must carry the order detail');

    // The drain retries until it sees a 2xx, so a repeat of the same outbox row
    // must be a no-op rather than a second email.
    const replay = await post(event);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json() as any).status, 'already_delivered');
    assert.equal(sent.length, 1);

    // The hourly heartbeat proves the signed wire is up without emailing.
    const heartbeat = await post({ id: 'heartbeat:2026-06-01T00', event: 'MALL_HEARTBEAT' });
    assert.equal(heartbeat.status, 200);
    assert.equal((await heartbeat.json() as any).status, 'acknowledged');
    assert.equal(sent.length, 1);

    // Missing Resend credentials fail loudly (503 so the outbox retries) instead
    // of reporting a delivery that never happened.
    const unconfigured = await post({ ...event, id: 'created:mall-order-2' }, { target: { ...env, RESEND_API_KEY: undefined } });
    assert.equal(unconfigured.status, 503);
    assert.equal(sent.length, 1);

    // With no configured sender we fall back to Resend's sandbox address instead
    // of an unverifiable @workers.dev address that Resend would reject.
    const fallback = await post({ ...event, id: 'created:mall-order-3' }, { target: { ...env, MALL_EMAIL_FROM: undefined } });
    assert.equal(fallback.status, 200);
    assert.equal(sent.length, 2);
    assert.match(sent[1].from, /onboarding@resend\.dev>$/);

    // An order that carried a customer email produces a second, customer-facing
    // copy: same event, different recipient and friendlier template.
    const withCustomer = await post({ ...event, id: 'created:mall-order-4', order: { ...event.order, customer_email: 'ADA@Example.com' } });
    assert.equal(withCustomer.status, 200);
    assert.equal((await withCustomer.json() as any).customer, 'sent');
    assert.equal(sent.length, 4, 'operator email first, then the customer copy');
    assert.deepEqual(sent[2].to, ['owner@test.invalid']);
    assert.deepEqual(sent[3].to, ['ada@example.com']);
    assert.match(sent[3].subject, /your order MALL-1/);
    assert.match(sent[3].html, /Hi Ada/, 'the customer copy greets the buyer by name');
    assert.doesNotMatch(sent[3].html, /customer_phone|payment_reference/, 'the customer copy stays free of internal plumbing');

    // Deliverability: Gmail spam-classifies HTML-only transactional mail from a
    // young domain, so every send must carry a plain-text alternative, a Reply-To
    // and a one-click List-Unsubscribe. Asserted on both copies.
    for (const copy of [sent[2], sent[3]]) {
      assert.equal(typeof copy.text, 'string');
      assert.ok(copy.text.length > 0, 'a plain-text alternative must accompany the HTML part');
      assert.doesNotMatch(copy.text, /<[a-z][^>]*>/i, 'the text part must not contain HTML tags');
      assert.equal(copy.reply_to, 'owner@test.invalid', 'Reply-To points at the monitored operator inbox');
      assert.match(copy.headers['List-Unsubscribe'], /^<mailto:/);
      assert.equal(copy.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    }
    assert.match(sent[3].text, /Hi Ada/, 'the customer text part keeps the greeting');

    // A malformed stored address is skipped (and reported) rather than emailed.
    const badCustomer = await post({ ...event, id: 'created:mall-order-5', order: { ...event.order, customer_email: 'not-an-email' } });
    assert.equal(badCustomer.status, 200);
    assert.equal((await badCustomer.json() as any).customer, 'skipped');
    assert.equal(sent.length, 5);
    assert.deepEqual(sent[4].to, ['owner@test.invalid'], 'the operator copy is unaffected by a bad customer address');
  });

  test('the scheduled drain emails the operator and the customer copy', async (t) => {
    const f = await fixture('worker'); t.after(() => f.db.close());
    const env: any = {
      ...f.env,
      MALL_WEBHOOK_URL: 'https://idomall.example.test/api/mall-webhook',
      MALL_WEBHOOK_SECRET: 'scheduler-webhook-secret-0123456789abcdef',
      MALL_NOTIFY_EMAIL: 'owner@test.invalid',
      MALL_EMAIL_FROM: 'Mall Orders <orders@verified.test>',
      RESEND_API_KEY: 're_scheduler_key',
    };
    // Only Resend is outbound; the drain must NOT reach back over the network to
    // its own MALL_WEBHOOK_URL (Cloudflare answers a self-subrequest with 1042).
    const sent: any[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ id: 'resend-1' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    t.after(() => { globalThis.fetch = realFetch; });

    const placed = await f.checkout(attempt, { customerEmail: 'ada@example.com' });
    assert.equal(placed.status, 201);
    const receipt = await placed.json() as { orderNo: string; customerEmail?: string };
    assert.equal(receipt.customerEmail, 'ada@example.com', 'the checkout response echoes the stored email');
    assert.equal(f.scalar("SELECT COUNT(*) FROM mall_outbox WHERE event='ORDER_RECEIVED' AND status='pending'"), 1);
    assert.equal(sent.length, 0, 'nothing is emailed until the scheduler runs');

    await worker.scheduled({}, env);
    assert.equal(sent.length, 2, 'one order event must email the operator and the customer copy');
    assert.equal(sent[0].to[0], 'owner@test.invalid');
    assert.match(sent[0].subject, new RegExp(`Order ${receipt.orderNo}`));
    assert.equal(sent[1].to[0], 'ada@example.com');
    assert.match(sent[1].subject, new RegExp(`your order ${receipt.orderNo}`));
    assert.equal(f.scalar("SELECT status FROM mall_outbox WHERE event='ORDER_RECEIVED'"), 'delivered');

    // The hourly heartbeat keeps the signed wire warm without emailing, which is
    // what stops one notification per hour forever.
    await worker.scheduled({}, env);
    await worker.scheduled({}, env);
    assert.equal(sent.length, 2, 'heartbeats must never email anyone');
    assert.equal(f.scalar("SELECT COUNT(*) FROM mall_outbox WHERE status='dead'"), 0);
  });

  test('the Node runtime serves the webhook receiver, so its drain emails too', async (t) => {
    const f = await fixture('node'); t.after(() => f.db.close());
    // The Node server has no D1 `DB`; server.ts wraps node:sqlite in a
    // `.prepare().bind()` shim with the same shape. This test drives that exact
    // seam: before it existed, the Node drain fetched /api/mall-webhook, got a
    // 404 from the Express server, retried and dead-lettered every order event.
    const nodeWebhookDb = {
      prepare(sql: string) {
        let params: unknown[] = [];
        const statement = {
          bind(...values: unknown[]) { params = values; return statement; },
          async run() { return { meta: { changes: Number(f.db.prepare(sql).run(...(params as any[])).changes) } }; },
          async all() { return { results: f.db.prepare(sql).all(...(params as any[])) as any[] }; },
        };
        return statement;
      },
    };
    const env: any = {
      MALL_WEBHOOK_URL: 'https://idomall.example.test/api/mall-webhook',
      MALL_WEBHOOK_SECRET: 'node-webhook-secret-0123456789abcdef',
      MALL_NOTIFY_EMAIL: 'owner@test.invalid',
      MALL_EMAIL_FROM: 'Mall Orders <orders@verified.test>',
      RESEND_API_KEY: 're_node_key',
    };
    const sent: any[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
      sent.push(JSON.parse(String(init.body)));
      const headers = { 'content-type': 'application/json' };
      return new Response(JSON.stringify({ id: 'resend-1' }), { status: 200, headers });
    }) as unknown as typeof fetch;
    t.after(() => { globalThis.fetch = realFetch; });

    const placed = await f.checkout(attempt, { customerEmail: 'ada@example.com' });
    assert.equal(placed.status, 201);
    assert.equal(f.scalar("SELECT COUNT(*) FROM mall_outbox WHERE event='ORDER_RECEIVED' AND status='pending'"), 1);

    const exec = makeNodeMallExecutor(f.db, env);
    let hits = 0;
    await runMallMaintenance(exec, async () => new Response(null, { status: 409 }), (async (input: unknown, init: any) => {
      hits += 1;
      const request = new Request(String(input), { method: init?.method || 'POST', headers: init?.headers, body: init?.body });
      return await handleMallWebhook(request, { ...env, DB: nodeWebhookDb });
    }) as unknown as typeof fetch);

    assert.ok(hits >= 1, 'the Node drain must reach the in-process receiver');
    assert.equal(sent.length, 2, 'the Node drain emails the operator and the customer copy');
    assert.equal(sent[0].to[0], 'owner@test.invalid');
    assert.equal(sent[1].to[0], 'ada@example.com');
    assert.equal(f.scalar("SELECT status FROM mall_outbox WHERE event='ORDER_RECEIVED'"), 'delivered');
  });

  const documents = Array.from({ length: SNAPSHOT_PUSH_DOC_LIMIT + 1 }, (_, i) => ({ id: `bulk-${i}`, name: 'Bulk' }));
  const oversized = await worker.fetch(new Request('http://test/api/storage/snapshot', {
    method: 'PUT',
    headers: { ...cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ stores: { products: documents }, expectedRevision: 0 }),
  }), env);
  assert.equal(oversized.status, 413);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM app_documents').get() as any).n, 0,
    'the bound must reject the push before a single row is written');

  // A bounded restore still succeeds right after the rejection.
  const restore = await worker.fetch(new Request('http://test/api/storage/snapshot', {
    method: 'PUT',
    headers: { ...cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      stores: {
        products: [{
          id: 'small-1', sku: 'SMALL-1', name: 'Small product', category: 'Caps', brand: 'Cap Brand',
          unit: 'pcs', status: 'Active', retailPrice: 100, currentStock: 1,
        }]
      }, expectedRevision: 0
    }),
  }), env);
  assert.equal(restore.status, 200);
  const after = await (await worker.fetch(new Request('http://test/api/storage/snapshot?fresh=true', { headers: cookie }), env)).json() as any;
  assert.equal(after.stores.products.length, 1);
});
test('storefront catalog reads drop the sold_qty join; detail and top rail keep it', async (t) => {
  for (const runtime of ['node', 'worker'] as const) {
    const f = await fixture(runtime); t.after(() => f.db.close());
    const queries: string[] = [];
    const instrumented: MallExecutor = { ...f.exec, queryAll: async (sql, params) => { queries.push(sql); return f.exec.queryAll(sql, params); } };
    const catalog = async (query: string) => (await (await handleMallApi(new Request(`http://test/api/mall/products?${query}`), instrumented)).json()) as any;
    const fetchDetail = async () => (await (await handleMallApi(new Request('http://test/api/mall/products/p'), instrumented)).json()) as any;
    const soldQueries = () => queries.filter((sql) => sql.includes('FROM sale_items')).length;

    queries.length = 0;
    const browse = await catalog('limit=5&sort=popular');
    assert.equal(browse.sort, 'popular');
    assert.equal(browse.products[0].sold, 0, 'catalog rows report sold: 0 after the join left the storefront columns');
    assert.equal(soldQueries(), 0);

    queries.length = 0;
    const detail = await fetchDetail();
    assert.equal(detail.product.sold, 0, 'a pending checkout is not a canonical sale');
    assert.equal(soldQueries(), 1, 'product detail keeps the real sold join');

    queries.length = 0;
    assert.equal((await f.checkout()).status, 201);
    assert.equal((await fetchDetail()).product.sold, 0, 'pending orders are not canonical sales');
    assert.equal(soldQueries(), 1);

    queries.length = 0;
    assert.equal((await f.pay()).status, 200);
    const paid = await fetchDetail();
    assert.equal(paid.product.sold, 2);
    assert.equal(soldQueries(), 1);

    queries.length = 0;
    const rails = await (await handleMallApi(new Request('http://test/api/mall/home', { headers: { 'x-mall-session': session } }), instrumented)).json() as any;
    assert.equal(rails.topSellers[0].id, 'p');
    assert.equal(rails.topSellers[0].sold, 2);
    assert.equal(soldQueries(), 1, 'the top-sellers rail keeps the real popularity join');
    queries.length = 0;
    await (await handleMallApi(new Request('http://test/api/mall/home', { headers: { 'x-mall-session': session } }), instrumented)).json();
    assert.equal(soldQueries(), 0, 'a warm homepage must not re-run the top-seller join');
  }
});

test('buy-again seeks session history and product IDs instead of scanning a 10K catalog', async t => {
  const f = await fixture('node'); t.after(() => f.db.close());
  const product = f.db.prepare(`INSERT INTO products(id,sku,name,status,stock_qty,retail_price_kobo,created_at,updated_at)
    VALUES(?,?,?,'Active',?,10000,'2026-01-01','2026-01-01')`);
  const order = f.db.prepare('INSERT INTO mall_orders(id,order_no,status,created_at) VALUES(?,?,?,?)');
  const checkout = f.db.prepare("INSERT INTO mall_checkout_attempts VALUES(?,?,'{}',?,?)");
  const item = f.db.prepare(`INSERT INTO mall_order_items(id,mall_order_id,product_id,qty,unit_price_kobo,total_kobo)
    VALUES(?,?,?,1,10000,10000)`);
  const payment = f.db.prepare("INSERT INTO payments(id,order_id,reference,status,created_at) VALUES(?,?,?,'paid','2026-01-01')");
  const purchase = (id: string, sid: string, status: string, at: string, ids: (string | null)[], paid = false) => {
    order.run(id, id, status, at);
    checkout.run(id, sid, id, at);
    ids.forEach((pid, i) => item.run(`${id}-${i}`, id, pid));
    if (paid) payment.run(id, id, id);
  };
  f.db.exec('BEGIN');
  for (let i = 0; i < 10000; i++) product.run(`noise-${i}`, `noise-${i}`, 'Unrelated', 10);
  for (let i = 0; i < 1000; i++) purchase(`noise-order-${i}`, 'other-browser-session', 'completed', '2026-06-01', [`noise-${i}`]);
  const ids = Array.from({ length: 15 }, (_, i) => `bought-${String(i).padStart(2, '0')}`);
  ids.forEach((id, i) => product.run(id, id, id, i < 3 ? 0 : 10));
  // Duplicate lines and multiple orders must still produce one row per product.
  purchase('old', session, 'completed', '2026-01-01', [...ids, ids[3], null, 'deleted-product']);
  purchase('recent', session, 'confirmed', '2026-03-01', [ids[4], ids[4]], true);
  payment.run('second-payment', 'recent', 'second-payment');
  purchase('pending', session, 'pending', '2026-05-01', ['noise-1', ids[5]]);
  purchase('cancelled', session, 'cancelled', '2026-05-01', ['noise-2', ids[6]], true);
  purchase('refunded', session, 'refunded', '2026-05-01', ['noise-3', ids[7]], true);
  f.db.prepare("UPDATE products SET status='Archived' WHERE id=?").run(ids[14]);
  f.db.exec('COMMIT; ANALYZE');

  let captured: { sql: string; params: any[] } | undefined;
  const instrumented: MallExecutor = { ...f.exec, queryAll: async (sql, params = []) => {
    // Isolate this rail: the three shared homepage rails have separate coverage.
    if (!sql.includes('last_purchase')) return [];
    captured = { sql, params };
    return f.exec.queryAll(sql, params);
  } };
  const response = await handleMallApi(new Request('http://test/api/mall/home', {
    headers: { 'x-mall-session': session },
  }), instrumented);
  assert.equal(response.status, 200);
  const result = await response.json() as any;
  assert.deepEqual(result.buyAgain.map((p: any) => p.id),
    [ids[4], ids[0], ids[3], ...ids.slice(5, 12)]);
  assert.equal(result.buyAgain.filter((p: any) => !p.available).length, 1);
  assert.ok(captured);
  assert.deepEqual(captured.params, [session], 'history is evaluated once for one bound session');

  // Compare ranking and last-purchase timestamps with the original semantics.
  const legacyHistory = `SELECT MAX(o.created_at) FROM mall_order_items oi
    JOIN mall_orders o ON o.id=oi.mall_order_id WHERE oi.product_id=products.id
    AND o.status NOT IN ('cancelled','refunded')
    AND (o.status='completed' OR EXISTS(SELECT 1 FROM payments pay WHERE pay.order_id=o.id AND pay.status='paid'))
    AND EXISTS(SELECT 1 FROM mall_checkout_attempts a WHERE a.order_id=o.id AND a.session_id=?)`;
  const legacy = f.db.prepare(`WITH candidates AS (
    SELECT id,stock_qty,(${legacyHistory}) AS last_purchase FROM products
    WHERE status='Active' AND (${legacyHistory}) IS NOT NULL
  ), ranked AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY (stock_qty<=0) ORDER BY last_purchase DESC,id ASC) AS stock_rank FROM candidates)
    SELECT id,last_purchase FROM ranked WHERE stock_qty>0 OR stock_rank=1 ORDER BY last_purchase DESC,id ASC LIMIT 10`).all(session, session);
  const actual = f.db.prepare(captured.sql).all(...captured.params).map(row => ({ id: row.id, last_purchase: row.last_purchase }));
  assert.deepEqual(actual, legacy.map(row => ({ ...row })));
  assert.deepEqual(f.db.prepare(captured.sql).all('brand-new-browser'), []);

});

test('Worker upgrades the previous schema marker with buy-again indexes', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  ensureRelationalSchemaNode(db);
  const indexes = ['idx_mall_checkout_session_order', 'idx_mall_order_items_order_product', 'idx_payments_order_status'];
  indexes.forEach(name => db.exec(`DROP INDEX ${name}`));
  db.prepare("INSERT OR IGNORE INTO mall_schema_versions VALUES(?,'old')").run(MALL_SCHEMA_VERSION - 1);
  const env: any = { DB: new SqliteD1(db), ASSETS: { fetch: async () => new Response('asset') } };
  await worker.fetch(new Request('http://test/api/mall/health'), env);
  for (const name of indexes) assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?").get(name));
  assert.ok(db.prepare('SELECT 1 FROM mall_schema_versions WHERE version=?').get(MALL_SCHEMA_VERSION));
});


test('top-sellers ranks by key and sums sales from the covering index, not per-product table reads', async t => {
  const f = await fixture('node'); t.after(() => f.db.close());
  const product = f.db.prepare(`INSERT INTO products(id,sku,name,status,stock_qty,retail_price_kobo,created_at,updated_at)
    VALUES(?,?,?,'Active',?,10000,'2026-01-01','2026-01-01')`);
  const sale = f.db.prepare(`INSERT INTO sales(id,receipt_no,status,created_at) VALUES(?,?,?,?)`);
  const line = f.db.prepare('INSERT INTO sale_items(id,sale_id,product_id,qty) VALUES(?,?,?,?)');
  f.db.exec('BEGIN');
  f.db.exec("UPDATE products SET status='Archived' WHERE id='p'");
  for (let i = 0; i < 200; i++) product.run(`noise-${i}`, `noise-${i}`, `Noise ${i}`, i % 3 === 0 ? 0 : 10);
  sale.run('s-old', 'R1', 'Completed', '2026-01-01');
  sale.run('s-new', 'R2', 'Paid', '2026-02-01');
  sale.run('s-void', 'R3', 'cancelled', '2026-03-01');
  const sold = (product, saleId, qty, n) => line.run(`${product}-${saleId}-${n}`, saleId, product, qty);
  sold('noise-1', 's-old', 4, 0);
  sold('noise-1', 's-new', 6, 1);
  sold('noise-1', 's-void', 99, 2);
  sold('noise-2', 's-old', 5, 0);
  sold('noise-4', 's-new', 5, 0);
  sold('noise-5', 's-new', 7, 0);
  f.db.exec('COMMIT; ANALYZE');

  let rail;
  const instrumented = { ...f.exec, queryAll: async (sql, params = []) => {
    if (!rail && sql.includes('AS sold_qty')) rail = { sql };
    return f.exec.queryAll(sql, params);
  } };
  const response = await handleMallApi(new Request('http://test/api/mall/home', {
    headers: { 'x-mall-session': session },
  }), instrumented);
  assert.equal(response.status, 200);
  const top = (await response.json()).topSellers;
  assert.deepEqual(top.map(p => p.id).slice(0, 4), ['noise-1', 'noise-5', 'noise-2', 'noise-4']);
  assert.deepEqual(top.map(p => p.sold).slice(0, 4), [10, 7, 5, 5]);
  assert.deepEqual(top.map(p => p.available).slice(0, 4), [true, true, true, true]);

  assert.ok(rail, 'the top-sellers rail must issue one ranking query');
  const rows = f.db.prepare(rail.sql).all();
  assert.deepEqual(rows.map(r => r.id).slice(0, 4), ['noise-1', 'noise-5', 'noise-2', 'noise-4']);
  assert.deepEqual(rows.map(r => r.sold_qty).slice(0, 4), [10, 7, 5, 5]);
  const plan = f.db.prepare(`EXPLAIN QUERY PLAN ${rail.sql}`).all().map(r => String(r.detail)).join(String.fromCharCode(10));
  // Verified plan: the SUM is served from the covering index (no sale_items
  // table read), products is never scanned, and the OLD narrower index is unused.
  assert.match(plan, /SEARCH si USING COVERING INDEX idx_sale_items_product_sale_qty/);
  assert.doesNotMatch(plan, /SCAN si\b/);
  assert.doesNotMatch(plan, /SEARCH si USING INDEX idx_sale_items_product \(/);
  assert.doesNotMatch(plan, /SCAN products\b/);
  assert.doesNotMatch(plan, /SCAN sale\b/);
});
