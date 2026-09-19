/** Preserve ranking within each stock group; never discard catalog records. */
export function arrangeStockRows<T extends {stock: number}>(items: T[], columns: number, maxSoldOut: number): T[][] {
  const width = Math.max(1, Math.floor(columns));
  const cap = Math.max(1, Math.min(width, Math.floor(maxSoldOut)));
  const pending = [...items];
  const rows: T[][] = [];
  while (pending.length) {
    const row: T[] = [];
    let soldOut = 0;
    while (row.length < width && pending.length) {
      const index = soldOut < cap ? 0 : pending.findIndex(item => item.stock > 0);
      if (index < 0) break;
      const [item] = pending.splice(index, 1);
      row.push(item);
      if (item.stock <= 0) soldOut++;
    }
    rows.push(row);
  }
  return rows;
}

export function mallGridColumns(width: number) {
  return width >= 1280 ? 5 : width >= 1024 ? 4 : width >= 640 ? 3 : 2;
}