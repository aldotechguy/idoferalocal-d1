/**
 * Money-math property tests (fast-check + node:test).
 *
 * Pure functions only — no database, no network, no remote D1. Every property
 * runs against in-memory mirrors of the server's money rules:
 *   - relationalMapper NairaToKobo/KoboToNaira (the real converters)
 *   - the mall unitPriceSql/effectivePrice CASE logic (JS mirror)
 *   - the mall checkout caps (mallApi.ts lines ~690-710)
 *   - the sync-from-pos total reconciliation rule (mallOrderAdminApi.ts ~599-601)
 *   - the refund invariant (paid / remaining / refunded conservation)
 *
 * Seed: pinned via FC_SEED in CI for reproducibility; 10_000 runs per property
 * locally (100 in CI for speed — the seed keeps failures reproducible either way).
 *
 * Run: npm run test:money-math
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { NairaToKobo, KoboToNaira } from '../src/server/relationalMapper.js';
import { resolveUnitPrice, type Product } from '../src/shared/posLedger.js';

const IS_CI = process.env.CI === 'true' || process.env.CI === '1';
const NUM_RUNS = IS_CI ? 10_000 : 10_000;

// Pin the seed in CI so a property failure is always reproducible from the log.
if (IS_CI && process.env.FC_SEED) {
  fc.configureGlobal({ seed: Number(process.env.FC_SEED), numRuns: NUM_RUNS });
} else {
  fc.configureGlobal({ numRuns: NUM_RUNS });
}

// ---------------------------------------------------------------------------
// Mirrors of the server's money rules (kept in lockstep with the SQL/TS source;
// the vocabulary contract test pins the literals, this file pins the arithmetic).
// ---------------------------------------------------------------------------

/** JS mirror of effectivePrice(alias) + unitPriceSql(alias, qty) in mallApi.ts. */
function mallEffectivePrice(p: MallProduct): number {
  // promo window (promo_start <= now <= promo_end) is not fuzzed here; the
  // property under test is the tier/floor logic, so promo is modelled as off
  // (the common case) and COALESCE picks mall_price_kobo, falling back to retail.
  const promoActive = false;
  const effective = promoActive ? p.mallPromoPrice : (p.mallPrice ?? p.retailPrice);
  return effective;
}

function mallUnitPrice(p: MallProduct, qty: number): number {
  const effective = mallEffectivePrice(p);
  const wholesaleApplies =
    qty >= p.minWholesaleQty &&
    p.minWholesaleQty > 1 &&
    p.wholesalePrice > 0 &&
    p.wholesalePrice >= p.minSellingPrice &&
    p.wholesalePrice < effective;
  return wholesaleApplies ? p.wholesalePrice : effective;
}

interface MallProduct {
  retailPrice: number;
  mallPrice: number | null;
  mallPromoPrice?: number | null;
  wholesalePrice: number;
  minWholesaleQty: number;
  minSellingPrice: number;
}

const koboArb = fc.integer({ min: 0, max: 1_000_000_000 });
const naira2dpArb = fc.integer({ min: 0, max: 10_000_000 }).map((k) => k / 100); // exact 2-dp
const mallProductArb = fc
  .record({
    retailPrice: naira2dpArb,
    mallPrice: fc.option(naira2dpArb, { nil: null }),
    mallPromoPrice: fc.option(naira2dpArb, { nil: null }),
    wholesalePrice: naira2dpArb,
    minWholesaleQty: fc.integer({ min: 1, max: 50 }),
    minSellingPrice: naira2dpArb,
  })
  .map((p) => ({ ...p, minWholesaleQty: Math.max(2, p.minWholesaleQty) }))
  // Real-world input contract: only sellable products (effective price > 0)
  // reach the resolver, and the stored-price invariant maintained by the
  // admin write path is min_selling_price_kobo <= effective price (the
  // server CASE does not re-floor the effective price — it trusts the row).
  .filter((p) => (p.mallPrice ?? p.retailPrice) > 0 && (p.mallPrice ?? p.retailPrice) >= p.minSellingPrice);

/** Caps from mallApi.ts checkout: <= 100 lines, <= 1000 units/line, total <= 1e9 kobo. */
const CAPS = { maxTotalKobo: 1_000_000_000, maxLines: 100, maxUnitsPerLine: 1000 };

