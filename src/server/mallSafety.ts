import type { MallExecutor, MallStmt } from './mallApi.js';

/** Additive schema: safe for existing Node and D1 databases. */
export const MALL_SAFETY_DDL = [
  `CREATE TABLE IF NOT EXISTS mall_write_guards (id TEXT PRIMARY KEY, valid INTEGER NOT NULL CONSTRAINT mall_state_conflict CHECK(valid = 1))`,
  `CREATE TABLE IF NOT EXISTS mall_checkout_attempts (attempt_key TEXT PRIMARY KEY, session_id TEXT NOT NULL, request_json TEXT NOT NULL, order_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL)`,
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