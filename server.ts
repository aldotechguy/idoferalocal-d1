import express from "express";
import type { Request, Response } from "express";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import { DatabaseSync } from "node:sqlite";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { isStaffPage, isPrivateApi, issueEntrance, hasEntrance, revokeEntrance, entranceCookie } from './src/server/staffEntrance';
import { verifyAccessToken } from './src/server/accessJwt';
import { staffSuperAdminSession, staffPrivilegeCheck, staffEditorCheck } from './src/server/staffPrivileges';
import { STEP_UP_SECONDS, issueStepUp, hasStepUp, revokeStepUp, revokeStepUpForUser, stepUpCookie } from './src/server/stepUp';
import { SESSION_COOKIE, sessionExpiry, sessionIdleSeconds, sessionIdleExpired, isMissingIdleColumn } from './src/server/staffSession';

dotenv.config();

const app = express();
const PORT = 3000;

/**
 * #18 — the Node runtime must serve the SAME `/api/mall-webhook` receiver the
 * Worker does. Without it, the scheduled outbox drain fetched MALL_WEBHOOK_URL,
 * hit this server's 404, and dead-lettered every order event: no email was ever
 * sent. Registered BEFORE the global JSON parser and with express.raw so the
 * HMAC is verified against the exact bytes the scheduler signed (re-serializing
 * parsed JSON would change the bytes and fail every signature).
 */
const webhookDb: WebhookDatabase = {
  prepare: (sql: string) => {
    let params: unknown[] = [];
    const statement = {
      bind(...values: unknown[]) { params = values; return statement; },
      async run() { return { meta: { changes: Number(db.prepare(sql).run(...(params as any[])).changes) } }; },
      async all() { return { results: db.prepare(sql).all(...(params as any[])) as any[] }; },
    };
    return statement;
  },
};

app.post("/api/mall-webhook", express.raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
  try {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? ""));
    const request = new globalThis.Request("http://localhost:3000/api/mall-webhook", {
      method: "POST",
      headers: {
        "content-type": String(req.headers["content-type"] || "application/json"),
        "x-mall-signature": String(req.headers["x-mall-signature"] || ""),
        "x-mall-timestamp": String(req.headers["x-mall-timestamp"] || ""),
      },
      body,
    });
    const response = await handleMallWebhook(request, { ...process.env, DB: webhookDb });
    return res.status(response.status).set("content-type", "application/json").send(await response.text());
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Webhook receiver error" });
  }
});

app.use(express.json({ limit: "50mb" }));
app.use("/mall", express.json({ limit: "50mb" }));

// Initialize Local SQLite Database simulating Cloudflare D1
const DB_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const DB_PATH = path.join(DB_DIR, "d1_storage.db");

function createDatabaseInstance(): DatabaseSync {
  try {
    const instance = new DatabaseSync(DB_PATH);
    instance.exec("PRAGMA journal_mode = WAL;");
    instance.exec("PRAGMA synchronous = NORMAL;");
    return instance;
  } catch (error) {
    console.error("SQLite failed to initialize or file was corrupted, recreating cleanly:", error);
    try {
      if (fs.existsSync(DB_PATH)) {
        fs.renameSync(DB_PATH, `${DB_PATH}.corrupted.${Date.now()}`);
      }
    } catch (e) {
      console.error("Failed to rename corrupted db:", e);
    }
    const fresh = new DatabaseSync(DB_PATH);
    fresh.exec("PRAGMA journal_mode = WAL;");
    return fresh;
  }
}

let db = createDatabaseInstance();

// Phase 4 — relational backend (100% relational). Local node:sqlite carries the
// SAME tables as D1 `idofera` (DDL single-sourced from drizzle/0000_unified-relational.sql).
// The mapper translates rows <-> the unchanged frontend snapshot shape, so the
// UI needs zero changes. The legacy `app_documents` JSON mirror is GONE: the store
// is relational-only and the sync revision is derived via src/server/syncWatermark.ts.
import { makeNodeAdapter } from "./src/server/nodeAdapter";
import { ensureRelationalSchemaNode, makeNodeMallExecutor } from "./src/server/nodeAdapter";
import { handleMallApi, invalidateMallFacetCache } from "./src/server/mallApi";
import { handleStaffMallApi, maintainMall } from "./src/server/mallOrderAdminApi";
import { handleStaffMallListingApi } from "./src/server/mallListingApi";
import { handleStaffProductImageApi, handlePublicImageRequest } from "./src/server/productImageApi";
import { makeNodeImageStore } from "./src/server/nodeImageStore";
import { handleMallWebhook, type WebhookDatabase } from "./src/server/mallWebhook";
import { bootstrapAdmin } from "./src/server/adminBootstrap";
import { buildSnapshot, SNAPSHOT_PUSH_DOC_LIMIT } from "./src/server/relationalSnapshot.js";
import {
  upsertToStatements,
  deleteToStatements,
  replaceCollectionStatements,
} from "./src/server/relationalWrites.js";
import { currentRevision, bumpWatermark } from "./src/server/syncWatermark.js";
const USE_RELATIONAL = process.env.VITE_USE_RELATIONAL !== "false";
try {
  const created = ensureRelationalSchemaNode(db);
  console.log(`Relational schema ready (${created} tables, backend=relational).`);
} catch (e) {
  throw new Error('Relational schema initialization failed; resolve migration conflicts before accepting orders.', {cause:e});
}

/**
 * 100% relational: the legacy `app_documents` -> relational backfill bridge has been
 * REMOVED. `idofera` (and the local node store) no longer carry a document mirror,
 * so there is nothing to project. Kept as an explicit no-op so the snapshot response
 * shape (`backfill`) stays stable for older clients.
 */
async function ensureRelationalBackfill(): Promise<{ statements: number; documents: number; skipped: number }> {
  return { statements: 0, documents: 0, skipped: 0 };
}

// Initialize schema with corruption protection
function initSchema() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS app_users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        username TEXT UNIQUE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'Sales Staff',
        status TEXT NOT NULL DEFAULT 'Active',
        avatar_url TEXT,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        password_iterations INTEGER NOT NULL,
        is_super_admin INTEGER NOT NULL DEFAULT 0,
        is_protected INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_login TEXT,
        password_last_changed TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL DEFAULT 0
      );
    `);
  } catch (err) {
    console.error("Failed to run schema exec, recreating DB from scratch:", err);
    try {
      if (fs.existsSync(DB_PATH)) {
        fs.unlinkSync(DB_PATH);
      }
      db = new DatabaseSync(DB_PATH);
      db.exec("PRAGMA journal_mode = WAL;");
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          username TEXT UNIQUE,
          display_name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'Sales Staff',
          status TEXT NOT NULL DEFAULT 'Active',
          avatar_url TEXT,
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          password_iterations INTEGER NOT NULL,
          is_super_admin INTEGER NOT NULL DEFAULT 0,
          is_protected INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          last_login TEXT,
          password_last_changed TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS app_sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL DEFAULT 0
        );
      `);
    } catch (criticalErr) {
      console.error("Critical SQLite init error:", criticalErr);
    }
  }
}

initSchema();

/**
 * Idle tracking on an `app_sessions` table that predates it. `DEFAULT 0` is
 * deliberate (see the Worker's identical migration): an existing row reads as
 * "never seen", so its first request refreshes it rather than granting a fresh
 * full idle window to a session that may have been abandoned.
 */
try {
  db.prepare("ALTER TABLE app_sessions ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0").run();
} catch (error: any) {
  if (!/duplicate column/i.test(String(error?.message || error))) {
    console.warn("app_sessions idle column skipped:", error?.message || error);
  }
}

const BUSINESS_OWNER_ID = "idofera-business";
const PASSWORD_ITERATIONS = 100000;
const ALLOWED_STORES = new Set([
  "products",
  "customers",
  "suppliers",
  "sales",
  "purchases",
  "expenses",
  "notifications",
  "auditLogs",
  "stockMovements",
  "pricingHistory",
  "settings",
  "heldOrders",
  "whatsAppPreOrders",
  "deliveryOrders",
  "moneyMovements",
]);

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function randomHex(bytes = 16): string {
  return crypto.randomBytes(bytes).toString("hex");
}