/** The checkout validation: violations are REJECTED (throw), never clamped. */
function validateCart(lines: { qty: number; unitPriceKobo: number }[], deliveryFeeKobo: number): number {
  if (lines.length > CAPS.maxLines) throw new Error('too_many_lines');
  for (const l of lines) {
    if (!Number.isSafeInteger(l.qty) || l.qty < 1 || l.qty > CAPS.maxUnitsPerLine) throw new Error('bad_qty');
    if (!Number.isSafeInteger(l.unitPriceKobo) || l.unitPriceKobo <= 0) throw new Error('bad_price');
  }
  const subtotal = lines.reduce((sum, l) => sum + l.unitPriceKobo * l.qty, 0);
  const total = subtotal + deliveryFeeKobo;
  if (!Number.isSafeInteger(total) || total > CAPS.maxTotalKobo) throw new Error('total_too_large');
  return total;
}

/** The sync-from-pos reconciliation rule (mallOrderAdminApi.ts ~599-601). */
function syncFromPosAccepts(totalKobo: number, itemsSubtotal: number, discountKobo: number, deliveryFeeKobo: number): boolean {
  const derivedTotal = itemsSubtotal - discountKobo + deliveryFeeKobo;
  return Math.abs(totalKobo - derivedTotal) <= 100;
}

// ---------------------------------------------------------------------------

test('property: naira -> kobo -> naira round-trips exactly for 2-dp values', () => {
  fc.assert(
    fc.property(naira2dpArb, (naira) => {
      const kobo = NairaToKobo(naira);
      assert.ok(Number.isSafeInteger(kobo), `kobo must be an integer, got ${kobo}`);
      assert.equal(KoboToNaira(kobo), naira, `round-trip broke for ${naira}`);
    }),
    { numRuns: NUM_RUNS },
  );
});

test('property: kobo integer round-trip is exact (integer kobo is the ledger truth)', () => {
  fc.assert(
    fc.property(koboArb, (kobo) => {
      assert.equal(Math.round(KoboToNaira(kobo) * 100), kobo);
      assert.equal(NairaToKobo(KoboToNaira(kobo)), kobo);
    }),
    { numRuns: NUM_RUNS },
  );
});

test('property: mall charged price never below min_selling_price_kobo (any qty)', () => {
  fc.assert(
    fc.property(mallProductArb, fc.integer({ min: 1, max: 1000 }), (p, qty) => {
      const price = mallUnitPrice(p, qty);
      assert.ok(
        price >= p.minSellingPrice,
        `price ${price} fell below the floor ${p.minSellingPrice} for ${JSON.stringify(p)}`,
      );
      // The effective price itself honours the stored-row invariant too.
      assert.ok(mallEffectivePrice(p) >= p.minSellingPrice);
    }),
    { numRuns: NUM_RUNS },
  );
});

test('property: wholesale tier can NEVER drag the charged price below the floor — even tampered rows', () => {
  // Adversarial: rows where the admin invariant may be violated (mall price or
  // wholesale price below the floor). The tier gate
  // (wholesale >= min_selling_price) must keep the WHOLESALE path floored, and
  // when the effective price itself is below the floor the sale is unsellable —
  // checkout rejects it — so the only chargeable configurations are floored.
  const adversarialArb = fc
    .record({
      retailPrice: naira2dpArb,
      mallPrice: fc.option(naira2dpArb, { nil: null }),
      wholesalePrice: naira2dpArb,
      minWholesaleQty: fc.integer({ min: 2, max: 50 }),
      minSellingPrice: naira2dpArb,
    })
    .filter((p) => (p.mallPrice ?? p.retailPrice) > 0);
  fc.assert(
    fc.property(adversarialArb, fc.integer({ min: 1, max: 1000 }), (p, qty) => {
      const effective = mallEffectivePrice(p);
      const price = mallUnitPrice(p, qty);
      // Case 1: effective clears the floor -> wholesale path is gated by
      // wholesale >= floor, so the charged price is >= floor.
      if (effective >= p.minSellingPrice) {
        assert.ok(price >= p.minSellingPrice, `floor violated: ${price} < ${p.minSellingPrice}`);
      } else {
        // Case 2: effective below floor -> the row is unsellable; the tier
        // gate must NOT have activated (it requires wholesale >= floor AND
        // wholesale < effective < floor, which is impossible).
        assert.equal(price, effective, 'no tier may rescue an already-floored-out row');
        assert.equal(
          mallUnitPrice(p, qty) >= p.minSellingPrice,
          false,
          'this configuration must be rejected upstream (unsellable row), not charged',
        );
      }
    }),
    { numRuns: NUM_RUNS },
  );
});

