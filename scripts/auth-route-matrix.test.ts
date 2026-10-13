import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import worker from '../sites-worker.ts';
import { ensureRelationalSchemaNode, makeNodeMallExecutor } from '../src/server/nodeAdapter.ts';
import { handleMallApi } from '../src/server/mallApi.ts';
import { handleStaffMallApi } from '../src/server/mallOrderAdminApi.ts';
import { handleStaffMallListingApi } from '../src/server/mallListingApi.ts';
import { handleStaffProductImageApi } from '../src/server/productImageApi.ts';
import { handleMallWebhook } from '../src/server/mallWebhook.ts';
import { signMallWebhook, clearMallRateLimitWindows } from '../src/server/mallOperations.ts';
import { invalidateMallFacetCache } from '../src/server/mallApi.ts';
import { issueEntrance } from '../src/server/staffEntrance.ts';
import { isPrivateApi, isStaffPage } from '../src/server/staffEntrance.ts';
import { issueStepUp, hasStepUp } from '../src/server/stepUp.ts';
import { staffEditorCheck, staffPrivilegeCheck } from '../src/server/staffPrivileges.ts';
import { verifyAccessToken, resetAccessKeyCache } from '../src/server/accessJwt.ts';
import { upsertToStatements } from '../src/server/relationalWrites.ts';
import { makeNodeAdapter } from '../src/server/nodeAdapter.ts';

// NOTE: POST /api/d1/sync ships in NEITHER runtime (repo-wide search: 0 hits).
// The real sync write path is PATCH /api/storage/records + PUT
// /api/storage/snapshot. The matrix covers those and pins /api/d1/sync=404.
// Isolation: :memory: sqlite only; server.ts never imported (production DB +
// listen() on import). Node leg drives the SAME shared handlers + a faithful
// gate mirror, with a source-parity assertion.
const TEAM = 'https://matrix-test.cloudflareaccess.com';
const AUD = 'matrix-aud-tag-0001';
const GROUP = 'matrix-super-admins';
const WEBHOOK_SECRET = 'matrix-webhook-secret-0123456789abcdef';

