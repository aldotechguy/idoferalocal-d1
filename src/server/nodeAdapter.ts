/** Phase 4 — node:sqlite adapter + schema bootstrap for server.ts. */
import type { DatabaseSync } from 'node:sqlite';
import { RELATIONAL_DDL, RELATIONAL_INDEXES } from './relationalDdl.js';

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
  return RELATIONAL_DDL.length;
}

/** Same bootstrap for Cloudflare D1 (statement-per-call, tolerant). */
export function relationalSchemaStatements(): string[] {
  return [...RELATIONAL_DDL, ...RELATIONAL_INDEXES].map((s) => (s.endsWith(';') ? s : `${s};`));
}
