/** Legacy stock labels must not control catalog visibility. */
export function catalogStatus(status?: string): 'Active' | 'Archived' {
  return status === 'Archived' ? 'Archived' : 'Active';
}

/**
 * Clearance / non-inventory test.
 *
 * A clearance sale line is not a real catalogue product: POS mints a throwaway id
 * (`clearance-<ts>-<rand>`) and `sku === 'CLEARANCE'`, and it never moves stock
 * (`AppContext` skips `adjustStock` for these). The three signals below are the
 * same three the POS cart and refund paths check, so a line is clearance if ANY
 * is true. Used by the ETL, the relational mapper and the write path so a
 * clearance item is never materialised as an active `products` row anywhere.
 */
export function isClearanceItem(item: {isClearance?: unknown; productId?: unknown; sku?: unknown} | null | undefined): boolean {
  if (!item) return false;
  if (item.isClearance === true || item.isClearance === 1 || item.isClearance === 'true') return true;
  if (typeof item.productId === 'string' && item.productId.startsWith('clearance-')) return true;
  return typeof item.sku === 'string' && item.sku.trim().toUpperCase() === 'CLEARANCE';
}

export function productStockLabel(product: {status: string; currentStock: number; minimumStockLevel: number}) {
  if (product.status === 'Archived') return 'Archived';
  if (product.currentStock <= 0) return 'Out of Stock';
  return product.currentStock <= product.minimumStockLevel ? 'Low Stock' : 'Active';
}