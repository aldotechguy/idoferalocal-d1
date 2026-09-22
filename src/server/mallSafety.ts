import type { MallExecutor, MallStmt } from './mallApi.js';

/** Additive schema: safe for existing Node and D1 databases. */
export const MALL_SAFETY_DDL = [
  `CREATE TABLE IF NOT EXISTS mall_write_guards (id TEXT PRIMARY KEY, valid INTEGER NOT NULL CONSTRAINT mall_state_conflict CHECK(valid = 1))`,
  `CREATE TABLE IF NOT EXISTS mall_checkout_attempts (attempt_key TEXT PRIMARY KEY, session_id TEXT NOT NULL, request_json TEXT NOT NULL, order_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL)`,
  // Buy-again walks only this browser's orders. Cover each hop so unrelated
  // sessions, order items and payments do not contribute to rows read.
  `CREATE INDEX IF NOT EXISTS idx_mall_checkout_session_order ON mall_checkout_attempts (session_id, order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_mall_order_items_order_product ON mall_order_items (mall_order_id, product_id)`,
  `CREATE INDEX IF NOT EXISTS idx_payments_order_status ON payments (order_id, status)`,
  // Sync-mirror write path (sites-worker PATCH + Node PATCH): bounds the delta
  // read to rows written after a composite (updated_at, collection, document_id)
  // watermark instead of scanning the whole document store per staff edit.
  `CREATE INDEX IF NOT EXISTS idx_app_documents_owner_updated ON app_documents (owner_id, updated_at, collection, document_id)`,
  // Stock-movement restock lookups: the newArrivals rail correlates
  // lastRestockSql against every product row; a covering index lets each
  // aggregate run entirely from the index without touching the table heap.
  // List order: product_id first (seek), then type/qty filters (index-only),
  // then created_at DESC (aggregate reads newest-first).
  `CREATE INDEX IF NOT EXISTS idx_stock_movements_product_type_qty_time ON stock_movements (product_id, type, qty, new_stock, prev_stock, created_at DESC)`,
  // Sales status lookup: top-sellers and product-detail sold_qty aggregates
  // join sale_items -> sales and filter on status. A plain status index
  // lets the planner filter sales by status before touching the table.
  `CREATE INDEX IF NOT EXISTS idx_sales_status ON sales (status)`,
  // --- Snapshot ORDER BY coverage -------------------------------------------
  // Every one of these serves the full-snapshot builder, which reads each
  // collection with `ORDER BY <column> DESC LIMIT <cap>`. Without an index on
  // the ORDER BY column SQLite scans the WHOLE table and sorts it in a temp
  // B-tree before applying the LIMIT, so the row caps bound the payload but not
  // a single row read. With these, the scan becomes a backwards index walk that
  // stops at the cap. (audit_logs/money_movements/expenses/sales already had
  // usable indexes; these are the ones that did not.)
  `CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_pricing_history_created ON pricing_history (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_delivery_orders_created ON delivery_orders (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_held_orders_created ON held_orders (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_whatsapp_preorders_created ON whatsapp_preorders (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_purchases_created ON purchases (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_customers_created ON customers (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_products_updated ON products (updated_at DESC)`,
  // Staff order list: `ORDER BY o.created_at DESC LIMIT ? OFFSET ?` could not
  // stop early without this, so every page read and sorted the whole table.
  `CREATE INDEX IF NOT EXISTS idx_mall_orders_created ON mall_orders (created_at DESC)`,
  // Maintenance sweeps: expired rate-limit rows and the bounded metric history.
  `CREATE INDEX IF NOT EXISTS idx_mall_rate_limits_expires ON mall_rate_limits (expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_mall_metrics_day ON mall_metrics (day DESC, metric)`,
  // --- Dead-weight indexes ---------------------------------------------------
  // `products` carried two indexes no query filters on, and D1 charges a row
  // written for every index entry a write touches — so both simply added a row
  // written to each stock change (i.e. to every checkout line) and to every
  // product edit:
  //   * idx_products_mall (is_mall_listed, stock_qty): the storefront keys
  //     visibility off `status` only, and mall-operations records that legacy
  //     `is_mall_listed` values are ignored (the staff listing PATCH compares the
  //     column by primary key, which never uses this index).
  //   * idx_products_status (status): a strict prefix of the (status, …) indexes
  //     below, which SQLite uses instead.
  // Dropped rather than never created, so already-provisioned databases converge.
  `DROP INDEX IF EXISTS idx_products_mall`,
  `DROP INDEX IF EXISTS idx_products_status`,
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
  // Visibility + merchandising order + the two facet columns the category/brand
  // lists group by. Each of these leads with `status`, so the standalone
  // `idx_products_status (status)` this list used to carry was a pure prefix of
  // them: SQLite plans `WHERE status = 'Active'` against these instead (verified
  // with EXPLAIN QUERY PLAN), and all it ever did was add one more index entry to
  // write on every product status change. Dropped in MALL_SAFETY_DDL.
  `CREATE INDEX IF NOT EXISTS idx_products_status_created ON products (status, created_at DESC, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_products_status_category ON products (status, category_name)`,
  `CREATE INDEX IF NOT EXISTS idx_products_status_brand ON products (status, brand)`,

  // Top-sellers ranking joins sale_items -> sales per candidate product.
  // Without a product_id index the planner drove that subquery off
  // idx_sale_items_sale and read EVERY sale_items row for EVERY candidate
  // product, which is what produced multi-million rows-read figures on the
  // home rail. Leading with product_id turns each lookup into a seek, and
  // the trailing qty covers the SUM without touching the table.
  `CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items (product_id, sale_id, qty)`,
  // Same aggregate, one hop shorter: carrying qty after product_id lets the
  // SUM be served entirely from THIS index -- `SEARCH si USING COVERING INDEX
  // idx_sale_items_product_sale_qty`, so the sale_items table itself is never
  // read. The paired `sales` status/join check then costs one primary-key seek
  // per matching sale line, which is why the rail dropped from ~1.8K reads to a
  // few hundred. This supersedes idx_sale_items_product for this aggregate.
  `CREATE INDEX IF NOT EXISTS idx_sale_items_product_sale_qty ON sale_items (product_id, sale_id, qty)`,
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