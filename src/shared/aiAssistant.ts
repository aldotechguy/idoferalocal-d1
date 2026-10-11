/**
 * Shared, pure AI-assistant policy: fallback payloads, privacy masking, and
 * the role gate for the three `/api/ai/*` endpoints.
 *
 * Extracted so the fallback answers live in ONE place (shared by the Node
 * twin, the Cloudflare Worker, and the React fallback text) and can be
 * regression-tested in Node without a DOM — the same pattern as
 * `src/shared/customerLedger.ts` and `src/shared/importGuards.ts`.
 *
 * Design rules enforced here:
 *  - Fallbacks are computed from the caller-supplied data, never hardcoded
 *    revenue/product figures. A no-key deployment gets honest "here is what
 *    your own data says" numbers, not fiction.
 *  - Privacy Mode (and the server-side `redacted` flag) masks margin and
 *    revenue figures while keeping the shape stable so the UI never crashes
 *    on a missing field.
 *  - The AI page allows Administrator, Store Manager and Accountant. The API
 *    mirrors that list so a role the UI hides cannot call the endpoint
 *    directly either.
 */

/** Roles the AI assistant page (and therefore its API) allows. Mirrors the
 * `ai` entry of `pagePermissions` in `src/staff/StaffApp.tsx`. */
export const AI_ALLOWED_ROLES = ['Administrator', 'Store Manager', 'Accountant'] as const;

export function aiRoleAllowed(role: string | undefined | null): boolean {
  if (!role) return false;
  return (AI_ALLOWED_ROLES as readonly string[]).includes(role);
}

/** Currency symbol with a safe fallback when settings are unavailable. */
export const aiCurrency = (symbol?: string | null): string => symbol || '₦';

export interface AiFallbackProduct {
  name?: string;
  costPrice?: number | string;
  retailPrice?: number | string;
  currentStock?: number | string;
  minimumStockLevel?: number | string;
}

export interface AiFallbackSale {
  totalAmount?: number | string;
}

const toNumber = (value: number | string | undefined | null): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Fallback retail/wholesale pair from a cost, with a floor so a zero/unknown
 * cost never yields a zero or negative "recommendation". */
export function fallbackPrices(costPrice: number | string | undefined | null): {
  cost: number;
  retail: number;
  wholesale: number;
  margin: number;
} {
  const cost = Math.max(toNumber(costPrice), 1);
  const retail = Math.round(cost * 1.45 * 100) / 100;
  const wholesale = Math.round(cost * 1.25 * 100) / 100;
  const margin = Math.round(((retail - cost) / retail) * 100);
  return { cost, retail, wholesale, margin };
}

export interface PricingFallback {
  recommendedRetailPrice: number;
  recommendedWholesalePrice: number;
  suggestedDiscountPct: number;
  projectedProfitMargin: number;
  riskLevel: 'Low';
  explanation: string;
  source: 'fallback';
}

/** Pricing fallback computed from the submitted product — no invented data. */
export function pricingFallback(
  product: AiFallbackProduct | undefined | null,
  currencySymbol?: string | null,
): PricingFallback {
  const prices = fallbackPrices(product?.costPrice);
  const symbol = aiCurrency(currencySymbol);
  const name = (product?.name || 'this product').toString();
  return {
    recommendedRetailPrice: prices.retail,
    recommendedWholesalePrice: prices.wholesale,
    suggestedDiscountPct: 5,
    projectedProfitMargin: prices.margin,
    riskLevel: 'Low',
    explanation:
      `Based on a cost price of ${symbol}${prices.cost} for ${name}, the suggested retail price ` +
      `(${symbol}${prices.retail}) preserves a ${prices.margin}% margin, and the wholesale price ` +
      `(${symbol}${prices.wholesale}) keeps volume orders viable. Connect an AI key for demand-aware pricing.`,
    source: 'fallback',
  };
}


export interface ForecastFallback {
  forecastDays: number;
  predictedRevenue: number;
  predictedSalesCount: number;
  highRiskStockouts: string[];
  suggestedReorderDate: string;
  cashFlowTrend: string;
  insights: string[];
  source: 'fallback';
}

