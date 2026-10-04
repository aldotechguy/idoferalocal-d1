import type {
  MallProduct,
  MallCartItem,
  MallCart,
  MallOrderItem,
  MallOrder,
  MallCheckoutBody,
  MallHealth,
  MallProductsResponse,
  MallBuyerProfile,
  MallCustomerHint,
  MallOrderLookup,
} from '../types/mall';

export type {
  MallProduct,
  MallCartItem,
  MallCart,
  MallOrderItem,
  MallOrder,
  MallCheckoutBody,
  MallHealth,
  MallProductsResponse,
  MallBuyerProfile,
  MallCustomerHint,
  MallOrderLookup,
};
const SESSION_KEY = 'idofera_mall_session';
const BASE = '/api/mall';
const ATTEMPT_KEY = 'idofera_mall_checkout_attempt';
let pendingAttempt: { key: string; body: string } | null = null;

function checkoutAttempt(body: MallCheckoutBody) {
  const serialized = JSON.stringify(body);
  if (!pendingAttempt) {
    try { pendingAttempt = JSON.parse(localStorage.getItem(ATTEMPT_KEY) || 'null'); } catch { /* storage unavailable */ }
  }
  if (!pendingAttempt || pendingAttempt.body !== serialized) {
    pendingAttempt = { key: crypto.randomUUID(), body: serialized };
    try { localStorage.setItem(ATTEMPT_KEY, JSON.stringify(pendingAttempt)); } catch { /* memory fallback */ }
  }
  return pendingAttempt;
}

function clearCheckoutAttempt() {
  pendingAttempt = null;
  try { localStorage.removeItem(ATTEMPT_KEY); } catch { /* storage unavailable */ }
}

function getSession(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return localStorage.getItem(SESSION_KEY) || undefined;
  } catch {
    return undefined;
  }
}

function setSession(session: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SESSION_KEY, session);
  } catch {}
}

function clearSession(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {}
}

function newSession(): string {
  return 'mall-' + crypto.randomUUID();
}

/** Performs the request and returns the raw Response, so headers stay readable. */
async function fetchMallResponse(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const session = getSession();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (session) {
    headers['x-mall-session'] = session;
  }
  return fetch(`${BASE}${path}`, { ...options, headers });
}

/** Parses a Mall response body, turning a non-2xx into a thrown Error. */
async function parseBody(res: Response): Promise<any> {
  let body: any = null;
  const text = await res.text();
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const message = (body && typeof body === 'object' && typeof body.error === 'string')
      ? body.error
      : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body;
}

async function fetchMall(
  path: string,
  options: RequestInit = {},
): Promise<any> {
  return parseBody(await fetchMallResponse(path, options));
}

const BUYER_KEY = 'idofera_mall_buyer';
/** Local mirror of the last server-confirmed cart, for offline browsing. */
const CART_KEY = 'idofera_mall_cart_mirror';

/**
 * Offline support for the Mall storefront.
 *
 * The staff POS has a full IndexedDB write path; the storefront deliberately does
 * NOT. D1 is the sole authority on price and stock, and the oversell trigger plus
 * the checkout idempotency key make a server-side retry safe. So nothing here
 * ever writes an order or a cart line to the server without a live connection --
 * this module only ever serves the last-known-good read payloads so a shopper on
 * a bad link sees their basket instead of an error page.
 *
 * Reads are served stale-while-revalidate: the cached copy renders immediately
 * and a background refresh replaces it when the network answers.
 */

const DATA_CACHE = 'idofera-mall-data-v1';
const MALL_DATA_CACHE_MAX = 60;
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days max offline lifetime

/** A cached read, with the wall-clock time it was captured. */
export type CachedRead<T> = { at: number; data: T };

/** Must match the storefront route shape. Query strings are part of the key. */
const cacheKeyFor = (url: string) => `GET ${url}`;

function hasCaches(): boolean {
  return typeof caches !== 'undefined';
}

/** Evicts oldest entries so storefront search/pagination doesn't grow unbounded. */
async function trimMallDataCache(cache: Cache): Promise<void> {
  try {
    const keys = await cache.keys();
    if (keys.length <= MALL_DATA_CACHE_MAX) return;
    await Promise.all(keys.slice(0, keys.length - MALL_DATA_CACHE_MAX).map((key) => cache.delete(key)));
  } catch {}
}

/** Best-effort: a storage failure must never break a live request. */
export async function cacheRead<T>(url: string, data: T): Promise<void> {
  if (!hasCaches()) return;
  try {
    const body = JSON.stringify({ data });
    const cache = await caches.open(DATA_CACHE);
    await cache.put(
      cacheKeyFor(url),
      new Response(body, {
        headers: {
          'content-type': 'application/json',
          // Age is carried in a header so the stored body stays byte-identical
          // to what the server sent, and a corrupt read can never poison state.
          'x-cached-at': String(Date.now()),
        },
      }),
    );
    await trimMallDataCache(cache);
  } catch { /* quota or private mode: the live path still works */ }
}

