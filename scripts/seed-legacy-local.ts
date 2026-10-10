/**
 * Phase 4e — seed a LOCAL legacy document database from the prod backup, so we can
 * exercise the document -> relational bridge exactly as it runs in production.
 * Creates data/d1_storage.db with the legacy tables ONLY (no relational tables):
 * the server is expected to create those and backfill by itself.
 * Run: npx tsx scripts/seed-legacy-local.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SOURCE_FILE } from './etl/lib.js';

const DB_DIR = path.join(process.cwd(), 'data');
fs.mkdirSync(DB_DIR, { recursive: true });
const DB_PATH = path.join(DB_DIR, 'd1_storage.db');
for (const suffix of ['', '-wal', '-shm']) {
  const file = `${DB_PATH}${suffix}`;
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

const sql = fs.readFileSync(SOURCE_FILE, 'utf8');
const docRe = /^INSERT INTO "app_documents"[^V]*VALUES\('((?:''|[^'])*)','((?:''|[^'])*)','((?:''|[^'])*)','((?:''|[^'])*)',(\d+)\);?\s*$/;
const unesc = (v: string) => v.replace(/''/g, "'");
const docRows: [string, string, string, string, number][] = [];
const userRows: string[] = [];
for (const line of sql.split('\n')) {
  const t = line.trim();
  if (!t) continue;
  if (t.startsWith('INSERT INTO "app_users"')) { userRows.push(t); continue; }
  if (!t.startsWith('INSERT INTO "app_documents"')) continue;
  const m = t.match(docRe);
  if (!m) continue;
  docRows.push([unesc(m[1]), unesc(m[2]), unesc(m[3]), unesc(m[4]), Number(m[5])]);
}

const db = new DatabaseSync(DB_PATH);
db.exec(`CREATE TABLE IF NOT EXISTS app_documents (
  owner_id TEXT NOT NULL, collection TEXT NOT NULL, document_id TEXT NOT NULL,
  payload TEXT NOT NULL, updated_at INTEGER,
  PRIMARY KEY (owner_id, collection, document_id));`);
db.exec(`CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL UNIQUE, username TEXT UNIQUE,
  display_name TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Active',
  avatar_url TEXT, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 100000, is_super_admin INTEGER NOT NULL DEFAULT 0,
  is_protected INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_login TEXT,
  password_last_changed TEXT);`);
db.exec(`CREATE TABLE IF NOT EXISTS sync_revisions (
  owner_id TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER);`);

db.exec('BEGIN;');
const insDoc = db.prepare('INSERT OR REPLACE INTO app_documents (owner_id, collection, document_id, payload, updated_at) VALUES (?, ?, ?, ?, ?)');
for (const r of docRows) insDoc.run(r[0], r[1], r[2], r[3], r[4]);
for (const u of userRows) db.exec(u);
db.prepare('INSERT OR REPLACE INTO sync_revisions (owner_id, revision, updated_at) VALUES (?, ?, ?)')
  .run('idofera-business', 1770000000000, 1770000000000);
db.exec('COMMIT;');

const count = db.prepare('SELECT COUNT(*) AS n FROM app_documents').get() as any;
const users = db.prepare('SELECT COUNT(*) AS n FROM app_users').get() as any;
const tables = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('products','sales','sale_items')").get() as any;
console.log(`legacy db seeded -> ${DB_PATH}`);
console.log(`raw document rows: ${count.n}, users: ${users.n}, relational tables present (expect 0): ${tables.n}`);
db.close();