function hashPassword(password: string, salt: string, iterations = PASSWORD_ITERATIONS): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, 32, "sha256", (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey.toString("hex"));
    });
  });
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function readCookie(req: Request, name: string): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  const customHeader = req.headers["x-session-token"];
  if (typeof customHeader === "string" && customHeader.trim()) {
    return customHeader.trim();
  }
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function publicUser(user: any) {
  return {
    id: user.id,
    email: user.email,
    username: user.username || undefined,
    displayName: user.display_name,
    role: user.role,
    status: user.status,
    avatarUrl: user.avatar_url || undefined,
    createdAt: user.created_at,
    lastLogin: user.last_login || undefined,
    passwordLastChanged: user.password_last_changed,
    superAdmin: Boolean(user.is_super_admin),
    isSuperAdmin: Boolean(user.is_super_admin),
    protected: Boolean(user.is_protected),
    isProtected: Boolean(user.is_protected),
  };
}

async function seedUser(user: { id: string; email: string; username: string; displayName: string; password: string; superAdmin: boolean }) {
  const salt = randomHex(16);
  const hash = await hashPassword(user.password, salt);
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO app_users (
      id, email, username, display_name, role, status, password_hash, password_salt, password_iterations, is_super_admin, is_protected, created_at, password_last_changed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    user.id,
    user.email,
    user.username,
    user.displayName,
    "Administrator",
    "Active",
    hash,
    salt,
    PASSWORD_ITERATIONS,
    user.superAdmin ? 1 : 0,
    user.superAdmin ? 1 : 0,
    now,
    now
  );
}

async function ensureAuthSeed() {
  if (db.prepare('SELECT id FROM app_users LIMIT 1').get()) return;
  const admin = bootstrapAdmin(process.env);
  if (admin) await seedUser(admin);
}

// Initial seed
ensureAuthSeed().catch(console.error);

// 100% relational: the legacy document-store owner migration
// (`app_documents`/`sync_revisions` copied into the `idofera-business` owner) has
// been REMOVED with the document mirror. The relational store is owner-less and
// canonical, so there is nothing to migrate.

async function requireAppUser(req: Request): Promise<any | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = sha256(token);
  const now = Date.now();
  const idleSeconds = sessionIdleSeconds(process.env);
  const select = (projection: string) => db.prepare(`
    SELECT u.*, ${projection} AS session_last_seen, s.created_at AS session_created FROM app_sessions s
    JOIN app_users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = ?
  `).get(tokenHash, now, "Active") as any;
  let row: any;
  try {
    row = select("s.last_seen_at");
  } catch (error: any) {
    // Parity with sites-worker.ts: the gate runs before the schema migration, so
    // between a local start and the first pass the idle column can be absent.
    if (!isMissingIdleColumn(error)) throw error;
    row = select("NULL");
  }
  if (!row) return null;
  // Parity with sites-worker.ts: an abandoned terminal stops authorizing private
  // APIs even before the absolute expiry (docs/staff-access.md). A row whose
  // `last_seen_at` is null/0 predates idle tracking, so its mint time is the
  // baseline rather than a fresh full window.
  const lastSeen = Number(row.session_last_seen || 0) || Number(row.session_created || 0);
  if (lastSeen && sessionIdleExpired(lastSeen, now, idleSeconds)) return null;
  // Touch the row so the window measures from THIS request, not the mint.
  try {
    db.prepare("UPDATE app_sessions SET last_seen_at = ? WHERE token_hash = ?").run(now, tokenHash);
  } catch (error: any) {
    if (!isMissingIdleColumn(error)) throw error;
  }
  return row;
}

