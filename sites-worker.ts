interface Env {
  ASSETS: {fetch(request: Request): Promise<Response>};
  DB: D1Database;
  GEMINI_API_KEY?: string;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{results?: T[]}>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

const ALLOWED_STORES = new Set([
  'products', 'customers', 'suppliers', 'sales', 'purchases', 'expenses',
  'notifications', 'auditLogs', 'stockMovements', 'pricingHistory', 'settings',
  'heldOrders', 'whatsAppPreOrders', 'deliveryOrders', 'moneyMovements',
]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json; charset=utf-8'},
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
    {name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations},
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

async function ensureSchema(env: Env) {
  await env.DB.batch([
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
  ]);
}

async function seedUser(env: Env, user: {id: string; email: string; username: string; displayName: string; password: string; superAdmin: boolean}) {
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
  await seedUser(env, {id: 'usr-superadmin-idofera', email: 'michaelidongesit5@gmail.com', username: 'idofera', displayName: 'Super Admin', password: 'aidy2800', superAdmin: true});
  await seedUser(env, {id: 'usr-admin-1', email: 'admin@idoferapackaging.com', username: 'admin', displayName: 'Administrator', password: 'admin123', superAdmin: false});
}

async function ensureBusinessDataOwner(env: Env) {
  const current = await env.DB.prepare('SELECT 1 AS present FROM app_documents WHERE owner_id = ? LIMIT 1').bind(BUSINESS_OWNER_ID).all();
  if (current.results?.length) return;
  const legacy = await env.DB.prepare('SELECT owner_id FROM app_documents WHERE owner_id != ? GROUP BY owner_id ORDER BY COUNT(*) DESC LIMIT 1')
    .bind(BUSINESS_OWNER_ID).all<{owner_id: string}>();
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
  return {token, maxAge: Math.floor((expiresAt - now) / 1000)};
}

async function authLogin(request: Request, env: Env) {
  await ensureAuthSeed(env);
  const body = await readJson(request);
  const identifier = String(body?.identifier || '').trim().toLowerCase();
  const password = String(body?.password || '');
  if (!identifier || !password) return json({error: 'Email/username and password are required.'}, 400);
  const rows = await env.DB.prepare('SELECT * FROM app_users WHERE lower(email) = ? OR lower(username) = ? LIMIT 1')
    .bind(identifier, identifier).all<AppUserRow>();
  const user = rows.results?.[0];
  if (!user || user.status !== 'Active') return json({error: 'Invalid credentials or inactive account.'}, 401);
  const candidate = await hashPassword(password, user.password_salt, user.password_iterations);
  if (!safeEqual(candidate, user.password_hash)) return json({error: 'Invalid credentials or inactive account.'}, 401);
  const lastLogin = new Date().toISOString();
  await env.DB.prepare('UPDATE app_users SET last_login = ? WHERE id = ?').bind(lastLogin, user.id).run();
  const session = await createSession(user.id, env);
  await ensureBusinessDataOwner(env);
  const response = json({user: publicUser({...user, last_login: lastLogin})});
  response.headers.set('set-cookie', sessionCookie(session.token, session.maxAge));
  return response;
}

async function authGoogle(request: Request, env: Env) {
  await ensureAuthSeed(env);
  const body = await readJson(request);
  const accessToken = String(body?.accessToken || '');
  if (!accessToken) return json({error: 'Google access token is required.'}, 400);
  const googleResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {headers: {authorization: `Bearer ${accessToken}`}});
  if (!googleResponse.ok) return json({error: 'Google authentication could not be verified.'}, 401);
  const googleUser = await googleResponse.json() as {email?: string; email_verified?: boolean};
  if (!googleUser.email || googleUser.email_verified === false) return json({error: 'A verified Google email is required.'}, 401);
  const rows = await env.DB.prepare('SELECT * FROM app_users WHERE lower(email) = ? LIMIT 1').bind(googleUser.email.toLowerCase()).all<AppUserRow>();
  const user = rows.results?.[0];
  if (!user || user.status !== 'Active') return json({error: 'This Google account is not registered or is inactive.'}, 403);
  const lastLogin = new Date().toISOString();
  await env.DB.prepare('UPDATE app_users SET last_login = ? WHERE id = ?').bind(lastLogin, user.id).run();
  const session = await createSession(user.id, env);
  await ensureBusinessDataOwner(env);
  const response = json({user: publicUser({...user, last_login: lastLogin})});
  response.headers.set('set-cookie', sessionCookie(session.token, session.maxAge));
  return response;
}

async function authSession(request: Request, env: Env) {
  await ensureAuthSeed(env);
  const user = await requireAppUser(request, env);
  return user ? json({user: publicUser(user)}) : json({user: null}, 401);
}

async function authLogout(request: Request, env: Env) {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await env.DB.prepare('DELETE FROM app_sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  const response = json({ok: true});
  response.headers.set('set-cookie', sessionCookie('', 0));
  return response;
}

async function authUsers(request: Request, env: Env) {
  const actor = await requireAppUser(request, env);
  if (!actor) return json({error: 'Authentication required.'}, 401);
  const rows = await env.DB.prepare('SELECT * FROM app_users ORDER BY is_super_admin DESC, display_name').all<AppUserRow>();
  return json({users: (rows.results || []).map(publicUser)});
}

async function upsertAuthUser(request: Request, env: Env) {
  const actor = await requireAppUser(request, env);
  if (!actor || actor.role !== 'Administrator') return json({error: 'Administrator access required.'}, 403);
  const body = await readJson(request);
  const input = body?.user || {};
  const id = String(input.id || '');
  if (!id || !input.email || !input.displayName) return json({error: 'User id, email, and display name are required.'}, 400);
  const existingRows = await env.DB.prepare('SELECT * FROM app_users WHERE id = ?').bind(id).all<AppUserRow>();
  const existing = existingRows.results?.[0];
  const password = String(body?.password || input.password || '');
  if (!existing && password.length < 8) return json({error: 'A password of at least 8 characters is required.'}, 400);
  let salt = existing?.password_salt || randomHex(16);
  let hash = existing?.password_hash || '';
  let changedAt = existing?.password_last_changed || new Date().toISOString();
  if (password) {
    if (password.length < 8) return json({error: 'Password must be at least 8 characters.'}, 400);
    salt = randomHex(16); hash = await hashPassword(password, salt); changedAt = new Date().toISOString();
  }
  await env.DB.prepare(
    'INSERT INTO app_users (id, email, username, display_name, role, status, avatar_url, password_hash, password_salt, password_iterations, is_super_admin, is_protected, created_at, last_login, password_last_changed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET email=excluded.email, username=excluded.username, display_name=excluded.display_name, role=excluded.role, status=excluded.status, avatar_url=excluded.avatar_url, password_hash=excluded.password_hash, password_salt=excluded.password_salt, password_iterations=excluded.password_iterations, last_login=excluded.last_login, password_last_changed=excluded.password_last_changed',
  ).bind(id, String(input.email).toLowerCase(), input.username || null, input.displayName, input.role || 'Sales Staff', input.status || 'Active', input.avatarUrl || null, hash, salt, PASSWORD_ITERATIONS, existing?.is_super_admin || 0, existing?.is_protected || 0, input.createdAt || existing?.created_at || new Date().toISOString(), input.lastLogin || existing?.last_login || null, changedAt).run();
  return json({ok: true});
}

async function deleteAuthUser(request: Request, env: Env, id: string) {
  const actor = await requireAppUser(request, env);
  if (!actor || !actor.is_super_admin) return json({error: 'Super administrator access required.'}, 403);
  if (id === actor.id || id === 'usr-superadmin-idofera') return json({error: 'Protected account cannot be deleted.'}, 400);
  await env.DB.prepare('DELETE FROM app_users WHERE id = ?').bind(id).run();
  return json({ok: true});
}

async function changeAuthPassword(request: Request, env: Env) {
  const actor = await requireAppUser(request, env);
  if (!actor) return json({error: 'Authentication required.'}, 401);
  const body = await readJson(request);
  const targetId = String(body?.targetUserId || actor.id);
  const newPassword = String(body?.newPassword || '');
  const oldPassword = String(body?.oldPassword || '');
  if (newPassword.length < 8) return json({error: 'Password must be at least 8 characters.'}, 400);
  const rows = await env.DB.prepare('SELECT * FROM app_users WHERE id = ?').bind(targetId).all<AppUserRow>();
  const target = rows.results?.[0];
  if (!target) return json({error: 'User not found.'}, 404);
  if (targetId === actor.id) {
    const candidate = await hashPassword(oldPassword, actor.password_salt, actor.password_iterations);
    if (!oldPassword || !safeEqual(candidate, actor.password_hash)) return json({error: 'Current password is incorrect.'}, 401);
  } else {
    if (actor.role !== 'Administrator') return json({error: 'Administrator access required.'}, 403);
    if (target.is_super_admin && !actor.is_super_admin) return json({error: 'Only the super administrator can reset this password.'}, 403);
  }
  const salt = randomHex(16);
  const changedAt = new Date().toISOString();
  await env.DB.prepare('UPDATE app_users SET password_hash = ?, password_salt = ?, password_iterations = ?, password_last_changed = ? WHERE id = ?')
    .bind(await hashPassword(newPassword, salt), salt, PASSWORD_ITERATIONS, changedAt, targetId).run();
  if (targetId !== actor.id) await env.DB.prepare('DELETE FROM app_sessions WHERE user_id = ?').bind(targetId).run();
  return json({ok: true, passwordLastChanged: changedAt});
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
  if (!body?.stores || typeof body.stores !== 'object') return json({error: 'A stores object is required.'}, 400);

  const revisionRows = await env.DB.prepare('SELECT revision FROM sync_revisions WHERE owner_id = ?')
    .bind(ownerId).all<{revision: number}>();
  const currentRevision = Number(revisionRows.results?.[0]?.revision || 0);
  const expectedRevision = Number(body.expectedRevision || 0);
  if (expectedRevision !== currentRevision) {
    return json({error: 'Snapshot revision conflict.', revision: currentRevision}, 409);
  }

  const now = Date.now();
  const revision = Math.max(now, currentRevision + 1);
  const statements: D1PreparedStatement[] = [];
  for (const [collection, documents] of Object.entries(body.stores)) {
    if (!ALLOWED_STORES.has(collection) || !Array.isArray(documents)) continue;
    statements.push(env.DB.prepare('DELETE FROM app_documents WHERE owner_id = ? AND collection = ?').bind(ownerId, collection));
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

  for (let offset = 0; offset < statements.length; offset += 75) {
    await env.DB.batch(statements.slice(offset, offset + 75));
  }
  return json({ok: true, revision, collections: Object.keys(body.stores).filter((name) => ALLOWED_STORES.has(name))});
}

async function readSnapshot(request: Request, env: Env) {
  await ensureSchema(env);
  const ownerId = BUSINESS_OWNER_ID;
  const rows = await env.DB.prepare(
    'SELECT collection, document_id, payload, updated_at FROM app_documents WHERE owner_id = ? ORDER BY collection, document_id',
  ).bind(ownerId).all<{collection: string; document_id: string; payload: string; updated_at: number}>();
  const stores: Record<string, unknown[]> = {};
  for (const row of rows.results || []) {
    try {
      (stores[row.collection] ||= []).push(JSON.parse(row.payload));
    } catch {
      // Ignore a malformed row without making the rest of the snapshot unreadable.
    }
  }
  const revisions = await env.DB.prepare('SELECT revision FROM sync_revisions WHERE owner_id = ?')
    .bind(ownerId).all<{revision: number}>();
  return json({stores, hasData: Object.keys(stores).length > 0, revision: Number(revisions.results?.[0]?.revision || 0)});
}

async function patchRecords(request: Request, env: Env) {
  await ensureSchema(env);
  const ownerId = BUSINESS_OWNER_ID;
  const body = await readJson(request);
  const upserts = Array.isArray(body?.upserts) ? body.upserts : [];
  const deletes = Array.isArray(body?.deletes) ? body.deletes : [];
  if (upserts.length + deletes.length > 5000) return json({error: 'Too many records in one sync.'}, 413);

  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  for (const item of upserts) {
    const collection = String(item?.collection || '');
    const document = item?.document;
    if (!ALLOWED_STORES.has(collection) || !document || typeof document !== 'object') continue;
    const documentId = String(document.id || 'singleton');
    statements.push(env.DB.prepare(
      'INSERT INTO app_documents (owner_id, collection, document_id, payload, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner_id, collection, document_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at',
    ).bind(ownerId, collection, documentId, JSON.stringify(document), now));
  }
  for (const item of deletes) {
    const collection = String(item?.collection || '');
    const documentId = String(item?.documentId || '');
    if (!ALLOWED_STORES.has(collection) || !documentId) continue;
    statements.push(env.DB.prepare(
      'DELETE FROM app_documents WHERE owner_id = ? AND collection = ? AND document_id = ?',
    ).bind(ownerId, collection, documentId));
  }

  const revisions = await env.DB.prepare('SELECT revision FROM sync_revisions WHERE owner_id = ?')
    .bind(ownerId).all<{revision: number}>();
  const revision = Math.max(now, Number(revisions.results?.[0]?.revision || 0) + 1);
  statements.push(env.DB.prepare(
    'INSERT INTO sync_revisions (owner_id, revision, updated_at) VALUES (?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at',
  ).bind(ownerId, revision, now));

  for (let offset = 0; offset < statements.length; offset += 75) {
    await env.DB.batch(statements.slice(offset, offset + 75));
  }
  return json({ok: true, revision, upserted: upserts.length, deleted: deletes.length});
}

async function askGemini(apiKey: string, prompt: string) {
  const model = 'gemini-2.5-flash';
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({contents: [{parts: [{text: prompt}]}]}),
    },
  );
  if (!response.ok) throw new Error(`Gemini request failed (${response.status})`);
  const data = await response.json() as any;
  return (data.candidates?.[0]?.content?.parts || [])
    .map((part: {text?: string}) => part.text || '')
    .join('')
    .trim();
}

function stripJsonFence(text: string) {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

async function businessAssistant(request: Request, env: Env) {
  const body = await readJson(request);
  if (!body?.prompt) return json({error: 'A prompt is required.'}, 400);
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
  return json({answer, source: 'gemini-2.5-flash'});
}

async function pricingAssistant(request: Request, env: Env) {
  const body = await readJson(request);
  const product = body?.product;
  if (!product) return json({error: 'A product is required.'}, 400);
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
  return json({...JSON.parse(stripJsonFence(text)), source: 'gemini-2.5-flash'});
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
  return json({...JSON.parse(stripJsonFence(text)), source: 'gemini-2.5-flash'});
}

async function serveAsset(request: Request, env: Env) {
  let response = await env.ASSETS.fetch(request);
  const url = new URL(request.url);
  const acceptsHtml = request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html');
  if (response.status === 404 && acceptsHtml) {
    response = await env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
  }
  const headers = new Headers(response.headers);
  if (url.pathname === '/' || url.pathname === '/index.html') {
    headers.set('cache-control', 'no-cache, max-age=0');
    headers.delete('content-length');
    const html = (await response.text()).replaceAll('__SITE_ORIGIN__', url.origin);
    return new Response(html, {status: response.status, statusText: response.statusText, headers});
  } else if (url.pathname.startsWith('/assets/')) {
    headers.set('cache-control', 'public, max-age=31536000, immutable');
  }
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health') return json({status: 'ok', app: 'IdoferaLabs API', timestamp: new Date().toISOString()});
      if (url.pathname === '/api/storage/d1/health') {
        await ensureSchema(env);
        const ownerId = BUSINESS_OWNER_ID;
        const revisions = await env.DB.prepare('SELECT revision FROM sync_revisions WHERE owner_id = ?').bind(ownerId).all<{revision: number}>();
        const docCount = await env.DB.prepare('SELECT count(*) as count FROM app_documents WHERE owner_id = ?').bind(ownerId).all<{count: number}>();
        return json({
          status: 'healthy',
          connected: true,
          databaseId: '3e95a550-a091-490b-819d-f0acb7ea8dd8',
          revision: Number(revisions.results?.[0]?.revision || 0),
          totalDocuments: Number(docCount.results?.[0]?.count || 0),
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
      if (url.pathname.startsWith('/api/')) return json({error: 'Not found'}, 404);
      return await serveAsset(request, env);
    } catch (error) {
      return json({error: error instanceof Error ? error.message : 'Unexpected server error'}, 500);
    }
  },
};
