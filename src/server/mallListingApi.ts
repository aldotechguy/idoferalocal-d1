/**
 * #10 — Staff Mall merchandising. Active status controls visibility, not approval.
 *
 * Mall price, Mall description, featured/display ordering and
 * an optional promotional window, all validated on the SERVER (never trusting the
 * editor) and previewed exactly as the storefront would render them.
 *
 * Price rules are enforced against `min_selling_price_kobo`, so a listing can never
 * be saved below the product floor price. The promo window uses one normalized
 * ISO-8601 representation, which the catalog's parameter-free "now" compares against
 * lexically.
 */
import type { MallExecutor, MallStmt } from './mallApi.js';
import { effectivePrice, promoActive, invalidateMallFacetCache, honorPosPromos } from './mallApi.js';
import { n, s } from './relationalMapper.js';
import { assertSql } from './mallSafety.js';
import { MAX_MALL_SEARCH_CHARS } from '../shared/mallSearch.js';
import type { StaffActor } from './mallOrderAdminApi.js';

type DomainError = Error & { status?: number; payload?: unknown };
const fail = (status: number, message: string, payload?: unknown): never => {
  const error = new Error(message) as DomainError;
  error.status = status;
  if (payload !== undefined) error.payload = payload;
  throw error;
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8' },
});

const READ_ROLES = ['Administrator', 'Store Manager', 'Sales Staff', 'Accountant'];
const WRITE_ROLES = ['Administrator', 'Store Manager'];
const MAX_DESCRIPTION = 2000;
const MAX_IMAGES = 6;
const MAX_ORDER = 100_000;

const listingColumns = (honorPos: boolean) => `id, sku, name, description, mall_description, category_name, brand, unit, images_json,
  stock_qty, retail_price_kobo, mall_price_kobo, is_mall_listed, status, min_selling_price_kobo,
  mall_featured, mall_display_order, mall_promo_price_kobo, mall_promo_start, mall_promo_end,
  CASE WHEN ${promoActive('products')} THEN 1 ELSE 0 END AS promo_active,
  ${effectivePrice('products', honorPos)} AS public_price_kobo,
  CASE WHEN ${effectivePrice('products', true)} != ${effectivePrice('products', false)}
    THEN ${effectivePrice('products', true)} END AS pos_promo_price_kobo`;

function parseImages(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string');
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch { return []; }
}

function cleanImages(raw: unknown): string[] {
  return parseImages(raw)
    .filter((image) => image.trim().length > 0)
    .map((image) => image.trim())
    .slice(0, MAX_IMAGES);
}

