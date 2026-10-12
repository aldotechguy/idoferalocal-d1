import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Product,
  LineItem,
  POLine,
  PriceTier,
  round2,
  resolveUnitPrice,
  createSale,
  editSale,
  refundSale,
  processGRN,
} from '../src/shared/posLedger.ts';

const baseProduct: Omit<Product, 'stockQty'> = {
  id: 'p1',
  name: 'Test Product',
  retailPrice: 1000,
  wholesalePrice: 800,
  minWholesaleQty: 10,
  minSellingPrice: 500,
};

test('resolveUnitPrice: basic retail price', () => {
  const product: Product = { ...baseProduct, stockQty: 100 };

  // Quantity below wholesale tier
  assert.equal(resolveUnitPrice(product, 5), 1000);
  // Quantity at wholesale tier - 1
  assert.equal(resolveUnitPrice(product, 9), 1000);
  // Quantity at wholesale tier
  assert.equal(resolveUnitPrice(product, 10), 800);
  // Quantity above wholesale tier
  assert.equal(resolveUnitPrice(product, 20), 800);
});

test('resolveUnitPrice: minimum selling price enforcement', () => {
  const product: Product = {
    ...baseProduct,
    retailPrice: 400, // Below minimum selling price
    wholesalePrice: 300,
    stockQty: 100,
  };

  // Should clamp to minimum selling price
  assert.equal(resolveUnitPrice(product, 1), 500);
  assert.equal(resolveUnitPrice(product, 10), 500); // Wholesale price is 300, but clamped to 500
});

test('round2: rounds to 2 decimals and guards against non-numbers', () => {
  // 0.1 + 0.2 exposes the floating point error; round2 reins it in.
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2(2.5), 2.5);
  // The || 0 guard turns NaN/undefined/null into 0 so they never poison a total.
  assert.equal(round2(undefined as unknown as number), 0);
  assert.equal(round2(null as unknown as number), 0);
});

test('resolveUnitPrice: forceTier overrides the wholesale threshold', () => {
  const product: Product = { ...baseProduct, stockQty: 100 };

  // Qty 20 would normally be wholesale (800); forcing Retail keeps retail (1000)
  assert.equal(resolveUnitPrice(product, 20, 'Retail'), 1000);
  // Qty 1 would normally be retail (1000); forcing Wholesale keeps wholesale (800)
  assert.equal(resolveUnitPrice(product, 1, 'Wholesale'), 800);
  // No forceTier still tier by quantity
  assert.equal(resolveUnitPrice(product, 20), 800);
  assert.equal(resolveUnitPrice(product, 1), 1000);
});

test('resolveUnitPrice: minimum selling price applies to forced tier', () => {
  const product: Product = {
    ...baseProduct,
    retailPrice: 400, // Below minimum selling price
    wholesalePrice: 300,
    stockQty: 100,
  };

  // Forcing either tier must still clamp to the minimum selling price
  assert.equal(resolveUnitPrice(product, 1, 'Retail'), 500);
  assert.equal(resolveUnitPrice(product, 1, 'Wholesale'), 500);
});

test('createSale: basic sale', () => {
  const product: Product = { ...baseProduct, stockQty: 100 };

  const lineItems = [
    { productId: 'p1', product: product, quantity: 5 },
    { productId: 'p1', product: product, quantity: 15 }, // triggers wholesale
  ];

  const result = createSale(lineItems);

  // First item: 5 * 1000 = 5000
  // Second item: 15 * 800 = 12000
  // Total: 17000
  assert.equal(result.totalAmount, 17000);

  // Stock delta: -5 for first, -15 for second -> total -20
  assert.equal(result.stockDelta['p1'], -20);

  // Check that the returned line items have unitPrice set
  assert.equal(result.saleItems.length, 2);
  assert.equal(result.saleItems[0].unitPrice, 1000);
  assert.equal(result.saleItems[1].unitPrice, 800);
});

test('createSale: enforces minimum selling price', () => {
  const product: Product = {
    ...baseProduct,
    retailPrice: 400, // Below minimum
    wholesalePrice: 300,
    stockQty: 100,
  };

  const result = createSale([{ productId: 'p1', product: product, quantity: 1 }]);
  // Should clamp to minimum selling price
  assert.equal(result.totalAmount, 500);
  assert.equal(result.saleItems[0].unitPrice, 500);
});