/** Returns the last-known-good payload for `url`, or null if there is none or it expired. */
export async function readCached<T>(url: string): Promise<CachedRead<T> | null> {
  if (!hasCaches()) return null;
  try {
    const response = await caches.match(cacheKeyFor(url));
    if (!response) return null;
    const cachedAt = Number(response.headers.get('x-cached-at') || 0);
    if (cachedAt && Date.now() - cachedAt > MAX_CACHE_AGE_MS) {
      void evictCached(url);
      return null;
    }
    const envelope = await response.json().catch(() => null);
    if (!envelope || typeof envelope !== 'object' || !('data' in envelope)) return null;
    return { at: cachedAt, data: envelope.data as T };
  } catch {
    return null;
  }
}

/** Drops one cached read (used when session-scoped data must not be reused). */
export async function evictCached(url: string): Promise<void> {
  if (!hasCaches()) return;
  try {
    const cache = await caches.open(DATA_CACHE);
    await cache.delete(cacheKeyFor(url));
  } catch { /* best effort */ }
}

/** Test seam: drops every cached storefront payload. */
export async function clearMallReadCache(): Promise<void> {
  if (!hasCaches()) return;
  try { await caches.delete(DATA_CACHE); } catch { /* best effort */ }
}

/**
 * Mirrors the last server-confirmed cart so a shopper who loses signal mid-browse
 * still sees their basket. This is a READ mirror only: it is never replayed to the
 * server. The cart line, its price and its stock are re-validated by D1 on the next
 * live add-to-cart and again inside the atomic checkout batch, so a stale mirror
 * can never oversell or charge a wrong price.
 */
export function mirrorCartLocally(cart: unknown): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(CART_KEY, JSON.stringify({ at: Date.now(), cart })); } catch { /* private mode */ }
}

export function readLocalCartMirror(): { at: number; cart: MallCart } | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(CART_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object' || !parsed.cart || !Array.isArray(parsed.cart.items)) return null;
    const at = Number(parsed.at) || 0;
    if (at && Date.now() - at > MAX_CACHE_AGE_MS) {
      clearLocalCartMirror();
      return null;
    }
    return { at, cart: parsed.cart as MallCart };
  } catch {
    return null;
  }
}

export function clearLocalCartMirror(): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(CART_KEY); } catch { /* best effort */ }
}

/**
 * A read that prefers the network but always resolves if the cache has a copy.
 * Returns `{ data, stale }`; `stale` is true when the payload came from Cache
 * Storage because the network failed. On success the fresh payload replaces the
 * cached one, so the next offline visit is as recent as possible.
 */
/**
 * A session-scoped read: the worker deliberately does NOT cache these, so the
 * app keeps its own last-known-good copy. Only `/home` qualifies -- it carries
 * this session's Buy Again history, and `resetSession()` evicts it explicitly so
 * a new session can never inherit the previous one's data.
 */
async function readThrough<T>(path: string, options?: RequestInit): Promise<{ data: T; stale: boolean }> {
  try {
    const data = await fetchMall(path, options) as T;
    void cacheRead(path, data);
    return { data, stale: false };
  } catch (error) {
    // An aborted request is a deliberate cancellation (the header search drops
    // superseded keystrokes), not a connectivity failure, so it must never be
    // answered from the cache -- that would resurrect an old result set.
    if ((error as { name?: string })?.name === 'AbortError') throw error;
    const cached = await readCached<T>(path);
    if (cached) return { data: cached.data, stale: true };
    throw error;
  }
}

/**
 * The public catalog is cached by the service worker, not here. It answers with
 * an X-From-Cache marker, so "is this live or saved?" is a fact read off the
 * response rather than a guess made by re-implementing a cache. Requests made
 * before a worker takes control have no marker, which is treated as live.
 */
async function readCatalog<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetchMallResponse(path, options);
  const marker = response.headers.get('X-From-Cache');
  if (onStale) onStale(marker === 'hit');
  return (await parseBody(response)) as T;
}

export function getBuyerProfile(): MallBuyerProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(BUYER_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object') return null;
    return {
      name: String(v.name || ''),
      phone: String(v.phone || ''),
      email: String(v.email || ''),
      address: String(v.address || ''),
      savedAt: String(v.savedAt || new Date().toISOString()),
    };
  } catch {
    return null;
  }
}

export function saveBuyerProfile(p: Omit<MallBuyerProfile, 'savedAt'>): MallBuyerProfile {
  const full: MallBuyerProfile = { ...p, savedAt: new Date().toISOString() };
  try {
    localStorage.setItem(BUYER_KEY, JSON.stringify(full));
  } catch {}
  return full;
}

