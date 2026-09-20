import type { MallExecutor, MallStmt } from './mallApi.js';

/** Additive schema: safe for existing Node and D1 databases. */
export const MALL_SAFETY_DDL = [
  `CREATE TABLE IF NOT EXISTS mall_write_guards (id TEXT PRIMARY KEY, valid INTEGER NOT NULL CONSTRAINT mall_state_conflict CHECK(valid = 1))`,
  `CREATE TABLE IF NOT EXISTS mall_checkout_attempts (attempt_key TEXT PRIMARY KEY, session_id TEXT NOT NULL, request_json TEXT NOT NULL, order_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL)`,
  // Sync-mirror write path (sites-worker PATCH + Node PATCH): bounds the delta
  // read to rows written after a composite (updated_at, collection, document_id)
  // watermark instead of scanning the whole document store per staff edit.
  `CREATE INDEX IF NOT EXISTS idx_app_documents_owner_updated ON app_documents (owner_id, updated_at, collection, document_id)`,
];

/**
 * Catalog read indexes. Visibility is `status = 'Active'` (see mallApi VISIBLE),
 * so every catalog request previously scanned the whole `products` table for the
 * page query, the total COUNT, the category list and the brand list.
 *
 * `products` already carries `status` in the shipped schema; the column list is
 * kept as a guarded additive ALTER so a fresh or older database ends up
 * identical to an upgraded one. The indexes are created afterwards.
 */
export const MALL_CATALOG_INDEX_COLUMNS: ReadonlyArray<{name: string; ddl: string}> = [
  { name: 'status', ddl: "ALTER TABLE products ADD COLUMN status TEXT DEFAULT 'Active' NOT NULL" },
];

export const MALL_CATALOG_INDEXES: string[] = [
  // The visibility predicate itself, plus the default merchandising order.
  `CREATE INDEX IF NOT EXISTS idx_products_status ON products (status)`,
  `CREATE INDEX IF NOT EXISTS idx_products_status_created ON products (status, created_at DESC, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_products_status_category ON products (status, category_name)`,
  `CREATE INDEX IF NOT EXISTS idx_products_status_brand ON products (status, brand)`,
];

/** A failed assertion aborts the entire batch, including all earlier writes. */
export function assertSql(condition: string, params: unknown[] = []): MallStmt[] {
  const id = crypto.randomUUID();
  return [
    { sql: `INSERT INTO mall_write_guards (id, valid) VALUES (?, CASE WHEN (${condition}) THEN 1 ELSE 0 END)`, params: [id, ...params] },
    { sql: 'DELETE FROM mall_write_guards WHERE id = ?', params: [id] },
  ];
}

export async function runOrderBatch(exec: MallExecutor, row: any, statements: MallStmt[]) {
  const guard = assertSql(`EXISTS (SELECT 1 FROM mall_orders o JOIN payments p ON p.order_id = o.id
    WHERE o.id = ? AND o.status = ? AND o.linked_sale_id IS ? AND o.total_kobo = ?
    AND o.delivery_address_json IS ? AND p.id = ? AND p.status = ? AND p.raw_json IS ?)`,
  [row.id, row.status, row.linked_sale_id, row.total_kobo, row.delivery_address_json,
    row.payment_id, row.payment_status, row.payment_raw_json]);
  try { return await exec.runBatch([...guard, ...statements]); }
  catch (error) {
    if (String(error).includes('mall_state_conflict')) {
      throw Object.assign(new Error('Order changed. Refresh it before retrying this operation.'), { status: 409 });
    }
    throw error;
  }
}