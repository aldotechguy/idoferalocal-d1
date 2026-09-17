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
  const segs = [];
  for (let i = 0; i < 4; i += 1) {
    segs.push(Math.random().toString(36).slice(2, 10));
  }
  return 'mall-' + segs.join('-');
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
  health: () => fetchMall('/health') as Promise<{ ok: boolean; routes: string[] }>,

  products: (params?: { q?: string; category?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.category) qs.set('category', params.category);
    if (params?.limit != null) qs.set('limit', String(params.limit));
    if (params?.offset != null) qs.set('offset', String(params.offset));
    const q = qs.toString();
    return fetchMall(`/products${q ? '?' + q : ''}`) as Promise<{
      products: MallProduct[];
      categories: (string | { name: string; count: number })[];
      total: number;
      limit: number;
      offset: number;
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

  checkout: (body: MallCheckoutBody) =>
    fetchMall('/checkout', {
      method: 'POST',
      body: JSON.stringify(body),
    }) as Promise<MallOrder>,

  ordersByPhone: (phone: string) => {
    const qs = new URLSearchParams({ phone });
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
    clearSession();
    const session = newSession();
    setSession(session);
    return session;
  },
};