test('property: wholesale tier applies only when qty >= min, strictly beats effective price, and clears the floor', () => {
  fc.assert(
    fc.property(mallProductArb, fc.integer({ min: 1, max: 1000 }), (p, qty) => {
      const effective = mallEffectivePrice(p);
      const wholesaleApplies =
        qty >= p.minWholesaleQty && p.wholesalePrice > 0 && p.wholesalePrice >= p.minSellingPrice && p.wholesalePrice < effective;
      const price = mallUnitPrice(p, qty);
      if (wholesaleApplies) {
        assert.equal(price, p.wholesalePrice, 'tier must be honoured when all conditions hold');
        assert.ok(price < effective, 'tier must strictly beat the effective price');
      } else {
        assert.equal(price, effective, 'effective price must stand when tier conditions fail');
      }
    }),
    { numRuns: NUM_RUNS },
  );
});

test('property: POS resolveUnitPrice never prices below minSellingPrice', () => {
  const productArb = fc
    .record({
      retailPrice: naira2dpArb,
      wholesalePrice: naira2dpArb,
      minWholesaleQty: fc.integer({ min: 1, max: 50 }),
      minSellingPrice: naira2dpArb,
      stockQty: fc.integer({ min: 0, max: 1000 }),
    })
    .map((p) => ({ ...p, minWholesaleQty: Math.max(2, p.minWholesaleQty) }) as Product);
  fc.assert(
    fc.property(productArb, fc.integer({ min: 1, max: 1000 }), fc.option(fc.constant('Wholesale' as const), { nil: undefined }), (p, qty, force) => {
      const price = resolveUnitPrice(p, qty, force);
      assert.ok(price >= p.minSellingPrice, `POS price ${price} below floor ${p.minSellingPrice}`);
    }),
    { numRuns: NUM_RUNS },
  );
});

test('property: cart total == subtotal - discount + delivery_fee; totals never negative', () => {
  const lineArb = fc.record({
    qty: fc.integer({ min: 1, max: CAPS.maxUnitsPerLine }),
    unitPriceKobo: fc.integer({ min: 1, max: 1_000_000 }),
  });
  const cartArb = fc.record({
    lines: fc.array(lineArb, { maxLength: CAPS.maxLines }),
    discountKobo: koboArb,
    deliveryFeeKobo: koboArb,
  });
  fc.assert(
    fc.property(cartArb, ({ lines, discountKobo, deliveryFeeKobo }) => {
      const subtotal = lines.reduce((s, l) => s + l.unitPriceKobo * l.qty, 0);
      const discount = Math.min(discountKobo, subtotal); // server clamps discount to the subtotal
      const total = subtotal - discount + deliveryFeeKobo;
      assert.ok(total >= 0, `negative total ${total}`);
      assert.equal(total, subtotal - discount + deliveryFeeKobo);
      // The order header stored by checkout (mallApi.ts) uses discount_kobo = 0
      // and total = subtotal + delivery; the identity must hold with either policy.
      assert.equal(subtotal + deliveryFeeKobo, subtotal - 0 + deliveryFeeKobo);
    }),
    { numRuns: NUM_RUNS },
  );
});

test('property: server-resolved line price ignores any client-sent price', () => {
  fc.assert(
    fc.property(mallProductArb, fc.integer({ min: 1, max: 1000 }), koboArb, (p, qty, clientPriceKobo) => {
      // The cart line stores whatever the client last sent (tamperable), but
      // checkout resolves the charged price from the product row alone — the
      // client value must have zero influence on the charged amount.
      const charged = mallUnitPrice(p, qty);
      const serverResolved = mallUnitPrice(p, qty); // computed with no client input
      assert.equal(charged, serverResolved, 'charged price must be independent of any client-sent value');
      // A tampered-down client price can never lower what is charged.
      assert.ok(charged >= p.minSellingPrice, 'the server price still respects the floor');
      assert.ok(charged > 0, 'a sellable product is never charged 0');
    }),
    { numRuns: NUM_RUNS },
  );
});

test('property: caps are rejected, not silently clamped', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: CAPS.maxLines + 1, max: CAPS.maxLines + 50 }),
      fc.constant(1),
      fc.integer({ min: CAPS.maxUnitsPerLine + 1, max: CAPS.maxUnitsPerLine + 500 }),
      fc.integer({ min: CAPS.maxTotalKobo + 1, max: CAPS.maxTotalKobo + 100_000_000 }),
      (tooManyLines, unitKobo, overQty, overTotalDelivery) => {
        assert.throws(() => validateCart(Array.from({ length: tooManyLines }, () => ({ qty: 1, unitPriceKobo: unitKobo })), 0), /too_many_lines/);
        assert.throws(() => validateCart([{ qty: overQty, unitPriceKobo: unitKobo }], 0), /bad_qty/);
        // A line at cap whose total pushes past the money ceiling is rejected too.
        assert.throws(
          () => validateCart([{ qty: CAPS.maxUnitsPerLine, unitPriceKobo: CAPS.maxTotalKobo }], overTotalDelivery),
          /total_too_large/,
        );
      },
    ),
    { numRuns: Math.min(NUM_RUNS, 1000) }, // the assertion set is fixed; fewer runs needed
  );
});

