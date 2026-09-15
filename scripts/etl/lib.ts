/** ETL part 1/4: preamble + helpers + dump parser + D1 writer. */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
dotenv.config();
export const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '35b307711376954341708cbea8080dcc';
export const DATABASE_ID = process.env.CLOUDFLARE_D1_DATABASE_ID_TARGET || '3a3eb157-5aa5-419a-a8ce-2eade2afc436';
export const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
export const DRY_RUN = process.argv.includes('--dry-run');
export const SOURCE_FILE = path.join(process.cwd(), 'backups', 'idofera-d1-2026-09-15.sql');
export const toKobo = (n: unknown): number => {
  const v = typeof n === 'number' ? n : typeof n === 'string' ? Number(n) : 0;
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100);
};
export const str = (v: unknown, fb = ''): string => (v === null || v === undefined ? fb : String(v));
export const num = (v: unknown, fb = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fb;
};
export const bool01 = (v: unknown): number => (v === true || v === 1 || v === 'true' ? 1 : 0);
export const nowIso = (): string => new Date().toISOString();
export const slugify = (s: string): string =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'uncategorized';
export function cleanImages(images: unknown): string[] {
  if (!Array.isArray(images)) return [];
  return (images as unknown[]).filter((u) => typeof u === 'string' && !u.startsWith('data:')).slice(0, 8) as string[];
}
export function unwrapSettings(payload: any): any {
  let cur = payload;
  for (let i = 0; i < 25 && cur && typeof cur === 'object'; i++) {
    if (typeof cur.storeName === 'string') return cur;
    if (cur['0'] && typeof cur['0'] === 'object') { cur = cur['0']; continue; }
    break;
  }
  return null;
}
export type DocRow = { owner: string; collection: string; docId: string; payload: string; updatedAt: number };
export type Stmt = { sql: string; params?: any[] };
export function parseDump(sql: string): { docs: DocRow[]; userInserts: string[] } {
  // One logical doc = latest row per (owner_id, collection, document_id) — the live app
  // uses INSERT OR REPLACE semantics per owner; the export keeps both owners' copies.
  // Owner priority: idofera-business (live) > default_owner > test_owner.
  const latest = new Map<string, DocRow>();
  const docs: DocRow[] = [];
  const userInserts: string[] = [];
  const OWNER_RANK: Record<string, number> = { 'idofera-business': 3, default_owner: 2, test_owner: 1 };
  const docRe = /^INSERT INTO "app_documents"[^V]*VALUES\('((?:''|[^'])*)','((?:''|[^'])*)','((?:''|[^'])*)','((?:''|[^'])*)',(\d+)\);?\s*$/;
  for (const line of sql.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('INSERT INTO "app_users"')) { userInserts.push(t); continue; }
    if (!t.startsWith('INSERT INTO "app_documents"')) continue;
    const m = t.match(docRe);
    if (!m) { console.warn('UNPARSED LINE:', t.slice(0, 160)); continue; }
    const unesc = (s: string) => s.replace(/''/g, "'");
    const row: DocRow = { owner: unesc(m[1]), collection: m[2], docId: unesc(m[3]), payload: unesc(m[4]), updatedAt: Number(m[5]) };
    const key = `${row.owner}|${row.collection}|${row.docId}`;
    const prev = latest.get(key);
    if (!prev || row.updatedAt >= prev.updatedAt) latest.set(key, row);
  }
  // Collapse cross-owner duplicates: same (collection, document_id) under two owners
  // is the same logical record synced from two devices — keep the highest-rank owner.
  const byDoc = new Map<string, DocRow>();
  for (const row of latest.values()) {
    const key = `${row.collection}|${row.docId}`;
    const prev = byDoc.get(key);
    if (!prev) { byDoc.set(key, row); continue; }
    const rank = (o: string) => OWNER_RANK[o] ?? 0;
    if (rank(row.owner) > rank(prev.owner) || (rank(row.owner) === rank(prev.owner) && row.updatedAt >= prev.updatedAt)) {
      byDoc.set(key, row);
    }
  }
  for (const row of byDoc.values()) docs.push(row);
  (parseDump as any).dedupInfo = { rawRows: latest.size + userInserts.length, logicalDocs: docs.length };
  return { docs, userInserts };
}
export async function executeD1(statements: Stmt[]) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`;
  for (const stmt of statements) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: stmt.sql, params: stmt.params || [] }),
    });
    const data = (await res.json()) as any;
    if (!res.ok || !data.success) {
      console.error('D1 FAILED:', stmt.sql.slice(0, 140), JSON.stringify(data).slice(0, 400));
      throw new Error('D1 execution error');
    }
  }
}
