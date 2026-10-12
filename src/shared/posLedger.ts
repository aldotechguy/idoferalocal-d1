/**
 * Point of Sale Ledger — pure financial and stock calculations.
 *
 * This module contains pure functions for:
 *   - Line-item pricing resolution (retail vs wholesale, minimumSellingPrice, round2)
 *   - Sale creation, editing, and refund stock-delta calculations
 *   - Purchase Order GRN receiving (stock increments, delivery status, price adjustment)
 *
 * It follows the same pattern as customerLedger.ts: no React, no storage, no network.
 * Amounts are plain decimal numbers (the app's currency unit, e.g. Naira); `round2`
 * keeps every money value to two decimal places so floating point never leaks in.
 */

export interface Product {
  id: string;
  name: string;
  retailPrice: number;
  wholesalePrice: number;
  minWholesaleQty: number;
  minSellingPrice: number;
  stockQty: number;
}

/** The pricing tier a line is billed at. */
export type PriceTier = 'Retail' | 'Wholesale';

/** A line that was charged a concrete unit price (e.g. an existing sale line). */
export interface SaleLine {
  productId: string;
  quantity: number;
  unitPrice: number;
}

/** A line to be (re)priced from the catalogue. */
export interface CatalogLine {
  productId: string;
  product: Product;
  quantity: number;
  forceTier?: PriceTier;
}

/** A priced line: a catalogue line with its unit price resolved. */
export interface LineItem extends CatalogLine {
  unitPrice: number;
}

export interface POLine {
  productId: string;
  product: Product;
  quantityOrdered: number;
  unitPrice: number;
}

/** Inputs used to prorate a refund against the original sale's discount/tax/delivery. */
export interface RefundFinancials {
  saleSubtotal: number;
  discount: number;
  tax: number;
  deliveryFeeRefunded: number;
}

/** Round to 2 decimals so floating point never leaks into stored money. */
export const round2 = (value: number): number => Math.round((Number(value) || 0) * 100) / 100;

/**
 * Resolve the unit price for a product given a quantity and (optionally) a forced
 * pricing tier.
 *
 * - Without `forceTier`, the wholesale price applies once `quantity` reaches
 *   `minWholesaleQty`; otherwise the retail price applies.
 * - With `forceTier` ('Retail' | 'Wholesale') the tier selection is overridden —
 *   used when a sale type or a "use retail price" flag sets the tier regardless
 *   of quantity.
 *
 * The resolved price is clamped to `minSellingPrice` so the product can never be
 * priced below its floor. Returns the unit price.
 */
export function resolveUnitPrice(product: Product, quantity: number, forceTier?: PriceTier): number {
  let unitPrice: number;
  if (forceTier === 'Retail') {
    unitPrice = product.retailPrice;
  } else if (forceTier === 'Wholesale') {
    unitPrice = product.wholesalePrice;
  } else {
    unitPrice = quantity >= product.minWholesaleQty ? product.wholesalePrice : product.retailPrice;
  }
  if (unitPrice < product.minSellingPrice) {
    unitPrice = product.minSellingPrice;
  }
  return round2(unitPrice);
}

/**
 * Create a sale from catalogue lines.
 *
 * Each line's unit price is resolved from its product (wholesale tier by
 * quantity, min-selling-price floor), then totals are accumulated. Returns the
 * total amount, the priced line items, and the per-product stock delta
 * (negative = stock reduction).
 */
export function createSale(lineItems: CatalogLine[]): {
  totalAmount: number;
  saleItems: LineItem[];
  stockDelta: Record<string, number>;
} {
  let totalAmount = 0;
  const saleItems: LineItem[] = [];
  const stockDelta: Record<string, number> = {};

  for (const item of lineItems) {
    const unitPrice = resolveUnitPrice(item.product, item.quantity, item.forceTier);
    const totalPrice = round2(unitPrice * item.quantity);
    const lineItemWithPrice: LineItem = { ...item, unitPrice };
    saleItems.push(lineItemWithPrice);
    totalAmount = round2(totalAmount + totalPrice);
    // Stock reduction: negative delta
    stockDelta[item.productId] = round2((stockDelta[item.productId] || 0) - item.quantity);
  }

  return { totalAmount: round2(totalAmount), saleItems, stockDelta };
}