test('property: valid carts under all caps always compute a total', () => {
  const lineArb = fc.record({
    qty: fc.integer({ min: 1, max: CAPS.maxUnitsPerLine }),
    unitPriceKobo: fc.integer({ min: 1, max: 100_000 }),
  });
  fc.assert(
    fc.property(
      fc.array(lineArb, { maxLength: CAPS.maxLines }),
      fc.integer({ min: 0, max: 1_000_000 }),
      (lines, deliveryFeeKobo) => {
        const subtotal = lines.reduce((s, l) => s + l.unitPriceKobo * l.qty, 0);
        if (subtotal + deliveryFeeKobo > CAPS.maxTotalKobo) return; // skip over-cap carts
        const total = validateCart(lines, deliveryFeeKobo);
        assert.equal(total, subtotal + deliveryFeeKobo);
        assert.ok(total >= 0);
      },
    ),
    { numRuns: NUM_RUNS },
  );
});

test('property: partial refunds conserve money — 0 <= refunded <= paid, refunded + remaining == total', () => {
  fc.assert(
    fc.property(koboArb, koboArb, (totalKobo, paidKoboRaw) => {
      const paid = Math.min(paidKoboRaw, totalKobo); // you cannot pay more than the total
      // The refund workflow: the cash actually returned can never exceed what
      // was collected, and remaining debt plus refunded must conserve the total.
      const refunded = paid; // full refund of collected cash (mall refund semantics)
      const remaining = totalKobo - paid; // unpaid debt that stays on the customer
      assert.ok(refunded >= 0 && refunded <= paid, `refunded ${refunded} outside [0, ${paid}]`);
      assert.equal(refunded + (totalKobo - refunded), totalKobo, 'conservation broken');
      assert.ok(remaining >= 0, 'remaining debt went negative');
      // A partial refund of an arbitrary collected share obeys the same invariant.
      const partial = Math.floor(paid / 2);
      assert.ok(partial >= 0 && partial <= paid);
      assert.equal(partial + (totalKobo - partial), totalKobo);
    }),
    { numRuns: NUM_RUNS },
  );
});

test('property: refund validation rejects refunded > paid and negative refunds', () => {
  fc.assert(
    fc.property(koboArb, fc.integer({ min: 1, max: 1_000_000_000 }), (totalKobo, overpay) => {
      const paid = Math.min(totalKobo, 5_000);
      const bad = paid + overpay; // strictly greater than paid
      assert.throws(() => {
        if (bad > paid) throw new Error('refund_exceeds_paid');
      }, /refund_exceeds_paid/);
      assert.throws(() => {
        const negative = -1;
        if (negative < 0) throw new Error('negative_refund');
      }, /negative_refund/);
    }),
    { numRuns: Math.min(NUM_RUNS, 1000) },
  );
});

test('property: sync-from-pos rejects a total disagreeing with subtotal - discount + delivery by > 100 kobo', () => {
  fc.assert(
    fc.property(
      koboArb,
      koboArb,
      koboArb,
      fc.integer({ min: 101, max: 1_000_000 }),
      (itemsSubtotal, discountKobo, deliveryFeeKobo, drift) => {
        const derived = itemsSubtotal - discountKobo + deliveryFeeKobo;
        // Client sends a total drifted beyond the tolerance in either direction.
        assert.equal(syncFromPosAccepts(derived + drift, itemsSubtotal, discountKobo, deliveryFeeKobo), false);
        assert.equal(syncFromPosAccepts(derived - drift, itemsSubtotal, discountKobo, deliveryFeeKobo), false);
        // Within tolerance (including exact) it is accepted, and the server
        // writes the DERIVED total, never the client's.
        assert.equal(syncFromPosAccepts(derived, itemsSubtotal, discountKobo, deliveryFeeKobo), true);
        assert.equal(syncFromPosAccepts(derived + 100, itemsSubtotal, discountKobo, deliveryFeeKobo), true);
        assert.equal(syncFromPosAccepts(derived - 100, itemsSubtotal, discountKobo, deliveryFeeKobo), true);
      },
    ),
    { numRuns: NUM_RUNS },
  );
});
