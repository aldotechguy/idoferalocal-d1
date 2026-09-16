/** Phase 4 — node:sqlite adapter + schema bootstrap for server.ts. */
import type { DatabaseSync } from 'node:sqlite';
import { RELATIONAL_DDL, RELATIONAL_INDEXES } from './relationalDdl.js';
import { MALL_OVERSELL_TRIGGER_SQL, type MallExecutor } from './mallApi.js';


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
  for (const index of RELATIONAL_INDEXES) {
    try {
      db.exec(index.endsWith(';') ? index : `${index};`);
    } catch {
      // index already present or table missing in an older local db — safe to continue
    }
  }
  // Phase 5: oversell is impossible store-wide once this trigger exists.
  try {
    db.exec(MALL_OVERSELL_TRIGGER_SQL.endsWith(';') ? MALL_OVERSELL_TRIGGER_SQL : `${MALL_OVERSELL_TRIGGER_SQL};`);
  } catch {
    // trigger already present — safe to continue
  }
  return RELATIONAL_DDL.length;
}

/**
 * Phase 5 — MallExecutor over node:sqlite. Each batch is a single transaction
 * (BEGIN IMMEDIATE takes the write lock up front, so concurrent checkouts
 * serialize and the oversell trigger can never race).
 */
export function makeNodeMallExecutor(db: DatabaseSync): MallExecutor {
  return {
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
  return [...RELATIONAL_DDL, ...RELATIONAL_INDEXES].map((s) => (s.endsWith(';') ? s : `${s};`));
}
