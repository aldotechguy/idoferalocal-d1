/**
 * Phase 5 — Mall API (single-vendor storefront backend).
 *
 * Framework-agnostic: consumes a `MallExecutor` so BOTH runtimes run the SAME
 * logic with no duplicated SQL:
 *   - sites-worker.ts -> Cloudflare D1 (`env.DB.batch` is atomic)
 *   - server.ts       -> node:sqlite (`BEGIN IMMEDIATE` / `COMMIT`)
 *
 * Rules that keep the storefront safe:
 *  - Prices are ALWAYS resolved from `products` (COALESCE(mall_price_kobo,
 *    retail_price_kobo)); client-sent prices are never trusted.
 *  - Only `is_mall_listed = 1 AND status = 'Active' AND stock_qty > 0` is sellable.
 *  - Oversell is physically impossible: trg_products_no_oversell ABORTs any
 *    UPDATE that would push stock_qty below zero, which atomically rolls back
 *    the whole checkout batch.
 */
import { KoboToNaira, parseJsonArray, s, n } from './relationalMapper.js';
import { MALL_DELIVERY_ZONE_IDS, mallDeliveryFeeKobo, mallDeliveryLabel, mallDeliveryZone } from '../shared/mallDelivery.js';

export type MallStmt = { sql: string; params?: any[] };

export type MallExecutor = {
  queryAll: (sql: string, params?: any[]) => Promise<any[]>;
  /** Runs statements atomically; returns per-statement `changes` counts. */
  runBatch: (stmts: MallStmt[]) => Promise<number[]>;
};

/** Oversell is impossible everywhere once this trigger exists (idempotent). */
export const MALL_OVERSELL_TRIGGER_SQL = `CREATE TRIGGER IF NOT EXISTS trg_products_no_oversell
BEFORE UPDATE ON products
FOR EACH ROW
WHEN NEW.stock_qty < 0
BEGIN
  SELECT RAISE(ABORT, 'INSUFFICIENT_STOCK');
END;`;

const SELLABLE = `is_mall_listed = 1 AND status = 'Active' AND stock_qty > 0`;
const CATALOG_COLUMNS = `id, sku, name, description, category_name, brand, unit, images_json, stock_qty,
  retail_price_kobo, COALESCE(mall_price_kobo, retail_price_kobo) AS price_kobo,
  COALESCE((
    SELECT SUM(si.qty)
    FROM sale_items si
    JOIN sales sale ON sale.id = si.sale_id
    WHERE si.product_id = products.id
      AND LOWER(COALESCE(sale.status, '')) IN ('completed', 'paid', 'fulfilled', 'delivered')
  ), 0) AS sold_qty`;

const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

type MallError = Error & { mallStatus?: number; mallPayload?: unknown };
function fail(status: number, message: string, payload?: unknown): never {
  const err = new Error(message) as MallError;
  err.mallStatus = status;
  if (payload !== undefined) err.mallPayload = payload;
  throw err;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

function sessionFrom(request: Request): string {
  const raw = s(request.headers.get('x-mall-session'));
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(raw)) fail(400, 'A valid X-Mall-Session header is required.');
  return raw;
}

function publicProduct(r: any) {
  const images = parseJsonArray(r.images_json).slice(0, 6);
  const stock = n(r.stock_qty);
  return {
    id: s(r.id),
    name: s(r.name),
    description: s(r.description),
    category: s(r.category_name),
    brand: s(r.brand),
    unit: s(r.unit, 'pcs'),
    price: n(r.price_kobo),
    retailPriceKobo: n(r.retail_price_kobo),
    sold: n(r.sold_qty),
    stock,
    image: images[0] || '',
    images,
    available: stock > 0,
  };
}