/** Normalizes accepted date input to the millisecond ISO-8601 UTC used by the promo columns. */
function normalizeInstant(value: unknown): string | null {
  if (value == null || value === '' || typeof value !== 'string') return null;
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

interface ListingInput {
  publish?: unknown; mallPriceKobo?: unknown; mallDescription?: unknown;
  featured?: unknown; displayOrder?: unknown;
  promoPriceKobo?: unknown; promoStart?: unknown; promoEnd?: unknown;
}

function listingView(row: any) {
  const images = cleanImages(row.images_json);
  return {
    id: s(row.id), sku: s(row.sku), name: s(row.name), category: s(row.category_name), brand: s(row.brand),
    unit: s(row.unit, 'pcs'), productStatus: s(row.status), stock: n(row.stock_qty),
    internalDescription: s(row.description), mallDescription: s(row.mall_description),
    images, imageCount: images.length,
    retailPriceKobo: n(row.retail_price_kobo),
    mallPriceKobo: row.mall_price_kobo == null ? null : n(row.mall_price_kobo),
    minimumSellingPriceKobo: n(row.min_selling_price_kobo),
    publicPriceKobo: n(row.public_price_kobo), promoActive: n(row.promo_active) === 1,
    /** Price the product-level POS promotional price WOULD produce when
     * MALL_HONOR_POS_PROMOS is enabled; null when it would change nothing.
     * Lets staff review the switch's impact while it is still OFF. */
    posPromoPriceKobo: row.pos_promo_price_kobo == null ? null : n(row.pos_promo_price_kobo),
    visibleOnMall: row.status === 'Active', featured: n(row.mall_featured) === 1,
    displayOrder: row.mall_display_order == null ? null : n(row.mall_display_order),
    promoPriceKobo: row.mall_promo_price_kobo == null ? null : n(row.mall_promo_price_kobo),
    promoStart: s(row.mall_promo_start) || null, promoEnd: s(row.mall_promo_end) || null,
    /** Price the storefront falls back to when no Mall price is set. */
    basePriceKobo: (row.mall_price_kobo == null ? n(row.retail_price_kobo) : n(row.mall_price_kobo)),
  };
}

/** Exactly how the public catalog would render this listing right now (visibility preview). */
function publicPreview(row: any) {
  const listing = listingView(row);
  return {
    id: listing.id, name: listing.name,
    description: listing.mallDescription || listing.internalDescription,
    category: listing.category, brand: listing.brand, unit: listing.unit,
    price: listing.publicPriceKobo, retailPriceKobo: listing.retailPriceKobo,
    image: listing.images[0] || '', images: listing.images, available: listing.productStatus === 'Active' && listing.stock > 0 && Number.isSafeInteger(listing.publicPriceKobo) && listing.publicPriceKobo > 0,
    featured: listing.featured, promoActive: listing.promoActive,
    visibleOnMall: listing.productStatus === 'Active',
  };
}

/** Validation runs on the PROPOSED listing state so errors match exactly what staff typed. */
function validateListing(row: any, input: ListingInput) {
  const fields: Record<string, string> = {};
  const issues: string[] = [];
  const images = cleanImages(row.images_json);
  const retail = n(row.retail_price_kobo);
  const floor = n(row.min_selling_price_kobo);
  const stock = n(row.stock_qty);
  const status = s(row.status);

  // --- Mall price -----------------------------------------------------------
  let mallPrice: number | null = null;
  if (input.mallPriceKobo != null && input.mallPriceKobo !== '') {
    const candidate = Number(input.mallPriceKobo);
    if (!Number.isSafeInteger(candidate) || candidate <= 0) {
      fields.mallPriceKobo = 'Enter a whole price in kobo greater than zero.';
    } else if (floor > 0 && candidate < floor) {
      fields.mallPriceKobo = `Price is below this product's floor of ${floor} kobo.`;
    } else mallPrice = candidate;
  }

  // --- Promotional price and window ----------------------------------------
  let promoPrice: number | null = null;
  if (input.promoPriceKobo != null && input.promoPriceKobo !== '') {
    const candidate = Number(input.promoPriceKobo);
    if (!Number.isSafeInteger(candidate) || candidate <= 0) {
      fields.promoPriceKobo = 'Enter a whole promotional price in kobo greater than zero.';
    } else promoPrice = candidate;
  }
  const promoStart = normalizeInstant(input.promoStart);
  const promoEnd = normalizeInstant(input.promoEnd);
  if (input.promoStart && !promoStart) fields.promoStart = 'Enter a valid start date and time.';
  if (input.promoEnd && !promoEnd) fields.promoEnd = 'Enter a valid end date and time.';
  if (promoStart && promoEnd && promoStart >= promoEnd) fields.promoEnd = 'The promotion must end after it starts.';

  const basePrice = mallPrice ?? retail;
  if (promoPrice != null && !fields.promoPriceKobo) {
    if (basePrice <= 0) fields.promoPriceKobo = 'Set a Mall or retail price before adding a promotion.';
    else if (promoPrice >= basePrice) fields.promoPriceKobo = 'The promotional price must be lower than the normal Mall price.';
    else if (floor > 0 && promoPrice < floor) fields.promoPriceKobo = `Promotional price is below this product's floor of ${floor} kobo.`;
    if (fields.promoPriceKobo) promoPrice = null;
  }

  // --- Description ----------------------------------------------------------
  const description = s(input.mallDescription).trim();
  if (description.length > MAX_DESCRIPTION) fields.mallDescription = `Keep the Mall description under ${MAX_DESCRIPTION} characters.`;
  else if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(description)) fields.mallDescription = 'Remove control characters from the Mall description.';

  // --- Merchandising --------------------------------------------------------
  let displayOrder: number | null = null;
  if (input.displayOrder != null && input.displayOrder !== '') {
    const candidate = Number(input.displayOrder);
    if (!Number.isSafeInteger(candidate) || Math.abs(candidate) > MAX_ORDER) {
      fields.displayOrder = `Display order must be a whole number between -${MAX_ORDER} and ${MAX_ORDER}.`;
    } else displayOrder = candidate;
  }

  // Availability and content-quality notes; these do not gate merchandising saves.
  if (status !== 'Active') issues.push('The product status must be Active.');
  if (stock <= 0) issues.push('The product needs stock available.');
  if (!images.length) issues.push('Add at least one product image.');
  if (images.some((image) => image.startsWith('data:'))) issues.push('Replace embedded images with uploaded image URLs.');

  const nowMs = Date.now();
  const promoIsActive = promoPrice != null
    && (!promoStart || Date.parse(promoStart) <= nowMs)
    && (!promoEnd || Date.parse(promoEnd) >= nowMs);
  const publicPriceKobo = promoIsActive ? (promoPrice as number) : basePrice;
  if (!(publicPriceKobo > 0)) issues.push('Set a Mall price or retail price above zero.');
  if (floor > 0 && publicPriceKobo > 0 && publicPriceKobo < floor) issues.push("The storefront price is below this product's floor price.");

  return {
    fields, issues, publicPriceKobo,
    mallPriceKobo: mallPrice, promoPriceKobo: promoPrice, promoStart, promoEnd,
    description: description || null, featured: input.featured === true, displayOrder,
  };
}

