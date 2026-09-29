/** Prices are integer kobo; an unpriced item remains visible but is not purchasable. */
export function hasMallPrice(price: number): boolean {
  return Number.isSafeInteger(price) && price > 0;
}

/** Stock visibility is independent of pricing and purchase eligibility. */
export function mallStockLabel(stock: number): string {
  if (stock <= 0) return 'Out of stock';
  return `${stock <= 10 ? 'Only ' : ''}${stock.toLocaleString('en-NG')} left`;
}

/**
 * Binary availability for the storefront surfaces that do NOT reveal the exact
 * count: product cards, the header search rows and the product detail page. The
 * exact number is deliberately withheld here and only shown once the item is in
 * the cart (cards) or is in a cart line (cart drawer and cart page).
 */
export function mallAvailabilityLabel(stock: number): string {
  return stock > 0 ? 'In stock' : 'Out of stock';
}

export function mallUnavailableLabel(product: { stock: number; price: number }): string {
  if (product.stock <= 0) return 'Out of stock';
  return hasMallPrice(product.price) ? 'Unavailable' : 'Price unavailable';
}