export function clearBuyerProfile(): void {
  try {
    localStorage.removeItem(BUYER_KEY);
  } catch {}
}

/**
 * Reports whether a catalog read was served from the offline cache. Set by the
 * Mall provider so the connectivity banner can distinguish "offline" from
 * "showing saved products". Module-level because the client is a plain object,
 * not a React component, and this is a presentation-only signal.
 */
let onStale: ((stale: boolean) => void) | null = null;
export function setMallStaleListener(listener: ((stale: boolean) => void) | null): void {
  onStale = listener;
}

export const mallClient = {
  /** Home rails. Cached so a shopper offline still sees the storefront layout. */
  home: async () => (await readThrough<{
    flashSales: MallProduct[]; topSellers: MallProduct[]; newArrivals: MallProduct[]; buyAgain: MallProduct[];
  }>('/home')).data,

  configuration: () => fetchMall('/config'),
  // Keeps the { product } envelope: MallProductPage reads `result.product`.
  product: (id: string) => readCatalog<{ product: MallProduct }>(`/products/${encodeURIComponent(id)}`),

  products: async (params?: { q?: string; category?: string; brand?: string; inStock?: 0 | 1; stockFirst?: 0 | 1; sort?: string; limit?: number; offset?: number }, options?: { signal?: AbortSignal }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.category) qs.set('category', params.category);
    if (params?.brand) qs.set('brand', params.brand);
    if (params?.inStock != null) qs.set('inStock', String(params.inStock));
    if (params?.stockFirst != null) qs.set('stockFirst', String(params.stockFirst));
    if (params?.sort) qs.set('sort', params.sort);
    if (params?.limit != null) qs.set('limit', String(params.limit));
    if (params?.offset != null) qs.set('offset', String(params.offset));
    const query = qs.toString();
    // The query string is part of the cache key, so each page/sort/filter
    // combination gets its own last-known-good copy in the worker.
    const path = `/products${query ? '?' + query : ''}`;
    return readCatalog<MallProductsResponse>(path, options);
  },

  /**
   * The cart is session-scoped and money-bearing, so it is never served from a
   * shared cache. The Cache Storage copy is keyed by the caller's own session
   * header implicitly (one browser, one session) and is only a read mirror for
   * offline display -- add/qty/checkout stay strictly network-only.
   */
  cart: async () => {
    try {
      const cart = await fetchMall('/cart') as MallCart;
      mirrorCartLocally(cart);
      return cart;
    } catch (error) {
      const mirror = readLocalCartMirror();
      if (mirror) return mirror.cart;
      throw error;
    }
  },

  addToCart: (productId: string, qty: number) =>
    fetchMall('/cart', {
      method: 'POST',
      body: JSON.stringify({ productId, qty }),
    }) as Promise<MallCart>,

  setCartQty: (productId: string, qty: number) =>
    fetchMall('/cart/qty', {
      method: 'POST',
      body: JSON.stringify({ productId, qty }),
    }) as Promise<MallCart>,

  checkout: async (body: MallCheckoutBody): Promise<MallOrder> => {
    const attempt = checkoutAttempt(body);
    const order = await fetchMall('/checkout', {
      method: 'POST',
      headers: { 'Idempotency-Key': attempt.key },
      body: JSON.stringify(body),
    });
    clearCheckoutAttempt();
    return order;
  },

  ordersByPhone: (phone: string, orderNo: string) => {
    const qs = new URLSearchParams({ phone, orderNo });
    return fetchMall(`/orders?${qs.toString()}`) as Promise<{
      orders: MallOrderLookup[];
      total: number;
    }>;
  },

  /**
   * Storefront recognition for checkout. Strictly network-only: it is keyed by a
   * phone number and answers with a name hint, so it is never cached or mirrored
   * (unlike the catalog reads) and it never touches Cache Storage. Callers treat
   * a thrown error as "not recognised" and let checkout proceed as a guest.
   */
  customerLookup: (phone: string) => {
    const qs = new URLSearchParams({ phone });
    return fetchMall(`/customer/lookup?${qs.toString()}`) as Promise<MallCustomerHint>;
  },

  ensureSession: () => {
    if (!getSession()) {
      setSession(newSession());
    }
    return getSession();
  },

  /**
   * Starting a new session must not inherit the old one's data. The `/home`
   * payload carries session-scoped "Buy Again" history and the cart mirror is
   * per-session, so both are dropped here; the shared catalog cache is kept
   * because product rows are not session-specific.
   */
  resetSession: () => {
    clearCheckoutAttempt();
    clearSession();
    clearLocalCartMirror();
    void evictCached('/home');
    const session = newSession();
    setSession(session);
    return session;
  },
};