/** Items at or below their reorder point, capped so the payload stays small. */
export function lowStockNames(products: AiFallbackProduct[] | undefined | null, limit = 5): string[] {
  if (!Array.isArray(products)) return [];
  return products
    .filter((p) => toNumber(p?.currentStock) <= toNumber(p?.minimumStockLevel))
    .slice(0, Math.max(0, limit))
    .map((p) => String(p?.name || 'Unnamed product'));
}

/** Forecast fallback computed from the submitted sales/products — the honest
 * variant the Worker already used. Replaces the hardcoded revenue figures
 * that shipped on the Node twin and in the client catch blocks. */
export function forecastFallback(
  sales: AiFallbackSale[] | undefined | null,
  products: AiFallbackProduct[] | undefined | null,
): ForecastFallback {
  const list = Array.isArray(sales) ? sales : [];
  const revenue = list.reduce((sum, s) => sum + toNumber(s?.totalAmount), 0);
  return {
    forecastDays: 30,
    predictedRevenue: Math.round(revenue * 100) / 100,
    predictedSalesCount: list.length,
    highRiskStockouts: lowStockNames(products),
    suggestedReorderDate: 'Within 5 days',
    cashFlowTrend: 'Monitor current sales velocity',
    insights: [
      'Review low-stock products before the next sales cycle.',
      'Use recent category velocity to prioritize purchase orders.',
    ],
    source: 'fallback',
  };
}

export interface BusinessFallback {
  answer: string;
  source: 'fallback';
}

/** Business fallback rendered from the caller-supplied context. The prompt is
 * never echoed back, so a crafted question cannot turn the fallback into a
 * reflection oracle. */
export function businessFallback(
  context: { todaySales?: number | string; lowStockCount?: number | string; monthlyRevenue?: number | string } | undefined | null,
  prompt: string | undefined | null,
  currencySymbol?: string | null,
): BusinessFallback {
  const symbol = aiCurrency(currencySymbol);
  const today = toNumber(context?.todaySales);
  const monthly = toNumber(context?.monthlyRevenue);
  const lowStock = toNumber(context?.lowStockCount);
  const wantsReorder = String(prompt || '').toLowerCase().includes('reorder');
  return {
    answer:
      `[IdoferaLabs AI Analysis]\n\nBased on your recent business data:\n` +
      `- Today's Total Sales: ${symbol}${today}\n` +
      `- Active Low Stock Items: ${lowStock}\n` +
      `- Monthly Revenue: ${symbol}${monthly}\n\n` +
      `**Key Takeaway**: ${wantsReorder
        ? 'Replenish items below their minimum stock threshold to prevent lost sales.'
        : 'Monitor top-performing categories and stock velocity to protect margins.'}`,
    source: 'fallback',
  };
}

/** Privacy masking for AI payloads. When `redacted` is true the shape is
 * preserved (so the UI never dereferences `undefined`) but money figures are
 * replaced with display-safe placeholders. */
export function maskAiPayload<T>(payload: T, redacted: boolean): T {
  if (!redacted || payload === null || typeof payload !== 'object') return payload;
  const masked = Array.isArray(payload) ? [...(payload as unknown[])] : { ...(payload as Record<string, unknown>) };
  for (const key of Object.keys(masked as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (lower.includes('price') || lower.includes('revenue') || lower.includes('amount') || lower.includes('margin') || lower.includes('cashflow') || lower.includes('cash_flow') || lower.includes('trend')) {
      (masked as Record<string, unknown>)[key] = '••';
    }
  }
  return masked as T;
}

/** Shape guard for endpoint payloads. Returns true only when every named
 * field is present (null counts as missing). The UI uses this before trusting
 * a response body, so a 500 `{ error }` payload can never render as advice. */
export function hasAiFields(body: unknown, fields: string[]): boolean {
  if (!body || typeof body !== 'object') return false;
  return fields.every((f) => (body as Record<string, unknown>)[f] !== undefined && (body as Record<string, unknown>)[f] !== null);
}
