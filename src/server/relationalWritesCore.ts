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

function upsert(table: string, row: Record<string, unknown>, conflict: string, updateCols: string[]): SqlStmt {
  return { sql: `INSERT INTO ${table} (${cols(row).join(', ')}) VALUES (${ph(row)}) ${upSuffix(conflict, updateCols)}`, params: vals(row) };
}

/** Core collections: products, customers, suppliers, sales, purchases. */
export function coreUpsert(collection: string, document: any): SqlStmt[] | null {
  if (!document || typeof document !== 'object' || !document.id) return [];
  const id = s(document.id);
  switch (collection) {
    case 'products': {
      const row = productToRow(document, new Date().toISOString());
      return [
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
      stmts.push({ sql: `DELETE FROM sale_items WHERE sale_id = ?`, params: [id] });
      for (const line of lines) stmts.push(upsert('sale_items', line, 'id', syncCols(line)));
      return stmts;
    }
    case 'purchases': {
      const { header, lines, receipts } = purchaseToRows(document);
      const stmts: SqlStmt[] = [upsert('purchases', header, 'id', syncCols(header))];
      stmts.push({ sql: `DELETE FROM purchase_items WHERE purchase_id = ?`, params: [id] });
      for (const line of lines) stmts.push(upsert('purchase_items', line, 'id', syncCols(line)));
      stmts.push({ sql: `DELETE FROM receiving_history WHERE purchase_id = ?`, params: [id] });
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
