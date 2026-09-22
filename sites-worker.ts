interface R2ObjectBody {
  arrayBuffer(): Promise<ArrayBuffer>;
  httpMetadata?: { contentType?: string };
}
interface R2BucketLike {
  put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(key: string): Promise<unknown>;
}

interface Env extends MallConfig {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DB: D1Database;
  MALL_IMAGES?: R2BucketLike;
  GEMINI_API_KEY?: string;
  BOOTSTRAP_ADMIN_EMAIL?: string;
  BOOTSTRAP_ADMIN_USERNAME?: string;
  BOOTSTRAP_ADMIN_PASSWORD?: string;
  RESEND_API_KEY?: string;
  MALL_NOTIFY_EMAIL?: string;
  MALL_EMAIL_FROM?: string;
  /** Bound D1 database ID, set per environment in wrangler.toml (display-only). */
  D1_DATABASE_ID?: string;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

// Phase 4 — relational backend for the edge worker. Wrangler bundles this entry
// with esbuild, which follows imports, so the mapper/DDL/write builders are the
// SAME modules server.ts uses (no more duplicated inline logic).
// Money is INTEGER kobo in D1, naira floats on the wire; frontend contract unchanged.
import { RELATIONAL_DDL, RELATIONAL_INDEXES } from './src/server/relationalDdl.js';
import { buildSnapshot, SNAPSHOT_PUSH_DOC_LIMIT } from './src/server/relationalSnapshot.js';
import {
  upsertToStatements,
  deleteToStatements,
  replaceCollectionStatements,
  backfillStatementsFromDocumentRows,
} from './src/server/relationalWrites.js';
import { handleMallApi, MALL_OVERSELL_TRIGGER_SQL, invalidateMallFacetCache } from './src/server/mallApi.js';
import { handleStaffMallApi, maintainMall } from './src/server/mallOrderAdminApi.js';
import { handleStaffMallListingApi } from './src/server/mallListingApi.js';
import { handleStaffProductImageApi, handlePublicImageRequest } from './src/server/productImageApi.js';
import type { ImageStore } from './src/server/imageStore.js';
import { MALL_OPERATIONS_DDL, MALL_MERCH_COLUMNS, MALL_ORDER_COLUMNS, MALL_SCHEMA_VERSION, isDuplicateColumnError, signMallWebhook, type MallConfig } from './src/server/mallOperations.js';
import { MALL_SAFETY_DDL, MALL_CATALOG_INDEX_COLUMNS, MALL_CATALOG_INDEXES } from './src/server/mallSafety.js';
import { bootstrapAdmin } from './src/server/adminBootstrap.js';
import { handleMallWebhook } from './src/server/mallWebhook.js';
import type { QueryAll } from './src/server/relationalMapper.js';
import { isStaffPage, isPrivateApi, issueEntrance, hasEntrance, revokeEntrance, entranceCookie } from './src/server/staffEntrance.js';

/** Rows out of D1 -> the QueryAll shape the shared mapper expects. */
function makeD1QueryAll(env: Env): QueryAll {
  return async (sql: string, params: any[] = []) => {
    const res = await env.DB.prepare(sql).bind(...params).all<any>();
    return res.results || [];
  };
}

/** #14 — R2-backed image store for the edge runtime. */
function makeR2ImageStore(env: Env): ImageStore | undefined {
  const bucket = env.MALL_IMAGES;
  if (!bucket) return undefined;
  return {
    async put(key, image) {
      await bucket.put(key, image.bytes, { httpMetadata: { contentType: image.contentType } });
    },
    async get(key) {
      const object = await bucket.get(key);
      if (!object) return null;
      const bytes = new Uint8Array(await object.arrayBuffer());
      return { bytes, contentType: object.httpMetadata?.contentType || 'application/octet-stream' };
    },
    async remove(key) { await bucket.delete(key); },
  };
}

/** One row out of D1. */
async function d1Get(env: Env, sql: string, params: any[] = []): Promise<any> {
  const res = await env.DB.prepare(sql).bind(...params).all<any>();
  return res.results?.[0] || null;
}

const ALLOWED_STORES = new Set([
  'products', 'customers', 'suppliers', 'sales', 'purchases', 'expenses',
  'notifications', 'auditLogs', 'stockMovements', 'pricingHistory', 'settings',
  'heldOrders', 'whatsAppPreOrders', 'deliveryOrders', 'moneyMovements',
]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

const encoder = new TextEncoder();
const BUSINESS_OWNER_ID = 'idofera-business';
const SESSION_COOKIE = 'idofera_session';
const PASSWORD_ITERATIONS = 100000;

const toHex = (bytes: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(bytes instanceof ArrayBuffer ? bytes : bytes.buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

const randomHex = (length = 32) => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
};

async function sha256(value: string) {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function hashPassword(password: string, salt: string, iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return toHex(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations },
    key,
    256,
  ));
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

function readCookie(request: Request, name: string) {
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const customHeader = request.headers.get('x-session-token');
  if (customHeader && customHeader.trim()) {
    return customHeader.trim();
  }
  const cookies = request.headers.get('cookie') || '';
  for (const part of cookies.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

function sessionCookie(token: string, maxAge: number) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

type AppUserRow = {
  id: string; email: string; username: string | null; display_name: string; role: string; status: string;
  avatar_url: string | null; password_hash: string; password_salt: string; password_iterations: number;
  is_super_admin: number; is_protected: number; created_at: string; last_login: string | null; password_last_changed: string | null;
};

function publicUser(user: AppUserRow) {
  return {
    id: user.id, email: user.email, username: user.username || undefined, displayName: user.display_name,
    role: user.role, status: user.status, avatarUrl: user.avatar_url || undefined, createdAt: user.created_at,
    lastLogin: user.last_login || undefined, passwordLastChanged: user.password_last_changed || undefined,
    isSuperAdmin: Boolean(user.is_super_admin), isProtected: Boolean(user.is_protected),
  };
}

const schemaReady = new WeakSet<D1Database>();
let relationalBackfilled = false;

/**
 * Row-read guard. `schemaReady` is per-isolate, so before this check every cold
 * isolate replayed the whole bootstrap (~80 DDL statements, plus 5 ALTERs that
 * are expected to throw `duplicate column name`). A matching marker row means
 * the schema is already in place: one primary-key lookup instead.
 */
async function schemaVersionCurrent(env: Env) {
  try {
    const rows = await env.DB.prepare('SELECT 1 AS present FROM mall_schema_versions WHERE version = ?')
      .bind(MALL_SCHEMA_VERSION).all();
    return Boolean(rows.results?.length);
  } catch {
    // The marker table itself is missing, so this is a fresh (or pre-marker) database.
    return false;
  }
}

async function ensureSchema(env: Env) {
  if (schemaReady.has(env.DB)) return;
  if (await schemaVersionCurrent(env)) {
    schemaReady.add(env.DB);
    return;
  }
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_documents (
      owner_id TEXT NOT NULL,
      collection TEXT NOT NULL,
      document_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (owner_id, collection, document_id)
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_app_documents_owner_collection ON app_documents (owner_id, collection)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS sync_revisions (
      owner_id TEXT PRIMARY KEY NOT NULL,
      revision INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_users (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL UNIQUE,
      username TEXT UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Active',
      avatar_url TEXT,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_iterations INTEGER NOT NULL DEFAULT 100000,
      is_super_admin INTEGER NOT NULL DEFAULT 0,
      is_protected INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_login TEXT,
      password_last_changed TEXT
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_app_users_login ON app_users (email, username, status)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_sessions (
      token_hash TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_app_sessions_user_expiry ON app_sessions (user_id, expires_at)`),
    // Phase 4: the 30 relational tables + 23 indexes, same DDL as drizzle/0000.
    ...RELATIONAL_DDL.map((ddl) => env.DB.prepare(ddl.endsWith(';') ? ddl.slice(0, -1) : ddl)),
    ...RELATIONAL_INDEXES.map((sql) => env.DB.prepare(sql.endsWith(';') ? sql.slice(0, -1) : sql)),
    // Phase 5: oversell is impossible store-wide once this trigger exists.
    env.DB.prepare(MALL_OVERSELL_TRIGGER_SQL.endsWith(';') ? MALL_OVERSELL_TRIGGER_SQL.slice(0, -1) : MALL_OVERSELL_TRIGGER_SQL),
  ];
  for (let offset = 0; offset < statements.length; offset += 50) {
    await env.DB.batch(statements.slice(offset, offset + 50));
  }
  await env.DB.batch(MALL_OPERATIONS_DDL.map(sql => env.DB.prepare(sql)));
  // Safety DDL second: its maintenance indexes (mall_rate_limits, mall_metrics)
  // and staff-page indexes assume the operations tables the batch above just
  // created, and its catalog covering indexes assume RELATIONAL_DDL tables.
  await env.DB.batch(MALL_SAFETY_DDL.map(sql => env.DB.prepare(sql)));
  // #10 merchandising columns + the status column the catalog indexes cover:
  // additive guarded ALTERs; a duplicate column is the expected no-op on every
  // start after the first.
  for (const column of [...MALL_MERCH_COLUMNS, ...MALL_ORDER_COLUMNS, ...MALL_CATALOG_INDEX_COLUMNS]) {
    try { await env.DB.prepare(column.ddl).run(); }
    catch (error) { if (!isDuplicateColumnError(error)) throw error; }
  }
  // Catalog read indexes: the visibility predicate, the merchandising order, and
  // the two facet columns the category/brand lists group by.
  for (const index of MALL_CATALOG_INDEXES) {
    try { await env.DB.prepare(index).run(); }
    catch (error) { console.warn('Catalog index skipped:', index, error instanceof Error ? error.message : error); }
  }
  // Record the marker last: the guard above must never pass before the work is done.
  await env.DB.prepare('INSERT OR IGNORE INTO mall_schema_versions(version, installed_at) VALUES (?, ?)')
    .bind(MALL_SCHEMA_VERSION, new Date().toISOString()).run();
  schemaReady.add(env.DB);
}

/** D1 only reports on tables it has; empty relational store + documents means we backfill once. */
async function emptyRelational(env: Env): Promise<boolean> {
  const row = await d1Get(env, 'SELECT (SELECT COUNT(*) FROM products) AS p, (SELECT COUNT(*) FROM sales) AS s');
  return Number(row?.p || 0) === 0 && Number(row?.s || 0) === 0;
}

/**
 * Phase 4 bridge (edge) — when the relational tables are empty but legacy
 * app_documents rows exist (fresh database, or the pre-ETL prod D1), project the
 * documents once. Chunked so it stays inside D1 limits; idempotent per isolate.
 */
async function ensureRelationalBackfill(env: Env): Promise<{ documents: number; statements: number; skipped: number }> {
  const none = { documents: 0, statements: 0, skipped: 0 };
  if (relationalBackfilled) return none;
  if (!(await emptyRelational(env))) {
    relationalBackfilled = true;
    return none;
  }
  const rows = await env.DB.prepare(
    'SELECT owner_id, collection, payload, updated_at FROM app_documents ORDER BY owner_id, collection, document_id',
  ).bind().all<{ collection: string; payload: string; owner_id?: string; updated_at?: number }>();
  const list = rows.results || [];
  if (!list.length) return none;
  const { stmts, skipped } = backfillStatementsFromDocumentRows(list, new Date().toISOString());
  await runStatements(env, toD1Statements(env, stmts));
  relationalBackfilled = true;
  return { documents: list.length, statements: stmts.length, skipped };
}

async function seedUser(env: Env, user: { id: string; email: string; username: string; displayName: string; password: string; superAdmin: boolean }) {
  await ensureSchema(env);
  const existing = await env.DB.prepare('SELECT id FROM app_users WHERE id = ?').bind(user.id).all();
  if (existing.results?.length) return;
  const salt = randomHex(16);
  const hash = await hashPassword(user.password, salt);
  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT OR IGNORE INTO app_users (id, email, username, display_name, role, status, password_hash, password_salt, password_iterations, is_super_admin, is_protected, created_at, password_last_changed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(user.id, user.email, user.username, user.displayName, 'Administrator', 'Active', hash, salt, PASSWORD_ITERATIONS, user.superAdmin ? 1 : 0, user.superAdmin ? 1 : 0, now, now).run();
}

async function ensureAuthSeed(env: Env) {
  await ensureSchema(env);
  if (await d1Get(env, 'SELECT id FROM app_users LIMIT 1')) return;
  const admin = bootstrapAdmin(env);
  if (admin) await seedUser(env, admin);
}

async function ensureBusinessDataOwner(env: Env) {
  const current = await env.DB.prepare('SELECT 1 AS present FROM app_documents WHERE owner_id = ? LIMIT 1').bind(BUSINESS_OWNER_ID).all();
  if (current.results?.length) return;
  const legacy = await env.DB.prepare('SELECT owner_id FROM app_documents WHERE owner_id != ? GROUP BY owner_id ORDER BY COUNT(*) DESC LIMIT 1')
    .bind(BUSINESS_OWNER_ID).all<{ owner_id: string }>();
  const legacyOwner = legacy.results?.[0]?.owner_id;
  if (!legacyOwner) return;
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO app_documents (owner_id, collection, document_id, payload, updated_at) SELECT ?, collection, document_id, payload, updated_at FROM app_documents WHERE owner_id = ?').bind(BUSINESS_OWNER_ID, legacyOwner),
    env.DB.prepare('INSERT OR IGNORE INTO sync_revisions (owner_id, revision, updated_at) SELECT ?, revision, updated_at FROM sync_revisions WHERE owner_id = ?').bind(BUSINESS_OWNER_ID, legacyOwner),
  ]);
}

async function requireAppUser(request: Request, env: Env): Promise<AppUserRow | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const rows = await env.DB.prepare(
    'SELECT u.* FROM app_sessions s JOIN app_users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = ?',
  ).bind(tokenHash, Date.now(), 'Active').all<AppUserRow>();
  return rows.results?.[0] || null;
}

async function createSession(userId: string, env: Env) {
  const token = randomHex(32);
  const now = Date.now();
  const expiresAt = now + 7 * 24 * 60 * 60 * 1000;
  await env.DB.prepare('INSERT INTO app_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), userId, now, expiresAt).run();
  return { token, maxAge: Math.floor((expiresAt - now) / 1000) };
}

async function authLogin(request: Request, env: Env) {
  await ensureAuthSeed(env);
  const body = await readJson(request);
  const identifier = String(body?.identifier || '').trim().toLowerCase();
  const password = String(body?.password || '');
  if (!identifier || !password) return json({ error: 'Email/username and password are required.' }, 400);
  const rows = await env.DB.prepare('SELECT * FROM app_users WHERE lower(email) = ? OR lower(username) = ? LIMIT 1')
    .bind(identifier, identifier).all<AppUserRow>();
  const user = rows.results?.[0];
  if (!user || user.status !== 'Active') return json({ error: 'Invalid credentials or inactive account.' }, 401);
  const candidate = await hashPassword(password, user.password_salt, user.password_iterations);
  if (!safeEqual(candidate, user.password_hash)) return json({ error: 'Invalid credentials or inactive account.' }, 401);
  const lastLogin = new Date().toISOString();
  await env.DB.prepare('UPDATE app_users SET last_login = ? WHERE id = ?').bind(lastLogin, user.id).run();
  const session = await createSession(user.id, env);
  await ensureBusinessDataOwner(env);
  const response = json({ user: publicUser({ ...user, last_login: lastLogin }) });
  response.headers.set('set-cookie', sessionCookie(session.token, session.maxAge));
  await revokeEntrance(request.headers.get('cookie') || '', makeD1QueryAll(env));
  response.headers.append('set-cookie', entranceCookie());
  return response;
}

async function authGoogle(request: Request, env: Env) {
  await ensureAuthSeed(env);
  const body = await readJson(request);
  const accessToken = String(body?.accessToken || '');
  if (!accessToken) return json({ error: 'Google access token is required.' }, 400);
  const googleResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { authorization: `Bearer ${accessToken}` } });
  if (!googleResponse.ok) return json({ error: 'Google authentication could not be verified.' }, 401);
  const googleUser = await googleResponse.json() as { email?: string; email_verified?: boolean };
  if (!googleUser.email || googleUser.email_verified === false) return json({ error: 'A verified Google email is required.' }, 401);
  const rows = await env.DB.prepare('SELECT * FROM app_users WHERE lower(email) = ? LIMIT 1').bind(googleUser.email.toLowerCase()).all<AppUserRow>();
  const user = rows.results?.[0];
  if (!user || user.status !== 'Active') return json({ error: 'This Google account is not registered or is inactive.' }, 403);
  const lastLogin = new Date().toISOString();
  await env.DB.prepare('UPDATE app_users SET last_login = ? WHERE id = ?').bind(lastLogin, user.id).run();
  const session = await createSession(user.id, env);
  await ensureBusinessDataOwner(env);
  const response = json({ user: publicUser({ ...user, last_login: lastLogin }) });
  response.headers.set('set-cookie', sessionCookie(session.token, session.maxAge));
  await revokeEntrance(request.headers.get('cookie') || '', makeD1QueryAll(env));
  response.headers.append('set-cookie', entranceCookie());
  return response;
}

async function authSession(request: Request, env: Env) {
  await ensureAuthSeed(env);
  const user = await requireAppUser(request, env);
  const entranceAllowed = !user && await hasEntrance(request.headers.get('cookie') || '', makeD1QueryAll(env));
  const response = json({ user: user ? publicUser(user) : null, authenticated: Boolean(user), entranceAllowed });
  response.headers.set('cache-control', 'no-store');
  return response;
}

async function authLogout(request: Request, env: Env) {
  await revokeEntrance(request.headers.get('cookie') || '', makeD1QueryAll(env));
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await env.DB.prepare('DELETE FROM app_sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  const response = json({ ok: true });
  response.headers.set('set-cookie', sessionCookie('', 0));
  response.headers.append('set-cookie', entranceCookie());
  return response;
}

async function authUsers(request: Request, env: Env) {
  const actor = await requireAppUser(request, env);
  if (!actor) return json({ error: 'Authentication required.' }, 401);
  const rows = await env.DB.prepare('SELECT * FROM app_users ORDER BY is_super_admin DESC, display_name').all<AppUserRow>();
  return json({ users: (rows.results || []).map(publicUser) });
}

async function upsertAuthUser(request: Request, env: Env) {
  const actor = await requireAppUser(request, env);
  if (!actor || actor.role !== 'Administrator') return json({ error: 'Administrator access required.' }, 403);
  const body = await readJson(request);
  const input = body?.user || {};
  const id = String(input.id || '');
  if (!id || !input.email || !input.displayName) return json({ error: 'User id, email, and display name are required.' }, 400);
  const existingRows = await env.DB.prepare('SELECT * FROM app_users WHERE id = ?').bind(id).all<AppUserRow>();
  const existing = existingRows.results?.[0];
  const password = String(body?.password || input.password || '');
  if (!existing && password.length < 8) return json({ error: 'A password of at least 8 characters is required.' }, 400);
  let salt = existing?.password_salt || randomHex(16);
  let hash = existing?.password_hash || '';
  let changedAt = existing?.password_last_changed || new Date().toISOString();
  if (password) {
    if (password.length < 8) return json({ error: 'Password must be at least 8 characters.' }, 400);
    salt = randomHex(16); hash = await hashPassword(password, salt); changedAt = new Date().toISOString();
  }
  await env.DB.prepare(
    'INSERT INTO app_users (id, email, username, display_name, role, status, avatar_url, password_hash, password_salt, password_iterations, is_super_admin, is_protected, created_at, last_login, password_last_changed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET email=excluded.email, username=excluded.username, display_name=excluded.display_name, role=excluded.role, status=excluded.status, avatar_url=excluded.avatar_url, password_hash=excluded.password_hash, password_salt=excluded.password_salt, password_iterations=excluded.password_iterations, last_login=excluded.last_login, password_last_changed=excluded.password_last_changed',
  ).bind(id, String(input.email).toLowerCase(), input.username || null, input.displayName, input.role || 'Sales Staff', input.status || 'Active', input.avatarUrl || null, hash, salt, PASSWORD_ITERATIONS, existing?.is_super_admin || 0, existing?.is_protected || 0, input.createdAt || existing?.created_at || new Date().toISOString(), input.lastLogin || existing?.last_login || null, changedAt).run();
  return json({ ok: true });
}

async function deleteAuthUser(request: Request, env: Env, id: string) {
  const actor = await requireAppUser(request, env);
  if (!actor || !actor.is_super_admin) return json({ error: 'Super administrator access required.' }, 403);
  if (id === actor.id || id === 'usr-superadmin-idofera') return json({ error: 'Protected account cannot be deleted.' }, 400);
  await env.DB.prepare('DELETE FROM app_users WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

async function changeAuthPassword(request: Request, env: Env) {
  const actor = await requireAppUser(request, env);
  if (!actor) return json({ error: 'Authentication required.' }, 401);
  const body = await readJson(request);
  const targetId = String(body?.targetUserId || actor.id);
  const newPassword = String(body?.newPassword || '');
  const oldPassword = String(body?.oldPassword || '');
  if (newPassword.length < 8) return json({ error: 'Password must be at least 8 characters.' }, 400);
  const rows = await env.DB.prepare('SELECT * FROM app_users WHERE id = ?').bind(targetId).all<AppUserRow>();
  const target = rows.results?.[0];
  if (!target) return json({ error: 'User not found.' }, 404);
  if (targetId === actor.id) {
    const candidate = await hashPassword(oldPassword, actor.password_salt, actor.password_iterations);
    if (!oldPassword || !safeEqual(candidate, actor.password_hash)) return json({ error: 'Current password is incorrect.' }, 401);
  } else {
    if (actor.role !== 'Administrator') return json({ error: 'Administrator access required.' }, 403);
    if (target.is_super_admin && !actor.is_super_admin) return json({ error: 'Only the super administrator can reset this password.' }, 403);
  }
  const salt = randomHex(16);
  const changedAt = new Date().toISOString();
  await env.DB.prepare('UPDATE app_users SET password_hash = ?, password_salt = ?, password_iterations = ?, password_last_changed = ? WHERE id = ?')
    .bind(await hashPassword(newPassword, salt), salt, PASSWORD_ITERATIONS, changedAt, targetId).run();
  if (targetId !== actor.id) await env.DB.prepare('DELETE FROM app_sessions WHERE user_id = ?').bind(targetId).run();
  return json({ ok: true, passwordLastChanged: changedAt });
}

async function readJson(request: Request) {
  try {
    return await request.json() as Record<string, any>;
  } catch {
    return null;
  }
}

async function saveSnapshot(request: Request, env: Env) {
  await ensureSchema(env);
  const ownerId = BUSINESS_OWNER_ID;
  const body = await readJson(request);
  if (!body?.stores || typeof body.stores !== 'object') return json({ error: 'A stores object is required.' }, 400);
  // Bound the restore before touching a single row: a runaway payload would
  // otherwise translate into tens of thousands of statements per request.
  const totalDocuments = Object.values(body.stores).reduce<number>((sum, documents) =>
    sum + (Array.isArray(documents) ? documents.length : 0), 0);
  if (totalDocuments > SNAPSHOT_PUSH_DOC_LIMIT) {
    return json({ error: `Snapshot exceeds the maximum of ${SNAPSHOT_PUSH_DOC_LIMIT} documents. Restore a bounded slice and sync the rest with record PATCHes.` }, 413);
  }

  const revisionRows = await env.DB.prepare('SELECT revision FROM sync_revisions WHERE owner_id = ?')
    .bind(ownerId).all<{ revision: number }>();
  const currentRevision = Number(revisionRows.results?.[0]?.revision || 0);
  const expectedRevision = Number(body.expectedRevision || 0);
  if (expectedRevision !== currentRevision) {
    return json({ error: 'Snapshot revision conflict.', revision: currentRevision }, 409);
  }

  const now = Date.now();
  const revision = Math.max(now, currentRevision + 1);
  const nowIso = new Date(now).toISOString();
  const statements: D1PreparedStatement[] = [];
  const relationalStmts: { sql: string; params: any[] }[] = [];
  for (const [collection, documents] of Object.entries(body.stores)) {
    if (!ALLOWED_STORES.has(collection) || !Array.isArray(documents)) continue;
    statements.push(env.DB.prepare('DELETE FROM app_documents WHERE owner_id = ? AND collection = ?').bind(ownerId, collection));
    // Phase 4: mirror the same full-replace into relational tables.
    relationalStmts.push(...replaceCollectionStatements(collection, documents, nowIso));
    for (const document of documents) {
      if (!document || typeof document !== 'object') continue;
      const documentId = String((document as Record<string, unknown>).id || 'singleton');
      statements.push(
        env.DB.prepare(
          'INSERT INTO app_documents (owner_id, collection, document_id, payload, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner_id, collection, document_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at',
        ).bind(ownerId, collection, documentId, JSON.stringify(document), now),
      );
    }
  }
  statements.push(
    env.DB.prepare(
      'INSERT INTO sync_revisions (owner_id, revision, updated_at) VALUES (?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at',
    ).bind(ownerId, revision, now),
  );

  await runStatements(env, statements);
  // A snapshot restore can replace every product; drop the catalog facet cache.
  invalidateMallFacetCache();
  // Document mirror is authoritative for the revision; a relational failure is reported, not fatal.
  let relationalSynced = true;
  let relationalError: string | undefined;
  try {
    await runStatements(env, toD1Statements(env, relationalStmts));
    relationalBackfilled = true;
  } catch (error) {
    relationalSynced = false;
    relationalError = error instanceof Error ? error.message : String(error);
    console.warn('Relational snapshot mirror failed:', relationalError);
  }
  return json({
    ok: true,
    revision,
    collections: Object.keys(body.stores).filter((name) => ALLOWED_STORES.has(name)),
    backend: 'relational',
    relationalStatements: relationalStmts.length,
    relationalSynced,
    relationalError,
  });
}

/** Convert shared mapper SqlStmt[] into D1 prepared statements. */
function toD1Statements(env: Env, stmts: { sql: string; params?: any[] }[]): D1PreparedStatement[] {
  return stmts.map((st) => env.DB.prepare(st.sql).bind(...(Array.isArray(st.params) ? st.params : [])));
}

/** D1 batch caps statement counts, so chunk the relational mirrors. */
async function runStatements(env: Env, statements: D1PreparedStatement[]) {
  for (let offset = 0; offset < statements.length; offset += 50) {
    await env.DB.batch(statements.slice(offset, offset + 50));
  }
}

/**
 * Snapshot revalidation. The Dashboard read the whole store (1,592 documents /
 * ~554 KB) on every boot even when nothing had changed since its last read.
 * The revision already bumps on every snapshot write, so it is a sound
 * validator: revision + the backend that served it, matching what the client
 * stores after each successful read.
 */
const snapshotGuard = (revision: number, backend: string) => `"${revision}-${backend}"`;

function snapshotNotModified(request: Request, revision: number, backend: string) {
  const header = request.headers.get('if-none-match');
  if (!revision || !header) return false;
  return header.split(',').some((value) => value.trim() === snapshotGuard(revision, backend));
}

const snapshotUnchanged = (revision: number, backend: string) =>
  new Response(null, { status: 304, headers: { 'cache-control': 'no-store', 'etag': snapshotGuard(revision, backend) } });

function snapshotResponse(body: Record<string, unknown>, revision: number, backend: string) {
  const response = json(body);
  response.headers.set('etag', snapshotGuard(revision, backend));
  response.headers.set('cache-control', 'no-store');
  return response;
}

/** One bounded page: a single edit must never trigger a whole-store read. */
const SNAPSHOT_DELTA_LIMIT = 500;

type SnapshotCursor = { ms: number; collection: string; documentId: string };

/**
 * Composite delta watermark. `updated_at` alone cannot bound a read: the bulk
 * PUT path stamps every row with the same millisecond, so a watermark of
 * `since.updated_at` would silently skip every row sharing that millisecond on
 * the next page. The (collection, document_id) tail makes the watermark a
 * strict keyset bound instead.
 */
function parseSnapshotCursor(since: string | null): SnapshotCursor | null {
  if (!since) return null;
  try {
    const parsed = JSON.parse(since);
    if (parsed && typeof parsed === 'object') {
      const ms = Number((parsed as { ms?: unknown }).ms);
      if (Number.isFinite(ms) && ms >= 0) {
        return {
          ms,
          collection: String((parsed as { collection?: unknown }).collection || ''),
          documentId: String((parsed as { documentId?: unknown }).documentId || ''),
        };
      }
      return null;
    }
  } catch {
    // Legacy ISO-string watermarks predate the composite cursor.
  }
  const ms = Date.parse(since);
  return Number.isFinite(ms) ? { ms, collection: '', documentId: '' } : null;
}

/**
 * Delta read for an open staff workspace, which already holds the full store and
 * therefore only needs the rows written after its watermark. Returns one bounded
 * page plus the next cursor; the client repeats while `bounded` is true.
 */
async function readSnapshotDelta(env: Env, ownerId: string, revision: number, since: string) {
  const watermark = parseSnapshotCursor(since);
  const sinceMs = watermark?.ms ?? 0;
  const rows = await env.DB.prepare(
    `SELECT collection, document_id, payload, updated_at FROM app_documents
     WHERE owner_id = ?
       AND (updated_at > ? OR (updated_at = ? AND (collection > ? OR (collection = ? AND document_id > ?))))
     ORDER BY updated_at, collection, document_id LIMIT ?`,
  ).bind(ownerId, sinceMs, sinceMs, watermark?.collection ?? '', watermark?.collection ?? '', watermark?.documentId ?? '', SNAPSHOT_DELTA_LIMIT)
    .all<{ collection: string; document_id: string; payload: string; updated_at: number }>();
  const list = rows.results || [];
  let cursor: SnapshotCursor = { ms: sinceMs, collection: watermark?.collection ?? '', documentId: watermark?.documentId ?? '' };
  const stores: Record<string, unknown[]> = {};
  for (const row of list) {
    cursor = { ms: Number(row.updated_at) || 0, collection: row.collection, documentId: row.document_id };
    try {
      (stores[row.collection] ||= []).push(JSON.parse(row.payload));
    } catch {
      // Ignore a malformed row without losing the rest of the page.
    }
  }
  return snapshotResponse({
    stores,
    hasData: Object.keys(stores).length > 0,
    revision,
    backend: 'documents',
    delta: true,
    cursor: JSON.stringify(cursor),
    bounded: list.length >= SNAPSHOT_DELTA_LIMIT,
  }, revision, 'documents');
}

async function readSnapshot(request: Request, env: Env) {
  await ensureSchema(env);
  const ownerId = BUSINESS_OWNER_ID;
  // Read the revision first so an unchanged store can short-circuit below.
  const revisions = await env.DB.prepare('SELECT revision FROM sync_revisions WHERE owner_id = ?')
    .bind(ownerId).all<{ revision: number }>();
  const revision = Number(revisions.results?.[0]?.revision || 0);

  // A supplied watermark means delta mode, and is handled before the relational
  // branch so an automatic save never falls back to the 18-query snapshot builder.
  const since = new URL(request.url).searchParams.get('since') || null;
  if (since) return readSnapshotDelta(env, ownerId, revision, since);

  // Phase 4: relational read path. Falls back to the document store when the
  // relational tables are still empty (pre-ETL / fresh database).
  try {
    const backfill = await ensureRelationalBackfill(env);
    if (relationalBackfilled) {
      if (snapshotNotModified(request, revision, 'relational')) return snapshotUnchanged(revision, 'relational');
      const { stores, capped } = await buildSnapshot(makeD1QueryAll(env));
      return snapshotResponse({
        stores,
        hasData: Object.keys(stores).length > 0,
        revision,
        backend: 'relational',
        backfill: backfill.statements ? backfill : undefined,
        ...(capped.length ? { bounds: { capped } } : {}),
      }, revision, 'relational');
    }
  } catch (error) {
    console.warn('Relational snapshot failed, serving documents:', error instanceof Error ? error.message : error);
  }

  // The document-store read is the most expensive query in the app; a matching
  // validator skips it entirely.
  if (snapshotNotModified(request, revision, 'documents')) return snapshotUnchanged(revision, 'documents');

  const rows = await env.DB.prepare(
    'SELECT collection, document_id, payload, updated_at FROM app_documents WHERE owner_id = ? ORDER BY collection, document_id',
  ).bind(ownerId).all<{ collection: string; document_id: string; payload: string; updated_at: number }>();
  const stores: Record<string, unknown[]> = {};
  for (const row of rows.results || []) {
    try {
      (stores[row.collection] ||= []).push(JSON.parse(row.payload));
    } catch {
      // Ignore a malformed row without making the rest of the snapshot unreadable.
    }
  }
  return snapshotResponse({
    stores,
    hasData: Object.keys(stores).length > 0,
    revision,
    backend: 'documents',
  }, revision, 'documents');
}

async function patchRecords(request: Request, env: Env) {
  await ensureSchema(env);
  const ownerId = BUSINESS_OWNER_ID;
  const body = await readJson(request);
  const upserts = Array.isArray(body?.upserts) ? body.upserts : [];
  const deletes = Array.isArray(body?.deletes) ? body.deletes : [];
  if (upserts.length + deletes.length > 5000) return json({ error: 'Too many records in one sync.' }, 413);

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  // Mirror-less PATCH (option B): a staff edit writes ONLY the relational rows
  // it changes. The app_documents mirror no longer receives per-edit upserts or
  // deletes — snapshot PUTs keep it current — so a PATCH stops paying the mirror
  // rewrite on every index entry it touches plus the 50-row probe pages that
  // pre-read every candidate from the mirror. The unchanged re-push guard went
  // with the probe: it compared against mirror payloads that PATCHes no longer
  // refresh, so it could never make a correct skip decision again. A repeated
  // push now costs only its idempotent relational upserts.
  const relationalStmts: { sql: string; params: any[] }[] = [];
  const writtenKeys: { collection: string; documentId: string }[] = [];
  for (const item of upserts) {
    const collection = String(item?.collection || '');
    const document = item?.document;
    if (!ALLOWED_STORES.has(collection) || !document || typeof document !== 'object') continue;
    const documentId = String(document.id || 'singleton');
    writtenKeys.push({ collection, documentId });
    relationalStmts.push(...upsertToStatements(collection, document, nowIso));
  }
  for (const item of deletes) {
    const collection = String(item?.collection || '');
    const documentId = String(item?.documentId || '');
    if (!ALLOWED_STORES.has(collection) || !documentId) continue;
    relationalStmts.push(...deleteToStatements(collection, documentId));
  }

  const revisions = await env.DB.prepare('SELECT revision FROM sync_revisions WHERE owner_id = ?')
    .bind(ownerId).all<{ revision: number }>();
  const revision = Math.max(now, Number(revisions.results?.[0]?.revision || 0) + 1);
  await runStatements(env, [env.DB.prepare(
    'INSERT INTO sync_revisions (owner_id, revision, updated_at) VALUES (?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at',
  ).bind(ownerId, revision, now)]);
  // Product writes change the catalog facet lists; drop the in-memory cache so
  // the next catalog request rebuilds the counts including this write.
  invalidateMallFacetCache();
  let relationalSynced = true;
  let relationalError: string | undefined;
  try {
    await runStatements(env, toD1Statements(env, relationalStmts));
  } catch (error) {
    relationalSynced = false;
    relationalError = error instanceof Error ? error.message : String(error);
    console.warn('Relational record write failed:', relationalError);
  }
  // Keyset cursor for the next delta: the max key this batch wrote, so rows
  // sharing the same millisecond with rows from another batch are never
  // excluded by a bare `updated_at > ?` bound. The cursor advances even though
  // PATCHes are mirror-less: delta reads see PUT-driven mirror rows only, and
  // every client still converges on PATCH changes through the revision bump
  // above plus the full relational snapshot read.
  const lastWritten = [...writtenKeys]
    .sort((left, right) => (left.collection < right.collection ? -1 : left.collection > right.collection ? 1 : left.documentId < right.documentId ? -1 : left.documentId > right.documentId ? 1 : 0))
    .pop();
  const patchCursor = lastWritten
    ? JSON.stringify({ ms: now, collection: lastWritten.collection, documentId: lastWritten.documentId })
    : nowIso;
  return json({
    ok: true,
    revision,
    upserted: writtenKeys.length,
    deleted: deletes.length,
    // The mirror probe is gone, so nothing is ever skipped; the field stays in
    // the response so older clients keep parsing it without a fallback.
    skippedUnchanged: 0,
    backend: 'relational',
    relationalStatements: relationalStmts.length,
    relationalSynced,
    relationalError,
    // Server-clock watermark the client stores to bound its next delta read.
    cursor: patchCursor,
  });
}

async function askGemini(apiKey: string, prompt: string) {
  const model = 'gemini-2.5-flash';
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    },
  );
  if (!response.ok) throw new Error(`Gemini request failed (${response.status})`);
  const data = await response.json() as any;
  return (data.candidates?.[0]?.content?.parts || [])
    .map((part: { text?: string }) => part.text || '')
    .join('')
    .trim();
}

function stripJsonFence(text: string) {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

async function businessAssistant(request: Request, env: Env) {
  const body = await readJson(request);
  if (!body?.prompt) return json({ error: 'A prompt is required.' }, 400);
  const context = body.businessContext || {};
  if (!env.GEMINI_API_KEY) {
    return json({
      answer: `[IdoferaLabs AI Analysis]\n\nBased on your recent business data:\n- Today's Total Sales: ${context.todaySales || 0}\n- Active Low Stock Items: ${context.lowStockCount || 0}\n- Monthly Revenue: ${context.monthlyRevenue || 0}\n\n**Key Takeaway**: ${String(body.prompt).toLowerCase().includes('reorder') ? 'Replenish items below their minimum stock threshold to prevent lost sales.' : 'Monitor top-performing categories and stock velocity to protect margins.'}`,
      source: 'fallback',
    });
  }
  const answer = await askGemini(
    env.GEMINI_API_KEY,
    `You are IdoferaLabs AI Business Assistant. Give concise, actionable retail and wholesale advice.\n\nBusiness context:\n${JSON.stringify(context, null, 2)}\n\nQuestion:\n${body.prompt}`,
  );
  return json({ answer, source: 'gemini-2.5-flash' });
}

async function pricingAssistant(request: Request, env: Env) {
  const body = await readJson(request);
  const product = body?.product;
  if (!product) return json({ error: 'A product is required.' }, 400);
  const cost = Number(product.costPrice) || 100;
  if (!env.GEMINI_API_KEY) {
    const retail = Math.round(cost * 145) / 100;
    const wholesale = Math.round(cost * 125) / 100;
    const margin = Math.round(((retail - cost) / retail) * 100);
    return json({
      recommendedRetailPrice: retail,
      recommendedWholesalePrice: wholesale,
      suggestedDiscountPct: 5,
      projectedProfitMargin: margin,
      riskLevel: 'Low',
      explanation: `The recommendation preserves a ${margin}% retail margin while keeping a volume-friendly wholesale price.`,
      source: 'fallback',
    });
  }
  const text = await askGemini(
    env.GEMINI_API_KEY,
    `Return only valid JSON with recommendedRetailPrice, recommendedWholesalePrice, suggestedDiscountPct, projectedProfitMargin, riskLevel, and explanation for this product:\n${JSON.stringify(product, null, 2)}`,
  );
  return json({ ...JSON.parse(stripJsonFence(text)), source: 'gemini-2.5-flash' });
}

async function salesForecast(request: Request, env: Env) {
  const body = await readJson(request);
  const sales = body?.historicalSales || [];
  const products = body?.products || [];
  if (!env.GEMINI_API_KEY) {
    return json({
      forecastDays: 30,
      predictedRevenue: sales.reduce((sum: number, sale: any) => sum + (Number(sale.totalAmount) || 0), 0),
      predictedSalesCount: sales.length,
      highRiskStockouts: products.filter((p: any) => Number(p.currentStock) <= Number(p.minimumStockLevel)).slice(0, 5).map((p: any) => p.name),
      suggestedReorderDate: 'Within 5 days',
      cashFlowTrend: 'Monitor current sales velocity',
      insights: ['Review low-stock products before the next sales cycle.', 'Use recent category velocity to prioritize purchase orders.'],
      source: 'fallback',
    });
  }
  const text = await askGemini(
    env.GEMINI_API_KEY,
    `Return only valid JSON with forecastDays, predictedRevenue, predictedSalesCount, highRiskStockouts, suggestedReorderDate, cashFlowTrend, and insights. Sales count: ${sales.length}. Products: ${JSON.stringify(products.slice(0, 20), null, 2)}`,
  );
  return json({ ...JSON.parse(stripJsonFence(text)), source: 'gemini-2.5-flash' });
}

async function serveAsset(request: Request, env: Env) {
  let response = await env.ASSETS.fetch(request);
  const url = new URL(request.url);
  const acceptsHtml = request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html');
  if (response.status === 404 && acceptsHtml) {
    // Fetch the canonical HTML internally: /index.html redirects to / in
    // Workers Assets, which would otherwise discard the browser's staff route.
    response = await env.ASSETS.fetch(new Request(new URL('/', url), request));
  }
  const headers = new Headers(response.headers);
  if ((response.headers.get('content-type') || '').includes('text/html')) {
    headers.set('cache-control', isStaffPage(url.pathname) ? 'no-store' : 'no-cache, max-age=0');
    headers.delete('content-length');
    const html = (await response.text()).replaceAll('__SITE_ORIGIN__', url.origin);
    return new Response(html, { status: response.status, statusText: response.statusText, headers });
  } else if (url.pathname.startsWith('/assets/')) {
    headers.set('cache-control', 'public, max-age=31536000, immutable');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    await ensureSchema(env);
    await maintainMall({
      config: env, queryAll: makeD1QueryAll(env), runBatch: async stmts => {
        const result = await env.DB.batch(toD1Statements(env, stmts));
        return result.map((row: any) => Number(row?.meta?.changes ?? 0));
      }
    }, async (input, init) => {
      // Deliver the signed outbox POST to the receiver IN PROCESS. Reaching
      // MALL_WEBHOOK_URL over the network would mean this Worker fetching a
      // hostname its own route matches, which Cloudflare answers with error 1042
      // ("Internal request count exceeded") once the subrequest chain grows.
      // The receiver still verifies the HMAC, so the signature path is real.
      // Only method/headers/body are carried over: `signal` and `redirect` are
      // transport concerns that do not apply to an in-process call.
      const request = new Request(String(input), {
        method: init?.method || 'POST',
        headers: init?.headers as Record<string, string>,
        body: init?.body as string,
      });
      return await handleMallWebhook(request, env);
    });
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      const query = makeD1QueryAll(env);
      const cookie = request.headers.get('cookie') || '';
      if (url.pathname === '/api/auth/entrance') {
        if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
        if (request.headers.get('origin') !== url.origin || request.headers.get('x-staff-entrance') !== 'cart-hold') return json({ error: 'Forbidden' }, 403);
        const response = json({ ok: true });
        response.headers.set('cache-control', 'no-store');
        response.headers.set('set-cookie', entranceCookie(await issueEntrance(query)));
        return response;
      }
      const login = ['/api/auth/login', '/api/auth/google'].includes(url.pathname);
      if (isStaffPage(url.pathname) || isPrivateApi(url.pathname) || login) {
        const entrance = !isPrivateApi(url.pathname) && await hasEntrance(cookie, query);
        if (!entrance && !await requireAppUser(request, env)) {
          if (isStaffPage(url.pathname)) return new Response(null, { status: 302, headers: { location: '/', 'cache-control': 'no-store' } });
          if (login) return json({ error: 'Staff entrance expired. Return to the Mall and hold the Cart button for 3 seconds to reopen Staff Login.', code: 'STAFF_ENTRANCE_REQUIRED' }, 401);
          return json({ error: 'Authentication required.' }, 401);
        }
      }
      if (url.pathname === '/api/health') return json({ status: 'ok', app: 'IdoferaLabs API', timestamp: new Date().toISOString() });
      if (url.pathname === '/api/storage/d1/health') {
        await ensureSchema(env);
        const ownerId = BUSINESS_OWNER_ID;
        const revisions = await env.DB.prepare('SELECT revision FROM sync_revisions WHERE owner_id = ?').bind(ownerId).all<{ revision: number }>();
        // Counting every document and five relational tables costs ~2,185 rows on
        // each poll. Liveness only needs the revision, so the counts are opt-in
        // (`?detail=1`) and used by the Settings panel rather than by every poll.
        const wantsDetail = new URL(request.url).searchParams.get('detail') === '1';
        let totalDocuments: number | undefined;
        let relational: Record<string, unknown> | undefined;
        if (wantsDetail) {
          const docCount = await env.DB.prepare('SELECT count(*) as count FROM app_documents WHERE owner_id = ?').bind(ownerId).all<{ count: number }>();
          totalDocuments = Number(docCount.results?.[0]?.count || 0);
          try {
            const row = await d1Get(env, `SELECT
              (SELECT COUNT(*) FROM products) as products,
              (SELECT COUNT(*) FROM sales) as sales,
              (SELECT COUNT(*) FROM customers) as customers,
              (SELECT COUNT(*) FROM suppliers) as suppliers,
              (SELECT COUNT(*) FROM sale_items) as sale_items`);
            relational = {
              products: Number(row?.products || 0),
              sales: Number(row?.sales || 0),
              customers: Number(row?.customers || 0),
              suppliers: Number(row?.suppliers || 0),
              saleItems: Number(row?.sale_items || 0),
            };
          } catch (error) {
            relational = { error: error instanceof Error ? error.message : String(error) };
          }
        }
        return json({
          status: 'healthy',
          connected: true,
          backend: 'relational',
          databaseId: env.D1_DATABASE_ID || 'unconfigured',
          revision: Number(revisions.results?.[0]?.revision || 0),
          totalDocuments,
          relational,
          detail: wantsDetail,
          endpoint: 'Cloudflare D1 Edge Worker',
          timestamp: new Date().toISOString(),
        });
      }
      if (request.method === 'POST' && url.pathname === '/api/auth/login') return await authLogin(request, env);
      if (request.method === 'POST' && url.pathname === '/api/auth/google') return await authGoogle(request, env);
      if (request.method === 'GET' && url.pathname === '/api/auth/session') return await authSession(request, env);
      if (request.method === 'POST' && url.pathname === '/api/auth/logout') return await authLogout(request, env);
      if (request.method === 'GET' && url.pathname === '/api/auth/users') return await authUsers(request, env);
      if (request.method === 'PUT' && url.pathname === '/api/auth/users') return await upsertAuthUser(request, env);
      if (request.method === 'DELETE' && url.pathname.startsWith('/api/auth/users/')) return await deleteAuthUser(request, env, decodeURIComponent(url.pathname.slice('/api/auth/users/'.length)));
      if (request.method === 'POST' && url.pathname === '/api/auth/password') return await changeAuthPassword(request, env);
      if (request.method === 'PUT' && url.pathname === '/api/storage/snapshot') return await saveSnapshot(request, env);
      if (request.method === 'GET' && url.pathname === '/api/storage/snapshot') return await readSnapshot(request, env);
      if (request.method === 'PATCH' && url.pathname === '/api/storage/records') return await patchRecords(request, env);
      if (request.method === 'POST' && url.pathname === '/api/ai/business-assistant') return await businessAssistant(request, env);
      if (request.method === 'POST' && url.pathname === '/api/ai/pricing-assistant') return await pricingAssistant(request, env);
      if (request.method === 'POST' && url.pathname === '/api/ai/sales-forecasting') return await salesForecast(request, env);
      if (url.pathname === '/api/staff/product-images') {
        const actor = await requireAppUser(request, env);
        if (!actor) return json({ error: 'Authentication required.' }, 401);
        await ensureSchema(env);
        return await handleStaffProductImageApi(request, makeR2ImageStore(env), {
          config: env,
          queryAll: makeD1QueryAll(env),
          runBatch: async (stmts) => {
            const results = await env.DB.batch(toD1Statements(env, stmts));
            return results.map((result: any) => Number(result?.meta?.changes ?? 0));
          },
        }, { id: actor.id, displayName: actor.display_name, role: actor.role });
      }
      if (url.pathname === '/api/staff/mall-listings' || url.pathname.startsWith('/api/staff/mall-listings/')) {
        const actor = await requireAppUser(request, env);
        if (!actor) return json({ error: 'Authentication required.' }, 401);
        await ensureSchema(env);
        return await handleStaffMallListingApi(request, {
          config: env,
          queryAll: makeD1QueryAll(env),
          runBatch: async (stmts) => {
            const results = await env.DB.batch(toD1Statements(env, stmts));
            return results.map((result: any) => Number(result?.meta?.changes ?? 0));
          },
        }, { id: actor.id, displayName: actor.display_name, role: actor.role });
      }
      if (url.pathname === '/api/staff/mall-orders' || url.pathname.startsWith('/api/staff/mall-orders/')) {
        await ensureSchema(env);
        const actor = await requireAppUser(request, env);
        if (!actor) return json({ error: 'Authentication required.' }, 401);
        return await handleStaffMallApi(request, {
          config: env,
          imagesConfigured: !!env.MALL_IMAGES,
          queryAll: makeD1QueryAll(env),
          runBatch: async (stmts) => {
            const results = await env.DB.batch(toD1Statements(env, stmts));
            return results.map((result: any) => Number(result?.meta?.changes ?? 0));
          },
        }, { id: actor.id, displayName: actor.display_name, role: actor.role });
      }
      // #18 — email notification webhook receiver (public, HMAC-signed).
      if (request.method === 'POST' && url.pathname === '/api/mall-webhook') {
        await ensureSchema(env);
        return await handleMallWebhook(request, env);
      }
      // Phase 5: mall storefront API (public catalog/cart/checkout/track).
      if (url.pathname === '/api/mall' || url.pathname.startsWith('/api/mall/')) {
        await ensureSchema(env);
        return await handleMallApi(request, {
          config: env,
          imagesConfigured: !!env.MALL_IMAGES,
          clientIp: request.headers.get('cf-connecting-ip') || 'unknown',
          queryAll: makeD1QueryAll(env),
          runBatch: async (stmts) => {
            const results = await env.DB.batch(toD1Statements(env, stmts));
            return results.map((r: any) => Number(r?.meta?.changes ?? 0));
          },
        });
      }
      if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
      // #14 — public, immutable product images (served from R2, never the asset bucket).
      if (url.pathname.startsWith('/mall-images/')) {
        return await handlePublicImageRequest(request, makeR2ImageStore(env), decodeURIComponent(url.pathname.slice('/mall-images/'.length)));
      }
      return await serveAsset(request, env);
    } catch (error) {
      // Preserve Mall domain semantics when an error propagates from the Mall
      // handlers (status + structured payload). Anything else falls back to a
      // generic 500 so unexpected failures never escape as non-Response throws.
      const known = error as Error & { mallStatus?: number; mallPayload?: unknown };
      const status = known?.mallStatus ?? 500;
      const body: Record<string, unknown> = { error: error instanceof Error ? error.message : 'Unexpected server error' };
      if (known?.mallPayload !== undefined) body.payload = known.mallPayload;
      const resp = json(body, status);
      resp.headers.set('cache-control', 'no-store');
      return resp;
    }
  },
};