async function createSession(userId: string, res: Response) {
  await revokeEntrance(res.req.headers.cookie || '', entranceQuery);
  res.append('Set-Cookie', entranceCookie('', res.req.secure));
  const token = randomHex(32);
  const now = Date.now();
  const expiresAt = sessionExpiry(now);
  const maxAge = Math.floor((expiresAt - now) / 1000);
  const stmt = db.prepare("INSERT INTO app_sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)");
  stmt.run(sha256(token), userId, now, expiresAt, now);

  res.cookie(SESSION_COOKIE, token, {
    maxAge: maxAge * 1000,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return token;
}

// Lazy init Gemini AI
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// =================== AUTH ROUTES ===================
const entranceQuery = async (sql: string, params: any[]) => db.prepare(sql).all(...params);

/* ---------------- Cloudflare Access staff gate (docs/staff-access.md) ----------------
 * Access authenticates a person and injects a signed JWT on every request to a
 * covered path. It grants no privileges: the roster decides who the email is,
 * `app_users.is_super_admin` decides what they may do, and a fresh password
 * step-up is required before any privileged change.
 */
const stepUpQuery = async (sql: string, params: any[]) => db.prepare(sql).all(...params) as any[];

function stepUpLifetimeSeconds() {
  const parsed = Number(process.env.CF_ACCESS_STEP_UP_SECONDS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : STEP_UP_SECONDS;
}

/** Verifies the Access JWT when the gate is configured. Raw headers are never trusted. */
async function accessIdentityFor(req: Request) {
  const teamDomain = process.env.CF_ACCESS_TEAM_DOMAIN;
  const audience = process.env.CF_ACCESS_AUD;
  if (!teamDomain || !audience) return null;
  const header = req.headers['cf-access-jwt-assertion'];
  const token = Array.isArray(header) ? header[0] : header;
  return await verifyAccessToken(String(token || ''), { teamDomain, audience });
}

/**
 * Parity with `sites-worker.ts#accessGateMisconfigured`: Access injected its
 * signed assertion yet this deployment cannot read an identity from it — always
 * a stale/absent `CF_ACCESS_AUD` for this hostname, or a gate left unconfigured
 * on a host Access fronts. An anonymous browser never reaches the origin with
 * the header set, so this is never "no entrance".
 */
function accessGateMisconfigured(req: Request) {
  const header = req.headers['cf-access-jwt-assertion'];
  const token = Array.isArray(header) ? header[0] : header;
  if (!token) return false;
  if (process.env.CF_ACCESS_SSO !== 'true') return true;
  return !process.env.CF_ACCESS_TEAM_DOMAIN || !process.env.CF_ACCESS_AUD;
}

/**
 * Names the Audience tag Access is actually minting (`aud` in the unverified
 * assertion — used ONLY for this message, never for an auth decision) so the
 * broken configuration is legible without any dashboard access.
 */
function accessGateMisconfiguredPage(req: Request) {
  const header = req.headers['cf-access-jwt-assertion'];
  const token = String((Array.isArray(header) ? header[0] : header) || '');
  let tag = 'unavailable';
  const payloadSegment = token.split('.')[1];
  if (payloadSegment) {
    try {
      const padded = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
      const parsed = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as { aud?: unknown };
      if (typeof parsed.aud === 'string') tag = parsed.aud;
      else if (Array.isArray(parsed.aud)) tag = parsed.aud.filter((entry: unknown) => typeof entry === 'string').join(', ');
    } catch { /* the message below is still actionable */ }
  }
  const hostname = String(req.headers.host || 'this host');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Staff Access is misconfigured</title></head>` +
    `<body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:2rem">` +
    `<main style="max-width:44rem;margin:0 auto">` +
    `<h1 style="font-size:1.5rem;color:#fbbf24">Cloudflare Access is configured, but this deployment is not</h1>` +
    `<p>Access authenticated you for <strong>${hostname}</strong>, and then handed the server a signed identity it could not verify. ` +
    `This is a <strong>deployment configuration</strong> problem — your OTP was accepted; the staff gate for this hostname has not been granted the Audience tag Access uses.</p>` +
    `<p>Access is minting this Audience tag for <strong>${hostname}</strong>:</p>` +
    `<pre style="background:#1e293b;padding:.75rem;border-radius:.5rem;overflow-wrap:anywhere;white-space:pre-wrap">${tag}</pre>` +
    `<p>Add it to <code>CF_ACCESS_AUD</code> (comma-separated), make sure <code>CF_ACCESS_SSO="true"</code> and <code>CF_ACCESS_TEAM_DOMAIN</code> are set, then redeploy.</p>` +
    `<p style="color:#94a3b8">No shopper is affected: the storefront and checkout are deliberately outside the Access application.</p>` +
    `</main></body></html>`;
}

const stepUpRequired = (res: Response) =>
  res.status(403).json({ error: 'Confirm your password to continue.', code: 'STEP_UP_REQUIRED' });

async function stepUpVerified(req: Request, userId: string) {
  return await hasStepUp(req.headers.cookie || '', userId, stepUpQuery);
}

/**
 * A super-admin session is the DB column AND, when `CF_ACCESS_SUPER_ADMIN_GROUP`
 * is configured, the IdP group. Both are re-evaluated on every request, so
 * removing somebody from the IdP group downgrades their next call.
 */
async function superAdminSession(req: Request, actor: any) {
  return staffSuperAdminSession(actor, await accessIdentityFor(req), process.env.CF_ACCESS_SUPER_ADMIN_GROUP);
}

const privilegeResponse = (res: Response, decision: { status: 401 | 403; error: string; code?: string }) =>
  res.status(decision.status).json({ error: decision.error, ...(decision.code ? { code: decision.code } : {}) });

/** Super-admin action: DB flag + IdP group + a fresh password step-up. */
async function requireSuperAdmin(req: Request, res: Response): Promise<{ actor: any } | { denied: Response }> {
  const actor = await requireAppUser(req);
  const decision = staffPrivilegeCheck({
    actor,
    identity: await accessIdentityFor(req),
    requiredGroup: process.env.CF_ACCESS_SUPER_ADMIN_GROUP,
    stepUp: actor ? await stepUpVerified(req, actor.id) : false,
  });
  // `.ok === false` (not `!decision.ok`): this repo compiles without strictNullChecks,
  // where truthiness checks don't narrow the {ok:true}|denial union but a literal comparison does.
  if (decision.ok === false) return { denied: privilegeResponse(res, decision) };
  return { actor };
}
app.use(async (req, res, next) => {
  try {
    const cookie = req.headers.cookie || '';
    if (req.path === '/api/auth/entrance') {
      if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});
      const origin = `${req.protocol}://${req.get('host')}`;
      if (req.get('origin') !== origin || req.get('x-staff-entrance') !== 'cart-hold') return res.status(403).json({error: 'Forbidden'});
      res.setHeader('Set-Cookie', entranceCookie(await issueEntrance(entranceQuery), req.secure));
      return res.set('Cache-Control', 'no-store').json({ok: true});
    }
    const login = ['/api/auth/login', '/api/auth/google'].includes(req.path);
    const staffPage = isStaffPage(req.path);
    if (staffPage || isPrivateApi(req.path) || login) {
      // The staff entrance is a SECOND factor in front of the staff pages and the
      // private APIs. It must NOT apply to the sign-in endpoints themselves:
      // requiring an entrance cookie to log in is circular, because the entrance
      // is only issued after a successful sign-in. This term was inverted, so
      // `hasEntrance` was evaluated for private APIs and skipped for login —
      // exactly backwards — and every POST /api/auth/login from a signed-out
      // browser was answered 401 STAFF_ENTRANCE_REQUIRED without the credentials
      // ever being checked.
      //
      // Staff PAGES (not private APIs) additionally accept a verified Cloudflare
      // Access identity: after Access signs the caller in at the edge, the SPA
      // shell must load so /api/auth/session can mint the app session that the
      // API handlers below require. APIs still need an entrance or a session —
      // a JWT alone authorizes nothing, exactly like the edge contract.
      let entrance = login ? true : await hasEntrance(cookie, entranceQuery);
      if (!entrance && staffPage && process.env.CF_ACCESS_SSO === 'true') {
        entrance = (await accessIdentityFor(req)) !== null;
      }
      if (!entrance && !await requireAppUser(req)) {
        // Parity with sites-worker.ts: Access authenticated the request but this
        // deployment cannot read the identity (stale/absent CF_ACCESS_AUD, or the
        // gate unconfigured on a host Access fronts). Reporting it beats the
        // silent redirect to `/` that made a completed OTP look like a no-op.
        if (staffPage && accessGateMisconfigured(req)) {
          return res.status(503).set('Cache-Control', 'no-store').type('html').send(accessGateMisconfiguredPage(req));
        }
        if (isStaffPage(req.path)) return res.set('Cache-Control', 'no-store').redirect(302, '/');
        if (login) return res.status(401).json({error: 'Staff entrance expired. Return to the Mall and hold the Cart button for 3 seconds to reopen Staff Login.', code: 'STAFF_ENTRANCE_REQUIRED'});
        return res.status(401).json({error: 'Authentication required.'});
      }
    }
    if (isStaffPage(req.path) || req.path.startsWith('/api/auth/')) res.set('Cache-Control', 'no-store');
    next();
  } catch (error) { next(error); }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    await ensureAuthSeed();
    const identifier = String(req.body?.identifier || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!identifier || !password) {
      return res.status(400).json({ error: "Email/username and password are required." });
    }

    // Emails are stored lowercased at every write, so a direct (indexable)
    // email seek replaces lower(email) = ?, which forced a full table scan per
    // login attempt. Usernames are NOT normalized on write, so their
    // case-insensitive match keeps the lower() wrapper (the users table is
    // small; the email seek is the hot path).
    const stmt = db.prepare("SELECT * FROM app_users WHERE email = ? OR lower(username) = ? LIMIT 1");
    const user = stmt.get(identifier, identifier) as any;
    if (!user || user.status !== "Active") {
      return res.status(401).json({ error: "Invalid credentials or inactive account." });
    }

    const candidate = await hashPassword(password, user.password_salt, user.password_iterations);
    if (!safeEqual(candidate, user.password_hash)) {
      return res.status(401).json({ error: "Invalid credentials or inactive account." });
    }

    const lastLogin = new Date().toISOString();
    db.prepare("UPDATE app_users SET last_login = ? WHERE id = ?").run(lastLogin, user.id);
    const token = await createSession(user.id, res);

    return res.json({ user: publicUser({ ...user, last_login: lastLogin }), sessionToken: token, token, canSuperAdmin: await superAdminSession(req, user) });
  } catch (error: any) {
    console.error("Auth login error:", error);
    return res.status(500).json({ error: error.message || "Login failed" });
  }
});

app.post("/api/auth/google", async (req, res) => {
  try {
    await ensureAuthSeed();
    const accessToken = String(req.body?.accessToken || "");
    if (!accessToken) {
      return res.status(400).json({ error: "Google access token is required." });
    }

    const googleResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!googleResponse.ok) {
      return res.status(401).json({ error: "Google authentication could not be verified." });
    }

    const googleUser = (await googleResponse.json()) as { email?: string; email_verified?: boolean };
    if (!googleUser.email || googleUser.email_verified === false) {
      return res.status(401).json({ error: "A verified Google email is required." });
    }

    const stmt = db.prepare("SELECT * FROM app_users WHERE lower(email) = ? LIMIT 1");
    const user = stmt.get(googleUser.email.toLowerCase()) as any;
    if (!user || user.status !== "Active") {
      return res.status(403).json({ error: "This Google account is not registered or is inactive." });
    }

    const lastLogin = new Date().toISOString();
    db.prepare("UPDATE app_users SET last_login = ? WHERE id = ?").run(lastLogin, user.id);
    const token = await createSession(user.id, res);

    return res.json({ user: publicUser({ ...user, last_login: lastLogin }), sessionToken: token, token, canSuperAdmin: await superAdminSession(req, user) });
  } catch (error: any) {
    console.error("Auth Google error:", error);
    return res.status(500).json({ error: error.message || "Google authentication failed" });
  }
});

app.get("/api/auth/session", async (req, res) => {
  try {
    await ensureAuthSeed();
    const user = await requireAppUser(req);
    if (user) {
      return res.json({ user: publicUser(user), authenticated: true, canSuperAdmin: await superAdminSession(req, user) });
    }
    // Cloudflare Access SSO bootstrap. This is the ONLY place a session is
    // minted without a password, so it must never create or upgrade an account:
    // Access proves the email, the roster decides whether that email has an
    // active account, and the database flag still decides what it may do.
    const identity = process.env.CF_ACCESS_SSO === 'true' ? await accessIdentityFor(req) : null;
    if (identity) {
      const matched = db.prepare('SELECT * FROM app_users WHERE lower(email) = ? LIMIT 1').get(identity.email) as any;
      if (matched && matched.status === 'Active') {
        const lastLogin = new Date().toISOString();
        db.prepare('UPDATE app_users SET last_login = ? WHERE id = ?').run(lastLogin, matched.id);
        const token = await createSession(matched.id, res);
        return res.json({
          user: publicUser({ ...matched, last_login: lastLogin }),
          authenticated: true,
          sessionToken: token,
          token,
          accessEmail: identity.email,
          canSuperAdmin: await superAdminSession(req, matched),
        });
      }
      return res.json({ user: null, authenticated: false, accessEmail: identity.email, registered: false });
    }
    return res.json({ user: null, authenticated: false, entranceAllowed: await hasEntrance(req.headers.cookie || '', entranceQuery) });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Session error" });
  }
});