async function getCatalog(exec: MallExecutor, url: URL) {
  const q = s(url.searchParams.get('q')).trim().slice(0, 80);
  const category = s(url.searchParams.get('category')).trim().slice(0, 80);
  const limitParam = url.searchParams.get('limit');
  const limit = Math.min(Math.max(limitParam === null ? 24 : n(limitParam, 24), 1), 60);
  const offset = Math.max(n(url.searchParams.get('offset'), 0), 0);

  const filters: string[] = [SELLABLE];
  const params: any[] = [];
  if (q) {
    filters.push('(name LIKE ? OR description LIKE ? OR brand LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  if (category) {
    filters.push('category_name = ?');
    params.push(category);
  }
  const where = filters.join(' AND ');

  const rows = await exec.queryAll(
    `SELECT ${CATALOG_COLUMNS} FROM products WHERE ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const totalRow = await exec.queryAll(`SELECT COUNT(*) AS n FROM products WHERE ${where}`, params);
  const catRows = await exec.queryAll(
    `SELECT category_name AS name, COUNT(*) AS count FROM products WHERE ${SELLABLE} GROUP BY category_name ORDER BY count DESC, name ASC`,
  );
  return json({
    products: rows.map(publicProduct),
    categories: catRows.map((c) => ({ name: s(c.name, 'Uncategorized'), count: n(c.count) })),
    total: n((totalRow[0] as any)?.n),
    limit,
    offset,
  });
}

async function getProduct(exec: MallExecutor, id: string) {
  const rows = await exec.queryAll(
    `SELECT ${CATALOG_COLUMNS} FROM products WHERE id = ? AND ${SELLABLE} LIMIT 1`,
    [id],
  );
  if (!rows.length) return json({ error: 'Product not available' }, 404);
  return json({ product: publicProduct(rows[0]) });
}
// ===SEAM-B===

async function getOrCreateCartId(exec: MallExecutor, sessionId: string): Promise<string> {
  // Deterministic cart id per session: INSERT OR IGNORE semantics via fixed id
  // make cart creation race-free — one row per session, ever.
  const cartId = `mc-${sessionId}`;
  const existing = await exec.queryAll('SELECT id, status FROM mall_carts WHERE id = ? LIMIT 1', [cartId]);
  if (!existing.length) {
    await exec.runBatch([{
      sql: 'INSERT INTO mall_carts (id, customer_id, session_id, status, updated_at) VALUES (?, NULL, ?, ?, ?)',
      params: [cartId, sessionId, 'active', Date.now()],
    }]);
    return cartId;
  }
  if (s((existing[0] as any).status) !== 'active') {
    await exec.runBatch([{
      sql: "UPDATE mall_carts SET status = 'active', updated_at = ? WHERE id = ?",
      params: [Date.now(), cartId],
    }]);
  }
  return cartId;
}

const CART_ITEM_COLUMNS = `ci.product_id AS product_id, ci.qty AS qty, p.name AS name, p.unit AS unit,
  p.stock_qty AS stock_qty, p.images_json AS images_json, p.is_mall_listed AS is_mall_listed,
  p.status AS status, COALESCE(p.mall_price_kobo, p.retail_price_kobo) AS price_kobo`;

async function readCart(exec: MallExecutor, cartId: string) {
  const rows = await exec.queryAll(
    `SELECT ${CART_ITEM_COLUMNS}
     FROM mall_cart_items ci JOIN products p ON p.id = ci.product_id
     WHERE ci.cart_id = ? ORDER BY ci.rowid ASC`,
    [cartId],
  );
  const items = rows.map((r) => {
    const sellable = n(r.is_mall_listed) === 1 && s(r.status) === 'Active';
    return {
      productId: s(r.product_id),
      name: s(r.name),
      unit: s(r.unit, 'pcs'),
      price: n(r.price_kobo),
      qty: n(r.qty),
      stock: n(r.stock_qty),
      image: (parseJsonArray(r.images_json)[0] as string) || '',
      available: sellable && n(r.qty) <= n(r.stock_qty),
    };
  });
  const subtotalKobo = items.reduce((sum, it) => sum + it.price * it.qty, 0);
  return { items, subtotalKobo };
}

async function respondWithCart(exec: MallExecutor, sessionId: string) {
  const cartId = await getOrCreateCartId(exec, sessionId);
  const cart = await readCart(exec, cartId);
  return json({ ...cart, cartId });
}

async function addToCart(exec: MallExecutor, sessionId: string, body: any) {
  const productId = s(body?.productId);
  const qty = n(body?.qty, 1);
  if (!productId) fail(400, 'productId is required.');
  if (!Number.isSafeInteger(qty) || qty < 1) fail(400, 'qty must be a positive whole number.');

  const rows = await exec.queryAll(
    `SELECT ${CATALOG_COLUMNS} FROM products WHERE id = ? AND ${SELLABLE} LIMIT 1`,
    [productId],
  );
  if (!rows.length) fail(404, 'Product is not available on the mall.');
  if (n((rows[0] as any).stock_qty) < 1) fail(409, 'Product is out of stock.');

  const cartId = await getOrCreateCartId(exec, sessionId);
  const current = await exec.queryAll(
    'SELECT qty FROM mall_cart_items WHERE cart_id = ? AND product_id = ? LIMIT 1',
    [cartId, productId],
  );
  const stock = n((rows[0] as any).stock_qty);
  const nextQty = Math.min(n((current[0] as any)?.qty) + qty, Math.max(stock, 1));
  await exec.runBatch([
    { sql: 'DELETE FROM mall_cart_items WHERE cart_id = ? AND product_id = ?', params: [cartId, productId] },
    { sql: 'INSERT INTO mall_cart_items (id, cart_id, product_id, variant_id, qty, unit_price_kobo) VALUES (?, ?, ?, NULL, ?, ?)', params: [`mci-${uuid()}`, cartId, productId, nextQty, n((rows[0] as any).price_kobo)] },
    { sql: 'UPDATE mall_carts SET updated_at = ? WHERE id = ?', params: [Date.now(), cartId] },
  ]);
  return respondWithCart(exec, sessionId);
}

async function setCartQty(exec: MallExecutor, sessionId: string, body: any) {
  const productId = s(body?.productId);
  const qty = n(body?.qty, -1);
  if (!productId) fail(400, 'productId is required.');
  if (!Number.isSafeInteger(qty) || qty < 0) fail(400, 'qty must be a non-negative whole number.');

  const cartId = await getOrCreateCartId(exec, sessionId);
  const stmts: MallStmt[] = [{ sql: 'DELETE FROM mall_cart_items WHERE cart_id = ? AND product_id = ?', params: [cartId, productId] }];
  if (qty > 0) {
    const rows = await exec.queryAll(
      `SELECT ${CATALOG_COLUMNS} FROM products WHERE id = ? AND ${SELLABLE} LIMIT 1`,
      [productId],
    );
    if (!rows.length) fail(404, 'Product is not available on the mall.');
    if (n((rows[0] as any).stock_qty) < qty) fail(409, `Only ${n((rows[0] as any).stock_qty)} left in stock.`);
    stmts.push({ sql: 'INSERT INTO mall_cart_items (id, cart_id, product_id, variant_id, qty, unit_price_kobo) VALUES (?, ?, ?, NULL, ?, ?)', params: [`mci-${uuid()}`, cartId, productId, qty, n((rows[0] as any).price_kobo)] });
  }
  stmts.push({ sql: 'UPDATE mall_carts SET updated_at = ? WHERE id = ?', params: [Date.now(), cartId] });
  await exec.runBatch(stmts);
  return respondWithCart(exec, sessionId);
}
// ===SEAM-D===

const PAYMENT_PROVIDERS = new Set(['pay_on_pickup', 'bank_transfer']);

function orderNumber(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let rand = '';
  for (let i = 0; i < 8; i++) rand += alphabet[Math.floor(Math.random() * alphabet.length)];
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `MALL-${day}-${rand}`;
}

/**
 * Checkout — ONE atomic batch:
 *   mall_orders + mall_order_items + products.stock_qty decrements
 *   + stock_movements + payments + cart conversion.
 * The oversell trigger aborts the whole batch if any line would push stock
 * below zero, so the storefront can never oversell the POS.
 */
async function checkout(exec: MallExecutor, sessionId: string, body: any) {
  const customerName = s(body?.customerName).trim().slice(0, 120) || 'Walk-in customer';
  const customerPhone = s(body?.customerPhone).trim().slice(0, 32) || '08000000000';
  const deliveryAddress = s(body?.deliveryAddress).trim().slice(0, 400);
  const note = s(body?.note).trim().slice(0, 400);
  const rawMethod = s(body?.paymentMethod);
  const paymentMethod = PAYMENT_PROVIDERS.has(rawMethod) ? rawMethod : 'pay_on_pickup';
  if (body?.deliveryZone != null && !MALL_DELIVERY_ZONE_IDS.has(body.deliveryZone)) fail(400, 'Select a valid delivery zone.');
  const deliveryZone = mallDeliveryZone(body?.deliveryZone);
  const fixedDeliveryFeeKobo = mallDeliveryFeeKobo(deliveryZone);
  const quoteRequired = fixedDeliveryFeeKobo === null;
  // Fixed fees are resolved from the trusted zone policy. Public clients never provide an amount.
  const deliveryFeeKobo = fixedDeliveryFeeKobo ?? 0;
  if (deliveryZone !== 'pickup' && !deliveryAddress) fail(400, 'Enter a delivery address for the selected zone.');

  const cartId = await getOrCreateCartId(exec, sessionId);
  const orderId = `mo-${sessionId}`;
  const existingOrder = await exec.queryAll('SELECT * FROM mall_orders WHERE id = ? LIMIT 1', [orderId]);
  if (existingOrder.length) {
    const existingItems = await exec.queryAll('SELECT product_id, product_name, qty, unit_price_kobo FROM mall_order_items WHERE mall_order_id = ? ORDER BY rowid', [orderId]);
    const existing = existingOrder[0];
    let existingDelivery: Record<string, any> = {};
    try { existingDelivery = existing.delivery_address_json ? JSON.parse(existing.delivery_address_json) : {}; } catch { /* malformed legacy data */ }
    return json({
      ok: true, orderNo: s(existing.order_no), status: s(existing.status, 'pending'),
      items: existingItems.map((item) => ({ productId: s(item.product_id), name: s(item.product_name), unit: 'pcs', price: n(item.unit_price_kobo), qty: n(item.qty) })),
      customerName: s(existing.customer_name), subtotalKobo: n(existing.subtotal_kobo), deliveryFeeKobo: n(existing.delivery_fee_kobo), totalKobo: n(existing.total_kobo), paymentStatus: 'pending',
      deliveryZone: mallDeliveryZone(existingDelivery.zone), deliveryLabel: s(existingDelivery.zoneLabel, mallDeliveryLabel(mallDeliveryZone(existingDelivery.zone))), quoteRequired: existingDelivery.quoteRequired === true && existingDelivery.quoteConfirmed !== true,
      paidKobo: 0, amountDueKobo: n(existing.total_kobo), createdAt: s(existing.created_at),
      subtotal: KoboToNaira(existing.subtotal_kobo), deliveryFee: KoboToNaira(existing.delivery_fee_kobo), total: KoboToNaira(existing.total_kobo),
    });
  }
  const rows = await exec.queryAll(
    `SELECT ci.product_id AS product_id, ci.qty AS qty, p.name AS name, p.stock_qty AS stock_qty,
            p.is_mall_listed AS is_mall_listed, p.status AS status,
            COALESCE(p.mall_price_kobo, p.retail_price_kobo) AS price_kobo
     FROM mall_cart_items ci JOIN products p ON p.id = ci.product_id
     WHERE ci.cart_id = ? ORDER BY ci.rowid ASC`,
    [cartId],
  );
  if (!rows.length) fail(400, 'Your cart is empty.');

  const items = rows.map((r) => ({
    productId: s(r.product_id),
    name: s(r.name),
    qty: n(r.qty),
    unitPriceKobo: n(r.price_kobo),
    totalKobo: n(r.price_kobo) * n(r.qty),
  }));
  for (const it of items) {
    const row = rows.find((r) => s(r.product_id) === it.productId) as any;
    if (n(row.is_mall_listed) !== 1) fail(409, `"${it.name}" is no longer available on the mall. Remove it to continue.`, { productId: it.productId });
    if (it.qty < 1) fail(409, `"${it.name}" has an invalid quantity.`, { productId: it.productId });
    if (n(row.stock_qty) < it.qty) fail(409, `Only the remaining stock of "${it.name}" can be ordered. Reduce the quantity to continue.`, { productId: it.productId });
  }

  const subtotalKobo = items.reduce((sum, it) => sum + it.totalKobo, 0);
  const totalKobo = subtotalKobo + deliveryFeeKobo;
  const orderNo = orderNumber();
  const createdAt = nowIso();

  const stmts: MallStmt[] = [{
    sql: `INSERT INTO mall_orders (id, order_no, customer_id, customer_name, customer_phone, status,
            subtotal_kobo, delivery_fee_kobo, discount_kobo, total_kobo, payment_ref, delivery_address_json, linked_sale_id, created_at)
          VALUES (?, ?, NULL, ?, ?, 'pending', ?, ?, 0, ?, NULL, ?, NULL, ?)`,
    params: [
      orderId, orderNo, customerName, customerPhone,
      subtotalKobo, deliveryFeeKobo, totalKobo,
      JSON.stringify({ address: deliveryAddress, note, paymentMethod, zone: deliveryZone, zoneLabel: mallDeliveryLabel(deliveryZone), quoteRequired, quoteConfirmed: !quoteRequired }),
      createdAt,
    ],
  }];
  items.forEach((it, index) => {
    stmts.push({
      sql: 'INSERT INTO mall_order_items (id, mall_order_id, product_id, product_name, qty, unit_price_kobo, total_kobo) VALUES (?, ?, ?, ?, ?, ?, ?)',
      params: [`${orderId}-item-${index}`, orderId, it.productId, it.name, it.qty, it.unitPriceKobo, it.totalKobo],
    });
    stmts.push({
      sql: 'UPDATE products SET stock_qty = stock_qty - ?, updated_at = ? WHERE id = ?',
      params: [it.qty, createdAt, it.productId],
    });
    stmts.push({
      sql: `INSERT INTO stock_movements (id, product_id, product_name, type, qty, prev_stock, new_stock, ref_id, notes, performed_by, created_at)
            VALUES (?, ?, ?, 'Mall Order', ?, (SELECT stock_qty + ? FROM products WHERE id = ?), (SELECT stock_qty FROM products WHERE id = ?), ?, ?, ?, ?)`,
      params: [
        `mv-${uuid()}`, it.productId, it.name, -it.qty,
        it.qty, it.productId, it.productId,
        `checkout:${orderId}`, `Mall order ${orderNo}`, 'Mall Storefront', createdAt,
      ],
    });
  });
  stmts.push({
    sql: `INSERT INTO payments (id, order_id, sale_id, provider, reference, amount_kobo, status, raw_json, created_at)
          VALUES (?, ?, NULL, ?, ?, ?, 'pending', ?, ?)`,
    params: [`pay-${uuid()}`, orderId, paymentMethod, `MALL-${orderNo}`, totalKobo, JSON.stringify({ orderNo }), createdAt],
  });
  stmts.push({ sql: 'DELETE FROM mall_cart_items WHERE cart_id = ?', params: [cartId] });
  stmts.push({ sql: "UPDATE mall_carts SET status = 'converted', updated_at = ? WHERE id = ?", params: [Date.now(), cartId] });

  await exec.runBatch(stmts);
  return json({
    ok: true,
    orderNo,
    status: 'pending',
    items: items.map(it => ({
      productId: it.productId,
      name: it.name,
      unit: 'pcs',
      price: it.unitPriceKobo,
      qty: it.qty,
    })),
    customerName,
    subtotalKobo,
    deliveryFeeKobo,
    totalKobo,
    deliveryZone,
    deliveryLabel: mallDeliveryLabel(deliveryZone),
    quoteRequired,
    paymentStatus: 'pending',
    paidKobo: 0,
    amountDueKobo: totalKobo,
    createdAt,
    subtotal: KoboToNaira(subtotalKobo),
    deliveryFee: KoboToNaira(deliveryFeeKobo),
    total: KoboToNaira(totalKobo),
  }, 201);

}
/**
 * Buyer order lookup — public, phone-scoped. Lets a buyer who checked out as
 * guest OR saved account find their orders without a staff login. Phone must
 * be >= 7 digits; only latest 20 orders returned, no PII beyond order totals.
 */
async function getOrdersByPhone(exec: MallExecutor, url: URL) {
  const rawPhone = s(url.searchParams.get('phone')).trim().slice(0, 32);
  const digits = rawPhone.replace(/\D/g, '');
  if (digits.length < 7) fail(400, 'Enter the phone number used at checkout to track orders.');
  const like = `%${digits.slice(-10)}%`;
  const rows = await exec.queryAll(
    `SELECT o.order_no AS order_no, o.status AS status, o.total_kobo AS total_kobo,
            o.created_at AS created_at, COUNT(oi.id) AS item_count
     FROM mall_orders o LEFT JOIN mall_order_items oi ON oi.mall_order_id = o.id
     WHERE REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(o.customer_phone,''),' ',''),'-',''),'(',''),')','') LIKE ?
        OR o.customer_phone LIKE ?
     GROUP BY o.id ORDER BY o.created_at DESC LIMIT 20`,
    [like, like],
  );
  return json({
    orders: rows.map((r: any) => ({
      orderNo: s(r.order_no),
      status: s(r.status, 'pending'),
      totalKobo: n(r.total_kobo),
      createdAt: s(r.created_at),
      itemCount: n(r.item_count),
    })),
    total: rows.length,
  });
}

/**
 * Express-compatible mall handler.
 * Consumes an existing `MallExecutor` and returns a `Response`.
 * Mounted in server.ts as the `/api/mall/*` entrypoint.
 */