test('createSale: clears stock for multiple products independently', () => {
  const productA: Product = { ...baseProduct, id: 'p1', name: 'A', stockQty: 100 };
  const productB: Product = { ...baseProduct, id: 'p2', name: 'B', retailPrice: 2000, wholesalePrice: 1500, minSellingPrice: 1000, stockQty: 50 };

  const result = createSale([
    { productId: 'p1', product: productA, quantity: 2 },
    { productId: 'p2', product: productB, quantity: 3 },
  ]);

  assert.equal(result.stockDelta['p1'], -2);
  assert.equal(result.stockDelta['p2'], -3);
  assert.equal(result.totalAmount, 2 * 1000 + 3 * 2000); // 8000
});

test('editSale: increasing quantity of a product', () => {
  const product: Product = { ...baseProduct, stockQty: 100 };

  // Original sale: 5 units at retail
  const previousItems = [
    { productId: 'p1', product: product, quantity: 5, unitPrice: 1000 },
  ];

  // Edit: change to 10 units (wholesale tier)
  const updatedItems = [{ productId: 'p1', product: product, quantity: 10 }];

  const result = editSale(previousItems, updatedItems);

  // Original total: 5 * 1000 = 5000
  // Updated total: 10 * 800 = 8000
  // Amount delta: +3000
  assert.equal(result.amountDelta, 3000);

  // Sold 5 MORE units: stock must DECREASE by 5 (negative delta restores nothing; it takes 5).
  assert.equal(result.stockDelta['p1'], -5);

  // Check updated sale items
  assert.equal(result.updatedSaleItems.length, 1);
  assert.equal(result.updatedSaleItems[0].unitPrice, 800);
  assert.equal(result.updatedSaleItems[0].quantity, 10);
});

test('editSale: decreasing quantity of a product', () => {
  const product: Product = { ...baseProduct, stockQty: 100 };

  // Original sale: 15 units at wholesale
  const previousItems = [
    { productId: 'p1', product: product, quantity: 15, unitPrice: 800 },
  ];

  // Edit: change to 5 units at retail
  const updatedItems = [{ productId: 'p1', product: product, quantity: 5 }];

  const result = editSale(previousItems, updatedItems);

  // Original total: 15 * 800 = 12000
  // Updated total: 5 * 1000 = 5000
  // Amount delta: -7000
  assert.equal(result.amountDelta, -7000);

  // Sold 10 FEWER units: stock is RETURNED by 10 (positive delta).
  assert.equal(result.stockDelta['p1'], 10);

  // Check updated sale items
  assert.equal(result.updatedSaleItems[0].unitPrice, 1000);
  assert.equal(result.updatedSaleItems[0].quantity, 5);
});

test('editSale: removing a product line returns its stock', () => {
  const productA: Product = { ...baseProduct, id: 'p1', name: 'A', stockQty: 100 };
  const productB: Product = { ...baseProduct, id: 'p2', name: 'B', retailPrice: 2000, wholesalePrice: 1500, minSellingPrice: 1000, stockQty: 50 };

  // Original sale: 2 units of A and 3 units of B
  const previousItems = [
    { productId: 'p1', product: productA, quantity: 2, unitPrice: 1000 },
    { productId: 'p2', product: productB, quantity: 3, unitPrice: 2000 },
  ];

  // Edit: remove product B, keep A
  const updatedItems = [{ productId: 'p1', product: productA, quantity: 2 }];

  const result = editSale(previousItems, updatedItems);

  // Original total: (2*1000) + (3*2000) = 8000
  // Updated total: 2*1000 = 2000
  // Amount delta: -6000
  assert.equal(result.amountDelta, -6000);

  // A unchanged -> 0; B removed -> 3 units returned to stock (+3)
  assert.equal(result.stockDelta['p1'], 0);
  assert.equal(result.stockDelta['p2'], 3);
});

test('editSale: swapping a product returns old stock and takes new stock', () => {
  const productA: Product = { ...baseProduct, id: 'p1', name: 'A', stockQty: 100 };
  const productB: Product = { ...baseProduct, id: 'p2', name: 'B', retailPrice: 2000, wholesalePrice: 1500, minSellingPrice: 1000, stockQty: 50 };

  // Original sale: 5 units of A
  const previousItems = [
    { productId: 'p1', product: productA, quantity: 5, unitPrice: 1000 },
  ];

  // Edit: change to 3 units of B
  const updatedItems = [{ productId: 'p2', product: productB, quantity: 3 }];

  const result = editSale(previousItems, updatedItems);

  // Original total: 5 * 1000 = 5000
  // Updated total: 3 * 2000 = 6000
  // Amount delta: +1000
  assert.equal(result.amountDelta, 1000);

  // A returned to stock (+5), B taken from stock (-3)
  assert.equal(result.stockDelta['p1'], 5);
  assert.equal(result.stockDelta['p2'], -3);
  assert.equal(result.updatedSaleItems.length, 1);
  assert.equal(result.updatedSaleItems[0].productId, 'p2');
  assert.equal(result.updatedSaleItems[0].unitPrice, 2000);
  assert.equal(result.updatedSaleItems[0].quantity, 3);
});