/**
 * Step-up: re-prove possession of the caller's own password before a privileged
 * change. The token is bound to the account that confirmed it and expires.
 */
app.post("/api/auth/step-up", async (req, res) => {
  try {
    const actor = await requireAppUser(req);
    if (!actor) return res.status(401).json({ error: "Authentication required." });
    const password = String(req.body?.password || "");
    if (!password) return res.status(400).json({ error: "Enter your current password to continue." });
    const candidate = await hashPassword(password, actor.password_salt, actor.password_iterations);
    if (!safeEqual(candidate, actor.password_hash)) return res.status(401).json({ error: "That password is not correct." });
    const seconds = stepUpLifetimeSeconds();
    const token = await issueStepUp(stepUpQuery, actor.id, seconds);
    res.append('Set-Cookie', stepUpCookie(token, req.secure, seconds));
    return res.json({ ok: true, expiresInSeconds: seconds, canSuperAdmin: await superAdminSession(req, actor) });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Step-up failed" });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    await revokeEntrance(req.headers.cookie || '', entranceQuery);
    res.append('Set-Cookie', entranceCookie('', req.secure));
    await revokeStepUp(req.headers.cookie || '', stepUpQuery);
    res.append('Set-Cookie', stepUpCookie('', req.secure));
    const token = readCookie(req, SESSION_COOKIE);
    if (token) {
      db.prepare("DELETE FROM app_sessions WHERE token_hash = ?").run(sha256(token));
    }
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    return res.json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Logout error" });
  }
});

/**
 * Lock the workspace: an AFK action that is NOT a sign-out (see the Worker's
 * `authLock` for the full reasoning). The session survives, so unlocking is
 * immediate; the step-up proof does not, so an unattended terminal cannot change
 * users, roles or passwords without a fresh password.
 */
app.post("/api/auth/lock", async (req, res) => {
  try {
    await revokeStepUp(req.headers.cookie || '', stepUpQuery);
    res.append('Set-Cookie', stepUpCookie('', req.secure));
    return res.json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Lock error" });
  }
});

/**
 * The URL that ends the CLOUDFLARE ACCESS session. `url: null` when the gate is
 * off, which is the normal local-development answer; the caller then falls back
 * to the Mall instead of travelling to a team domain that is not configured.
 */
app.get("/api/auth/access-logout-url", (req, res) => {
  res.set('Cache-Control', 'no-store');
  const team = String(process.env.CF_ACCESS_TEAM_DOMAIN || '').replace(/\/+$/, '');
  if (process.env.CF_ACCESS_SSO !== 'true' || !team) return res.json({ url: null });
  const mallOrigin = `${req.protocol}://${req.get('host')}/`;
  return res.json({ url: `${team}/cdn-cgi/access/logout?returnTo=${encodeURIComponent(mallOrigin)}` });
});

app.get("/api/auth/users", async (req, res) => {
  try {
    const actor = await requireAppUser(req);
    if (!actor) return res.status(401).json({ error: "Authentication required." });

    const rows = db.prepare("SELECT * FROM app_users ORDER BY is_super_admin DESC, display_name").all() as any[];
    return res.json({ users: (rows || []).map(publicUser) });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Failed to fetch users" });
  }
});

app.put("/api/auth/users", async (req, res) => {
  try {
    const actor = await requireAppUser(req);
    // Creating an account, changing a role or setting a password is privileged:
    // the Administrator role and a fresh step-up are both required (docs/staff-access.md).
    const editorCheck = staffEditorCheck({ actor, stepUp: actor ? await stepUpVerified(req, actor.id) : false });
    if (editorCheck.ok === false) return privilegeResponse(res, editorCheck);

    const input = req.body?.user || {};
    const id = String(input.id || "");
    if (!id || !input.email || !input.displayName) {
      return res.status(400).json({ error: "User id, email, and display name are required." });
    }

    const existing = db.prepare("SELECT * FROM app_users WHERE id = ?").get(id) as any;
    // Same guard as /api/auth/password: a regular Administrator must never be able
    // to rewrite the super administrator's profile — this upsert would otherwise
    // let them reset the super-admin password (and with it take over the account)
    // or point the protected identity at their own email.
    if (existing?.is_super_admin && !await superAdminSession(req, actor)) {
      return res.status(403).json({ error: "Only the super administrator can modify this account." });
    }
    if (existing?.is_protected && !await superAdminSession(req, actor)) {
      return res.status(403).json({ error: "Only the super administrator can modify this protected account." });
    }
    const password = String(req.body?.password || input.password || "");

    if (!existing && password.length < 8) {
      return res.status(400).json({ error: "A password of at least 8 characters is required." });
    }

    let salt = existing?.password_salt || randomHex(16);
    let hash = existing?.password_hash || "";
    let changedAt = existing?.password_last_changed || new Date().toISOString();

    if (password) {
      if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
      salt = randomHex(16);
      hash = await hashPassword(password, salt);
      changedAt = new Date().toISOString();
    }

    const stmt = db.prepare(`
      INSERT INTO app_users (
        id, email, username, display_name, role, status, avatar_url, password_hash, password_salt, password_iterations, is_super_admin, is_protected, created_at, last_login, password_last_changed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        email = excluded.email,
        username = excluded.username,
        display_name = excluded.display_name,
        role = excluded.role,
        status = excluded.status,
        avatar_url = excluded.avatar_url,
        password_hash = excluded.password_hash,
        password_salt = excluded.password_salt,
        password_iterations = excluded.password_iterations,
        password_last_changed = excluded.password_last_changed,
        last_login = coalesce(excluded.last_login, app_users.last_login)
    `);

    stmt.run(
      id,
      input.email,
      input.username || null,
      input.displayName,
      input.role || "Sales Staff",
      input.status || "Active",
      input.avatarUrl || null,
      hash,
      salt,
      PASSWORD_ITERATIONS,
      existing?.is_super_admin || 0,
      existing?.is_protected || 0,
      input.createdAt || existing?.created_at || new Date().toISOString(),
      input.lastLogin || existing?.last_login || null,
      changedAt
    );

    // A password change on another account must revoke that account's sessions,
    // exactly like /api/auth/password does — otherwise the old sessions survive
    // the reset and the takeover is never fully revoked.
    if (password && existing && id !== actor.id) {
      db.prepare("DELETE FROM app_sessions WHERE user_id = ?").run(id);
    }

    return res.json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Failed to save user" });
  }
});

app.delete("/api/auth/users/:id", async (req, res) => {
  try {
    // Deleting an account is the most destructive staff action: DB flag, IdP
    // group (when configured) and a fresh password step-up are all required.
    const privileged = await requireSuperAdmin(req, res);
    if ('denied' in privileged) return privileged.denied;
    const actor = privileged.actor;

    const id = req.params.id;
    // Self-deletion was always blocked; the extra hardcoded id did not protect
    // anything the is_protected flag does not already cover, and its only effect
    // was to keep a long-deleted account un-deletable. Honour the flag so an
    // operator can actually remove an old default-seeded account on rotation.
    const target = db.prepare("SELECT is_protected FROM app_users WHERE id = ?").get(id) as any;
    if (id === actor.id || (target && Number(target.is_protected) === 1)) {
      return res.status(400).json({ error: "Protected account cannot be deleted." });
    }

    db.prepare("DELETE FROM app_users WHERE id = ?").run(id);
    await revokeStepUpForUser(stepUpQuery, id);
    return res.json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Failed to delete user" });
  }
});

