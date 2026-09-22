/** Phase 4 — node:sqlite adapter + schema bootstrap for server.ts. */
import type { DatabaseSync } from 'node:sqlite';
import { RELATIONAL_DDL, RELATIONAL_INDEXES } from './relationalDdl.js';
import { MALL_OVERSELL_TRIGGER_SQL, type MallExecutor } from './mallApi.js';
import { MALL_SAFETY_DDL, MALL_CATALOG_INDEX_COLUMNS, MALL_CATALOG_INDEXES } from './mallSafety.js';
import { MALL_OPERATIONS_DDL, MALL_MERCH_COLUMNS, MALL_ORDER_COLUMNS, MALL_SCHEMA_VERSION, isDuplicateColumnError, type MallConfig } from './mallOperations.js';


export type Tx = {
  run: (sql: string, params?: any[]) => void;
  all: <T = any>(sql: string, params?: any[]) => T[];
  queryAll: (sql: string, params?: any[]) => Promise<any[]>;
};

export function makeNodeAdapter(db: DatabaseSync): Tx {
  return {
    run: (sql: string, params: any[] = []) => {
      db.prepare(sql).run(...params);
    },
    all: <T = any>(sql: string, params: any[] = []): T[] => {
      return db.prepare(sql).all(...params) as T[];
    },
    queryAll: async (sql: string, params: any[] = []) => {
      return db.prepare(sql).all(...params) as any[];
    },
  };
}

/** Create the relational tables in a local node:sqlite database (idempotent). */
export function ensureRelationalSchemaNode(db: DatabaseSync): number {
  for (const ddl of RELATIONAL_DDL) db.exec(ddl.endsWith(';') ? ddl : `${ddl};`);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const ddl of MALL_OPERATIONS_DDL) db.exec(ddl);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  // Safety DDL second: its DROP INDEX / covering-index statements assume the
  // tables above already exist (mall_rate_limits, mall_metrics, mall_orders).
  for (const ddl of MALL_SAFETY_DDL) db.exec(ddl);
  // #10 merchandising columns: additive, and a duplicate-column error on restart
  // is the expected no-op rather than a failure.
  for (const column of MALL_MERCH_COLUMNS) {
    try { db.exec(`${column.ddl};`); }
    catch (error) { if (!isDuplicateColumnError(error)) throw error; }
  }
  // #16 customer email on orders: additive, same guarded contract as merch columns.
  for (const column of MALL_ORDER_COLUMNS) {
    try { db.exec(`${column.ddl};`); }
    catch (error) { if (!isDuplicateColumnError(error)) throw error; }
  }
  for (const column of MALL_CATALOG_INDEX_COLUMNS) {
    try { db.exec(`${column.ddl};`); }
    catch (error) { if (!isDuplicateColumnError(error)) throw error; }
  }
  for (const index of MALL_CATALOG_INDEXES) {
    try {
      db.exec(index.endsWith(';') ? index : `${index};`);
    } catch {
      // index already present or table missing in an older local db — safe to continue
    }
  }
  for (const index of RELATIONAL_INDEXES) {
    try {
      db.exec(index.endsWith(';') ? index : `${index};`);
    } catch {
      // index already present or table missing in an older local db — safe to continue
    }
  }
  // Phase 5: oversell is impossible store-wide once this trigger exists.
  db.exec(MALL_OVERSELL_TRIGGER_SQL.endsWith(';') ? MALL_OVERSELL_TRIGGER_SQL : `${MALL_OVERSELL_TRIGGER_SQL};`);
// NOTE: intentionally no MALL_SCHEMA_VERSION marker here. That marker means
  // "the deployed Worker bootstrap ran", and this Node bootstrap creates a
  // smaller table set (no app_users/app_sessions), so claiming the version would
  // make the Worker skip tables it still needs to create.
  return RELATIONAL_DDL.length;
}

/**
 * Phase 5 — MallExecutor over node:sqlite. Each batch is a single transaction
 * (BEGIN IMMEDIATE takes the write lock up front, so concurrent checkouts
 * serialize and the oversell trigger can never race).
 */
export function makeNodeMallExecutor(db: DatabaseSync, config?: MallConfig, clientIp?: string): MallExecutor {
  return {
    config, clientIp,
    // #14 — the Node disk store is always available.
    imagesConfigured: true,
    queryAll: async (sql, params = []) => db.prepare(sql).all(...params) as any[],
    runBatch: async (stmts) => {
      db.exec('BEGIN IMMEDIATE;');
      try {
        const changes: number[] = [];
        for (const st of stmts) {
          const result = db.prepare(st.sql).run(...(st.params || [])) as unknown as { changes?: number };
          changes.push(Number(result?.changes ?? 0));
        }
        db.exec('COMMIT;');
        return changes;
      } catch (error) {
        try { db.exec('ROLLBACK;'); } catch { /* transaction already rolled back */ }
        throw error;
      }
    },
  };
}

/** Same bootstrap for Cloudflare D1 (statement-per-call, tolerant). */
export function relationalSchemaStatements(): string[] {
  return [...RELATIONAL_DDL, ...RELATIONAL_INDEXES, ...MALL_OPERATIONS_DDL, ...MALL_SAFETY_DDL,
    ...MALL_MERCH_COLUMNS.map((column) => column.ddl),
    ...MALL_ORDER_COLUMNS.map((column) => column.ddl),
    ...MALL_CATALOG_INDEX_COLUMNS.map((column) => column.ddl),
    ...MALL_CATALOG_INDEXES,
    MALL_OVERSELL_TRIGGER_SQL,
    `INSERT OR IGNORE INTO mall_schema_versions(version, installed_at) VALUES (${MALL_SCHEMA_VERSION}, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  ].map((s) => (s.endsWith(';') ? s : `${s};`));
}