/**
 * Edit a sale: compute the stock delta and amount change when changing quantities.
 *
 * @param previousItems The original line items of the sale (quantity + unit price it sold at).
 * @param updatedItems  The new line items after editing (re-priced from the catalogue).
 * @returns
 *   - stockDelta: net change in stock per product. Positive = stock returned to
 *     inventory (sold quantity reduced), negative = stock taken (sold quantity increased).
 *     Computed as oldQty - newQty per product, matching the app's stock-adjustment
 *     convention where a positive delta restores stock.
 *   - amountDelta: change in total amount (positive = increase, negative = decrease).
 *   - updatedSaleItems: the updated line items with unit prices resolved for saving.
 *
 * previousStockDelta/updatedStockDelta hold the NEGATIVE reductions (-qty). The
 * change in stock is (new reduction) - (old reduction) = updatedStockDelta -
 * previousStockDelta = (-newQty) - (-oldQty) = oldQty - newQty. Positive when the
 * sold quantity was reduced, i.e. stock is returned.
 */
export function editSale(
  previousItems: SaleLine[],
  updatedItems: CatalogLine[]
): {
  stockDelta: Record<string, number>;
  amountDelta: number;
  updatedSaleItems: LineItem[];
} {
  // Compute the previous sale total and stock delta from the original line items.
  let previousTotal = 0;
  const previousStockDelta: Record<string, number> = {};
  for (const item of previousItems) {
    previousTotal = round2(previousTotal + round2(item.unitPrice * item.quantity));
    previousStockDelta[item.productId] = round2((previousStockDelta[item.productId] || 0) - item.quantity);
  }

  // Compute the updated sale total and stock delta from the updated line items.
  let updatedTotal = 0;
  const updatedStockDelta: Record<string, number> = {};
  const updatedSaleItems: LineItem[] = [];
  for (const item of updatedItems) {
    const unitPrice = resolveUnitPrice(item.product, item.quantity, item.forceTier);
    const totalPrice = round2(unitPrice * item.quantity);
    const lineItemWithPrice: LineItem = { ...item, unitPrice };
    updatedSaleItems.push(lineItemWithPrice);
    updatedTotal = round2(updatedTotal + totalPrice);
    updatedStockDelta[item.productId] = round2((updatedStockDelta[item.productId] || 0) - item.quantity);
  }

  // Stock delta: how much stock changes due to the edit.
  const stockDelta: Record<string, number> = {};
  const allProductIds = new Set([
    ...Object.keys(previousStockDelta),
    ...Object.keys(updatedStockDelta),
  ]);
  for (const pid of allProductIds) {
    const prevDelta = previousStockDelta[pid] || 0;
    const updDelta = updatedStockDelta[pid] || 0;
    stockDelta[pid] = round2(updDelta - prevDelta);
  }

  const amountDelta = round2(updatedTotal - previousTotal);

  return { stockDelta, amountDelta, updatedSaleItems };
}

/**
 * Refund a sale's line items.
 *
 * @param originalItems  The original line items of the sale (quantity + unit price).
 * @param refundedItems  The items being returned (quantity + unit price they sold at).
 * @param financials     Optional sale context (subtotal/discount/tax/delivery fee) used
 *                       to prorate the discount, tax and delivery-fee portion of the refund.
 *                       Omit to get the gross refund amount with no proration.
 * @returns
 *   - stockDelta: per-product stock change (positive = stock returned to inventory).
 *   - refundAmount: gross returned subtotal (unitPrice * quantity, rounded).
 *   - discountDeducted, taxDeducted, deliveryFeeRefunded: prorated shares of the
 *     original sale's discount/tax/delivery fee.
 *   - netRefundAmount: refundAmount - discountDeducted + taxDeducted + deliveryFeeRefunded (>= 0).
 *   - refundedItems: pass-through of the refunded line items (with prices) for the record.
 *
 * The stock delta is positive because returning an item restores stock that the
 * original sale had removed. The caller is responsible for validating that
 * refunded quantities do not exceed the original quantities.
 */