app.post("/api/auth/password", async (req, res) => {
  try {
    const actor = await requireAppUser(req);
    if (!actor) return res.status(401).json({ error: "Authentication required." });

    const targetId = String(req.body?.targetUserId || actor.id);
    const newPassword = String(req.body?.newPassword || "");
    const oldPassword = String(req.body?.oldPassword || "");

    if (newPassword.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    const target = db.prepare("SELECT * FROM app_users WHERE id = ?").get(targetId) as any;
    if (!target) return res.status(404).json({ error: "User not found." });

    if (targetId === actor.id) {
      const candidate = await hashPassword(oldPassword, actor.password_salt, actor.password_iterations);
      if (!oldPassword || !safeEqual(candidate, actor.password_hash)) {
        return res.status(401).json({ error: "Current password is incorrect." });
      }
    } else {
      if (actor.role !== "Administrator") {
        return res.status(403).json({ error: "Administrator access required." });
      }
      // Resetting somebody else's password is privileged: the caller must
      // confirm their own password, and a super-admin target also needs the IdP group.
      if (!await stepUpVerified(req, actor.id)) return stepUpRequired(res);
      if (target.is_super_admin && !await superAdminSession(req, actor)) {
        return res.status(403).json({ error: "Only the super administrator can reset this password." });
      }
    }

    const salt = randomHex(16);
    const changedAt = new Date().toISOString();
    const hash = await hashPassword(newPassword, salt);

    db.prepare(`
      UPDATE app_users SET
        password_hash = ?, password_salt = ?, password_iterations = ?, password_last_changed = ?
      WHERE id = ?
    `).run(hash, salt, PASSWORD_ITERATIONS, changedAt, targetId);

    if (targetId !== actor.id) {
      db.prepare("DELETE FROM app_sessions WHERE user_id = ?").run(targetId);
    }
    // A password change invalidates every step-up proof that account was given.
    await revokeStepUpForUser(stepUpQuery, targetId);

    return res.json({ ok: true, passwordLastChanged: changedAt });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Failed to update password" });
  }
});

app.post("/api/auth/verify-password", async (req, res) => {
  try {
    await ensureAuthSeed();
    const actor = await requireAppUser(req);
    const fallbackUserId = String(req.body?.userId || "");
    const targetUser =
      actor ||
      (fallbackUserId
        ? (db.prepare("SELECT * FROM app_users WHERE id = ?").get(fallbackUserId) as any)
        : null);

    if (!targetUser) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const password = String(req.body?.password || "");
    if (!password) {
      return res.status(400).json({ error: "Password is required." });
    }

    const candidate = await hashPassword(
      password,
      targetUser.password_salt,
      targetUser.password_iterations
    );
    if (!safeEqual(candidate, targetUser.password_hash)) {
      return res.status(401).json({ error: "Incorrect password." });
    }

    return res.json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Password verification failed" });
  }
});

/**
 * Clear the ENTIRE audit trail. Wiping every log is a super-admin action: it
 * must be gated on the DB flag, the IdP group, and a fresh password step-up
 * (the same bar as deleting a protected account), because the trail is the
 * only record of who did what. The previous client-only `clearAuditLogs`
 * emptied the local IndexedDB copy and left the D1/Drive copy intact, so the
 * "cleared" trail reappeared on the next sync — a silent audit-cover-up.
 */
app.post("/api/auth/audit-logs/clear", async (req, res) => {
  try {
    const privileged = await requireSuperAdmin(req, res);
    if ("denied" in privileged) return privileged.denied;
    const actor = privileged.actor;

    db.prepare("DELETE FROM audit_logs").run();

    // Record the wipe itself so the trail is not left with zero evidence.
    db.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, entity, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `audit-clear-${Date.now()}`,
      String(actor.id),
      'AUDIT_CLEAR',
      'auditLogs',
      null,
      `Audit trail cleared by ${actor.display_name || actor.username} (${actor.id}).`,
      new Date().toISOString()
    );

    return res.json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Failed to clear audit logs" });
  }
});

// =================== D1 STORAGE ROUTES ===================

// =================== MALL STOREFRONT API (Phase 5) ===================
// #14 — durable image storage. Node writes to disk; the edge writes to R2.
const mallImageStore = makeNodeImageStore(process.env.MALL_IMAGE_DIR || path.join(process.cwd(), 'data', 'mall-images'));

let mallMaintenanceRunning = false;
const mallMaintenanceTimer = setInterval(async () => {
  if (mallMaintenanceRunning) return;
  mallMaintenanceRunning = true;
  try {
    // Deliver the signed outbox POST to THIS server's receiver in-process, the
    // same way the scheduled Worker does. Reaching MALL_WEBHOOK_URL over the
    // network would mean the Node server fetching its own hostname — and
    // `webhookConfigured()` rejects localhost/127.0.0.1 URLs outright, so a
    // local drain could never send at all. The receiver still verifies the HMAC,
    // so the signature path stays real. Only method/headers/body are carried
    // over: `signal` and `redirect` are transport concerns that do not apply to
    // an in-process call.
    await maintainMall(makeNodeMallExecutor(db, process.env), async (input, init) => {
      const request = new globalThis.Request(String(input), {
        method: init?.method || 'POST',
        headers: init?.headers as Record<string, string>,
        body: init?.body as string,
      });
      return await handleMallWebhook(request, { ...process.env, DB: webhookDb });
    });
  }
  catch { console.error('[mall-maintenance] Failed; check staff operations/readiness.'); }
  finally { mallMaintenanceRunning = false; }
}, 60_000);
mallMaintenanceTimer.unref();
// Same shared handler the edge worker uses; serves the public storefront from
// local dev so `npm run dev` + /mall behaves exactly like production.
app.all("/api/mall/*", async (req, res) => {
  try {
    const url = new URL(req.originalUrl || req.url, "http://localhost:3000");
    const headers = new Headers({ "content-type": "application/json" });
    const session = req.headers["x-mall-session"];
    if (typeof session === "string" && session) headers.set("x-mall-session", session);
    const attemptKey = req.headers['idempotency-key'];
    if (typeof attemptKey === 'string') headers.set('idempotency-key', attemptKey);
    const request = new Request(url, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body ?? {}),
    });
    const response = await handleMallApi(request, makeNodeMallExecutor(db, process.env, req.ip || req.socket.remoteAddress || 'unknown'));
    if (!response) return res.status(404).json({ error: "Not found" });
    return res.status(response.status).set(Object.fromEntries(response.headers)).send(await response.text());
  } catch (error: any) {
    const status = error?.mallStatus ?? 500;
    const body: any = { error: error?.message || "Mall API error" };
    if (error?.mallPayload) body.payload = error.mallPayload;
    return res.status(status).json(body);
  }
});

app.all("/api/staff/mall-orders*", async (req, res) => {
  try {
    const actor = await requireAppUser(req);
    if (!actor) return res.status(401).json({ error: "Authentication required." });
    const url = new URL(req.originalUrl || req.url, "http://localhost:3000");
    const headers = new Headers({ "content-type": "application/json" });
    const request = new globalThis.Request(url, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body ?? {}),
    });
    const response = await handleStaffMallApi(request, makeNodeMallExecutor(db, process.env), {
      id: actor.id,
      displayName: actor.display_name,
      role: actor.role,
    });
    return res.status(response.status).set("content-type", "application/json").send(await response.text());
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Mall order operation failed." });
  }
});

app.all("/api/staff/mall-listings*", async (req, res) => {
  try {
    const actor = await requireAppUser(req);
    if (!actor) return res.status(401).json({ error: "Authentication required." });
    const url = new URL(req.originalUrl || req.url, "http://localhost:3000");
    const headers = new Headers({ "content-type": "application/json" });
    const request = new globalThis.Request(url, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body ?? {}),
    });
    const response = await handleStaffMallListingApi(request, makeNodeMallExecutor(db, process.env), {
      id: actor.id,
      displayName: actor.display_name,
      role: actor.role,
    });
    return res.status(response.status).set("content-type", "application/json").send(await response.text());
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Mall listing operation failed." });
  }
});

app.all("/api/staff/product-images", async (req, res) => {
  try {
    const actor = await requireAppUser(req);
    if (!actor) return res.status(401).json({ error: "Authentication required." });
    const url = new URL(req.originalUrl || req.url, "http://localhost:3000");
    const request = new globalThis.Request(url, {
      method: req.method,
      headers: new Headers({ "content-type": "application/json" }),
      body: ["GET", "HEAD", "DELETE"].includes(req.method) ? undefined : JSON.stringify(req.body ?? {}),
    });
    const response = await handleStaffProductImageApi(request, mallImageStore, makeNodeMallExecutor(db, process.env), {
      id: actor.id,
      displayName: actor.display_name,
      role: actor.role,
    });
    return res.status(response.status).set("content-type", "application/json").send(await response.text());
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Image operation failed." });
  }
});

