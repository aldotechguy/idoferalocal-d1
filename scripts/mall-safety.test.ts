import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import worker from '../sites-worker.ts';
import { ensureRelationalSchemaNode, makeNodeMallExecutor } from '../src/server/nodeAdapter.ts';
import { handleMallApi, type MallExecutor } from '../src/server/mallApi.ts';
import { handleStaffMallApi } from '../src/server/mallOrderAdminApi.ts';
import { handleStaffMallListingApi } from '../src/server/mallListingApi.ts';
import { handleStaffProductImageApi, handlePublicImageRequest } from '../src/server/productImageApi.ts';
import { decodeBase64Image, imageKeyFromUrl, imageUrl, newProductImageKey } from '../src/server/imageStore.ts';
import { makeNodeImageStore } from '../src/server/nodeImageStore.ts';
import { bootstrapAdmin } from '../src/server/adminBootstrap.ts';
import { drainMallOutbox, signMallWebhook, mallReadiness, runMallMaintenance, MALL_OPERATIONS_DDL } from '../src/server/mallOperations.ts';
import { normalizeMallPhone, normalizedPhoneSql } from '../src/shared/mallPhone.ts';

/** Binding-shaped test double; executes real SQL and atomic batches, not canned results.
 * This is NOT a deployed D1/workerd test. */
class SqliteD1 {
  constructor(readonly db: DatabaseSync) {}
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
  const exec = makeNodeMallExecutor(db);
  const env: any = { MALL_CHECKOUT_ENABLED:'true',MALL_PICKUP_ADDRESS:'Test pickup',MALL_PICKUP_HOURS:'Test hours', DB: new SqliteD1(db), ASSETS: { fetch: async (req: Request) => new Response(`asset:${new URL(req.url).pathname}`) } };
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
  return { db, exec, env, send, fill, checkout, id, op, pay, scalar };
}

