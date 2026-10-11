import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AI_ALLOWED_ROLES,
  aiCurrency,
  aiRoleAllowed,
  businessFallback,
  fallbackPrices,
  forecastFallback,
  hasAiFields,
  lowStockNames,
  maskAiPayload,
  pricingFallback,
} from '../src/shared/aiAssistant.ts';

// ---------------------------------------------------------------------------
// A6: the API mirrors the page allow-list (Administrator, Store Manager,
// Accountant). Sales Staff is hidden in the UI and refused at the API.
// ---------------------------------------------------------------------------
test('A6: only the AI page roles may call the AI endpoints', () => {
  assert.deepEqual([...AI_ALLOWED_ROLES].sort(), ['Accountant', 'Administrator', 'Store Manager']);
  assert.equal(aiRoleAllowed('Administrator'), true);
  assert.equal(aiRoleAllowed('Store Manager'), true);
  assert.equal(aiRoleAllowed('Accountant'), true);
  assert.equal(aiRoleAllowed('Sales Staff'), false);
  assert.equal(aiRoleAllowed(''), false);
  assert.equal(aiRoleAllowed(undefined), false);
  assert.equal(aiRoleAllowed(null), false);
});

// ---------------------------------------------------------------------------
// A3: fallbacks are computed from caller data — never hardcoded fiction.
// ---------------------------------------------------------------------------
test('A3: forecast fallback answers from the submitted sales and stock', () => {
  const sales = [{ totalAmount: 100 }, { totalAmount: 250.5 }, { totalAmount: 'bad' }];
  const products = [
    { name: 'Low Item', currentStock: 2, minimumStockLevel: 5 },
    { name: 'Fine Item', currentStock: 10, minimumStockLevel: 5 },
  ];
  const out = forecastFallback(sales as any, products as any);
  assert.equal(out.source, 'fallback');
  assert.equal(out.predictedRevenue, 350.5);
  assert.equal(out.predictedSalesCount, 3);
  assert.deepEqual(out.highRiskStockouts, ['Low Item']);
});

test('A3: forecast fallback on empty data is zeros, not invented revenue', () => {
  const out = forecastFallback([], []);
  assert.equal(out.predictedRevenue, 0);
  assert.equal(out.predictedSalesCount, 0);
  assert.deepEqual(out.highRiskStockouts, []);
  const nullish = forecastFallback(undefined, undefined);
  assert.equal(nullish.predictedRevenue, 0);

test('A3: pricing fallback derives from the submitted cost', () => {
  const out = pricingFallback({ name: 'Widget', costPrice: 100 }, '₦');
  assert.equal(out.source, 'fallback');
  assert.equal(out.recommendedRetailPrice, 145);
  assert.equal(out.recommendedWholesalePrice, 125);
  assert.equal(out.projectedProfitMargin, 31);
  assert.match(out.explanation, /Widget/);
  assert.match(out.explanation, /₦/);
});

test('A3: pricing fallback floors an unknown cost instead of pricing at zero', () => {
  for (const cost of [undefined, null, 0, 'bad'] as any[]) {
    const prices = fallbackPrices(cost);
    assert.ok(prices.retail > 0 && prices.wholesale > 0, `cost ${String(cost)} must not yield a zero recommendation`);
  }
  const missing = pricingFallback(undefined);
  assert.ok(missing.recommendedRetailPrice > 0);
});

test('A3: business fallback renders the context, never the prompt', () => {
  const out = businessFallback({ todaySales: 5000, lowStockCount: 3, monthlyRevenue: 120000 }, 'reorder <script>alert(1)</script>', '₦');
  assert.match(out.answer, /₦5000/);
  assert.match(out.answer, /120000/);
  assert.doesNotMatch(out.answer, /<script>/);
  const generic = businessFallback({ todaySales: 0, lowStockCount: 0, monthlyRevenue: 0 }, 'how are we doing?');
  assert.match(generic.answer, /Monitor top-performing categories/);
});

// ---------------------------------------------------------------------------
// A5: currency travels with the caller instead of a hardcoded symbol.
// ---------------------------------------------------------------------------
test('A5: fallbacks honour the caller currency symbol', () => {
  assert.equal(aiCurrency('$'), '$');
  assert.equal(aiCurrency(undefined), '₦');
  const out = pricingFallback({ name: 'X', costPrice: 200 }, 'GH₵');
  assert.match(out.explanation, /GH₵/);
});

// ---------------------------------------------------------------------------
// A7: privacy masking keeps the shape, hides the money.
// ---------------------------------------------------------------------------
test('A7: masked payloads keep every key but hide money figures', () => {
  const masked = maskAiPayload(
    { recommendedRetailPrice: 145, riskLevel: 'Low', explanation: 'text', predictedRevenue: 999, insights: ['a'] },
    true,
  );
  assert.equal(masked.recommendedRetailPrice, '••');
  assert.equal(masked.predictedRevenue, '••');
  assert.equal(masked.riskLevel, 'Low');
  assert.equal(masked.explanation, 'text');
  assert.deepEqual(masked.insights, ['a']);
});

test('A7: masking is a no-op when not redacted', () => {
  const payload = { recommendedRetailPrice: 145 };
  assert.equal(maskAiPayload(payload, false), payload);
});

// ---------------------------------------------------------------------------
// A1/A2: the UI shape guard rejects error payloads before render.
// ---------------------------------------------------------------------------
test('A1/A2: hasAiFields accepts full payloads, rejects error shapes', () => {
  assert.equal(hasAiFields({ answer: 'hi' }, ['answer']), true);
  assert.equal(hasAiFields({ error: 'boom' }, ['answer']), false);
  assert.equal(hasAiFields({ forecastDays: 30, predictedRevenue: 1, predictedSalesCount: 1 }, ['forecastDays', 'predictedRevenue', 'predictedSalesCount', 'insights']), false);
  assert.equal(hasAiFields({ forecastDays: 30, predictedRevenue: 1, predictedSalesCount: 1, insights: [] }, ['forecastDays', 'predictedRevenue', 'predictedSalesCount', 'insights']), true);
  assert.equal(hasAiFields(null, ['answer']), false);
  assert.equal(hasAiFields({ answer: null }, ['answer']), false);
});

// ---------------------------------------------------------------------------
// lowStockNames: capped, null-safe building block of the forecast.
// ---------------------------------------------------------------------------
test('lowStockNames caps output and tolerates bad input', () => {
  const products = [
    { name: 'A', currentStock: 1, minimumStockLevel: 2 },
    { name: 'B', currentStock: 0, minimumStockLevel: 0 },
    { name: 'C', currentStock: 9, minimumStockLevel: 2 },
  ];
  assert.deepEqual(lowStockNames(products as any, 1), ['A']);
  assert.deepEqual(lowStockNames(undefined), []);
  assert.deepEqual(lowStockNames(null), []);
});

  assert.equal(nullish.predictedSalesCount, 0);
});