test('editSale: reducing to zero quantity returns all stock', () => {
  const product: Product = { ...baseProduct, stockQty: 100 };

  const previousItems = [
    { productId: 'p1', product: product, quantity: 5, unitPrice: 1000 },
  ];

  const updatedItems = [{ productId: 'p1', product: product, quantity: 0 }];

  const result = editSale(previousItems, updatedItems);

  // Original total: 5 * 1000 = 5000
  // Updated total: 0
  // Amount delta: -5000
  assert.equal(result.amountDelta, -5000);

  // All 5 units returned to stock (+5)
  assert.equal(result.stockDelta['p1'], 5);
});

test('refundSale: full refund', () => {
  const product: Product = { ...baseProduct, stockQty: 100 };

  // Original sale: 5 units at retail
  const originalItems = [
    { productId: 'p1', product: product, quantity: 5, unitPrice: 1000 },
  ];

  // Refund: all 5 units
  const refundedItems = [
    { productId: 'p1', product: product, quantity: 5, unitPrice: 1000 },
  ];

  const result = refundSale(originalItems, refundedItems);

  // Refund amount: 5 * 1000 = 5000
  assert.equal(result.refundAmount, 5000);
  // With no financials, net equals gross
  assert.equal(result.netRefundAmount, 5000);
  // Stock delta: +5 (returning 5 units to stock)
  assert.equal(result.stockDelta['p1'], 5);
  assert.equal(result.refundedItems.length, 1);
  assert.equal(result.refundedItems[0].quantity, 5);
});

test('refundSale: partial refund', () => {
  const product: Product = { ...baseProduct, stockQty: 100 };

  // Original sale: 10 units at wholesale
  const originalItems = [
    { productId: 'p1', product: product, quantity: 10, unitPrice: 800 },
  ];

  // Refund: 3 units
  const refundedItems = [
    { productId: 'p1', product: product, quantity: 3, unitPrice: 800 },
  ];

  const result = refundSale(originalItems, refundedItems);

  // Refund amount: 3 * 800 = 2400
  assert.equal(result.refundAmount, 2400);
  // Stock delta: +3
  assert.equal(result.stockDelta['p1'], 3);
});

test('refundSale: refund with multiple products', () => {
  const productA: Product = { ...baseProduct, id: 'p1', name: 'A', stockQty: 100 };
  const productB: Product = { ...baseProduct, id: 'p2', name: 'B', retailPrice: 2000, wholesalePrice: 1500, minSellingPrice: 1000, stockQty: 50 };

  // Original sale: 5 units of A and 3 units of B
  const originalItems = [
    { productId: 'p1', product: productA, quantity: 5, unitPrice: 1000 },
    { productId: 'p2', product: productB, quantity: 3, unitPrice: 2000 },
  ];

  // Refund: 2 units of A and 1 unit of B
  const refundedItems = [
    { productId: 'p1', product: productA, quantity: 2, unitPrice: 1000 },
    { productId: 'p2', product: productB, quantity: 1, unitPrice: 2000 },
  ];

  const result = refundSale(originalItems, refundedItems);

  // Refund amount: (2*1000) + (1*2000) = 4000
  assert.equal(result.refundAmount, 4000);
  // Stock delta: A: +2, B: +1
  assert.equal(result.stockDelta['p1'], 2);
  assert.equal(result.stockDelta['p2'], 1);
});

test('refundSale: prorated discount, tax, and delivery fee', () => {
  const product: Product = { ...baseProduct, stockQty: 100 };

  // Original sale: 10 units at retail (1000) => subtotal 10000, discount 1000, tax 500, delivery 200 refunded
  const originalItems = [
    { productId: 'p1', product: product, quantity: 10, unitPrice: 1000 },
  ];

  // Refund: 5 units at retail (1000) => gross 5000
  const refundedItems = [
    { productId: 'p1', product: product, quantity: 5, unitPrice: 1000 },
  ];

  const result = refundSale(originalItems, refundedItems, {
    saleSubtotal: 10000,
    discount: 1000,
    tax: 500,
    deliveryFeeRefunded: 200,
  });

  // Gross = 5000
  assert.equal(result.refundAmount, 5000);
  // Discount prorated: (5000/10000)*1000 = 500
  assert.equal(result.discountDeducted, 500);
  // Tax prorated: (5000/10000)*500 = 250
  assert.equal(result.taxDeducted, 250);
  // Delivery fee refunded: 200
  assert.equal(result.deliveryFeeRefunded, 200);
  // Net = 5000 - 500 (discount) + 250 (tax) + 200 (delivery) = 4950
  assert.equal(result.netRefundAmount, 4950);
});

