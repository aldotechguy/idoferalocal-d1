/**
 * Phase 4 — generate src/server/relationalDdl.ts from the drizzle migration.
 * Single source of truth for the relational schema: drizzle/0000_unified-relational.sql
 * Emitting a .ts module (instead of .json) keeps the edge-worker bundle free of
 * import-attribute / JSON-loader differences between esbuild and wrangler.
 * Run: npx tsx scripts/etl/gen-ddl.ts
 */
import fs from 'node:fs';

const sql = fs.readFileSync('./drizzle/0000_unified-relational.sql', 'utf8');
const parts = sql
  .split('--> statement-breakpoint')
  .map((x) => x.trim())
  .filter(Boolean);
const ddls = parts
  .filter((x) => /^CREATE TABLE/i.test(x))
  .map((x) =>
    x
      .split('`')
      .join('')
      .split(/\s+/)
      .join(' ')
      // drizzle emits `CREATE TABLE x (`, which throws on any pre-existing table.
      // Bootstrap must be re-runnable (legacy db, partial creation, D1 already provisioned).
      .replace(/^CREATE TABLE\s+(?!IF NOT EXISTS)(\S+)/i, 'CREATE TABLE IF NOT EXISTS $1')
      .trim(),
  );

const indexSql = parts
  .filter((x) => /^CREATE (UNIQUE )?INDEX/i.test(x))
  .map((x) =>
    x
      .split('`')
      .join('')
      .split(/\s+/)
      .join(' ')
      .replace(/^CREATE (UNIQUE )?INDEX\s+(\S+)\s+ON/i, (_m, unique, name) => `CREATE ${unique || ''}INDEX IF NOT EXISTS ${name} ON`)
      .trim(),
  );

const out = `/**
 * AUTO-GENERATED — do not edit by hand.
 * Source: drizzle/0000_unified-relational.sql
 * Regenerate: npx tsx scripts/etl/gen-ddl.ts
 * Used by server.ts (node:sqlite) AND sites-worker.ts (Cloudflare D1).
 */
export const RELATIONAL_DDL: string[] = ${JSON.stringify(ddls, null, 2)};

/** Indexes (idempotent form) — applied after the tables exist. */
export const RELATIONAL_INDEXES: string[] = ${JSON.stringify(indexSql, null, 2)};
`;

fs.writeFileSync('./src/server/relationalDdl.ts', out);
if (fs.existsSync('./src/server/relationalDdl.json')) fs.unlinkSync('./src/server/relationalDdl.json');
console.log('tables:', ddls.length, 'indexes:', indexSql.length, '-> src/server/relationalDdl.ts');