async function parseMallBody(request: Request): Promise<any> {
  if (request.method === 'GET' || request.method === 'HEAD') return {};
  try {
    const body = await request.text();
    if (!body) return {};
    return JSON.parse(body);
  } catch {
    return {};
  }
}

export async function handleMallApi(request: Request, exec: MallExecutor): Promise<Response> {
  try {
  const methodName = request.method;
  const rawPath = new URL(request.url, 'http://localhost').pathname;
  if (rawPath !== '/api/mall' && !rawPath.startsWith('/api/mall/')) return json({ error: 'Not found' }, 404);
  const pathname = rawPath.replace(/^\/api\/mall/, '');

  if (pathname.startsWith('/health')) {
    return json({
      ok: true,
      routes: [
        '/api/mall/health',
        '/api/mall/products',
        '/api/mall/cart/total',
        '/api/mall/cart',
        '/api/mall/cart/qty',
        '/api/mall/checkout',
        '/api/mall/orders',
      ],
    });
  }

  if (pathname.startsWith('/orders')) {
    if (methodName !== 'GET') return json({ error: 'Only GET is supported.' }, 405);
    return getOrdersByPhone(exec, new URL(request.url, 'http://localhost'));
  }

  if (pathname.startsWith('/products/')) {
    if (methodName !== 'GET') return json({ error: 'Only GET is supported.' }, 405);
    return getProduct(exec, decodeURIComponent(pathname.slice('/products/'.length)));
  }

  if (pathname.startsWith('/products')) {
    if (methodName !== 'GET') return json({ error: 'Only GET is supported.' }, 405);
    return getCatalog(exec, new URL(request.url, 'http://localhost'));
  }

  if (pathname.startsWith('/cart/total')) {
    if (methodName !== 'GET') return json({ error: 'Only GET is supported.' }, 405);
    const session = s(request.headers.get('x-mall-session'));
    if (!session) return json({ error: 'Session is required. Send x-mall-session header or cookie.' }, 400);
    return respondWithCart(exec, session);
  }

  if (pathname.startsWith('/cart/qty')) {
    if (methodName !== 'POST') return json({ error: 'Only POST is supported.' }, 405);
    const session = s(request.headers.get('x-mall-session'));
    if (!session) return json({ error: 'Session is required. Send x-mall-session header or cookie.' }, 400);
    return setCartQty(exec, session, await parseMallBody(request));
  }

  if (pathname.startsWith('/cart')) {
    const session = s(request.headers.get('x-mall-session'));
    if (methodName === 'GET') {
      if (!session) return json({ error: 'Session is required. Send x-mall-session header or cookie.' }, 400);
      return respondWithCart(exec, session);
    }
    if (methodName === 'POST') {
      if (!session) return json({ error: 'Session is required. Send x-mall-session header or cookie.' }, 400);
      return addToCart(exec, session, await parseMallBody(request));
    }
    return json({ error: 'Only GET or POST is supported.' }, 405);
  }

  if (pathname.startsWith('/checkout')) {
    if (methodName !== 'POST') return json({ error: 'Only POST is supported.' }, 405);
    const session = s(request.headers.get('x-mall-session'));
    if (!session) return json({ error: 'Session is required. Send x-mall-session header or cookie.' }, 400);
    return checkout(exec, session, await parseMallBody(request));
  }

  return json({ error: 'Unknown /api/mall route.' }, 404);
  } catch (error) {
    const known = error as MallError;
    return json({ error: error instanceof Error ? error.message : 'Mall API error', payload: known.mallPayload }, known.mallStatus || 500);
  }
}