for (const runtime of ['node', 'worker'] as const) {
  test(`${runtime}: homepage rows use the whole catalog and browser-scoped paid history`, async t => {
    const f = await fixture(runtime); t.after(() => f.db.close());
    const home = async (sid = session) => {
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
    assert.equal(initial.flashSales.length, 1);
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
    assert.ok(restocked.every((p: any) => !p.available), 'Restocked products remain visible after selling out');
    assert.ok(initial.flashSales.every((p: any) => p.stock === 0 && !p.available));
    // In-stock candidates beyond the original LIMIT must backfill the rails.
    f.db.exec("UPDATE products SET stock_qty=5 WHERE id IN ('home-0','home-1','home-2','home-3','home-4','home-5','home-6','home-7','home-8','home-9','home-10','home-11','home-12','home-13','home-70','home-71')");
    const mixed = await home();
    assert.equal(mixed.flashSales.length, 10);
    assert.equal(mixed.topSellers.length, 12);
    assert.equal(mixed.newArrivals.length, 12);
    for (const rail of [mixed.flashSales, mixed.topSellers, mixed.newArrivals]) {
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

  test(`${runtime}: catalog, direct detail, description, pagination and cart concurrency`,async t=>{
    const f=await fixture(runtime);t.after(()=>f.db.close());
    f.db.exec("UPDATE products SET mall_description='Public description',mall_price_kobo=12000; INSERT INTO products(id,sku,name,stock_qty,status,is_mall_listed,retail_price_kobo,created_at,updated_at) VALUES('hidden','hidden','Hidden',10,'Active',0,100,'now','now')");
    const detail:any=await (await f.send(new Request('http://test/api/mall/products/p'))).json();
    assert.equal(detail.product.description,'Public description');assert.equal(detail.product.price,12000);
    assert.equal((await f.send(new Request('http://test/api/mall/products/hidden'))).status,200);
    const catalog:any=await (await f.send(new Request('http://test/api/mall/products?limit=1&offset=1&q=Product'))).json();
    assert.equal(catalog.total,1);assert.equal(catalog.products.length,0);
    const add=()=>f.send(new Request('http://test/api/mall/cart',{method:'POST',headers:{'x-mall-session':session},body:JSON.stringify({productId:'p',qty:1})}));
    const responses=await Promise.all([add(),add()]);assert.ok(responses.every(r=>r.ok));
    assert.equal(f.scalar('SELECT qty FROM mall_cart_items'),4);
    const cart:any=await (await f.send(new Request('http://test/api/mall/cart',{headers:{'x-mall-session':session}}))).json();
    assert.equal(cart.subtotalKobo,48000);
  });

  test(`${runtime}: private tracking, reference search, timeline and normalized matching`,async t=>{
    const f=await fixture(runtime);t.after(()=>f.db.close());const receipt:any=await (await f.checkout()).json();
    assert.equal((await f.send(new Request('http://test/api/mall/orders?phone=08031234567'))).status,400);
    const track=async(phone:string)=>(await (await f.send(new Request(`http://test/api/mall/orders?orderNo=${receipt.orderNo}&phone=${encodeURIComponent(phone)}`))).json()) as any;
    assert.equal((await track('+2348031234567')).orders.length,1);
    assert.equal((await track('+2348031234568')).orders.length,0);
    const search=await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders?q=${receipt.paymentReference}`),f.exec,actor);
    assert.equal((await search.json() as any).total,1);
    await f.op('confirm');await f.pay();
    const result:any=await (await handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${f.id()}`),f.exec,actor)).json();
    assert.equal(result.order.timeline.length,3);
    assert.ok(result.order.timeline.every((event:any)=>event.createdAt && event.actorId));
    assert.equal(f.scalar('SELECT COUNT(*) FROM notifications'),1);
    assert.equal(f.scalar('SELECT COUNT(*) FROM mall_outbox'),3);
  });

  test(`${runtime}: maximum supported cart commits atomically`,async t=>{
    const f=await fixture(runtime);t.after(()=>f.db.close());
    f.db.exec('DELETE FROM mall_cart_items');
    for(let i=0;i<100;i++){
      f.db.prepare("INSERT INTO products(id,sku,name,stock_qty,status,is_mall_listed,retail_price_kobo,created_at,updated_at) VALUES(?,?,?,2,'Active',1,100,'now','now')").run(`max-${i}`,`max-${i}`,`Max ${i}`);
      f.db.prepare('INSERT INTO mall_cart_items(id,cart_id,product_id,qty,unit_price_kobo) VALUES(?,?,?,1,100)').run(`max-${i}`,`mc-${session}`,`max-${i}`);
    }
    assert.equal((await f.checkout()).status,201);
    assert.equal(f.scalar('SELECT COUNT(*) FROM mall_order_items'),100);
    assert.equal(f.scalar('SELECT COUNT(*) FROM stock_movements'),100);
  });

  test(`${runtime}: serviceability, dispatch, delivery and return record stay synchronized`,async t=>{
    const f=await fixture(runtime);t.after(()=>f.db.close());
    assert.equal((await f.checkout(attempt,{deliveryZone:'uyo_central',deliveryAddress:'Test street, central Uyo'})).status,201);
    assert.equal((await f.op('confirm')).status,409);
    assert.equal((await f.op('review-delivery',{confirmed:true},'Sales Staff')).status,403);
    assert.equal((await f.op('review-delivery',{confirmed:true})).status,200);
    assert.equal((await f.op('confirm')).status,200);
    assert.equal((await f.op('collect-payment',{paymentMethod:'Cash',amountKobo:170000})).status,200);
    assert.equal((await f.op('mark-packed')).status,200);
    assert.equal((await f.op('mark-ready')).status,409);
    assert.equal((await f.op('mark-out-for-delivery')).status,400);
    assert.equal((await f.op('mark-out-for-delivery',{courier:'Test courier'})).status,200);
    assert.equal(f.scalar('SELECT status FROM delivery_orders'),'In Transit');
    assert.throws(()=>f.db.exec("UPDATE delivery_orders SET status='Delivered'"));
    assert.equal((await f.op('complete')).status,200);
    assert.equal(f.scalar('SELECT status FROM delivery_orders'),'Delivered');
    assert.equal((await f.op('refund',{reason:'Return',returnStock:true})).status,400);
    assert.equal((await f.op('refund',{reason:'Return',returnStock:true,returnReference:'GRN-TEST'})).status,200);
    assert.equal(f.scalar('SELECT status FROM delivery_orders'),'Returned');
    assert.equal(f.scalar('SELECT receipt_reference FROM mall_returns'),'GRN-TEST');
    assert.equal(f.scalar('SELECT stock_qty FROM products'),10);
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
    const results = await Promise.all([f.op('refund', { reason: 'Returned', returnStock: true }), f.op('mark-out-for-delivery',{courier:'Test courier'})]);
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
    beta.run('alpha-bucket','AB','Alpha Bucket',5,'Active',1,50000,'2020-01-01T00:00:00.000Z','2026-09-18T11:00:00.000Z','Acme',1,5);
    beta.run('beta-jug','BJ','Beta Jug',5,'Active',1,10000,'2024-01-01T00:00:00.000Z','now','Beta',0,null);
    beta.run('gamma-pail','GP','Gamma Pail',5,'Active',1,30000,'2022-01-01T00:00:00.000Z','2026-09-18T10:00:00.000Z','Acme',0,1);
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

test('Worker static routes bypass Mall and unexpected async errors become responses', async (t) => {
  const f = await fixture('worker'); t.after(() => f.db.close());
  for (const path of ['/', '/mall', '/assets/app.js']) {
    const response = await worker.fetch(new Request(`http://test${path}`), f.env);
    assert.equal(response.status, 200); assert.match(await response.text(), /^asset:/);
  }
  f.env.DB.prepare = () => { throw new Error('database unavailable'); };
  assert.equal((await worker.fetch(new Request('http://test/api/mall/products'), f.env)).status, 500);
});

test('outbox signatures, exclusive leases, retry, dead letters and readiness',async t=>{
  const f=await fixture('node');t.after(()=>f.db.close());
  f.exec.config={MALL_CHECKOUT_ENABLED:'true',MALL_PICKUP_ADDRESS:'Test pickup',MALL_PICKUP_HOURS:'Test hours',MALL_BANK_NAME:'Test bank',MALL_BANK_ACCOUNT_NAME:'Test business',MALL_BANK_ACCOUNT_NUMBER:'0000000000',MALL_WEBHOOK_URL:'https://notifications.example.test/mall',MALL_WEBHOOK_SECRET:'test-secret-only-12345678901234567890'};
  await f.checkout();let count=0;
  const send:typeof fetch=async(_url,options)=>{
    count++;
    const headers=new Headers(options?.headers);const timestamp=headers.get('x-mall-timestamp')!;
    assert.equal(headers.get('x-mall-signature'),`sha256=${await signMallWebhook(f.exec.config!.MALL_WEBHOOK_SECRET!,timestamp,String(options?.body))}`);
    return new Response(null,{status:204});
  };
  await Promise.all([drainMallOutbox(f.exec,send),drainMallOutbox(f.exec,send)]);
  assert.equal(count,1);assert.equal(f.scalar("SELECT status FROM mall_outbox LIMIT 1"),'delivered');
  await f.op('confirm');
  await drainMallOutbox(f.exec,async()=>new Response(null,{status:503}));
  assert.equal(f.scalar("SELECT attempts FROM mall_outbox WHERE status='pending'"),1);
  f.db.exec("UPDATE mall_outbox SET attempts=9,next_attempt_at=0 WHERE status='pending'");
  await drainMallOutbox(f.exec,async()=>new Response(null,{status:503}));
  assert.equal(f.scalar("SELECT COUNT(*) FROM mall_outbox WHERE status='dead'"),1);
  assert.equal((await mallReadiness(f.exec)).ready,false);
  await handleStaffMallApi(new Request('http://test/api/staff/mall-orders/retry-notifications',{method:'POST'}),f.exec,actor);
  await runMallMaintenance(f.exec,async()=>new Response(null,{status:409}),send);
  assert.equal((await mallReadiness(f.exec)).ready,true);
  f.db.exec('DROP TRIGGER trg_products_no_oversell');
  assert.equal((await mallReadiness(f.exec)).ready,false);
});

test('unpaid expiry restores stock once, cleans abandoned carts and emits cancellation event',async t=>{
  const f=await fixture('node');t.after(()=>f.db.close());await f.checkout();
  f.db.exec("UPDATE mall_orders SET created_at='2020-01-01T00:00:00.000Z';UPDATE mall_carts SET updated_at=0");
  const expire=(id:string)=>handleStaffMallApi(new Request(`http://test/api/staff/mall-orders/${id}/cancel`,{method:'POST',body:JSON.stringify({reason:'Expired unpaid'})}),f.exec,actor);
  await runMallMaintenance(f.exec,expire);await runMallMaintenance(f.exec,expire);
  assert.equal(f.scalar('SELECT stock_qty FROM products'),10);
  assert.equal(f.scalar('SELECT status FROM mall_orders'),'cancelled');
  assert.equal(f.scalar('SELECT COUNT(*) FROM mall_carts'),0);
  assert.equal(f.scalar("SELECT status FROM mall_order_events WHERE action='CANCEL_MALL_ORDER'"),'cancelled');
});

test('database guards reject invalid records and legacy phone expression indexes match exact values',async t=>{
  const f=await fixture('node');t.after(()=>f.db.close());
  assert.throws(()=>f.db.exec('UPDATE mall_cart_items SET qty=0'));
  assert.throws(()=>f.db.exec("INSERT INTO mall_cart_items(id,cart_id,product_id,qty,unit_price_kobo) SELECT 'duplicate',cart_id,product_id,qty,unit_price_kobo FROM mall_cart_items"));
  await f.checkout();
  assert.throws(()=>f.db.exec("UPDATE mall_orders SET status='invented'"));
  assert.throws(()=>f.db.exec('UPDATE payments SET amount_kobo=-1'));
  for(const input of ['0803 123 4567','2348031234567','+234 (803) 123-4567','invalid']) {
    const value=(f.db.prepare(`SELECT ${normalizedPhoneSql('?')} AS phone`).get(...Array((normalizedPhoneSql('?').match(/\?/g)||[]).length).fill(input)) as any).phone;
    assert.equal(value,normalizeMallPhone(input));
  }
  ensureRelationalSchemaNode(f.db);
  assert.equal(f.scalar('SELECT COUNT(*) FROM mall_orders'),1);
  assert.equal(f.scalar('SELECT COUNT(*) FROM mall_order_events'),1);
});

test('trusted-IP rate limits and missing production configuration fail closed',async t=>{
  const f=await fixture('node');t.after(()=>f.db.close());f.exec.clientIp='test-client';
  for(let i=0;i<10;i++) await f.send(new Request('http://test/api/mall/orders'));
  const limited=await f.send(new Request('http://test/api/mall/orders'));
  assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'60');
  f.exec.config={};
  assert.equal((await f.checkout()).status,503);
  assert.equal(f.scalar('SELECT COUNT(*) FROM mall_orders'),0);
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
    const executor: MallExecutor = { ...f.exec, runBatch: async (statements) => {
      f.db.exec(mutation);
      return f.exec.runBatch(statements);
    } };
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
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run('sell','S','Sellable',5,'Active',0,20000,'now','now','["http://img/x.png"]',5000);
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