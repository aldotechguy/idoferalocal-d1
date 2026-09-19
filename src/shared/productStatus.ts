/** Legacy stock labels must not control catalog visibility. */
export function catalogStatus(status?: string): 'Active' | 'Archived' {
  return status === 'Archived' ? 'Archived' : 'Active';
}

export function productStockLabel(product: {status: string; currentStock: number; minimumStockLevel: number}) {
  if (product.status === 'Archived') return 'Archived';
  if (product.currentStock <= 0) return 'Out of Stock';
  return product.currentStock <= product.minimumStockLevel ? 'Low Stock' : 'Active';
}