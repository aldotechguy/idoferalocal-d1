/** Prices are integer kobo; an unpriced item remains visible but is not purchasable. */
export function hasMallPrice(price: number): boolean {
  return Number.isSafeInteger(price) && price > 0;
}

/** Stock visibility is independent of pricing and purchase eligibility. */
export function mallStockLabel(stock: number): string {
  if (stock <= 0) return 'Out of stock';
  return `${stock <= 10 ? 'Only ' : ''}${stock.toLocaleString('en-NG')} left`;
}

export function mallUnavailableLabel(product: { stock: number; price: number }): string {
  if (product.stock <= 0) return 'Out of stock';
  return hasMallPrice(product.price) ? 'Unavailable' : 'Price unavailable';
}