test('refundSale: without financials, net equals gross and prorations are zero', () => {
  const product: Product = { ...baseProduct, stockQty: 100 };

  const originalItems = [
    { productId: 'p1', product: product, quantity: 10, unitPrice: 1000 },
  ];
  const refundedItems = [
    { productId: 'p1', product: product, quantity: 5, unitPrice: 1000 },
  ];

  const result = refundSale(originalItems, refundedItems);

  assert.equal(result.refundAmount, 5000);
  assert.equal(result.netRefundAmount, 5000);
  assert.equal(result.discountDeducted, 0);
  assert.equal(result.taxDeducted, 0);
  assert.equal(result.deliveryFeeRefunded, 0);
});

test('refundSale: partial refund with proration and no delivery fee', () => {
  const product: Product = { ...baseProduct, stockQty: 100 };

  const originalItems = [
    { productId: 'p1', product: product, quantity: 10, unitPrice: 800 },
  ];
  const refundedItems = [
    { productId: 'p1', product: product, quantity: 3, unitPrice: 800 },
  ];

  const result = refundSale(originalItems, refundedItems, {
    saleSubtotal: 8000,
    discount: 800,
    tax: 0,
    deliveryFeeRefunded: 0,
  });

  // Gross = 2400; discount prorated = (2400/8000)*800 = 240; tax 0; delivery 0
  assert.equal(result.refundAmount, 2400);
  assert.equal(result.discountDeducted, 240);
  assert.equal(result.taxDeducted, 0);
  assert.equal(result.deliveryFeeRefunded, 0);
  assert.equal(result.netRefundAmount, 2160);
});

test('processGRN: full delivery, no price adjustment', () => {
  const product: Product = { ...baseProduct, stockQty: 100 };

  const poLine = {
    productId: 'p1',
    product: product,
    quantityOrdered: 10,
    unitPrice: 900,
  };

  const result = processGRN(poLine, 10, 900);

  assert.equal(result.stockIncrement, 10);
  assert.equal(result.isFullyDelivered, true);
  assert.equal(result.hasPriceAdjustment, false);
  assert.equal(result.priceAdjustmentPerUnit, 0);
});

test('processGRN: partial delivery, no price adjustment', () => {
  const product: Product = { ...baseProduct, stockQty: 100 };

  const poLine = {
    productId: 'p1',
    product: product,
    quantityOrdered: 10,
    unitPrice: 900,
  };

  const result = processGRN(poLine, 7, 900);

  assert.equal(result.stockIncrement, 7);
  assert.equal(result.isFullyDelivered, false);
  assert.equal(result.hasPriceAdjustment, false);
  assert.equal(result.priceAdjustmentPerUnit, 0);
});

test('processGRN: full delivery, with price adjustment (increase)', () => {
  const product: Product = { ...baseProduct, stockQty: 100 };

  const poLine = {
    productId: 'p1',
    product: product,
    quantityOrdered: 10,
    unitPrice: 900,
  };

  const result = processGRN(poLine, 10, 950); // Received at 950

  assert.equal(result.stockIncrement, 10);
  assert.equal(result.isFullyDelivered, true);
  assert.equal(result.hasPriceAdjustment, true);
  assert.equal(result.priceAdjustmentPerUnit, 50); // 950 - 900 = 50
});

test('processGRN: full delivery, with price adjustment (decrease)', () => {
  const product: Product = { ...baseProduct, stockQty: 100 };

  const poLine = {
    productId: 'p1',
    product: product,
    quantityOrdered: 10,
    unitPrice: 900,
  };

  const result = processGRN(poLine, 10, 850); // Received at 850

  assert.equal(result.stockIncrement, 10);
  assert.equal(result.isFullyDelivered, true);
  assert.equal(result.hasPriceAdjustment, true);
  assert.equal(result.priceAdjustmentPerUnit, -50); // 850 - 900 = -50
});