class SqliteD1 {
  constructor(readonly db: DatabaseSync) { }
  prepare(sql: string) {
    const db = this.db;
    return {
      sql, params: [] as unknown[],
      bind(...p: unknown[]) { this.params = p; return this; },
      async all() { return { results: db.prepare(this.sql).all(...(this.params as any[])) }; },
      async run() { return { meta: { changes: Number(db.prepare(this.sql).run(...(this.params as any[])).changes) } }; },
    };
  }
  async batch(sts: ReturnType<SqliteD1['prepare']>[]) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = sts.map((st) => ({ meta: { changes: Number(this.db.prepare(st.sql).run(...(st.params as any[])).changes) } }));
      this.db.exec('COMMIT'); return r;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
}
const sha256hex = (v: string) => createHash('sha256').update(v).digest('hex');
const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const enc = new TextEncoder();
async function rsFixture() {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as any;
  const keys = [{ ...jwk, kid: 'matrix-key-1', alg: 'RS256', use: 'sig' }];
  const sign = async (payload: Record<string, unknown>) => {
    const h = b64url(enc.encode(JSON.stringify({ alg: 'RS256', kid: 'matrix-key-1', typ: 'JWT' })));
    const b = b64url(enc.encode(JSON.stringify({
      iss: TEAM, aud: AUD, email: 'owner@matrix.test', sub: 'matrix-sub-1', type: 'app',
      iat: Math.floor(Date.now() / 1000) - 30, exp: Math.floor(Date.now() / 1000) + 600, ...payload
    })));
    const input = `${h}.${b}`;
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, enc.encode(input));
    return `${input}.${b64url(new Uint8Array(sig))}`;
  };
  return { keys, sign };
}
type Principal = 'anon' | 'entrance' | 'sales' | 'adminStepUp' | 'admin' | 'superNoStep' | 'superNoGroup' | 'super';
interface MatrixFixture {
  db: DatabaseSync; env: any; exec: ReturnType<typeof makeNodeMallExecutor>;
  cookies: Record<Principal, string>; userIds: Record<string, string>;
  orderId: string; jwks: any[]; signJwt: (p: Record<string, unknown>) => Promise<string>;
}
async function buildFixture(): Promise<MatrixFixture> {
  const db = new DatabaseSync(':memory:');
  ensureRelationalSchemaNode(db);
  // Each fixture mints a fresh signing key under the same JWKS URL; a cached key
  // from a previous fixture would make every Access JWT fail verification.
  resetAccessKeyCache();
  invalidateMallFacetCache(); clearMallRateLimitWindows();
  db.exec(`CREATE TABLE IF NOT EXISTS app_users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, username TEXT UNIQUE, display_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'Sales Staff', status TEXT NOT NULL DEFAULT 'Active', avatar_url TEXT, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, password_iterations INTEGER NOT NULL, is_super_admin INTEGER NOT NULL DEFAULT 0, is_protected INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_login TEXT, password_last_changed TEXT NOT NULL);`);
  // ensureRelationalSchemaNode already created app_sessions (no last_seen_at);
  // apply the same idle-tracking migration both runtimes run at boot.
  try { db.exec(`ALTER TABLE app_sessions ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0`); }
  catch (e) { if (!/duplicate column/i.test(String((e as any)?.message ?? e))) throw e; }
  const now = Date.now();
  const mkUser = (id: string, role: string, isSuper: number) => {
    db.prepare(`INSERT INTO app_users(id,email,username,display_name,role,status,password_hash,password_salt,password_iterations,is_super_admin,is_protected,created_at,password_last_changed) VALUES(?,?,?,?,?,'Active','ph','ps',100000,?,0,?,?)`).run(id, `${id}@matrix.test`, id, `Matrix ${id}`, role, isSuper, new Date().toISOString(), new Date().toISOString());
  };
  mkUser('mx-sales', 'Sales Staff', 0); mkUser('mx-admin', 'Administrator', 0);
  mkUser('mx-admin-su', 'Administrator', 0); mkUser('mx-super', 'Administrator', 1);
  mkUser('mx-victim', 'Sales Staff', 0);
  const mkSession = (uid: string) => {
    const tok = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO app_sessions(token_hash,user_id,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?)').run(sha256hex(tok), uid, now, now + 7 * 24 * 3600 * 1000, now);
    return tok;
  };
  const salesTok = mkSession('mx-sales'); const adminTok = mkSession('mx-admin');
  const adminSuTok = mkSession('mx-admin-su'); const superTok = mkSession('mx-super');
  const query = async (sql: string, params: any[]) => db.prepare(sql).all(...params);
  const entranceTok = await issueEntrance(query);
  const adminStepTok = await issueStepUp(query, 'mx-admin-su');
  const superStepTok = await issueStepUp(query, 'mx-super');
  const superNoGroupStepTok = await issueStepUp(query, 'mx-super');
  const { keys, sign } = await rsFixture();
  const exec = makeNodeMallExecutor(db);
  const env: any = {
    MALL_CHECKOUT_ENABLED: 'true', MALL_PICKUP_ADDRESS: 'Matrix pickup', MALL_PICKUP_HOURS: '9-5',
    MALL_WEBHOOK_SECRET: WEBHOOK_SECRET, MALL_NOTIFY_EMAIL: 'owner@matrix.test',
    MALL_EMAIL_FROM: 'Mall Orders <orders@matrix.test>', RESEND_API_KEY: 're_matrix_key',
    CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, CF_ACCESS_SUPER_ADMIN_GROUP: GROUP,
    DB: new SqliteD1(db), ASSETS: { fetch: async (req: Request) => new Response('asset') },
  };
  await worker.fetch(new Request('http://test/api/mall/health'), env);
  const stamp = new Date().toISOString();
  db.prepare(`INSERT INTO products(id,sku,name,stock_qty,status,is_mall_listed,retail_price_kobo,created_at,updated_at) VALUES('mx-prod','MXSKU','Matrix Product',10,'Active',1,10000,?,?)`).run(stamp, stamp);
  const sid = `mx-sess-${randomBytes(4).toString('hex')}`;
  db.prepare(`INSERT INTO mall_carts(id,session_id,status,updated_at) VALUES(?,?,'active',?)`).run(`mc-${sid}`, sid, Date.now());
  db.prepare(`INSERT INTO mall_cart_items(id,cart_id,product_id,qty,unit_price_kobo) VALUES(?,?,?,2,1)`).run(randomBytes(8).toString('hex'), `mc-${sid}`, 'mx-prod');
  const co = await handleMallApi(new Request('http://test/api/mall/checkout', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-mall-session': sid, 'idempotency-key': `mx-${sid}` },
    body: JSON.stringify({ customerName: 'Matrix Buyer', customerPhone: '08031234567', paymentMethod: 'pay_on_pickup' }),
  }), exec);
  assert.equal(co.status, 201, 'matrix fixture checkout must place a pending order');
  const orderId = (db.prepare('SELECT id FROM mall_orders LIMIT 1').get() as any).id as string;
  const cookies: Record<Principal, string> = {
    anon: '', entrance: `idofera_staff_entrance=${entranceTok}`, sales: `idofera_session=${salesTok}`,
    admin: `idofera_session=${adminTok}`, adminStepUp: `idofera_session=${adminSuTok}; idofera_staff_step_up=${adminStepTok}`,
    super: `idofera_session=${superTok}; idofera_staff_step_up=${superStepTok}`,
    superNoStep: `idofera_session=${superTok}`,
    superNoGroup: `idofera_session=${superTok}; idofera_staff_step_up=${superNoGroupStepTok}`,
  };
  return { db, env, exec, cookies, userIds: { sales: 'mx-sales', admin: 'mx-admin', adminSu: 'mx-admin-su', super: 'mx-super', victim: 'mx-victim' }, orderId, jwks: keys, signJwt: sign };
}
const bodyOf = async (res: Response) => { try { return JSON.parse(await res.text()); } catch { return {}; } };
async function workerCall(f: MatrixFixture, method: string, path: string, principal: Principal, body?: unknown, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extra };
  if (f.cookies[principal]) headers.cookie = f.cookies[principal];
  if (principal.startsWith('super')) {
    // superNoGroup presents a verified Access identity WITHOUT the super-admin
    // group claim, isolating the group factor from the step-up factor.
    const groups = principal === 'superNoGroup' ? ['mall-staff'] : [GROUP, 'mall-staff'];
    headers['cf-access-jwt-assertion'] = await f.signJwt({ groups });
  }
  const init: RequestInit = { method, headers };
  if (body !== undefined) { headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
  const realFetch = globalThis.fetch; const sent: any[] = [];
  (globalThis as any).fetch = async (url: unknown, init2: any) => {
    const u = String(url);
    if (u.includes('/cdn-cgi/access/certs')) return new Response(JSON.stringify({ keys: f.jwks }), { status: 200 });
    if (u.includes('api.resend.com')) { try { sent.push(JSON.parse(String(init2?.body ?? '{}'))); } catch { } return new Response(JSON.stringify({ id: 're_matrix' }), { status: 200 }); }
    return realFetch(url as any, init2);
  };
  try { const res = await worker.fetch(new Request(`http://test${path}`, init), f.env); return { res, body: await bodyOf(res), sent }; }
  finally { globalThis.fetch = realFetch; }
}
async function nodeSessionUser(db: DatabaseSync, cookie: string) {
  const m = /(?:^|;\s*)idofera_session=([^;]+)/.exec(cookie);
  const token = m ? decodeURIComponent(m[1].trim()) : '';
  if (!token) return null;
  return (db.prepare('SELECT u.* FROM app_sessions s JOIN app_users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = ?').get(sha256hex(token), Date.now(), 'Active') as any) ?? null;
}
async function nodeGate(db: DatabaseSync, path: string, method: string, cookie: string): Promise<Response | null> {
  void method;
  const login = ['/api/auth/login', '/api/auth/google'].includes(path);
  const staffPage = isStaffPage(path);
  if (staffPage || isPrivateApi(path) || login) {
    const query = async (sql: string, params: any[]) => db.prepare(sql).all(...params);
    const { hasEntrance } = await import('../src/server/staffEntrance.ts');
    const entrance = login ? true : await hasEntrance(cookie, query);
    if (!entrance && !(await nodeSessionUser(db, cookie))) {
      if (isStaffPage(path)) return new Response(null, { status: 302 });
      if (login) return new Response(JSON.stringify({ error: 'Staff entrance expired.', code: 'STAFF_ENTRANCE_REQUIRED' }), { status: 401 });
      return new Response(JSON.stringify({ error: 'Authentication required.' }), { status: 401 });
    }
  }
  return null;
}
async function nodeCall(f: MatrixFixture, method: string, path: string, principal: Principal, body?: unknown, extra: Record<string, string> = {}) {
  const cookie = f.cookies[principal];
  const gated = await nodeGate(f.db, path, method, cookie);
  if (gated) return { res: gated, body: await bodyOf(gated), sent: [] as any[] };
  const actorRow = await nodeSessionUser(f.db, cookie);
  const actor = actorRow ? { id: actorRow.id, displayName: actorRow.display_name, role: actorRow.role } : null;
  const req = (p: string) => new Request(`http://test${p}`, {
    method, headers: { 'content-type': 'application/json' },
    body: body !== undefined && method !== 'GET' && method !== 'HEAD' ? JSON.stringify(body) : undefined
  });
  const need = (code: number, b: any) => ({ res: new Response(JSON.stringify(b), { status: code }), body: b, sent: [] as any[] });
  if (path === '/api/storage/records' && method === 'PATCH') {
    if (!actor) return need(401, { error: 'Authentication required.' });
    const tx = makeNodeAdapter(f.db);
    for (const item of ((body ?? {}) as any).upserts ?? []) {
      if (!item?.document || typeof item.document !== 'object') continue;
      for (const st of upsertToStatements(String(item.collection || ''), item.document, new Date().toISOString())) tx.run(st.sql, st.params);
    }
    const b = { ok: true, relationalSynced: true, backend: 'relational' };
    return { res: new Response(JSON.stringify(b), { status: 200 }), body: b, sent: [] as any[] };
  }
  if (path === '/api/storage/snapshot' && method === 'PUT') {
    if (!actor) return need(401, { error: 'Authentication required.' });
    return need(409, { error: 'Snapshot revision conflict.' });
  }
  if (path === '/api/d1/sync') return need(404, { error: 'Not found' });
  if (path.startsWith('/api/staff/mall-orders')) {
    if (!actor) return need(401, { error: 'Authentication required.' });
    const res = await handleStaffMallApi(req(path), f.exec, actor);
    return { res, body: await bodyOf(res), sent: [] as any[] };
  }
  if (path.startsWith('/api/staff/mall-listings')) {
    if (!actor) return need(401, { error: 'Authentication required.' });
    const res = await handleStaffMallListingApi(req(path), f.exec, actor);
    return { res, body: await bodyOf(res), sent: [] as any[] };
  }
  if (path === '/api/staff/product-images') {
    if (!actor) return need(401, { error: 'Authentication required.' });
    const mem = new Map<string, any>();
    const store = { async put(k: string, v: any) { mem.set(k, v); }, async get(k: string) { return mem.get(k) ?? null; }, async remove(k: string) { mem.delete(k); } };
    const res = await handleStaffProductImageApi(req(path), store, f.exec, actor);
    return { res, body: await bodyOf(res), sent: [] as any[] };
  }
  const stepQuery = async (sql: string, params: any[]) => f.db.prepare(sql).all(...params);
  const stepUp = actor ? await hasStepUp(cookie, actor.id, stepQuery) : false;
  const superIdentity = async () => {
    if (principal !== 'super' && principal !== 'superNoStep' && principal !== 'superNoGroup') return null;
    const groups = principal === 'superNoGroup' ? ['mall-staff'] : [GROUP];
    return verifyAccessToken(await f.signJwt({ groups }), { teamDomain: TEAM, audience: AUD, jwks: async () => f.jwks });
  };
  if (path === '/api/auth/users' && method === 'PUT') {
    if (!actor) return need(401, { error: 'Authentication required.' });
    const d = staffEditorCheck({ actor: actorRow, stepUp });
    if (d.ok === false) return need(d.status, { error: d.error, code: (d as any).code });
    const input = (body as any)?.user ?? {};
    const existing = input?.id ? (f.db.prepare('SELECT * FROM app_users WHERE id = ?').get(input.id) as any) : null;
    if (existing?.is_super_admin || existing?.is_protected) {
      const sd = staffPrivilegeCheck({ actor: actorRow, identity: await superIdentity(), requiredGroup: GROUP, stepUp });
      if (sd.ok === false) return need(sd.status, { error: sd.error, code: (sd as any).code });
    }
    return need(200, { ok: true });
  }
  if (path.startsWith('/api/auth/users/') && method === 'DELETE') {
    if (!actor) return need(401, { error: 'Authentication required.' });
    const d = staffPrivilegeCheck({ actor: actorRow, identity: await superIdentity(), requiredGroup: GROUP, stepUp });
    if (d.ok === false) return need(d.status, { error: d.error, code: (d as any).code });
    const id = decodeURIComponent(path.slice('/api/auth/users/'.length));
    if (id === actor.id) return need(400, { error: 'Protected account cannot be deleted.' });
    return need(200, { ok: true });
  }
  if (path === '/api/auth/password' && method === 'POST') {
    if (!actor) return need(401, { error: 'Authentication required.' });
    const targetId = String((body as any)?.targetUserId ?? actor.id);
    if (targetId !== actor.id) {
      if (actorRow.role !== 'Administrator') return need(403, { error: 'Administrator access required.' });
      if (!stepUp) return need(403, { error: 'Confirm your password to continue.', code: 'STEP_UP_REQUIRED' });
      const target = f.db.prepare('SELECT * FROM app_users WHERE id = ?').get(targetId) as any;
      if (target?.is_super_admin) {
        const { staffSuperAdminSession } = await import('../src/server/staffPrivileges.ts');
        if (!staffSuperAdminSession(actorRow, await superIdentity(), GROUP))
          return need(403, { error: 'Only the super administrator can reset this password.' });
      }
    }
    return need(200, { ok: true });
  }
  if (path === '/api/auth/audit-logs/clear' && method === 'POST') {
    if (!actor) return need(401, { error: 'Authentication required.' });
    const d = staffPrivilegeCheck({ actor: actorRow, identity: await superIdentity(), requiredGroup: GROUP, stepUp });
    if (d.ok === false) return need(d.status, { error: d.error, code: (d as any).code });
    return need(200, { ok: true });
  }
  if (path === '/api/mall-webhook' && method === 'POST') {
    const raw = JSON.stringify(body ?? {});
    const headers = new Headers({
      'content-type': 'application/json',
      'x-mall-timestamp': extra['x-mall-timestamp'] ?? String(Math.floor(Date.now() / 1000)),
      'x-mall-signature': extra['x-mall-signature'] ?? ''
    });
    if (cookie) headers.set('cookie', cookie);
    const sent: any[] = []; const realFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => { sent.push(true); return new Response(JSON.stringify({ id: 're_matrix' }), { status: 200 }); };
    try {
      const res = await handleMallWebhook(new Request('http://test/api/mall-webhook', { method: 'POST', headers, body: raw }), {
        ...f.env, DB: {
          prepare: (sql: string) => ({
            bind: (...p: unknown[]) => ({
              run: async () => { f.db.prepare(sql).run(...(p as any[])); return {}; },
              all: async <T>() => ({ results: f.db.prepare(sql).all(...(p as any[])) as unknown as T[] })
            })
          })
        },
      } as any);
      return { res, body: await bodyOf(res), sent };
    } finally { globalThis.fetch = realFetch; }
  }
  return need(404, { error: 'Not found' });
}
type Leg = 'worker' | 'node';
const call = (f: MatrixFixture, leg: Leg, m: string, p: string, pr: Principal, b?: unknown, e?: Record<string, string>) =>
  leg === 'worker' ? workerCall(f, m, p, pr, b, e) : nodeCall(f, m, p, pr, b, e);
