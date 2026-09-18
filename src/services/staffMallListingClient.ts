/** Staff Mall merchandising; Active product status controls visibility. */
export type StaffMallListing = {
  id: string; sku: string; name: string; category: string; brand: string; unit: string;
  productStatus: string; stock: number; internalDescription: string; mallDescription: string;
  images: string[]; imageCount: number;
  retailPriceKobo: number; mallPriceKobo: number | null; basePriceKobo: number;
  minimumSellingPriceKobo: number; publicPriceKobo: number; promoActive: boolean;
  visibleOnMall: boolean; featured: boolean; displayOrder: number | null;
  promoPriceKobo: number | null; promoStart: string | null; promoEnd: string | null;
  issues: string[];
};

export type MallListingPreview = {
  id: string; name: string; description: string; category: string; brand: string; unit: string;
  price: number; retailPriceKobo: number; image: string; images: string[];
  available: boolean; featured: boolean; promoActive: boolean; visibleOnMall: boolean;
};

export type MallListingSave = {
  mallPriceKobo: number | null; mallDescription: string;
  featured: boolean; displayOrder: number | null;
  promoPriceKobo: number | null; promoStart: string | null; promoEnd: string | null;
};

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('idofera_session_token') || sessionStorage.getItem('idofera_session_token');
  return token ? { authorization: `Bearer ${token}`, 'x-session-token': token } : {};
}

async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(`/api/staff/mall-listings${path}`, {
    ...options,
    credentials: 'include',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', ...authHeaders(), ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`) as Error & {
      fields?: Record<string, string>;
    };
    error.fields = data.fields;
    throw error;
  }
  return data;
}

export const staffMallListingClient = {
  list: (params: { view?: string; q?: string; limit?: number; offset?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.view && params.view !== 'all') query.set('view', params.view);
    if (params.q) query.set('q', params.q);
    if (params.limit) query.set('limit', String(params.limit));
    if (params.offset) query.set('offset', String(params.offset));
    return request(`?${query}`) as Promise<{
      listings: StaffMallListing[]; total: number;
      counts: { active: number; hidden: number };
    }>;
  },
  detail: (productId: string) => request(`/${encodeURIComponent(productId)}`) as Promise<{
    listing: StaffMallListing; preview: MallListingPreview;
  }>,
  save: (productId: string, body: MallListingSave) =>
    request(`/${encodeURIComponent(productId)}`, { method: 'PUT', body: JSON.stringify(body) }) as Promise<{
      listing: StaffMallListing; preview: MallListingPreview;
    }>,
};