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
 *  - Every Active product is visible; purchasing also requires stock and a valid price.
 *  - Oversell is physically impossible: trg_products_no_oversell ABORTs any
 *    UPDATE that would push stock_qty below zero, which atomically rolls back
 *    the whole checkout batch.
 */
import { KoboToNaira, parseJsonArray, s, n } from './relationalMapper.js';
import { hasMallPrice } from '../shared/mallProductPresentation.js';
import { createMallSearchMatcher } from '../shared/mallSearch.js';
import { MALL_DELIVERY_ZONE_IDS, mallDeliveryFeeKobo, mallDeliveryLabel, mallDeliveryZone } from '../shared/mallDelivery.js';
import { assertSql } from './mallSafety.js';
import { normalizeMallPhone, normalizedPhoneSql } from '../shared/mallPhone.js';
import { mallReadiness, mallRateLimit, publicMallConfig, type MallConfig } from './mallOperations.js';

export type MallStmt = { sql: string; params?: any[] };

export type MallExecutor = {
  config?: MallConfig;
  clientIp?: string;
  /** #14 — whether durable image storage exists in this runtime. */
  imagesConfigured?: boolean;
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

const VISIBLE = `status = 'Active'`;

/**
 * Parameter-free "now" so promotional windows are evaluated identically in the
 * catalog, the cart, the detail endpoint AND the checkout batch assertion.
 * Promo columns are always stored as millisecond ISO-8601 UTC, so the lexical
 * comparison is also a chronological one.
 */
export const NOW_SQL = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;
export const promoActive = (alias: string) => `${alias}.mall_promo_price_kobo IS NOT NULL
    AND (${alias}.mall_promo_start IS NULL OR ${alias}.mall_promo_start <= ${NOW_SQL})
    AND (${alias}.mall_promo_end IS NULL OR ${alias}.mall_promo_end >= ${NOW_SQL})`;
/** THE definition of the public mall price: active promo -> mall price -> retail price. */
export const effectivePrice = (alias: string) =>
  `COALESCE(CASE WHEN ${promoActive(alias)} THEN ${alias}.mall_promo_price_kobo END, ${alias}.mall_price_kobo, ${alias}.retail_price_kobo)`;

const CATALOG_COLUMNS = `id, sku, name, COALESCE(NULLIF(mall_description, ''), description) AS description, category_name, brand, unit, images_json, stock_qty,
  created_at,
  retail_price_kobo, mall_price_kobo, mall_featured, mall_display_order,
  mall_promo_price_kobo, mall_promo_start, mall_promo_end,
  CASE WHEN ${promoActive('products')} THEN 1 ELSE 0 END AS promo_active,
  ${effectivePrice('products')} AS price_kobo`;

/**
 * Popularity join, split out of CATALOG_COLUMNS on purpose: only the two
 * consumers that genuinely rank or display sold quantities pay it -- product
 * detail (one row) and the 60s-cached top-sellers rail. Catalog and search rows
 * report sold: 0.
 *
 * The correlated subquery is served by idx_sale_items_product
 * (product_id, sale_id, qty). Driving it from `sale_items` by product_id is a
 * seek per product instead of a whole-table read per product, which is what
 * previously produced multi-million rows-read counts on the home rail.
 */
const CATALOG_SOLD_COLUMNS = `${CATALOG_COLUMNS},
  COALESCE((
    SELECT SUM(si.qty)
    FROM sale_items si
    JOIN sales sale ON sale.id = si.sale_id
    WHERE si.product_id = products.id
      AND sale.status IN ('Completed', 'Paid', 'Fulfilled', 'Delivered', 'completed', 'paid', 'fulfilled', 'delivered')
  ), 0) AS sold_qty`;

/**
 * Catalog 'popular' fallback after sold_qty left the storefront columns:
 * merchandised ordering first, then recency. The top-sellers rail and product
 * detail still rank by real sold quantities.
 */
const POPULAR_FALLBACK_SORT = `mall_featured DESC, updated_at DESC, id ASC`;

/** Whitelisted server-side sorts. Select aliases (price_kobo, sold_qty) are valid ORDER BY keys. */
const CATALOG_SORTS: Record<string, string> = {
  relevance: `mall_featured DESC, (mall_display_order IS NULL) ASC, mall_display_order ASC, updated_at DESC, id ASC`,
  popular: `sold_qty DESC, mall_featured DESC, updated_at DESC, id ASC`,
  price_asc: `price_kobo ASC, name ASC, id ASC`,
  price_desc: `price_kobo DESC, name ASC, id ASC`,
  newest: `created_at DESC, id DESC`,
};
const MAX_CATALOG_OFFSET = 10_000;

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
    available: stock > 0 && hasMallPrice(n(r.price_kobo)),
    createdAt: s(r.created_at),
    featured: n(r.mall_featured) === 1,
    promoActive: n(r.promo_active) === 1,
  };
}
/**
 * Facet cache (per runtime process/isolate). The category list is identical for
 * every catalog and search request, and the brand list varies only with the
 * base scope (search text excluded — it is computed in JS; category filter
 * included). Both are GROUP BY scans over all visible products, so they are
 * cached in memory for FACET_TTL_MS and invalidated by staff product writes
 * (PATCH /api/storage/records, snapshot restore). Staleness can only ever
 * affect the filter sidebar counts — product rows themselves are always read
 * fresh. Multi-isolate deployments reconcile within the TTL even without an
 * invalidation call, because each isolate owns its own cache.
 */