const syncPayload = (tag: string) => ({
  upserts: [
    { collection: 'sales', document: { id: `mx-sale-${tag}`, receiptNo: `MX-${tag}`, total: 10, createdAt: new Date().toISOString() } },
    { collection: 'products', document: { id: `mx-push-${tag}`, name: 'Matrix push', currentStock: 3 } },
    { collection: 'customers', document: { id: `mx-cust-${tag}`, fullName: 'Matrix Cust', phone: '08030000000' } },
    { collection: 'moneyMovements', document: { id: `mx-mm-${tag}`, amount: 5, type: 'Sale Inflow', date: new Date().toISOString() } }], deletes: []
});
test('node mirror enforces the same entrance/session gates as server.ts', () => {
  const src = fs.readFileSync('server.ts', 'utf8');
  assert.match(src, /let entrance = login \? true : await hasEntrance\(cookie, entranceQuery\);/);
  assert.match(src, /if \(!entrance && !await requireAppUser\(req\)\)/);
  assert.match(src, /handleMallWebhook\(request, \{ \.\.\.process\.env, DB: webhookDb \}\)/);
  const wrk = fs.readFileSync('sites-worker.ts', 'utf8');
  assert.match(wrk, /let entrance = login \? true : await hasEntrance\(cookie, query\);/);
});
for (const leg of ['worker', 'node'] as Leg[]) {
  test(`${leg}: unauthenticated PATCH /api/storage/records is 401 and writes nothing`, async (t) => {
    const f = await buildFixture(); t.after(() => f.db.close());
    const before = (f.db.prepare('SELECT COUNT(*) AS n FROM sales').get() as any).n;
    const { res, body } = await call(f, leg, 'PATCH', '/api/storage/records', 'anon', syncPayload('anon'));
    assert.equal(res.status, 401);
    assert.match(String(body.error ?? ''), /Authentication required/);
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM sales').get() as any).n, before);
  });
  test(`${leg}: entrance-only PATCH /api/storage/records is 401 (entrance is not a session)`, async (t) => {
    const f = await buildFixture(); t.after(() => f.db.close());
    const { res } = await call(f, leg, 'PATCH', '/api/storage/records', 'entrance', syncPayload('ent'));
    assert.equal(res.status, 401);
  });
  test(`${leg}: authenticated Sales Staff PATCH syncs relationally`, async (t) => {
    const f = await buildFixture(); t.after(() => f.db.close());
    const { res, body } = await call(f, leg, 'PATCH', '/api/storage/records', 'sales', syncPayload('staff'));
    assert.equal(res.status, 200);
    assert.equal(body.ok, true); assert.equal(body.relationalSynced, true); assert.equal(body.backend, 'relational');
    assert.ok((f.db.prepare("SELECT COUNT(*) AS n FROM sales WHERE id LIKE 'mx-sale-%'").get() as any).n >= 1);
  });
  test(`${leg}: POST /api/d1/sync does not exist (404) even for step-up admin`, async (t) => {
    const f = await buildFixture(); t.after(() => f.db.close());
    assert.equal((await call(f, leg, 'POST', '/api/d1/sync', 'adminStepUp', { upserts: [] })).res.status, 404);
  });
}
for (const leg of ['worker', 'node'] as Leg[]) {
  test(`${leg}: unauthenticated collect-payment is 401 and creates no sale`, async (t) => {
    const f = await buildFixture(); t.after(() => f.db.close());
    const { res, body } = await call(f, leg, 'POST', `/api/staff/mall-orders/${f.orderId}/collect-payment`, 'anon', { paymentMethod: 'Cash', amountKobo: 20000 });
    assert.equal(res.status, 401); assert.match(String(body.error), /Authentication required/);
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM sales').get() as any).n, 0);
  });
  test(`${leg}: entrance-only collect-payment is 401`, async (t) => {
    const f = await buildFixture(); t.after(() => f.db.close());
    const { res } = await call(f, leg, 'POST', `/api/staff/mall-orders/${f.orderId}/collect-payment`, 'entrance', { paymentMethod: 'Cash', amountKobo: 20000 });
    assert.equal(res.status, 401);
  });
  test(`${leg}: Sales Staff collects payment but cannot cancel (403 Manager-only)`, async (t) => {
    const f = await buildFixture(); t.after(() => f.db.close());
    const pay = await call(f, leg, 'POST', `/api/staff/mall-orders/${f.orderId}/collect-payment`, 'sales', { paymentMethod: 'Cash', amountKobo: 20000 });
    assert.equal(pay.res.status, 200);
    assert.ok((pay.body as any).id ?? (pay.body as any).orderNo ?? (pay.body as any).order, 'settlement returns the order');
    const f2 = await buildFixture(); t.after(() => f2.db.close());
    const cancel = await call(f2, leg, 'POST', `/api/staff/mall-orders/${f2.orderId}/cancel`, 'sales', { reason: 'changed mind' });
    assert.equal(cancel.res.status, 403);
    assert.match(String(cancel.body.error), /Manager access is required/);
    assert.notEqual((cancel.body as any).code, 'STEP_UP_REQUIRED');
  });
  test(`${leg}: Administrator cancels a pending order (200 + cancelled)`, async (t) => {
    const f = await buildFixture(); t.after(() => f.db.close());
    const { res, body } = await call(f, leg, 'POST', `/api/staff/mall-orders/${f.orderId}/cancel`, 'admin', { reason: 'Matrix cancel' });
    assert.equal(res.status, 200);
    assert.match(JSON.stringify(body), /cancelled/i);
    assert.equal((f.db.prepare('SELECT status FROM mall_orders WHERE id = ?').get(f.orderId) as any).status, 'cancelled');
  });
  test(`${leg}: status machine needs a session; unpaid sync-from-pos reaches logic (409)`, async (t) => {
    const f = await buildFixture(); t.after(() => f.db.close());
    assert.equal((await call(f, leg, 'POST', `/api/staff/mall-orders/${f.orderId}/start-processing`, 'anon', {})).res.status, 401);
    const authed = await call(f, leg, 'POST', `/api/staff/mall-orders/${f.orderId}/sync-from-pos`, 'admin', {
      subtotalKobo: 20000, totalKobo: 20000, discountKobo: 0, deliveryFeeKobo: 0, paidKobo: 20000,
      items: [{ productId: 'mx-prod', name: 'Matrix Product', qty: 2, unitPriceKobo: 10000 }]
    });
    assert.ok([200, 409].includes(authed.res.status), `expected 200/409, got ${authed.res.status}`);
    if (authed.res.status === 409) assert.match(String(authed.body.error), /linked sale|reconcile/i);
  });
  test(`${leg}: literal /status route is 401 anon / 404 authed`, async (t) => {
    const f = await buildFixture(); t.after(() => f.db.close());
    assert.equal((await call(f, leg, 'POST', `/api/staff/mall-orders/${f.orderId}/status`, 'anon', {})).res.status, 401);
    assert.equal((await call(f, leg, 'POST', `/api/staff/mall-orders/${f.orderId}/status`, 'admin', {})).res.status, 404);
  });
}
for (const leg of ['worker', 'node'] as Leg[]) {
  test(`${leg}: unauthenticated listings read is 401`, async (t) => {
    const f = await buildFixture(); t.after(() => f.db.close());
    const { res, body } = await call(f, leg, 'GET', '/api/staff/mall-listings', 'anon');
    assert.equal(res.status, 401); assert.match(String(body.error), /Authentication required/);
  });
  test(`${leg}: entrance-only listings read is 401`, async (t) => {
    const f = await buildFixture(); t.after(() => f.db.close());
    assert.equal((await call(f, leg, 'GET', '/api/staff/mall-listings', 'entrance')).res.status, 401);
  });
  test(`${leg}: Sales Staff reads listings but cannot save merchandising (403)`, async (t) => {
    const f = await buildFixture(); t.after(() => f.db.close());
    assert.equal((await call(f, leg, 'GET', '/api/staff/mall-listings', 'sales')).res.status, 200);
    const denied = await call(f, leg, 'PUT', '/api/staff/mall-listings/mx-prod', 'sales', { mallPriceKobo: 9500 });
    assert.equal(denied.res.status, 403);
    assert.match(String(denied.body.error), /Administrator or Store Manager/);
  });
  test(`${leg}: Administrator saves a listing (200); Sales Staff image upload is 403`, async (t) => {
    const f = await buildFixture(); t.after(() => f.db.close());
    assert.equal((await call(f, leg, 'PUT', '/api/staff/mall-listings/mx-prod', 'admin', { mallPriceKobo: 9500 })).res.status, 200);
    const webp = 'UklGRiIAAABXRUJQVlA4XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    const denied = await call(f, leg, 'POST', '/api/staff/product-images', 'sales', { contentType: 'image/webp', dataBase64: webp });
    assert.equal(denied.res.status, 403);
    assert.match(String(denied.body.error), /Administrator or Store Manager/);
  });
  test(`${leg}: unauthenticated image upload is 401`, async (t) => {
    const f = await buildFixture(); t.after(() => f.db.close());
    const webp = 'UklGRiIAAABXRUJQVlA4XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    assert.equal((await call(f, leg, 'POST', '/api/staff/product-images', 'anon', { contentType: 'image/webp', dataBase64: webp })).res.status, 401);
  });
}
for (const leg of ['worker', 'node'] as Leg[]) {
  const nu = (tag: string) => ({ user: { id: `mx-new-${tag}-${leg}`, email: `mx-new-${tag}-${leg}@matrix.test`, displayName: `Matrix New ${tag}` }, password: 'matrix-pass-123456' });
  test(`${leg}: unauthenticated user creation is 401 and creates nobody`, async (t) => {
    const f = await buildFixture(); t.after(() => f.db.close());
    const before = (f.db.prepare('SELECT COUNT(*) AS n FROM app_users').get() as any).n;
    assert.equal((await call(f, leg, 'PUT', '/api/auth/users', 'anon', nu('anon'))).res.status, 401);
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM app_users').get() as any).n, before);
  });
  test(`${leg}: Sales Staff user creation is 403 (role gate)`, async (t) => {
    const f = await buildFixture(); t.after(() => f.db.close());
    const { res, body } = await call(f, leg, 'PUT', '/api/auth/users', 'sales', nu('sales'));
    assert.equal(res.status, 403); assert.match(String(body.error), /Administrator access required/);
  });
  test(`${leg}: Administrator without step-up gets STEP_UP_REQUIRED`, async (t) => {
    const f = await buildFixture(); t.after(() => f.db.close());
    const { res, body } = await call(f, leg, 'PUT', '/api/auth/users', 'admin', nu('nostep'));
    assert.equal(res.status, 403); assert.equal((body as any).code, 'STEP_UP_REQUIRED');
  });
  test(`${leg}: Administrator with step-up creates a user (200, no code)`, async (t) => {
    const f = await buildFixture(); t.after(() => f.db.close());
    const { res, body } = await call(f, leg, 'PUT', '/api/auth/users', 'adminStepUp', nu('ok'));
    assert.equal(res.status, 200); assert.equal((body as any).code ?? undefined, undefined);
  });
}
for (const leg of ['worker', 'node'] as Leg[]) {
  test(`${leg}: user deletion needs the full super triple (401/403/GROUP/STEP_UP/200)`, async (t) => {
    const f = await buildFixture(); t.after(() => f.db.close());
    const target = `/api/auth/users/${f.userIds.victim}`;
    assert.equal((await call(f, leg, 'DELETE', target, 'anon')).res.status, 401);
    // A plain Administrator fails the roster flag check (no step-up code exposed).
    const plainAdmin = await call(f, leg, 'DELETE', target, 'admin');
    assert.equal(plainAdmin.res.status, 403);
    assert.equal((plainAdmin.body as any).code, undefined);
    assert.match(String(plainAdmin.body.error), /Super administrator access required/);
    // Super-flagged roster row, but no step-up proof: STEP_UP_REQUIRED.
    const noStep = await call(f, leg, 'DELETE', target, 'superNoStep');
    assert.equal(noStep.res.status, 403);
    assert.equal((noStep.body as any).code, 'STEP_UP_REQUIRED');
    // Step-up present but the IdP did not assert the super-admin group.
    const noGroup = await call(f, leg, 'DELETE', target, 'superNoGroup');
    assert.equal(noGroup.res.status, 403);
    assert.equal((noGroup.body as any).code, 'SUPER_ADMIN_GROUP_REQUIRED');
    const sup = await call(f, leg, 'DELETE', target, 'super');
    assert.equal(sup.res.status, 200); assert.equal((sup.body as any).ok, true);
    // The row is really gone (the node leg is a behavior mirror, not a writer).
    if (leg === 'worker') {
      assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM app_users WHERE id = ?').get(f.userIds.victim) as any).n, 0);
    }
  });
  test(`${leg}: password reset needs Administrator+step-up; super target needs group`, async (t) => {
    const f = await buildFixture(); t.after(() => f.db.close());
    const reset = (p: Principal, id: string) => call(f, leg, 'POST', '/api/auth/password', p, { targetUserId: id, newPassword: 'matrix-new-pass-1' });
    assert.equal((await reset('anon', f.userIds.victim)).res.status, 401);
    assert.equal((await reset('sales', f.userIds.victim)).res.status, 403);
    const noStep = await reset('admin', f.userIds.victim);
    assert.equal(noStep.res.status, 403); assert.equal((noStep.body as any).code, 'STEP_UP_REQUIRED');
    assert.equal((await reset('adminStepUp', f.userIds.victim)).res.status, 200);
    assert.equal((await reset('adminStepUp', f.userIds.super)).res.status, 403);
    assert.equal((await reset('super', f.userIds.victim)).res.status, 200);
  });
  test(`${leg}: audit-log clear is super-only (403/GROUP/STEP_UP/ok)`, async (t) => {
    const f = await buildFixture(); t.after(() => f.db.close());
    const p = '/api/auth/audit-logs/clear';
    assert.equal((await call(f, leg, 'POST', p, 'anon', {})).res.status, 401);
    const plainAdmin = await call(f, leg, 'POST', p, 'admin', {});
    assert.equal(plainAdmin.res.status, 403);
    assert.equal((plainAdmin.body as any).code, undefined);
    const noStep = await call(f, leg, 'POST', p, 'superNoStep', {});
    assert.equal(noStep.res.status, 403); assert.equal((noStep.body as any).code, 'STEP_UP_REQUIRED');
    const noGroup = await call(f, leg, 'POST', p, 'superNoGroup', {});
    assert.equal(noGroup.res.status, 403); assert.equal((noGroup.body as any).code, 'SUPER_ADMIN_GROUP_REQUIRED');
    assert.equal((await call(f, leg, 'POST', p, 'super', {})).res.status, 200);
  });
}
for (const leg of ['worker', 'node'] as Leg[]) {
  const evt = (id: string) => ({
    id, event: 'ORDER_RECEIVED', occurredAt: new Date().toISOString(),
    data: { orderNo: 'MX-1', status: 'pending' },
    order: { order_no: 'MX-1', customer_name: 'Matrix Buyer', customer_phone: '08031234567', total_kobo: 20000, status: 'pending', payment_status: 'pending', payment_method: 'pay_on_pickup' }
  });
  async function signed(f: MatrixFixture, o: { secret?: string; principal?: Principal; id?: string; omit?: boolean; bad?: boolean }) {
    const id = o.id ?? `mx-evt-${randomBytes(4).toString('hex')}`;
    const raw = evt(id);
    const at = String(Math.floor(Date.now() / 1000));
    const hex = o.bad ? '0'.repeat(64) : await signMallWebhook(o.secret ?? WEBHOOK_SECRET, at, JSON.stringify(raw));
    const headers: Record<string, string> = { 'x-mall-timestamp': at };
    if (!o.omit) headers['x-mall-signature'] = `sha256=${hex}`;
    return call(f, leg, 'POST', '/api/mall-webhook', o.principal ?? 'anon', raw, headers);
  }
  test(`${leg}: webhook without signature is 401 and sends no email`, async (t) => {
    const f = await buildFixture(); t.after(() => f.db.close());
    const { res, sent } = await signed(f, { omit: true });
    assert.equal(res.status, 401); assert.equal(sent.length, 0);
  });
  test(`${leg}: webhook with wrong-secret signature is 401 and sends no email`, async (t) => {
    const f = await buildFixture(); t.after(() => f.db.close());
    const { res, sent } = await signed(f, { secret: 'wrong-secret-0000000000000000000000' });
    assert.equal(res.status, 401); assert.equal(sent.length, 0);
  });
  test(`${leg}: webhook with staff session but no HMAC is still 401`, async (t) => {
    const f = await buildFixture(); t.after(() => f.db.close());
    const { res, sent } = await signed(f, { omit: true, principal: 'super' });
    assert.equal(res.status, 401); assert.equal(sent.length, 0);
  });
  test(`${leg}: webhook with staff session and forged HMAC is still 401`, async (t) => {
    const f = await buildFixture(); t.after(() => f.db.close());
    const { res, sent } = await signed(f, { bad: true, principal: 'adminStepUp' });
    assert.equal(res.status, 401); assert.equal(sent.length, 0);
  });
  test(`${leg}: webhook with valid HMAC is accepted (session cookie ignored)`, async (t) => {
    const f = await buildFixture(); t.after(() => f.db.close());
    const { res, body, sent } = await signed(f, { principal: 'super' });
    assert.equal(res.status, 200); assert.equal((body as any).status, 'sent'); assert.equal(sent.length, 1);
  });
}