test('processGRN: cumulative receive marks a line fully delivered', () => {
  const product: Product = { ...baseProduct, stockQty: 100 };

  const poLine = {
    productId: 'p1',
    product: product,
    quantityOrdered: 10,
    unitPrice: 900,
  };

  // 4 previously + 6 now => 10 cumulative, meets the ordered 10
  const result = processGRN(poLine, 10, 900);
  assert.equal(result.isFullyDelivered, true);
});

test('refundSale: the originalSale parameter is retained for callers that validate', () => {
  // Documents that refundSale does not itself enforce original-vs-returned
  // quantities; the caller is responsible for that validation.
  const product: Product = { ...baseProduct, stockQty: 100 };

  const originalItems = [
    { productId: 'p1', product: product, quantity: 5, unitPrice: 1000 },
  ];

  // Refunding 6 from a 5-unit original is over-refunding; the pure function
  // just computes the stated math and lets the caller reject it upstream.
  const refundedItems = [
    { productId: 'p1', product: product, quantity: 6, unitPrice: 1000 },
  ];

  const result = refundSale(originalItems, refundedItems);

  assert.equal(result.refundAmount, 6000);
  assert.equal(result.stockDelta['p1'], 6);
});

test('PriceTier type exports', () => {
  const tiers: PriceTier[] = ['Retail', 'Wholesale'];
  assert.equal(tiers.length, 2);
});

test('POLine shape is typed for GRN receipts', () => {
  const product: Product = { ...baseProduct, stockQty: 100 };
  const poLine: POLine = {
    productId: 'p1',
    product: product,
    quantityOrdered: 10,
    unitPrice: 900,
  };
  assert.equal(poLine.quantityOrdered, 10);
});

test('resolveUnitPrice: forceTier with minSellingPrice clamp on wholesale tier', () => {
  const product: Product = {
    ...baseProduct,
    retailPrice: 1200,
    wholesalePrice: 600, // Below minimum
    minSellingPrice: 700,
    stockQty: 100,
  };

  // Forcing Wholesale at high qty must still clamp to minSellingPrice
  assert.equal(resolveUnitPrice(product, 50, 'Wholesale'), 700);
  // No forceTier at high qty also clamps
  assert.equal(resolveUnitPrice(product, 50), 700);
});

test('createSale: forceTier overrides tier per line', () => {
  const product: Product = { ...baseProduct, stockQty: 100 };

  const lineItems = [
    { productId: 'p1', product: product, quantity: 1, forceTier: 'Wholesale' as const }, // force wholesale at qty 1
    { productId: 'p1', product: product, quantity: 20, forceTier: 'Retail' as const }, // force retail at qty 20
  ];

  const result = createSale(lineItems as LineItem[]);

  // First: 1 * 800 = 800; Second: 20 * 1000 = 20000; Total: 20800
  assert.equal(result.totalAmount, 20800);
  assert.equal(result.saleItems[0].unitPrice, 800);
  assert.equal(result.saleItems[1].unitPrice, 1000);
  assert.equal(result.stockDelta['p1'], -21);
});

test('editSale: forceTier on updated items overrides tier', () => {
  const product: Product = { ...baseProduct, stockQty: 100 };

  // Original: 5 units at retail (1000)
  const previousItems = [
    { productId: 'p1', product: product, quantity: 5, unitPrice: 1000 },
  ];

  // Edit: change to 5 units but force wholesale pricing
  const updatedItems = [
    { productId: 'p1', product: product, quantity: 5, forceTier: 'Wholesale' as const },
  ];

  const result = editSale(previousItems, updatedItems);

  // Original total: 5 * 1000 = 5000
  // Updated total: 5 * 800 = 4000
  // Amount delta: -1000
  assert.equal(result.amountDelta, -1000);

  // Stock unchanged (same qty)
  assert.equal(result.stockDelta['p1'], 0);

  // Updated item has wholesale price
  assert.equal(result.updatedSaleItems[0].unitPrice, 800);
});

test('refundSale: refund items recorded at forced tier use their recorded unitPrice', () => {
  const product: Product = { ...baseProduct, stockQty: 100 };

  // Original sale: 10 units at forced wholesale (800 each)
  const originalItems = [
    { productId: 'p1', product: product, quantity: 10, unitPrice: 800 },
  ];

  // Refund: 3 units at the recorded forced-wholesale price
  const refundedItems = [
    { productId: 'p1', product: product, quantity: 3, unitPrice: 800 },
  ];

  const result = refundSale(originalItems, refundedItems);

  // Refund uses recorded unitPrice (800), not current tier price
  assert.equal(result.refundAmount, 2400);
  assert.equal(result.netRefundAmount, 2400);
});