const FACET_TTL_MS = 60_000;
const FACET_BRAND_SCOPES_MAX = 32;
type FacetRows = { name: string; count: number }[];
let cachedCategories: { expiresAt: number; rows: FacetRows } | null = null;
const cachedBrandScopes = new Map<string, { expiresAt: number; rows: FacetRows }>();

/** Home rails cache entry: the visitor-identical flashSales/topSellers/newArrivals rows. */
let cachedHomeRailEntry: { expiresAt: number; flash: any[]; top: any[]; newest: any[] } | null = null;

/**
 * Derived-read caches owned by other modules (the staff order counts/operations
 * payloads in mallOrderAdminApi) register here, so every existing caller of
 * invalidateMallFacetCache() — the PATCH route, snapshot restore, checkout,
 * merchandising saves — drops them too. One entry point, no new wiring.
 */
const cacheInvalidators: (() => void)[] = [];

export function registerMallCacheInvalidator(invalidate: () => void): () => void {
  cacheInvalidators.push(invalidate);
  return () => {
    const index = cacheInvalidators.indexOf(invalidate);
    if (index >= 0) cacheInvalidators.splice(index, 1);
  };
}

/**
 * Staff writes must call this so derived read caches never outlive the write:
 * PATCH /api/storage/records and snapshot restores drop everything; checkout
 * and merchandising saves only reshape the home rails but go through the same
 * single entry point. (Named for the facet phase; it also clears the rails.)
 */
export function invalidateMallFacetCache(): void {
  cachedCategories = null;
  cachedBrandScopes.clear();
  cachedHomeRailEntry = null;
  for (const invalidate of cacheInvalidators) invalidate();
}

const facetFresh = <T extends { expiresAt: number }>(entry: T | null | undefined) =>
  entry && entry.expiresAt > Date.now() ? entry : null;

async function cachedCategoryFacets(exec: MallExecutor): Promise<FacetRows> {
  const fresh = facetFresh(cachedCategories);
  if (fresh) return fresh.rows;
  const rows = (await exec.queryAll(
    `SELECT category_name AS name, COUNT(*) AS count FROM products WHERE ${VISIBLE} GROUP BY category_name ORDER BY count DESC, name ASC`,
  )) as FacetRows;
  cachedCategories = { expiresAt: Date.now() + FACET_TTL_MS, rows };
  return rows;
}

async function cachedBrandFacets(exec: MallExecutor, whereBase: string, baseParams: unknown[]): Promise<FacetRows> {
  const key = `${whereBase}|${JSON.stringify(baseParams)}`;
  const fresh = facetFresh(cachedBrandScopes.get(key));
  if (fresh) return fresh.rows;
  const rows = (await exec.queryAll(
    `SELECT brand AS name, COUNT(*) AS count FROM products WHERE ${whereBase} AND brand <> '' GROUP BY brand ORDER BY count DESC, name ASC`,
    baseParams,
  )) as FacetRows;
  if (cachedBrandScopes.size >= FACET_BRAND_SCOPES_MAX) cachedBrandScopes.clear();
  cachedBrandScopes.set(key, { expiresAt: Date.now() + FACET_TTL_MS, rows });
  return rows;
}

/** Supplier receipts and manual restocks use Incoming; returns and corrections must not make an old product appear newly restocked. */
const lastRestockSql = `SELECT MAX(sm.created_at) FROM stock_movements sm
    WHERE sm.product_id = products.id AND sm.type = 'Incoming'
      AND sm.qty > 0 AND sm.new_stock > sm.prev_stock`;

/** Rank each stock group before LIMIT so lower-ranked eligible in-stock items can fill positions vacated by excess sold-out products. */
const selectRail = (exec: MallExecutor, selection: string, order: string, limit: number, params: any[] = []) => exec.queryAll(`
    WITH candidates AS (${selection}), ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY (stock_qty <= 0) ORDER BY ${order}) AS stock_rank
      FROM candidates
    ) SELECT * FROM ranked WHERE stock_qty > 0 OR stock_rank = 1 ORDER BY ${order} LIMIT ${limit}`, params);

/**
 * Same rail semantics as selectRail, for a selection whose ORDER BY key is an
 * expensive per-row aggregate (top sellers: SUM(sale_items.qty) per product).
 *
 * selectRail re-runs that aggregate for every candidate row in the projection
 * window AND again in its ROW_NUMBER window, so the cost is paid twice across
 * the whole Active catalog. Here the ranking CTE carries ONLY the primary key
 * plus the keys the ORDER BY can use, so the aggregate is computed once per
 * catalog row by the window itself, then the payload is fetched by primary key
 * for the handful of rows that survive the LIMIT. Returned rows are
 * byte-identical to selectRail's, in the same order.
 */
