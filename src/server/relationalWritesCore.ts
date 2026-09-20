/** Phase 4 — relational write router part 1: core entities. */
import { s } from './relationalMapper.js';
import { productToRow, customerToRow, supplierToRow, saleToRows, purchaseToRows } from './relationalMapper.js';

export type SqlStmt = { sql: string; params: any[] };
const cols = (row: Record<string, unknown>) => Object.keys(row);
const ph = (row: Record<string, unknown>) => Object.keys(row).map(() => '?').join(', ');
const vals = (row: Record<string, unknown>) => Object.values(row);
/** Every column except the identity key(s) and immutable created_at stays in sync on upsert. */
const syncCols = (row: Record<string, unknown>, keys: string[] = ['id']) =>
  Object.keys(row).filter((c) => !keys.includes(c) && c !== 'created_at');
const upSuffix = (conflict: string, updateCols: string[]) =>
  `ON CONFLICT(${conflict}) DO UPDATE SET ${updateCols.map((c) => `${c}=excluded.${c}`).join(', ')}`;

/**
 * No-op guard: an unchanged re-push must touch zero rows (0 changes), so a
 * repeated automatic-save batch costs a lookup, not a write and a trigger.
 * Comparing per-column avoids pulling JSON1 into the write path; `IS NOT`
 * compares NULLs as distinct values, matching SQLite equality semantics for
 * the nullable columns these tables use.
 */
const noWriteSuffix = (table: string, updateCols: string[]) =>
  updateCols.length
    ? ` WHERE ${updateCols.map((c) => `excluded.${c} IS NOT ${table}.${c}`).join(' OR ')}`
    : '';

function upsert(table: string, row: Record<string, unknown>, conflict: string, updateCols: string[]): SqlStmt {
  return { sql: `INSERT INTO ${table} (${cols(row).join(', ')}) VALUES (${ph(row)}) ${upSuffix(conflict, updateCols)}${noWriteSuffix(table, updateCols)}`, params: vals(row) };
}

/** Core collections: products, customers, suppliers, sales, purchases. */
export function coreUpsert(collection: string, document: any): SqlStmt[] | null {
  if (!document || typeof document !== 'object' || !document.id) return [];
  const id = s(document.id);
  switch (collection) {
    case 'products': {
      const row = productToRow(document, new Date().toISOString());
      return [
        // Same category repeats on every product of that category; dedupe within
        // the batch lookup so a 10-product push costs 1 category probe, not 10.
        { sql: `INSERT INTO categories (id, name, slug, parent_id, image_url) VALUES (?, ?, ?, NULL, NULL) ON CONFLICT(id) DO NOTHING`, params: [row.category_id, row.category_name, String(row.category_name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-')] },
        upsert('products', row, 'id', syncCols(row)),
      ];
    }
    case 'customers':
      return [upsert('customers', customerToRow(document, new Date().toISOString()), 'id', syncCols(customerToRow(document, new Date().toISOString())))];
    case 'suppliers':
      return [upsert('suppliers', supplierToRow(document, new Date().toISOString()), 'id', syncCols(supplierToRow(document, new Date().toISOString())))];
    case 'sales': {
      const { header, lines } = saleToRows(document);
      const stmts: SqlStmt[] = [upsert('sales', header, 'id', syncCols(header))];
      // Header + deterministic `${id}-item-${i}` line ids make this safe: a line
      // id can only exist for this sale, so deleting only ids outside the new
      // set removes orphans without touching unchanged rows (the old blanket
      // DELETE rewrote every line on every sale edit).
      const lineIds = lines.map((line) => line.id);
      stmts.push(lineIds.length
        ? { sql: `DELETE FROM sale_items WHERE sale_id = ? AND id NOT IN (${lineIds.map(() => '?').join(', ')})`, params: [id, ...lineIds] }
        : { sql: `DELETE FROM sale_items WHERE sale_id = ?`, params: [id] });
      for (const line of lines) stmts.push(upsert('sale_items', line, 'id', syncCols(line)));
      return stmts;
    }
    case 'purchases': {
      const { header, lines, receipts } = purchaseToRows(document);
      const stmts: SqlStmt[] = [upsert('purchases', header, 'id', syncCols(header))];
      const lineIds = lines.map((line) => line.id);
      stmts.push(lineIds.length
        ? { sql: `DELETE FROM purchase_items WHERE purchase_id = ? AND id NOT IN (${lineIds.map(() => '?').join(', ')})`, params: [id, ...lineIds] }
        : { sql: `DELETE FROM purchase_items WHERE purchase_id = ?`, params: [id] });
      for (const line of lines) stmts.push(upsert('purchase_items', line, 'id', syncCols(line)));
      const receiptIds = receipts.map((r) => r.id);
      stmts.push(receiptIds.length
        ? { sql: `DELETE FROM receiving_history WHERE purchase_id = ? AND id NOT IN (${receiptIds.map(() => '?').join(', ')})`, params: [id, ...receiptIds] }
        : { sql: `DELETE FROM receiving_history WHERE purchase_id = ?`, params: [id] });
      for (const r of receipts) stmts.push(upsert('receiving_history', r, 'id', syncCols(r)));
      return stmts;
    }
    default:
      return null;
  }
}

/** Core deletes with cascade children first. */
export function coreDelete(collection: string, documentId: string): SqlStmt[] | null {
  const id = s(documentId);
  if (!id) return [];
  switch (collection) {
    case 'products': return [{ sql: `DELETE FROM products WHERE id = ?`, params: [id] }];
    case 'customers': return [{ sql: `DELETE FROM customers WHERE id = ?`, params: [id] }];
    case 'suppliers': return [{ sql: `DELETE FROM suppliers WHERE id = ?`, params: [id] }];
    case 'sales': return [{ sql: `DELETE FROM sale_items WHERE sale_id = ?`, params: [id] }, { sql: `DELETE FROM sales WHERE id = ?`, params: [id] }];
    case 'purchases': return [{ sql: `DELETE FROM purchase_items WHERE purchase_id = ?`, params: [id] }, { sql: `DELETE FROM receiving_history WHERE purchase_id = ?`, params: [id] }, { sql: `DELETE FROM purchases WHERE id = ?`, params: [id] }];
    default: return null;
  }
}
