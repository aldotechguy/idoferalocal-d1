export type StaffMallOrderItem = {
  id: string; productId: string; name: string; sku: string; unit: string;
  qty: number; unitPriceKobo: number; costPriceKobo: number; totalKobo: number;
};

export type StaffMallOrder = {
  id: string; orderNo: string; customerId?: string; customerName: string; customerPhone: string;
  status: string; subtotalKobo: number; deliveryFeeKobo: number; discountKobo: number; totalKobo: number;
  linkedSaleId?: string; createdAt: string; itemCount: number; items: StaffMallOrderItem[];
  delivery: { address?: string; note?: string; paymentMethod?: string; zone?: string; zoneLabel?: string; quoteRequired?: boolean; quoteConfirmed?: boolean };
  payment: { id: string; provider: string; reference: string; amountKobo: number; status: string; metadata?: Record<string, unknown> };
};

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('idofera_session_token') || sessionStorage.getItem('idofera_session_token');
  return token ? { authorization: `Bearer ${token}`, 'x-session-token': token } : {};
}

async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(`/api/staff/mall-orders${path}`, {
    ...options,
    credentials: 'include',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', ...authHeaders(), ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

export const staffMallClient = {
  list: (params: { status?: string; q?: string; limit?: number; offset?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.status && params.status !== 'all') query.set('status', params.status);
    if (params.q) query.set('q', params.q);
    if (params.limit) query.set('limit', String(params.limit));
    if (params.offset) query.set('offset', String(params.offset));
    return request(`?${query}`) as Promise<{ orders: StaffMallOrder[]; total: number }>;
  },
  detail: (id: string) => request(`/${encodeURIComponent(id)}`) as Promise<{ order: StaffMallOrder }>,
  counts: () => request('/counts') as Promise<{ byStatus: Record<string, number>; actionable: number }>,
  confirm: (id: string) => request(`/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: '{}' }) as Promise<{ order: StaffMallOrder }>,
  quoteDelivery: (id: string, feeKobo: number) => request(`/${encodeURIComponent(id)}/quote-delivery`, { method: 'POST', body: JSON.stringify({ feeKobo }) }) as Promise<{ order: StaffMallOrder }>,
  cancel: (id: string, reason: string) => request(`/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }) as Promise<{ order: StaffMallOrder }>,
  collectPayment: (id: string, body: { paymentMethod: string; amountKobo: number; reference?: string; paymentBreakdown?: Record<string, number> }) =>
    request(`/${encodeURIComponent(id)}/collect-payment`, { method: 'POST', body: JSON.stringify(body) }) as Promise<{ order: StaffMallOrder }>,
  verifyPayment: (id: string, body: { amountKobo: number; reference: string }) =>
    request(`/${encodeURIComponent(id)}/verify-payment`, { method: 'POST', body: JSON.stringify(body) }) as Promise<{ order: StaffMallOrder }>,
  transition: (id: string, action: 'start-processing' | 'mark-packed' | 'mark-ready' | 'mark-out-for-delivery' | 'complete') =>
    request(`/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: '{}' }) as Promise<{ order: StaffMallOrder }>,
  refund: (id: string, reason: string, returnStock = true) => request(`/${encodeURIComponent(id)}/refund`, { method: 'POST', body: JSON.stringify({ reason, returnStock }) }) as Promise<{ order: StaffMallOrder }>,
};