export function refundSale(
  originalItems: SaleLine[],
  refundedItems: SaleLine[],
  financials?: RefundFinancials,
): {
  stockDelta: Record<string, number>;
  refundAmount: number;
  discountDeducted: number;
  taxDeducted: number;
  deliveryFeeRefunded: number;
  netRefundAmount: number;
  refundedItems: SaleLine[];
} {
  const grossRaw = refundedItems.reduce(
    (acc, it) => acc + (Number(it.unitPrice) || 0) * (Number(it.quantity) || 0),
    0,
  );
  const refundAmount = round2(grossRaw);

  let discountDeducted = 0;
  let taxDeducted = 0;
  let deliveryFeeRefunded = 0;
  let netRefundAmount = refundAmount;

  if (financials) {
    const base = Number(financials.saleSubtotal) || 0;
    const discount = Number(financials.discount) || 0;
    const tax = Number(financials.tax) || 0;
    deliveryFeeRefunded = round2(Math.max(0, Number(financials.deliveryFeeRefunded) || 0));
    discountDeducted = base > 0 && discount > 0 ? round2((grossRaw / base) * discount) : 0;
    taxDeducted = base > 0 && tax > 0 ? round2((grossRaw / base) * tax) : 0;
    netRefundAmount = round2(Math.max(0, grossRaw - discountDeducted + taxDeducted + deliveryFeeRefunded));
  }

  const stockDelta: Record<string, number> = {};
  for (const item of refundedItems) {
    // Returning items increases stock: positive delta
    stockDelta[item.productId] = round2((stockDelta[item.productId] || 0) + (Number(item.quantity) || 0));
  }

  void originalItems; // retained for API clarity / future validation; not used in the calculation

  return {
    stockDelta: round2Object(stockDelta),
    refundAmount,
    discountDeducted,
    taxDeducted,
    deliveryFeeRefunded,
    netRefundAmount,
    refundedItems: [...refundedItems],
  };
}

/**
 * Process a GRN (Goods Receipt Note) receipt line.
 *
 * @param poLine            The purchase order line (ordered qty + PO unit price).
 * @param receivedQty       Quantity received on this receipt (== stock increment).
 * @param receivedUnitPrice Price per unit at which the items were received.
 * @returns stockIncrement, isFullyDelivered, and price-adjustment info.
 *
 * `isFullyDelivered` reflects whether `receivedQty` meets/exceeds the ordered
 * quantity. For cumulative receipts, pass the cumulative received total so the
 * flag reads "the line is now fully received".
 */
export function processGRN(
  poLine: POLine,
  receivedQty: number,
  receivedUnitPrice: number,
): {
  stockIncrement: number;
  isFullyDelivered: boolean;
  hasPriceAdjustment: boolean;
  priceAdjustmentPerUnit: number;
} {
  const stockIncrement = Number(receivedQty) || 0;
  const isFullyDelivered = stockIncrement >= (Number(poLine.quantityOrdered) || 0);
  const priceAdjustmentPerUnit = round2(receivedUnitPrice - (Number(poLine.unitPrice) || 0));
  const hasPriceAdjustment = priceAdjustmentPerUnit !== 0;

  return {
    stockIncrement,
    isFullyDelivered,
    hasPriceAdjustment,
    priceAdjustmentPerUnit,
  };
}

/** Helper to round all values in a stock delta object. */
function round2Object(obj: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      result[key] = round2(obj[key]);
    }
  }
  return result;
}