const selectRankedByKey = (
  exec: MallExecutor, selection: string, order: string, limit: number, params: any[] = [],
) => exec.queryAll(`
    WITH candidates AS (${selection}), ranked AS (
      SELECT id, CASE WHEN stock_qty > 0 THEN 0 ELSE 1 END AS stock_group,
        ROW_NUMBER() OVER (PARTITION BY (stock_qty <= 0) ORDER BY ${order}) AS stock_rank
      FROM candidates
    ), winners AS (
      SELECT id FROM ranked WHERE stock_group = 0 OR stock_rank = 1
    )
    SELECT ${CATALOG_SOLD_COLUMNS}, updated_at FROM products
      WHERE id IN (SELECT id FROM winners) ORDER BY ${order} LIMIT ${limit}`, params);

/**
 * Home rail cache. flashSales/topSellers/newArrivals are identical for every
 * visitor (only buyAgain is session-scoped), yet they re-ran three whole-catalog
 * scans on EVERY homepage view. They share the facet cache's TTL and
 * invalidation contract, so a warm homepage costs one buyAgain lookup. Rows are
 * cached pre-mapping; publicProduct is a pure transform of them.
 */
async function cachedHomeRails(exec: MallExecutor) {
  const fresh = facetFresh(cachedHomeRailEntry);
  if (fresh) return fresh;
  const [flash, top, newest] = await Promise.all([
    exec.queryAll(`SELECT ${CATALOG_COLUMNS} FROM products WHERE ${VISIBLE}
      AND ${effectivePrice('products')} > 0 AND ${effectivePrice('products')} < retail_price_kobo
      ORDER BY ${CATALOG_SORTS.relevance} LIMIT 10`),
    selectRankedByKey(exec, `SELECT ${CATALOG_SOLD_COLUMNS}, updated_at FROM products WHERE ${VISIBLE}`, CATALOG_SORTS.popular, 12),
    selectRail(exec, `WITH p AS (SELECT *, (${lastRestockSql}) AS last_restock FROM products)
      SELECT *, last_restock FROM p WHERE ${VISIBLE} AND last_restock IS NOT NULL`, 'last_restock DESC, id ASC', 12),
  ]);
  cachedHomeRailEntry = { expiresAt: Date.now() + FACET_TTL_MS, flash, top, newest };
  return cachedHomeRailEntry;
}