// #14 — public, immutable delivery of stored product images.
app.get("/mall-images/*", async (req, res) => {
  try {
    const key = decodeURIComponent(String(req.path).replace(/^\/mall-images\//, ""));
    const response = await handlePublicImageRequest(
      new globalThis.Request(new URL(req.originalUrl || req.url, "http://localhost:3000"), { method: "GET" }),
      mallImageStore,
      key,
    );
    if (response.status !== 200) return res.status(response.status).send(await response.text());
    const buffer = Buffer.from(await response.arrayBuffer());
    return res.status(200).set(Object.fromEntries(response.headers)).send(buffer);
  } catch {
    return res.status(404).send("Not found");
  }
});

app.get("/api/storage/snapshot", async (req, res) => {
  try {
    // 100% relational: the snapshot is built from the relational tables only. The
    // legacy `app_documents` fallback is REMOVED — there is no document mirror.
    const tx = makeNodeAdapter(db);
    const { stores, capped } = await buildSnapshot(tx.queryAll);
    const revision = await currentRevision(tx);
    return res.json({
      stores,
      hasData: Object.keys(stores).length > 0,
      revision,
      timestamp: new Date().toISOString(),
      backend: "relational",
      ...(capped.length ? { bounds: { capped } } : {}),
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Failed to read snapshot" });
  }
});

app.put("/api/storage/snapshot", async (req, res) => {
  try {
    const body = req.body;
    if (!body?.stores || typeof body.stores !== "object") {
      return res.status(400).json({ error: "A stores object is required." });
    }
    // Bound the restore before any write; a runaway payload would otherwise
    // translate into tens of thousands of statements per request.
    const totalDocuments = Object.values(body.stores).reduce<number>((sum, documents) =>
      sum + (Array.isArray(documents) ? documents.length : 0), 0);
    if (totalDocuments > SNAPSHOT_PUSH_DOC_LIMIT) {
      return res.status(413).json({ error: `Snapshot exceeds the maximum of ${SNAPSHOT_PUSH_DOC_LIMIT} documents. Restore a bounded slice and sync the rest with record PATCHes.` });
    }

    const tx = makeNodeAdapter(db);
    const current = await currentRevision(tx);
    const expectedRevision = Number(body.expectedRevision || 0);
    const isForce = Boolean(body.force) || expectedRevision === -1;

    if (!isForce && expectedRevision !== current && current !== 0) {
      return res.status(409).json({ error: "Snapshot revision conflict.", revision: current });
    }

    // 100% relational full replace: child-first DELETE + upsert per collection.
    // No document mirror is written — there is nothing to mirror into.
    const relStatements: { sql: string; params: any[] }[] = [];
    const nowIso = new Date().toISOString();

    db.exec("BEGIN TRANSACTION;");
    try {
      for (const [collection, documents] of Object.entries(body.stores)) {
        if (!ALLOWED_STORES.has(collection) || !Array.isArray(documents)) continue;
        for (const st of replaceCollectionStatements(collection, documents, nowIso)) {
          tx.run(st.sql, st.params);
          relStatements.push(st);
        }
      }
      db.exec("COMMIT;");
    } catch (txErr) {
      db.exec("ROLLBACK;");
      throw txErr;
    }

    // Advance the relational watermark so clients see a new revision.
    const revision = await bumpWatermark(tx);

    // A snapshot restore can replace every product; drop the catalog facet cache.
    invalidateMallFacetCache();

    return res.json({
      ok: true,
      revision,
      collections: Object.keys(body.stores).filter((name) => ALLOWED_STORES.has(name)),
      backend: "relational",
      relationalStatements: relStatements.length,
      relationalSynced: true,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Failed to save snapshot" });
  }
});

app.patch("/api/storage/records", async (req, res) => {
  try {
    const upserts = Array.isArray(req.body?.upserts) ? req.body.upserts : [];
    const deletes = Array.isArray(req.body?.deletes) ? req.body.deletes : [];

    if (upserts.length + deletes.length > 5000) {
      return res.status(413).json({ error: "Too many records in one sync." });
    }

    const nowIso = new Date().toISOString();
    const tx = makeNodeAdapter(db);
    // 100% relational: a PATCH writes ONLY the relational rows it changes. There is
    // no `app_documents` mirror to keep in sync — the relational store is the store.
    const relStatements: { sql: string; params: any[] }[] = [];

    for (const item of upserts) {
      const collection = String(item?.collection || "");
      const document = item?.document;
      if (!ALLOWED_STORES.has(collection) || !document || typeof document !== "object") continue;
      for (const st of upsertToStatements(collection, document, nowIso)) {
        tx.run(st.sql, st.params);
        relStatements.push(st);
      }
    }

    for (const item of deletes) {
      const collection = String(item?.collection || "");
      const documentId = String(item?.documentId || "");
      if (!ALLOWED_STORES.has(collection) || !documentId) continue;
      for (const st of deleteToStatements(collection, documentId)) {
        tx.run(st.sql, st.params);
        relStatements.push(st);
      }
    }

    // Product writes change the catalog facet lists; drop the in-memory cache
    // so the next catalog request rebuilds the counts including this write.
    invalidateMallFacetCache();

    // Advance the relational watermark so clients see a new revision.
    const revision = await bumpWatermark(tx);

    return res.json({
      ok: true,
      revision,
      upserted: upserts.length,
      deleted: deletes.length,
      backend: "relational",
      relationalStatements: relStatements.length,
      // A relational write that throws here fails the whole PATCH, so reaching this
      // response means the live catalog rows are in place.
      relationalSynced: true,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Failed to patch records" });
  }
});

/**
 * Reported for parity with the Worker health payload. The Node runtime holds no
 * Cloudflare credentials: the deployed Worker owns every D1 write.
 */
const NODE_D1_DATABASE_ID = process.env.CLOUDFLARE_D1_DATABASE_ID || "3e95a550-a091-490b-819d-f0acb7ea8dd8";

app.get("/api/storage/d1/health", async (req, res) => {
  try {
    const start = Date.now();
    const tx = makeNodeAdapter(db);

    // Relational-only health: no document counts. `totalDocuments` is retained
    // (0) so older clients that read the field keep parsing the payload.
    let relational: any = null;
    try {
      const rows = await tx.queryAll(`SELECT
        (SELECT COUNT(*) FROM products) as products,
        (SELECT COUNT(*) FROM sales) as sales,
        (SELECT COUNT(*) FROM customers) as customers,
        (SELECT COUNT(*) FROM suppliers) as suppliers,
        (SELECT COUNT(*) FROM sale_items) as sale_items`);
      const row: any = rows?.[0] || {};
      relational = {
        tables: (await tx.queryAll("SELECT COUNT(*) as n FROM sqlite_master WHERE type='table'"))?.[0]?.n ?? null,
        products: Number(row.products || 0),
        sales: Number(row.sales || 0),
        customers: Number(row.customers || 0),
        suppliers: Number(row.suppliers || 0),
        saleItems: Number(row.sale_items || 0),
      };
    } catch (e: any) {
      relational = { error: e?.message || String(e) };
    }

    const revision = await currentRevision(tx);
    const latencyMs = Date.now() - start;

    return res.json({
      status: "healthy",
      connected: true,
      backend: "relational",
      databaseId: NODE_D1_DATABASE_ID,
      revision,
      totalDocuments: 0,
      relational,
      latencyMs,
      endpoint: "Cloudflare D1 Primary Edge",
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return res.status(500).json({
      status: "unhealthy",
      connected: false,
      databaseId: NODE_D1_DATABASE_ID,
      error: error.message || "D1 storage check failed",
      timestamp: new Date().toISOString(),
    });
  }
});

function normalizeDocumentPayload(collection: string, payloadStr: string): string {
  try {
    const doc = JSON.parse(payloadStr);
    if (!doc || typeof doc !== "object") return payloadStr;

    if (collection === "purchases") {
      if (typeof doc.isDraft !== "boolean") {
        doc.isDraft = doc.deliveryStatus === "Draft";
      }
      if (!doc.deliveryStatus) {
        doc.deliveryStatus = doc.isDraft ? "Draft" : "Pending";
      }
      if (!doc.inspectionStatus) {
        doc.inspectionStatus = doc.deliveryStatus === "Received" ? "Passed" : "Pending";
      }
      if (typeof doc.quotationNotes !== "string") {
        doc.quotationNotes = doc.quotationNotes ? String(doc.quotationNotes) : "";
      }
      if (!Array.isArray(doc.receivingHistory)) {
        doc.receivingHistory = [];
      }
      return JSON.stringify(doc);
    }

    if (collection === "sales") {
      doc.deliveryFee = Number(doc.deliveryFee ?? 0);
      const isHist = Boolean(
        doc.isHistorical ||
        (typeof doc.id === "string" && doc.id.startsWith("sale-imp-")) ||
        (typeof doc.notes === "string" &&
          (doc.notes.includes("Historical") ||
            doc.notes.includes("Past Entry") ||
            doc.notes.includes("Import Wizard")))
      );
      if (isHist) {
        doc.isHistorical = true;
      }
      if (doc.expenseId !== undefined && doc.expenseId !== null) {
        doc.expenseId = String(doc.expenseId);
      }
      return JSON.stringify(doc);
    }

    if (collection === "expenses") {
      doc.amount = Number(doc.amount || 0);
      const isHistExp = Boolean(
        doc.isHistorical ||
        (typeof doc.id === "string" && doc.id.startsWith("exp-hist-")) ||
        (typeof doc.title === "string" && doc.title.includes("Historical")) ||
        (typeof doc.description === "string" && doc.description.includes("Historical"))
      );
      if (isHistExp) {
        doc.isHistorical = true;
      }
      if (doc.saleId !== undefined && doc.saleId !== null) {
        doc.saleId = String(doc.saleId);
      }
      if (typeof doc.title === "string" && (doc.title.includes("Logistics") || doc.title.includes("Delivery Fee"))) {
        doc.category = "Logistics";
      }
      return JSON.stringify(doc);
    }

    if (collection === "moneyMovements") {
      doc.amount = Math.abs(Number(doc.amount || 0));
      if (doc.referenceId !== undefined && doc.referenceId !== null) {
        doc.referenceId = String(doc.referenceId);
      }
      if (doc.subtype !== undefined && doc.subtype !== null) {
        doc.subtype = String(doc.subtype);
      }
      return JSON.stringify(doc);
    }
    return payloadStr;
  } catch {
    return payloadStr;
  }
}

// =================== GOOGLE DRIVE BACKUP PROXY ROUTES ===================

const DEDICATED_DRIVE_FOLDER_ID = "11KHJv7CPD7OLcI5w_1MCc_YO70Re8CV9";
const DEFAULT_GOOGLE_DRIVE_API_KEY = "AIzaSyCrJexCUhktsNrT2obqJtqExbukggOqPYQ";

app.get("/api/drive/backups", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const apiKey = process.env.GOOGLE_DRIVE_API_KEY || DEFAULT_GOOGLE_DRIVE_API_KEY;
    const query = `'${DEDICATED_DRIVE_FOLDER_ID}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`;
    let url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&orderBy=createdTime desc&fields=files(id,name,createdTime,size,mimeType)&pageSize=100`;

    const headers: Record<string, string> = {};
    if (authHeader && authHeader.startsWith("Bearer ") && !authHeader.includes("undefined")) {
      headers["Authorization"] = authHeader;
    } else {
      url += `&key=${encodeURIComponent(apiKey)}`;
    }

    let gRes = await fetch(url, { headers });
    if (!gRes.ok && headers["Authorization"]) {
      delete headers["Authorization"];
      const fallbackUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&orderBy=createdTime desc&fields=files(id,name,createdTime,size,mimeType)&pageSize=100&key=${encodeURIComponent(apiKey)}`;
      gRes = await fetch(fallbackUrl, { headers });
    }

    if (!gRes.ok) {
      const err = await gRes.json().catch(() => ({}));
      return res.status(gRes.status).json({ error: err.error?.message || "Failed to list Google Drive backups" });
    }

    const data = (await gRes.json()) as any;
    const files = (data.files || []).filter((f: any) => {
      const name = String(f.name || "").toLowerCase();
      return name.endsWith(".json") || name.startsWith("idofera_backup");
    });

    return res.json({ files });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Failed to list Google Drive backups" });
  }
});

app.get("/api/drive/latest-backup", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const apiKey = process.env.GOOGLE_DRIVE_API_KEY || DEFAULT_GOOGLE_DRIVE_API_KEY;
    const query = `'${DEDICATED_DRIVE_FOLDER_ID}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`;
    let listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&orderBy=createdTime desc&fields=files(id,name,createdTime,size,mimeType)&pageSize=100`;

    const headers: Record<string, string> = {};
    if (authHeader && authHeader.startsWith("Bearer ") && !authHeader.includes("undefined")) {
      headers["Authorization"] = authHeader;
    } else {
      listUrl += `&key=${encodeURIComponent(apiKey)}`;
    }

    let gRes = await fetch(listUrl, { headers });
    if (!gRes.ok && headers["Authorization"]) {
      delete headers["Authorization"];
      listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&orderBy=createdTime desc&fields=files(id,name,createdTime,size,mimeType)&pageSize=100&key=${encodeURIComponent(apiKey)}`;
      gRes = await fetch(listUrl, { headers });
    }

    if (!gRes.ok) {
      const err = await gRes.json().catch(() => ({}));
      return res.status(gRes.status).json({ error: err.error?.message || "Failed to list Google Drive files" });
    }

    const data = (await gRes.json()) as any;
    const files = (data.files || []).filter((f: any) => {
      const name = String(f.name || "").toLowerCase();
      return name.endsWith(".json") || name.startsWith("idofera_backup");
    });

    if (files.length === 0) {
      return res.status(404).json({ error: "No JSON backup files found in Drive folder." });
    }

    for (const file of files) {
      try {
        let downloadUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
        const dlHeaders: Record<string, string> = {};
        if (headers["Authorization"]) {
          dlHeaders["Authorization"] = headers["Authorization"];
        } else {
          downloadUrl += `&key=${encodeURIComponent(apiKey)}`;
        }

        let dlRes = await fetch(downloadUrl, { headers: dlHeaders });
        if (!dlRes.ok && dlHeaders["Authorization"]) {
          dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${encodeURIComponent(apiKey)}`);
        }

        if (dlRes.ok) {
          const jsonText = await dlRes.text();
          const trimmed = jsonText.trim();
          if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            return res.json({
              file: {
                id: file.id,
                name: file.name,
                createdTime: file.createdTime,
                size: file.size,
              },
              jsonString: trimmed,
            });
          }
        }
      } catch (fileErr) {
        console.warn(`Drive download attempt failed for ${file.name}:`, fileErr);
      }
    }

    return res.status(500).json({ error: "Could not download any valid backup file from Google Drive." });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Failed to fetch latest Drive backup" });
  }
});

// =================== AI ROUTES ===================

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", app: "IdoferaLabs API with D1 Storage", timestamp: new Date().toISOString() });
});

app.post("/api/ai/business-assistant", async (req, res) => {
  try {
    const { prompt, businessContext } = req.body;
    const ai = getGeminiClient();

    if (!ai) {
      return res.json({
        answer: `[IdoferaLabs AI Analysis]\n\nBased on your recent business data:\n- Today's Total Sales: ₦${businessContext?.todaySales || 0}\n- Active Low Stock Items: ${businessContext?.lowStockCount || 0}\n- Monthly Revenue: ₦${businessContext?.monthlyRevenue || 0}\n\n**Key Takeaway**: ${prompt.toLowerCase().includes("reorder") ? "We recommend immediate replenishment for items below minimum stock threshold to prevent lost revenue." : "Sales trends show consistent activity. Monitor top-performing categories to optimize inventory turnover."}`,
        source: "fallback",
      });
    }

    const systemInstruction = `You are IdoferaLabs AI Business Assistant, an expert business analyst for retail, wholesale, and hybrid enterprises. Answer the user query using the provided context clearly, concisely, and with actionable business recommendations.`;
    const fullPrompt = `${systemInstruction}\n\nBusiness Context:\n${JSON.stringify(businessContext, null, 2)}\n\nUser Question:\n${prompt}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: fullPrompt,
    });

    res.json({
      answer: response.text,
      source: "gemini-2.5-flash",
    });
  } catch (error: any) {
    console.error("AI Business Assistant Error:", error);
    res.status(500).json({ error: error.message || "Failed to process AI query" });
  }
});

app.post("/api/ai/pricing-assistant", async (req, res) => {
  try {
    const { product } = req.body;
    const ai = getGeminiClient();

    if (!ai || !product) {
      const cost = product?.costPrice || 100;
      const currentRetail = product?.retailPrice || 150;
      const currentWholesale = product?.wholesalePrice || 125;
      const suggestedRetail = Math.round(cost * 1.45 * 100) / 100;
      const suggestedWholesale = Math.round(cost * 1.25 * 100) / 100;
      const margin = Math.round(((suggestedRetail - cost) / suggestedRetail) * 100);

      return res.json({
        recommendedRetailPrice: suggestedRetail,
        recommendedWholesalePrice: suggestedWholesale,
        suggestedDiscountPct: 5,
        projectedProfitMargin: margin,
        riskLevel: "Low",
        explanation: `Based on a cost price of ₦${cost}, the suggested retail price (₦${suggestedRetail}) maintains a healthy ${margin}% margin while remaining competitive in the current category market. The wholesale price (₦${suggestedWholesale}) yields a stable 20% margin for volume orders.`,
        source: "fallback",
      });
    }

    const prompt = `You are IdoferaLabs AI Pricing Assistant. Analyze the following product pricing and stock details, and respond ONLY with a strict valid JSON object (no markdown surrounding ticks, just pure JSON) with the following fields:
"recommendedRetailPrice" (number),
"recommendedWholesalePrice" (number),
"suggestedDiscountPct" (number),
"projectedProfitMargin" (number, percentage),
"riskLevel" (string: "Low" | "Medium" | "High"),
"explanation" (string)

Product details:
${JSON.stringify(product, null, 2)}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    let text = response.text?.trim() || "";
    if (text.startsWith("```json")) {
      text = text.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    } else if (text.startsWith("```")) {
      text = text.replace(/^```\s*/, "").replace(/\s*```$/, "");
    }

    const parsed = JSON.parse(text);
    res.json({ ...parsed, source: "gemini-2.5-flash" });
  } catch (error: any) {
    console.error("AI Pricing Assistant Error:", error);
    res.status(500).json({ error: error.message || "Failed to generate pricing recommendations" });
  }
});

app.post("/api/ai/sales-forecasting", async (req, res) => {
  try {
    const { historicalSales, products } = req.body;
    const ai = getGeminiClient();

    if (!ai) {
      return res.json({
        forecastDays: 30,
        predictedRevenue: 485000,
        predictedSalesCount: 340,
        highRiskStockouts: ["Corrugated Box 10x10", "Kraft Paper Rolls"],
        suggestedReorderDate: "Within 5 days",
        cashFlowTrend: "Positive (+12.4% MoM)",
        insights: [
          "Demand for packaging products is projected to rise 18% over the next 2 weeks.",
          "Stock levels for high-velocity SKUs require immediate purchase order dispatch.",
          "Expected net cash inflow is projected at ₦142,000 after pending supplier commitments.",
        ],
        source: "fallback",
      });
    }

    const prompt = `You are IdoferaLabs AI Sales Forecasting Engine. Analyze the historical sales and current product inventory data provided below, and respond ONLY with a strict valid JSON object with fields:
"forecastDays" (number),
"predictedRevenue" (number),
"predictedSalesCount" (number),
"highRiskStockouts" (array of product name strings),
"suggestedReorderDate" (string),
"cashFlowTrend" (string),
"insights" (array of strings)

Data:
Historical Sales Count: ${historicalSales?.length || 0}
Products Count: ${products?.length || 0}
Sample Products: ${JSON.stringify((products || []).slice(0, 5), null, 2)}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    let text = response.text?.trim() || "";
    if (text.startsWith("```json")) {
      text = text.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    } else if (text.startsWith("```")) {
      text = text.replace(/^```\s*/, "").replace(/\s*```$/, "");
    }

    const parsed = JSON.parse(text);
    res.json({ ...parsed, source: "gemini-2.5-flash" });
  } catch (error: any) {
    console.error("AI Forecasting Error:", error);
    res.status(500).json({ error: error.message || "Failed to generate forecasting" });
  }
});
/**
 * LEGACY one-time merchandising seed, now opt-in only (MALL_SEED_HEROES=true).
 *
 * Publishing is the maintained workflow: use the staff Mall Listings screen
 * (PUT /api/staff/mall-listings/:productId). This exists solely to bootstrap an
 * existing deployment that already depends on these specific hero products, and
 * it never runs during normal startup. New deployments should not use it.
 */
const MALL_HERO_IDS = [
  { id: 'prod-imp-1785576583554-82', name: 'Large Travel Nylon Bag', mallPrice: 300000 },
  { id: 'prod-imp-1785576583547-0', name: 'Translucent 1L Bucket', mallPrice: 40000 },
  { id: 'prod-imp-1785576583550-11', name: 'Cream Jar 200g', mallPrice: 20000 },
  { id: 'prod-imp-1785576583551-36', name: 'Small Foil Plate', mallPrice: 10000 },
  { id: 'prod-imp-1785576583551-25', name: 'Long Plain Bottle 25cl', mallPrice: 11000 },
  { id: 'prod-1785999491663', name: 'Clear TPouch 2kg', mallPrice: 20000 },
  { id: 'prod-imp-1785576583553-73', name: 'Small Chops Pouch', mallPrice: 10000 },
];

const LISTING_STEP_PCT = 0.85;

function seedMallHeroes(db: DatabaseSync): { updated: number; warnings: string[]; existingCount: number; afterCount: number } {
  const warnings: string[] = [];
  const heroRows = MALL_HERO_IDS.map((h) => {
    const row = db.prepare('SELECT id, status, stock_qty, retail_price_kobo, is_mall_listed FROM products WHERE id = ?').get(h.id) as any;
    return { hero: h, row };
  });

  const missingIds = heroRows
    .filter(({ row }) => !row || row.status !== 'Active' || row.stock_qty <= 0)
    .map(({ hero }) => hero.id);

  if (missingIds.length) {
    warnings.push(`Mall hero products missing or not sellable: ${missingIds.join(', ')}`);
  }

  const existingCount = (db.prepare('SELECT COUNT(*) AS n FROM products WHERE is_mall_listed = 1').get() as any)?.n ?? 0;
  const now = new Date().toISOString();
  let updated = 0;

  for (const { hero, row } of heroRows) {
    if (!row) continue;
    const mallPrice = (hero.mallPrice ?? Math.round(Number(row.retail_price_kobo) * LISTING_STEP_PCT)) as number;
    db.prepare(`
      UPDATE products
      SET is_mall_listed = 1,
          mall_price_kobo = ?,
          mall_description = ?,
          updated_at = ?
      WHERE id = ?
    `).run(mallPrice, 'Featured item on the storefront, shown with the mall price.', now, hero.id);
    updated++;
  }

  const afterCount = (db.prepare('SELECT COUNT(*) AS n FROM products WHERE is_mall_listed = 1').get() as any)?.n ?? 0;
  return { updated, warnings, existingCount, afterCount };
}

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`IdoferaLabs Server running on http://0.0.0.0:${PORT}`);

    // The deployed Worker owns Cloudflare D1, so startup only prepares this
    // runtime's own store. (100% relational: no document owner migration runs.)

    (async () => {
      if (process.env.MALL_SEED_HEROES === 'true') {
        const heroSeed = seedMallHeroes(db);
        if (heroSeed.warnings.length) {
          for (const warning of heroSeed.warnings) console.warn(`[mall-init] ${warning}`);
        }
        console.log(`[mall-init] mall-listed rows: ${heroSeed.existingCount} -> ${heroSeed.afterCount}; heroes updated: ${heroSeed.updated}`);
      } else if (process.env.MALL_SEED_HEROES !== undefined) {
        console.warn('[mall-init] MALL_SEED_HEROES must be exactly "true" to run the legacy seed; skipping.');
      }
    })();
  });
}

startServer();