async function readRow(exec: MallExecutor, productId: string, honorPos = false) {
  const rows = await exec.queryAll(`SELECT ${listingColumns(honorPos)} FROM products WHERE id = ? LIMIT 1`, [productId]);
  if (!rows.length) fail(404, 'Product not found.');
  return rows[0];
}

/** Validates the listing exactly as it currently stands in the database.
 * Never throws: a product may legitimately have availability or content issues
 * (e.g. stock drained to zero); the list view must still render it with issues. */
function validateCurrent(row: any) {
  return validateListing(row, {
    mallPriceKobo: row.mall_price_kobo ?? '', mallDescription: row.mall_description,
    featured: n(row.mall_featured) === 1, displayOrder: row.mall_display_order ?? '',
    promoPriceKobo: row.mall_promo_price_kobo ?? '', promoStart: row.mall_promo_start, promoEnd: row.mall_promo_end,
  });
}

async function listListings(exec: MallExecutor, url: URL) {
  const honorPos = honorPosPromos(exec);
  const q = s(url.searchParams.get('q')).trim().slice(0, MAX_MALL_SEARCH_CHARS);
  const view = s(url.searchParams.get('view'), 'all');
  const limit = Math.min(Math.max(n(url.searchParams.get('limit'), 50), 1), 200);
  const offset = Math.max(n(url.searchParams.get('offset'), 0), 0);
  if (!['all', 'active', 'hidden'].includes(view)) fail(400, 'view must be all, active or hidden.');

  const filters: string[] = [];
  const params: unknown[] = [];
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    filters.push(`(name LIKE ? ESCAPE '\\' OR sku LIKE ? ESCAPE '\\' OR brand LIKE ? ESCAPE '\\')`);
    params.push(like, like, like);
  }
  if (view === 'active') filters.push("status = 'Active'");
  if (view === 'hidden') filters.push("status <> 'Active'");
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  // Single windowed query: page rows + page_total in one round-trip.
  // COUNT(*) OVER() gives the full filtered count without a separate
  // COUNT query, exactly like getCatalog() already does.
  const rows = await exec.queryAll(
    `SELECT ${listingColumns(honorPos)}, COUNT(*) OVER() AS page_total FROM products ${where}
     ORDER BY mall_featured DESC, name ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const mapped = rows.map((row) => {
    const validation = validateCurrent(row);
    return { ...listingView(row), issues: validation.issues };
  });
  const listings = mapped;
  const total = rows.length ? n(rows[0].page_total) : 0;
  const counts = (await exec.queryAll(`SELECT
    SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) AS active,
    SUM(CASE WHEN status <> 'Active' THEN 1 ELSE 0 END) AS hidden FROM products`))[0];
  return json({
    listings, total, limit, offset, view,
    counts: { active: n(counts?.active), hidden: n(counts?.hidden) },
    posPromosEnabled: honorPos,
  });
}

async function getListing(exec: MallExecutor, productId: string) {
  const honorPos = honorPosPromos(exec);
  const row = await readRow(exec, productId, honorPos);
  const validation = validateCurrent(row);
  return json({
    listing: { ...listingView(row), issues: validation.issues },
    preview: publicPreview(row),
    posPromosEnabled: honorPos,
  });
}

async function saveListing(exec: MallExecutor, productId: string, actor: StaffActor, input: ListingInput) {
  if ('publish' in input) fail(400, 'Publishing approval is no longer supported. Product Active status controls Mall visibility.');
  const row = await readRow(exec, productId);
  const decision = validateListing(row, input);
  if (Object.keys(decision.fields).length) fail(400, 'Validation failed', { fields: decision.fields });
  const at = new Date().toISOString();

  const statements: MallStmt[] = [
    // Optimistic concurrency: if another staff member changed this listing while the
    // editor was open, abort instead of silently overwriting their work.
    ...assertSql(`EXISTS (SELECT 1 FROM products WHERE id = ? AND is_mall_listed = ? AND mall_price_kobo IS ?
        AND mall_description IS ? AND mall_featured = ? AND mall_display_order IS ?
        AND mall_promo_price_kobo IS ? AND mall_promo_start IS ? AND mall_promo_end IS ?)`,
    [productId, n(row.is_mall_listed), row.mall_price_kobo, row.mall_description, n(row.mall_featured),
      row.mall_display_order, row.mall_promo_price_kobo, row.mall_promo_start, row.mall_promo_end]),
    {
      sql: `UPDATE products SET mall_price_kobo = ?, mall_description = ?, mall_featured = ?,
              mall_display_order = ?, mall_promo_price_kobo = ?, mall_promo_start = ?, mall_promo_end = ?, updated_at = ?
            WHERE id = ?`,
      params: [decision.mallPriceKobo, decision.description, decision.featured ? 1 : 0,
        decision.displayOrder, decision.promoPriceKobo, decision.promoStart, decision.promoEnd, at, productId],
    },
    {
      sql: `INSERT INTO audit_logs (id, actor_id, action, entity, entity_id, details, created_at) VALUES (?, ?, ?, 'Product', ?, ?, ?)`,
      params: [crypto.randomUUID(), actor.id,
        'UPDATE_MALL_LISTING',
        productId,
        `${actor.displayName} updated Mall merchandising for "${s(row.name)}"` +
        ` (storefront price ${decision.publicPriceKobo} kobo${decision.featured ? ', featured' : ''}).`,
        at],
    },
  ];

  try { await exec.runBatch(statements); }
  catch (error) {
    if (/mall_state_conflict|MALL_INVALID/.test(String(error))) fail(409, 'This listing changed while you were editing. Reload and apply your changes again.');
    throw error;
  }
  // A saved promo/price reshapes the storefront's flash-sales rail; drop the
  // cached rails so the next homepage view recomputes them.
  invalidateMallFacetCache();
  const updated = await readRow(exec, productId, honorPosPromos(exec));
  return json({
    listing: { ...listingView(updated), issues: decision.issues },
    preview: publicPreview(updated),
    posPromosEnabled: honorPosPromos(exec),
  });
}

async function parseBody(request: Request) {
  const text = await request.text();
  if (text.length > 65_536) fail(413, 'Request body is too large.');
  let parsed: unknown;
  try { parsed = text ? JSON.parse(text) : {}; }
  catch { fail(400, 'Invalid JSON request body.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(400, 'Expected a JSON object.');
  return parsed as ListingInput;
}

export async function handleStaffMallListingApi(request: Request, exec: MallExecutor, actor: StaffActor): Promise<Response> {
  try {
    if (!actor?.id) return json({ error: 'Authentication required.' }, 401);
    if (!READ_ROLES.includes(actor.role)) fail(403, 'Staff Mall access is not permitted for this role.');

    const url = new URL(request.url, 'http://localhost');
    const prefix = '/api/staff/mall-listings';
    const tail = url.pathname.slice(prefix.length).replace(/^\//, '');
    const parts = tail ? tail.split('/') : [];

    if (request.method === 'GET' && parts.length === 0) return await listListings(exec, url);
    if (request.method === 'GET' && parts.length === 1) return await getListing(exec, decodeURIComponent(parts[0]));
    if (request.method === 'PUT' && parts.length === 1) {
      if (!WRITE_ROLES.includes(actor.role)) fail(403, 'Only an Administrator or Store Manager can edit Mall merchandising.');
      return await saveListing(exec, decodeURIComponent(parts[0]), actor, await parseBody(request));
    }
    return json({ error: 'Unknown staff Mall listing route.' }, 404);
  } catch (error) {
    const known = error as DomainError;
    return json({
      error: known.status ? known.message : 'Mall listing operation failed.',
      ...(known.payload && typeof known.payload === 'object' ? known.payload : {}),
    }, known.status || 500);
  }
}