async function getCatalog(exec: MallExecutor, url: URL) {
  const q = s(url.searchParams.get('q')).trim().slice(0, 80);
  const category = s(url.searchParams.get('category')).trim().slice(0, 80);
  const brandFilter = s(url.searchParams.get('brand')).trim().slice(0, 80);
  const sortKey = s(url.searchParams.get('sort'), 'relevance').trim();
  const sort = CATALOG_SORTS[sortKey];
  // Catalog 'popular' no longer orders by per-row sold quantities; fall back
  // to merchandised-then-recency ordering.
  const effectiveSort = sortKey === 'popular' ? POPULAR_FALLBACK_SORT : sort;
  const limitParam = url.searchParams.get('limit');
  const limit = Math.min(Math.max(limitParam === null ? 24 : n(limitParam, 24), 1), 60);
  const offset = Math.max(n(url.searchParams.get('offset'), 0), 0);

  if (!sort) fail(400, `Unsupported sort. Use one of: ${Object.keys(CATALOG_SORTS).join(', ')}.`);
  if (offset > MAX_CATALOG_OFFSET) fail(400, 'Pagination offset is too large. Narrow the search instead.');

  const rawInStock = url.searchParams.get('inStock');
  if (rawInStock !== null && !['0', '1'].includes(rawInStock)) fail(400, 'inStock must be 0 or 1.');
  const stockFirst = url.searchParams.get('stockFirst');
  if (stockFirst !== null && !['0', '1'].includes(stockFirst)) fail(400, 'stockFirst must be 0 or 1.');
  const stockOrder = stockFirst === '1' ? '(stock_qty > 0) DESC, ' : '';

  // Base scope: everything the storefront may show, minus brand/inStock. The brand
  // list is derived from this scope so the filter reflects the WHOLE catalog page
  // set (search + category), not just the current page.
  const base: string[] = [VISIBLE];
  const baseParams: any[] = [];
  if (category) {
    base.push('category_name = ?');
    baseParams.push(category);
  }
  const whereBase = base.join(' AND ');

  if (q) {
    // Scan only searchable public text, not images, prices or sales aggregates.
    // JSON binds keep large match sets within both runtimes' parameter limits.
    const candidates = await exec.queryAll(`SELECT id, name, brand, category_name, stock_qty,
      COALESCE(NULLIF(mall_description, ''), description) AS description
      FROM products WHERE ${whereBase} ORDER BY id`, baseParams);
    const match = createMallSearchMatcher(q);
    const scored = candidates.map(row => ({ row, score: match(row) })).filter(item => item.score > 0);
    const strong = scored.some(item => item.score >= 60);
    const matches = scored.filter(item => !strong || item.score >= 60).sort((a, b) => b.score - a.score);
    const brandCounts = new Map<string, number>();
    for (const { row } of matches) if (row.brand) brandCounts.set(row.brand, (brandCounts.get(row.brand) || 0) + 1);
    const ids = matches.filter(({ row }) => (!brandFilter || row.brand === brandFilter) &&
      (rawInStock !== '1' || n(row.stock_qty) > 0)).map(({ row }) => row.id);
    const encodedIds = JSON.stringify(ids);
    const order = sortKey === 'relevance'
      ? `(SELECT CAST(key AS INTEGER) FROM json_each(?) WHERE value = products.id)` : effectiveSort;
    const rows = ids.length ? await exec.queryAll(
      `SELECT ${CATALOG_COLUMNS} FROM products WHERE ${VISIBLE} AND id IN (SELECT value FROM json_each(?))
       ORDER BY ${stockOrder}${order} LIMIT ? OFFSET ?`,
      [encodedIds, ...(sortKey === 'relevance' ? [encodedIds] : []), limit, offset],
    ) : [];
    const categories = await cachedCategoryFacets(exec);
    return json({ products: rows.map(publicProduct), total: ids.length, limit, offset, sort: sortKey,
      search: { query: q, approximate: !strong && matches.length > 0 },
      categories: categories.map(row => ({ name: s(row.name, 'Uncategorized'), count: n(row.count) })),
      brands: [...brandCounts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    });
  }

  const filters = [...base];
  const params = [...baseParams];
  if (brandFilter) {
    filters.push('brand = ?');
    params.push(brandFilter);
  }
  // Stock filtering is opt-in; sold-out products remain visible by default.
  if (rawInStock === '1') filters.push('stock_qty > 0');
  const where = filters.join(' AND ');

  // Page + filtered total in ONE windowed query: a catalog page view previously
  // scanned the products table twice (page, then COUNT). When the offset lands
  // past the end no row is returned and the window value is absent, so fall
  // back to the plain count — that only costs an extra query on the rare
  // out-of-range page, not on any normal page view.
  const rows = await exec.queryAll(
    `SELECT ${CATALOG_COLUMNS}, COUNT(*) OVER() AS page_total FROM products WHERE ${where} ORDER BY ${stockOrder}${effectiveSort} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const total = n((rows[0] as any)?.page_total
    ?? ((await exec.queryAll(`SELECT COUNT(*) AS n FROM products WHERE ${where}`, params))[0] as any)?.n);
  // Facet lists (category/brand counts) are identical across requests until a
  // staff product write lands; they are served from the short-TTL cache above.
  const catRows = await cachedCategoryFacets(exec);
  const brandRows = await cachedBrandFacets(exec, whereBase, baseParams);
  return json({
    products: rows.map(publicProduct),
    categories: catRows.map((c) => ({ name: s(c.name, 'Uncategorized'), count: n(c.count) })),
    brands: brandRows.map((b) => ({ name: s(b.name), count: n(b.count) })),
    total,
    limit,
    offset,
    sort: sortKey,
  });
}

async function getHomeSections(exec: MallExecutor, session: string) {
  // Mall order history is browser-scoped: an order counts as a purchase for
  // buyAgain only when THIS checkout session placed it AND it is paid or
  // completed. Pending orders are not purchases.
  // Start with this session's indexed checkout attempts, not every active product.
  // CROSS JOIN fixes SQLite's loop order: session -> orders -> items, then one
  // product PK seek per distinct purchase. Even an empty history avoids a catalog
  // scan. Aggregate once before joining products or applying the stock ranking.
  const history = `SELECT oi.product_id, MAX(o.created_at) AS last_purchase
    FROM mall_checkout_attempts a
    CROSS JOIN mall_orders o ON o.id = a.order_id
    CROSS JOIN mall_order_items oi ON oi.mall_order_id = o.id
    WHERE a.session_id = ?
      AND o.status NOT IN ('cancelled', 'refunded')
      AND (o.status = 'completed' OR EXISTS (SELECT 1 FROM payments pay WHERE pay.order_id = o.id AND pay.status = 'paid'))
      AND oi.product_id IS NOT NULL
    GROUP BY oi.product_id`;
  const [rails, again] = await Promise.all([
    cachedHomeRails(exec),
    selectRail(exec, `SELECT ${CATALOG_COLUMNS}, history.last_purchase FROM (${history}) history
      CROSS JOIN products ON products.id = history.product_id
      WHERE ${VISIBLE}`, 'last_purchase DESC, id ASC', 10, [session]),
  ]);
  return json({ flashSales: rails.flash.map(publicProduct), topSellers: rails.top.map(publicProduct),
    newArrivals: rails.newest.map(publicProduct), buyAgain: again.map(publicProduct) });
}

async function getProduct(exec: MallExecutor, id: string) {
  const rows = await exec.queryAll(
    `SELECT ${CATALOG_SOLD_COLUMNS} FROM products WHERE id = ? AND ${VISIBLE} LIMIT 1`,
    [id],
  );
  if (!rows.length) return json({ error: 'Product not available' }, 404);
  return json({ product: publicProduct(rows[0]) });
}
// ===SEAM-B===

async function getOrCreateCartId(exec: MallExecutor, sessionId: string): Promise<string> {
  // Deterministic cart id per session: one row per session, ever. Creation and
  // reactivation are the SAME statement, so a cart request no longer pays a
  // SELECT probe before its write (that probe ran on every cart / cart-qty /
  // checkout call). The conflict branch's WHERE keeps an already-active cart
  // untouched, so `updated_at` still only moves when a cart is reactivated and
  // the abandoned-cart sweep can still expire it.
  const cartId = `mc-${sessionId}`;
  await exec.runBatch([{
    sql: `INSERT INTO mall_carts (id, customer_id, session_id, status, updated_at) VALUES (?, NULL, ?, 'active', ?)
      ON CONFLICT(id) DO UPDATE SET status = 'active', updated_at = excluded.updated_at
      WHERE mall_carts.status <> 'active'`,
    params: [cartId, sessionId, Date.now()],
  }]);
  return cartId;
}

const CART_ITEM_COLUMNS = `ci.product_id AS product_id, ci.qty AS qty, p.name AS name, p.unit AS unit,
  p.stock_qty AS stock_qty, p.images_json AS images_json, p.is_mall_listed AS is_mall_listed,
  p.status AS status, ${effectivePrice('p')} AS price_kobo`;

async function readCart(exec: MallExecutor, cartId: string) {
  const rows = await exec.queryAll(
    `SELECT ${CART_ITEM_COLUMNS}
     FROM mall_cart_items ci JOIN products p ON p.id = ci.product_id
     WHERE ci.cart_id = ? ORDER BY ci.rowid ASC`,
    [cartId],
  );
  const items = rows.map((r) => {
    const sellable = s(r.status) === 'Active' && n(r.stock_qty) > 0 && hasMallPrice(n(r.price_kobo));
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
  if (!Number.isSafeInteger(qty) || qty < 1 || qty > 1000) fail(400, 'qty must be a whole number between 1 and 1000.');

  const rows = await exec.queryAll(
    `SELECT ${CATALOG_COLUMNS} FROM products WHERE id = ? AND ${VISIBLE} LIMIT 1`,
    [productId],
  );
  if (!rows.length) fail(404, 'Product is not available on the mall.');
  if (!hasMallPrice(n(rows[0].price_kobo))) fail(409, 'Price unavailable. This product cannot be purchased yet.');
  if (n((rows[0] as any).stock_qty) < 1) fail(409, 'Product is out of stock.');

  const cartId = await getOrCreateCartId(exec, sessionId);
  const stock = n((rows[0] as any).stock_qty);
  if (qty > stock) fail(409, 'Quantity exceeds available stock.');
  await exec.runBatch([
    ...assertSql(`COALESCE((SELECT qty FROM mall_cart_items WHERE cart_id=? AND product_id=?),0)+? <= MIN(1000,(SELECT stock_qty FROM products WHERE id=?))`,[cartId,productId,qty,productId]),
    { sql: 'INSERT INTO mall_cart_items (id, cart_id, product_id, qty, unit_price_kobo) VALUES (?, ?, ?, ?, ?) ON CONFLICT(cart_id,product_id) DO UPDATE SET qty=mall_cart_items.qty+excluded.qty,unit_price_kobo=excluded.unit_price_kobo', params: [uuid(), cartId, productId, qty, n((rows[0] as any).price_kobo)] },
    { sql: 'UPDATE mall_carts SET updated_at = ? WHERE id = ?', params: [Date.now(), cartId] },
  ]);
  return respondWithCart(exec, sessionId);
}

async function setCartQty(exec: MallExecutor, sessionId: string, body: any) {
  const productId = s(body?.productId);
  const qty = n(body?.qty, -1);
  if (!productId) fail(400, 'productId is required.');
  if (!Number.isSafeInteger(qty) || qty < 0 || qty > 1000) fail(400, 'qty must be a whole number between 0 and 1000.');

  const cartId = await getOrCreateCartId(exec, sessionId);
  const stmts: MallStmt[] = [{ sql: 'DELETE FROM mall_cart_items WHERE cart_id = ? AND product_id = ?', params: [cartId, productId] }];
  if (qty > 0) {
    const rows = await exec.queryAll(
      `SELECT ${CATALOG_COLUMNS} FROM products WHERE id = ? AND ${VISIBLE} LIMIT 1`,
      [productId],
    );
    if (!rows.length) fail(404, 'Product is not available on the mall.');
    if (!hasMallPrice(n(rows[0].price_kobo))) fail(409, 'Price unavailable. This product cannot be purchased yet.');
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
  for (const byte of crypto.getRandomValues(new Uint8Array(12))) rand += alphabet[byte % alphabet.length];
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
async function checkout(exec: MallExecutor, sessionId: string, body: any, attemptKey: string) {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(attemptKey)) fail(400, 'A valid Idempotency-Key is required.');
  const fields: Record<string, string> = {};
  const text = (key: string, max: number, required = false) => {
    const value = body?.[key];
    if ((value != null && typeof value !== 'string') || (typeof value === 'string' && (value.length > max || /[\x00-\x1f\x7f]/.test(value)))) fields[key] = `Use plain text up to ${max} characters.`;
    const result = typeof value === 'string' ? value.trim() : '';
    if (required && !result) fields[key] = 'This field is required.';
    return result;
  };
  const customerName = text('customerName', 120, true);
  const rawPhone = text('customerPhone', 32, true);
  const customerPhone = normalizeMallPhone(rawPhone);
  if (!customerPhone) fields.customerPhone = 'Enter a Nigerian mobile number or an international number starting with +.';
  const rawEmail = text('customerEmail', 254);
  const customerEmail = rawEmail.toLowerCase();
  if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) fields.customerEmail = 'Enter a valid email address.';
  const deliveryAddress = text('deliveryAddress', 400);
  const note = text('note', 400);
  const rawMethod = s(body?.paymentMethod);
  if (!PAYMENT_PROVIDERS.has(rawMethod)) fields.paymentMethod = 'Select pay_on_pickup or bank_transfer.';
  if (Object.keys(fields).length) fail(400, 'Validation failed', { fields });
  const paymentMethod = rawMethod;
  if (body?.deliveryZone != null && !MALL_DELIVERY_ZONE_IDS.has(body.deliveryZone)) fail(400, 'Select a valid delivery zone.',{fields:{deliveryZone:'Select a supported zone or request a staff quote.'}});
  const deliveryZone = mallDeliveryZone(body?.deliveryZone);
  const fixedDeliveryFeeKobo = mallDeliveryFeeKobo(deliveryZone);
  const quoteRequired = fixedDeliveryFeeKobo === null;
  // Fixed fees are resolved from the trusted zone policy. Public clients never provide an amount.
  const deliveryFeeKobo = fixedDeliveryFeeKobo ?? 0;
  if (deliveryZone !== 'pickup' && deliveryAddress.length<10) fail(400, 'Enter a delivery address for the selected zone.',{fields:{deliveryAddress:'Enter at least 10 characters including street and area.'}});

  const requestJson = JSON.stringify({ customerName, customerPhone, customerEmail, deliveryAddress, note, paymentMethod, deliveryZone });
  const attempt = (await exec.queryAll('SELECT * FROM mall_checkout_attempts WHERE attempt_key = ?', [attemptKey]))[0];
  if (attempt && (attempt.session_id !== sessionId || attempt.request_json !== requestJson)) fail(409, 'Idempotency key was already used for a different checkout.');
  const orderId = attempt?.order_id || `mo-${uuid()}`;
  const existingOrder = await exec.queryAll('SELECT * FROM mall_orders WHERE id = ? LIMIT 1', [orderId]);
  if (existingOrder.length) {
    const existingItems = await exec.queryAll('SELECT product_id, product_name, qty, unit_price_kobo FROM mall_order_items WHERE mall_order_id = ? ORDER BY rowid', [orderId]);
    const existing = existingOrder[0];
    const payment = (await exec.queryAll('SELECT status, provider, reference FROM payments WHERE order_id = ? LIMIT 1', [orderId]))[0];
    const paid = payment?.status === 'paid' ? n(existing.total_kobo) : 0;
    let existingDelivery: Record<string, any> = {};
    try { existingDelivery = existing.delivery_address_json ? JSON.parse(existing.delivery_address_json) : {}; } catch { /* malformed legacy data */ }
    return json({
      ok: true, orderNo: s(existing.order_no), status: s(existing.status, 'pending'),
      items: existingItems.map((item) => ({ productId: s(item.product_id), name: s(item.product_name), unit: 'pcs', price: n(item.unit_price_kobo), qty: n(item.qty) })),
      customerName: s(existing.customer_name), customerEmail: s(existing.customer_email) || undefined, subtotalKobo: n(existing.subtotal_kobo), deliveryFeeKobo: n(existing.delivery_fee_kobo), totalKobo: n(existing.total_kobo), paymentStatus: payment?.status, paymentMethod: payment?.provider, paymentReference: payment?.reference,
      deliveryZone: mallDeliveryZone(existingDelivery.zone), deliveryLabel: s(existingDelivery.zoneLabel, mallDeliveryLabel(mallDeliveryZone(existingDelivery.zone))), quoteRequired: existingDelivery.quoteRequired === true && existingDelivery.quoteConfirmed !== true,
      paidKobo: paid, amountDueKobo: ['cancelled', 'refunded'].includes(existing.status) ? 0 : n(existing.total_kobo) - paid, createdAt: s(existing.created_at),
      instructions: publicMallConfig(exec.config),
      subtotal: KoboToNaira(existing.subtotal_kobo), deliveryFee: KoboToNaira(existing.delivery_fee_kobo), total: KoboToNaira(existing.total_kobo),
    });
  }
  const cartId = await getOrCreateCartId(exec, sessionId);
  if (exec.config) {
    const configuration = publicMallConfig(exec.config);
    if (!configuration.checkoutEnabled || !configuration.pickup || (paymentMethod === 'bank_transfer' && !configuration.bank)) fail(503, 'Checkout is not configured. Please contact the store.');
  }
  const rows = await exec.queryAll(
    `SELECT ci.id AS cart_line_id, ci.product_id AS product_id, ci.qty AS qty, p.name AS name, p.stock_qty AS stock_qty,
            p.is_mall_listed AS is_mall_listed, p.status AS status,
            ${effectivePrice('p')} AS price_kobo
     FROM mall_cart_items ci JOIN products p ON p.id = ci.product_id
     WHERE ci.cart_id = ? ORDER BY ci.rowid ASC`,
    [cartId],
  );
  if (!rows.length) fail(400, 'Your cart is empty.');
  if (rows.length > 100) fail(400, 'An order may contain at most 100 items.');
  if (new Set(rows.map((r) => r.product_id)).size !== rows.length) fail(409, 'Duplicate cart lines. Refresh your cart.');

  const items = rows.map((r) => ({
    productId: s(r.product_id),
    name: s(r.name),
    qty: n(r.qty),
    unitPriceKobo: n(r.price_kobo),
    totalKobo: n(r.price_kobo) * n(r.qty),
  }));
  for (const it of items) {
    const row = rows.find((r) => s(r.product_id) === it.productId) as any;
    if (row.status !== 'Active') fail(409, `"${it.name}" is no longer available on the mall. Remove it to continue.`, { productId: it.productId });
    if (!Number.isSafeInteger(it.qty) || it.qty < 1 || it.qty > 1000) fail(409, `"${it.name}" has an invalid quantity.`, { productId: it.productId });
    if (!Number.isSafeInteger(it.unitPriceKobo) || it.unitPriceKobo <= 0) fail(409, `"${it.name}" has an invalid price.`, { productId: it.productId });
    if (n(row.stock_qty) < it.qty) fail(409, `Only the remaining stock of "${it.name}" can be ordered. Reduce the quantity to continue.`, { productId: it.productId });
  }

  const subtotalKobo = items.reduce((sum, it) => sum + it.totalKobo, 0);
  const totalKobo = subtotalKobo + deliveryFeeKobo;
  if (!Number.isSafeInteger(totalKobo) || totalKobo > 1_000_000_000) fail(400, 'Order total exceeds the supported maximum.');
  const orderNo = orderNumber();
  const createdAt = nowIso();

  const stmts: MallStmt[] = [
    { sql: 'INSERT INTO mall_checkout_attempts (attempt_key, session_id, request_json, order_id, created_at) VALUES (?, ?, ?, ?, ?)', params: [attemptKey, sessionId, requestJson, orderId, createdAt] },
    ...assertSql('(SELECT COUNT(*) FROM mall_cart_items WHERE cart_id = ?) = ?', [cartId, rows.length]),
    ...rows.flatMap((r) => assertSql(`EXISTS (SELECT 1 FROM mall_cart_items ci JOIN products p ON p.id = ci.product_id
      WHERE ci.id = ? AND ci.cart_id = ? AND ci.product_id = ? AND ci.qty = ?
      AND p.status = 'Active' AND p.stock_qty >= ?
      AND ${effectivePrice('p')} = ?)`,
    [r.cart_line_id, cartId, r.product_id, r.qty, r.qty, r.price_kobo])),
    {
    sql: `INSERT INTO mall_orders (id, order_no, customer_id, customer_name, customer_phone, customer_email, status,
            subtotal_kobo, delivery_fee_kobo, discount_kobo, total_kobo, payment_ref, delivery_address_json, linked_sale_id, created_at)
          VALUES (?, ?, NULL, ?, ?, ?, 'pending', ?, ?, 0, ?, NULL, ?, NULL, ?)`,
    params: [
      orderId, orderNo, customerName, customerPhone, customerEmail || null,
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
      // One products seek instead of two correlated subqueries: the row the
      // UPDATE above just decremented supplies BOTH prev_stock and new_stock
      // (prev = post-decrement stock + qty, new = post-decrement stock), so a
      // multi-line order reads half as many rows as before.
      sql: `INSERT INTO stock_movements (id, product_id, product_name, type, qty, prev_stock, new_stock, ref_id, notes, performed_by, created_at)
            SELECT ?, p.id, ?, 'Mall Order', ?, p.stock_qty + ?, p.stock_qty, ?, ?, ?, ?
            FROM products p WHERE p.id = ?`,
      params: [
        `mv-${uuid()}`, it.name, -it.qty, it.qty,
        `checkout:${orderId}`, `Mall order ${orderNo}`, 'Mall Storefront', createdAt, it.productId,
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

  try { await exec.runBatch(stmts); }
  catch (error) {
    const committed = await exec.queryAll('SELECT attempt_key FROM mall_checkout_attempts WHERE attempt_key = ?', [attemptKey]);
    if (committed.length) return await checkout(exec, sessionId, body, attemptKey);
    if (/mall_state_conflict|INSUFFICIENT_STOCK/.test(String(error))) fail(409, 'Cart, price, or availability changed. Refresh your cart and retry.');
    throw error;
  }
  // Stock and purchase counts changed: the cached home rails must not show a
  // pre-checkout world past this write.
  invalidateMallFacetCache();
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
    customerEmail: customerEmail || undefined,
    subtotalKobo,
    deliveryFeeKobo,
    totalKobo,
    deliveryZone,
    deliveryLabel: mallDeliveryLabel(deliveryZone),
    quoteRequired,
    paymentStatus: 'pending',
    paymentMethod,
    paymentReference: `MALL-${orderNo}`,
    instructions: publicMallConfig(exec.config),
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
  const phone = normalizeMallPhone(url.searchParams.get('phone'));
  const orderNo = s(url.searchParams.get('orderNo')).trim();
  if (!phone || !orderNo || orderNo.length>80) fail(400, 'Enter both the order number and checkout phone number.', {fields:{orderNo:'Order number is required.',phone:'Valid checkout phone is required.'}});
  const rows = await exec.queryAll(
    `SELECT o.order_no AS order_no, o.status AS status, o.total_kobo AS total_kobo,
            (SELECT status FROM payments WHERE order_id=o.id LIMIT 1) AS payment_status,
            (SELECT MAX(created_at) FROM mall_order_events WHERE order_id=o.id) AS updated_at,
            o.created_at AS created_at, COUNT(oi.id) AS item_count
     FROM mall_orders o LEFT JOIN mall_order_items oi ON oi.mall_order_id = o.id
      WHERE ${normalizedPhoneSql('o.customer_phone')} = ? AND o.order_no = ?
      GROUP BY o.id LIMIT 1`,
    [phone, orderNo],
  );
  return json({
    orders: rows.map((r: any) => ({
      orderNo: s(r.order_no),
      status: s(r.status, 'pending'),
      totalKobo: n(r.total_kobo),
      createdAt: s(r.created_at),
      itemCount: n(r.item_count),
      paymentStatus: s(r.payment_status),
      updatedAt: s(r.updated_at),
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
    if (body.length>16_384) fail(413,'Request body is too large.');
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(400, 'Expected a JSON object.');
    return parsed;
  } catch (error) {
    if ((error as MallError)?.mallStatus) throw error;
    fail(400, 'Invalid JSON request body.');
  }
}

async function routeMallApi(request: Request, exec: MallExecutor): Promise<Response> {
  try {
  const methodName = request.method;
  const rawPath = new URL(request.url, 'http://localhost').pathname;
  if (rawPath !== '/api/mall' && !rawPath.startsWith('/api/mall/')) return json({ error: 'Not found' }, 404);
  const pathname = rawPath.replace(/^\/api\/mall/, '');
  if (pathname === '/ready') {
    const readiness = await mallReadiness(exec);
    return json(readiness,readiness.ready?200:503);
  }
  if (pathname === '/config') return json(publicMallConfig(exec.config));
  if (!pathname.startsWith('/health')) await mallRateLimit(exec,request);

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
    return await getOrdersByPhone(exec, new URL(request.url, 'http://localhost'));
  }

  if (pathname === '/home') {
    if (methodName !== 'GET') return json({ error: 'Only GET is supported.' }, 405);
    return await getHomeSections(exec, sessionFrom(request));
  }

  if (pathname.startsWith('/products/')) {
    if (methodName !== 'GET') return json({ error: 'Only GET is supported.' }, 405);
    return await getProduct(exec, decodeURIComponent(pathname.slice('/products/'.length)));
  }

  if (pathname.startsWith('/products')) {
    if (methodName !== 'GET') return json({ error: 'Only GET is supported.' }, 405);
    return await getCatalog(exec, new URL(request.url, 'http://localhost'));
  }

  if (pathname.startsWith('/cart/total')) {
    if (methodName !== 'GET') return json({ error: 'Only GET is supported.' }, 405);
    const session = sessionFrom(request);
    if (!session) return json({ error: 'Session is required. Send x-mall-session header or cookie.' }, 400);
    return await respondWithCart(exec, session);
  }

  if (pathname.startsWith('/cart/qty')) {
    if (methodName !== 'POST') return json({ error: 'Only POST is supported.' }, 405);
    const session = sessionFrom(request);
    if (!session) return json({ error: 'Session is required. Send x-mall-session header or cookie.' }, 400);
    return await setCartQty(exec, session, await parseMallBody(request));
  }

  if (pathname.startsWith('/cart')) {
    const session = sessionFrom(request);
    if (methodName === 'GET') {
      if (!session) return json({ error: 'Session is required. Send x-mall-session header or cookie.' }, 400);
      return await respondWithCart(exec, session);
    }
    if (methodName === 'POST') {
      if (!session) return json({ error: 'Session is required. Send x-mall-session header or cookie.' }, 400);
      return await addToCart(exec, session, await parseMallBody(request));
    }
    return json({ error: 'Only GET or POST is supported.' }, 405);
  }

  if (pathname.startsWith('/checkout')) {
    if (methodName !== 'POST') return json({ error: 'Only POST is supported.' }, 405);
    const session = sessionFrom(request);
    if (!session) return json({ error: 'Session is required. Send x-mall-session header or cookie.' }, 400);
    return await checkout(exec, session, await parseMallBody(request), s(request.headers.get('idempotency-key')));
  }

  return json({ error: 'Unknown /api/mall route.' }, 404);
  } catch (error) {
    const known = error as MallError;
    if (/mall_state_conflict|MALL_INVALID_CART_LINE/.test(String(error))) return json({error:'Cart changed or quantity exceeds stock. Refresh and retry.'},409);
    return json({ error: known.mallStatus ? known.message : 'Mall API error', payload: known.mallPayload,
      ...(known.mallPayload && typeof known.mallPayload === 'object' && 'fields' in known.mallPayload ? { fields: known.mallPayload.fields } : {}) }, known.mallStatus || 500);
  }
}

export async function handleMallApi(request:Request,exec:MallExecutor):Promise<Response> {
  const response=await routeMallApi(request,exec);
  const path=new URL(request.url).pathname;
  if(path.includes('/checkout') || response.status>=500) {
    const metric=path.includes('/checkout') ? `checkout.${response.status===201?'created':response.status===200?'replayed':response.status===409?'conflict':response.status===429?'limited':'failed'}` : 'api.error';
    try { await exec.runBatch([{sql:'INSERT INTO mall_metrics(day,metric,count) VALUES (?,?,1) ON CONFLICT(day,metric) DO UPDATE SET count=count+1',params:[new Date().toISOString().slice(0,10),metric]}]); }
    catch { console.error('[mall-metrics] unavailable'); }
  }
  response.headers.set('cache-control','no-store');
  if(response.status===429) response.headers.set('retry-after','60');
  return response;
}