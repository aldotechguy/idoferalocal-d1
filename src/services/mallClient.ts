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

async function fetchMall(
  path: string,
  options: RequestInit = {},
): Promise<any> {
  const session = getSession();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (session) {
    headers['x-mall-session'] = session;
  }

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
  });

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

const BUYER_KEY = 'idofera_mall_buyer';

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

export const mallClient = {
  home: () => fetchMall('/home') as Promise<{
    flashSales: MallProduct[]; topSellers: MallProduct[]; newArrivals: MallProduct[]; buyAgain: MallProduct[];
  }>,
  health: () => fetchMall('/health') as Promise<{ ok: boolean; routes: string[] }>,
  configuration: () => fetchMall('/config'),
  product: (id: string) => fetchMall(`/products/${encodeURIComponent(id)}`) as Promise<{product:MallProduct}>,

  products: (params?: { q?: string; category?: string; brand?: string; inStock?: 0 | 1; stockFirst?: 0 | 1; sort?: string; limit?: number; offset?: number }, options?: { signal?: AbortSignal }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.category) qs.set('category', params.category);
    if (params?.brand) qs.set('brand', params.brand);
    if (params?.inStock != null) qs.set('inStock', String(params.inStock));
    if (params?.stockFirst != null) qs.set('stockFirst', String(params.stockFirst));
    if (params?.sort) qs.set('sort', params.sort);
    if (params?.limit != null) qs.set('limit', String(params.limit));
    if (params?.offset != null) qs.set('offset', String(params.offset));
    const q = qs.toString();
    return fetchMall(`/products${q ? '?' + q : ''}`, options) as Promise<{
      search?: { query: string; approximate: boolean };
      products: MallProduct[];
      categories: (string | { name: string; count: number })[];
      brands?: { name: string; count: number }[];
      total: number;
      limit: number;
      offset: number;
      sort?: string;
    }>;
  },

  cart: () => fetchMall('/cart') as Promise<MallCart>,

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

  ensureSession: () => {
    if (!getSession()) {
      setSession(newSession());
    }
    return getSession();
  },

  resetSession: () => {
    clearCheckoutAttempt();
    clearSession();
    const session = newSession();
    setSession(session);
    return session;
  },
};
