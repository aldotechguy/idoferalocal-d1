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

// Phase 4 â€” relational backend. Local node:sqlite now carries the SAME 30
// tables as D1 `idofera` (DDL single-sourced from drizzle/0000_unified-relational.sql).
// The mapper translates rows <-> the unchanged frontend snapshot shape, so the
// UI needs zero changes. Legacy app_documents tables are kept for rollback reads.
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
  relationalHasData,
  backfillStatementsFromDocumentRows,
} from "./src/server/relationalWrites.js";
const USE_RELATIONAL = process.env.VITE_USE_RELATIONAL !== "false";
try {
  const created = ensureRelationalSchemaNode(db);
  console.log(`Relational schema ready (${created} tables, backend=relational).`);
} catch (e) {
  throw new Error('Relational schema initialization failed; resolve migration conflicts before accepting orders.', {cause:e});
}

/**
 * Phase 4 bridge â€” if the relational store is still empty but legacy documents
 * exist (first boot on a fresh machine, or a restored document store), project the
 * documents into relational tables once. Idempotent: no-op once rows exist.
 */
async function ensureRelationalBackfill(): Promise<{ statements: number; documents: number; skipped: number }> {
  const empty = { statements: 0, documents: 0, skipped: 0 };
  if (!USE_RELATIONAL) return empty;
  const tx = makeNodeAdapter(db);
  if (await relationalHasData(tx.queryAll)) return empty;
  let rows: any[] = [];
  try {
    rows = db
      .prepare("SELECT owner_id, collection, payload, updated_at FROM app_documents ORDER BY updated_at")
      .all() as any[];
  } catch {
    return empty;
  }
  if (!rows.length) return empty;
  const { stmts, skipped } = backfillStatementsFromDocumentRows(rows, new Date().toISOString());
  db.exec("BEGIN TRANSACTION;");
  try {
    for (const st of stmts) tx.run(st.sql, st.params);
    db.exec("COMMIT;");
  } catch (e) {
    try { db.exec("ROLLBACK;"); } catch {}
    throw e;
  }
  console.log(`Relational backfill: ${stmts.length} statements from ${rows.length} documents (${skipped} skipped).`);
  return { statements: stmts.length, documents: rows.length, skipped };
}

// Initialize schema with corruption protection
function initSchema() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS app_documents (
        owner_id TEXT NOT NULL,
        collection TEXT NOT NULL,
        document_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (owner_id, collection, document_id)
      );

      CREATE TABLE IF NOT EXISTS sync_revisions (
        owner_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

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
        expires_at INTEGER NOT NULL
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
        CREATE TABLE IF NOT EXISTS app_documents (
          owner_id TEXT NOT NULL,
          collection TEXT NOT NULL,
          document_id TEXT NOT NULL,
          payload TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (owner_id, collection, document_id)
        );

        CREATE TABLE IF NOT EXISTS sync_revisions (
          owner_id TEXT PRIMARY KEY,
          revision INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

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
          expires_at INTEGER NOT NULL
        );
      `);
    } catch (criticalErr) {
      console.error("Critical SQLite init error:", criticalErr);
    }
  }
}

initSchema();

const SESSION_COOKIE = "idofera_session";
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

async function ensureBusinessDataOwner() {
  const current = db.prepare("SELECT 1 AS present FROM app_documents WHERE owner_id = ? LIMIT 1").get(BUSINESS_OWNER_ID) as any;
  if (current?.present) return;
  const legacy = db.prepare("SELECT owner_id FROM app_documents WHERE owner_id != ? GROUP BY owner_id ORDER BY COUNT(*) DESC LIMIT 1").get(BUSINESS_OWNER_ID) as any;
  const legacyOwner = legacy?.owner_id;
  if (!legacyOwner) return;
  db.exec(`
    INSERT OR IGNORE INTO app_documents (owner_id, collection, document_id, payload, updated_at)
    SELECT '${BUSINESS_OWNER_ID}', collection, document_id, payload, updated_at FROM app_documents WHERE owner_id = '${legacyOwner}';
    INSERT OR IGNORE INTO sync_revisions (owner_id, revision, updated_at)
    SELECT '${BUSINESS_OWNER_ID}', revision, updated_at FROM sync_revisions WHERE owner_id = '${legacyOwner}';
  `);
}
ensureBusinessDataOwner().catch(console.error);

async function requireAppUser(req: Request): Promise<any | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = sha256(token);
  const stmt = db.prepare(`
    SELECT u.* FROM app_sessions s
    JOIN app_users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = ?
  `);
  const row = stmt.get(tokenHash, Date.now(), "Active") as any;
  return row || null;
}

async function createSession(userId: string, res: Response) {
  await revokeEntrance(res.req.headers.cookie || '', entranceQuery);
  res.append('Set-Cookie', entranceCookie('', res.req.secure));
  const token = randomHex(32);
  const now = Date.now();
  const maxAge = 7 * 24 * 60 * 60; // 7 days in seconds
  const expiresAt = now + maxAge * 1000;
  const stmt = db.prepare("INSERT INTO app_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)");
  stmt.run(sha256(token), userId, now, expiresAt);

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
    if (isStaffPage(req.path) || isPrivateApi(req.path) || login) {
      const entrance = !isPrivateApi(req.path) && await hasEntrance(cookie, entranceQuery);
      if (!entrance && !await requireAppUser(req)) {
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

    const stmt = db.prepare("SELECT * FROM app_users WHERE lower(email) = ? OR lower(username) = ? LIMIT 1");
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

    return res.json({ user: publicUser({ ...user, last_login: lastLogin }), sessionToken: token, token });
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

    return res.json({ user: publicUser({ ...user, last_login: lastLogin }), sessionToken: token, token });
  } catch (error: any) {
    console.error("Auth Google error:", error);
    return res.status(500).json({ error: error.message || "Google authentication failed" });
  }
});

app.get("/api/auth/session", async (req, res) => {
  try {
    await ensureAuthSeed();
    const user = await requireAppUser(req);
    if (!user) {
      return res.json({ user: null, authenticated: false, entranceAllowed: await hasEntrance(req.headers.cookie || '', entranceQuery) });
    }
    return res.json({ user: publicUser(user), authenticated: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Session error" });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    await revokeEntrance(req.headers.cookie || '', entranceQuery);
    res.append('Set-Cookie', entranceCookie('', req.secure));
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
    if (!actor || actor.role !== "Administrator") {
      return res.status(403).json({ error: "Administrator access required." });
    }

    const input = req.body?.user || {};
    const id = String(input.id || "");
    if (!id || !input.email || !input.displayName) {
      return res.status(400).json({ error: "User id, email, and display name are required." });
    }

    const existing = db.prepare("SELECT * FROM app_users WHERE id = ?").get(id) as any;
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

    return res.json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Failed to save user" });
  }
});

app.delete("/api/auth/users/:id", async (req, res) => {
  try {
    const actor = await requireAppUser(req);
    if (!actor || !actor.is_super_admin) {
      return res.status(403).json({ error: "Super administrator access required." });
    }

    const id = req.params.id;
    if (id === actor.id || id === "usr-superadmin-idofera") {
      return res.status(400).json({ error: "Protected account cannot be deleted." });
    }

    db.prepare("DELETE FROM app_users WHERE id = ?").run(id);
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
      if (target.is_super_admin && !actor.is_super_admin) {
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

    return res.json({ ok: true, passwordLastChanged: changedAt });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Failed to update password" });
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
    const ownerId = BUSINESS_OWNER_ID;

    // Phase 4: relational read path â€” rows -> frontend snapshot (same contract).
    if (USE_RELATIONAL) {
      try {
        const backfill = await ensureRelationalBackfill();
        const tx = makeNodeAdapter(db);
        const { stores, capped } = await buildSnapshot(tx.queryAll);
        const revRow = db.prepare("SELECT revision FROM sync_revisions WHERE owner_id = ?").get(ownerId) as any;
        const revision = Number(revRow?.revision || 0);
        return res.json({
          stores,
          hasData: Object.keys(stores).length > 0,
          revision,
          timestamp: new Date().toISOString(),
          backend: "relational",
          backfill: backfill.statements ? backfill : undefined,
          ...(capped.length ? { bounds: { capped } } : {}),
        });
      } catch (relErr: any) {
        console.warn("Relational snapshot failed, falling back to documents:", relErr?.message || relErr);
      }
    }

    const rows = db.prepare(`
      SELECT collection, document_id, payload, updated_at FROM app_documents
      WHERE owner_id = ? ORDER BY collection, document_id
    `).all(ownerId) as any[];

    const stores: Record<string, any[]> = {};
    for (const row of rows || []) {
      try {
        const parsed = JSON.parse(normalizeDocumentPayload(row.collection, row.payload));
        (stores[row.collection] ||= []).push(parsed);
      } catch {
        // Skip invalid JSON row
      }
    }

    const revRow = db.prepare("SELECT revision FROM sync_revisions WHERE owner_id = ?").get(ownerId) as any;
    const revision = Number(revRow?.revision || 0);

    return res.json({
      stores,
      hasData: Object.keys(stores).length > 0,
      revision,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Failed to read snapshot" });
  }
});

app.put("/api/storage/snapshot", async (req, res) => {
  try {
    const ownerId = BUSINESS_OWNER_ID;
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

    const revRow = db.prepare("SELECT revision FROM sync_revisions WHERE owner_id = ?").get(ownerId) as any;
    const currentRevision = Number(revRow?.revision || 0);
    const expectedRevision = Number(body.expectedRevision || 0);
    const isForce = Boolean(body.force) || expectedRevision === -1;

    if (!isForce && expectedRevision !== currentRevision && currentRevision !== 0) {
      return res.status(409).json({ error: "Snapshot revision conflict.", revision: currentRevision });
    }

    const now = Date.now();
    const revision = Math.max(now, currentRevision + 1);

    const deleteStoreStmt = db.prepare("DELETE FROM app_documents WHERE owner_id = ? AND collection = ?");
    const insertDocStmt = db.prepare(`
      INSERT INTO app_documents (owner_id, collection, document_id, payload, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(owner_id, collection, document_id) DO UPDATE SET
        payload = excluded.payload, updated_at = excluded.updated_at
    `);

    // Phase 4: mirror the full-replace snapshot into relational tables (idofera).
    const relStatements: { sql: string; params: any[] }[] = [];
    const nowIso = new Date(now).toISOString();
    const tx = makeNodeAdapter(db);

    db.exec("BEGIN TRANSACTION;");
    try {
      for (const [collection, documents] of Object.entries(body.stores)) {
        if (!ALLOWED_STORES.has(collection) || !Array.isArray(documents)) continue;
        deleteStoreStmt.run(ownerId, collection);
        if (USE_RELATIONAL) {
          for (const st of replaceCollectionStatements(collection, documents, nowIso)) {
            tx.run(st.sql, st.params);
            relStatements.push(st);
          }
        }

        for (const doc of documents) {
          if (!doc || typeof doc !== "object") continue;
          const documentId = String((doc as any).id || "singleton");
          const payloadStr = JSON.stringify(doc);
          insertDocStmt.run(ownerId, collection, documentId, payloadStr, now);
        }
      }

      const setRevStmt = db.prepare(`
        INSERT INTO sync_revisions (owner_id, revision, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(owner_id) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at
      `);
      setRevStmt.run(ownerId, revision, now);

      db.exec("COMMIT;");
    } catch (txErr) {
      db.exec("ROLLBACK;");
      throw txErr;
    }

    // A snapshot restore can replace every product; drop the catalog facet cache.
    invalidateMallFacetCache();

    // Cloudflare D1 is written by the deployed Worker, so a local restore only
    // touches this runtime's own store.
    return res.json({
      ok: true,
      revision,
      collections: Object.keys(body.stores).filter((name) => ALLOWED_STORES.has(name)),
      backend: USE_RELATIONAL ? "relational" : "documents",
      relationalStatements: relStatements.length,
      // The relational rows commit inside the same transaction as the mirror, so a
      // committed PUT is always relationally synced; a failure rolls back to a 500.
      relationalSynced: true,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Failed to save snapshot" });
  }
});

app.patch("/api/storage/records", async (req, res) => {
  try {
    const ownerId = BUSINESS_OWNER_ID;
    const upserts = Array.isArray(req.body?.upserts) ? req.body.upserts : [];
    const deletes = Array.isArray(req.body?.deletes) ? req.body.deletes : [];

    if (upserts.length + deletes.length > 5000) {
      return res.status(413).json({ error: "Too many records in one sync." });
    }

    const now = Date.now();
    const nowIso = new Date().toISOString();
    const tx = makeNodeAdapter(db);
    // Mirror-less PATCH (option B): when the relational backend owns the store
    // (the default), a staff edit no longer rewrites its app_documents mirror
    // row — snapshot PUTs keep the mirror current, so a PATCH pays only the
    // relational rows it changes instead of a mirror rewrite per index entry.
    // The legacy documents backend still owns its mirror, so the dual-write
    // (local store + non-blocking D1 replication) stays enabled there.
    const mirror = !USE_RELATIONAL;
    const relStatements: { sql: string; params: any[] }[] = [];

    const insertStmt = db.prepare(`
      INSERT INTO app_documents (owner_id, collection, document_id, payload, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(owner_id, collection, document_id) DO UPDATE SET
        payload = excluded.payload, updated_at = excluded.updated_at
    `);
    const deleteStmt = db.prepare(`
      DELETE FROM app_documents WHERE owner_id = ? AND collection = ? AND document_id = ?
    `);

    for (const item of upserts) {
      const collection = String(item?.collection || "");
      const document = item?.document;
      if (!ALLOWED_STORES.has(collection) || !document || typeof document !== "object") continue;
      const documentId = String(document.id || "singleton");
      const payloadStr = JSON.stringify(document);
      if (mirror) {
        insertStmt.run(ownerId, collection, documentId, payloadStr, now);
      }
      if (USE_RELATIONAL) {
        for (const st of upsertToStatements(collection, document, nowIso)) {
          tx.run(st.sql, st.params);
          relStatements.push(st);
        }
      }
    }

    for (const item of deletes) {
      const collection = String(item?.collection || "");
      const documentId = String(item?.documentId || "");
      if (!ALLOWED_STORES.has(collection) || !documentId) continue;
      if (mirror) {
        deleteStmt.run(ownerId, collection, documentId);
      }
      if (USE_RELATIONAL) {
        for (const st of deleteToStatements(collection, documentId)) {
          tx.run(st.sql, st.params);
          relStatements.push(st);
        }
      }
    }

    // Product writes change the catalog facet lists; drop the in-memory cache
    // so the next catalog request rebuilds the counts including this write.
    invalidateMallFacetCache();

    const revRow = db.prepare("SELECT revision FROM sync_revisions WHERE owner_id = ?").get(ownerId) as any;
    const currentRevision = Number(revRow?.revision || 0);
    const revision = Math.max(now, currentRevision + 1);

    db.prepare(`
      INSERT INTO sync_revisions (owner_id, revision, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(owner_id) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at
    `).run(ownerId, revision, now);

    // Cloudflare D1 is written by the deployed Worker; this runtime only bumps
    // its own revision for the local read path.
    return res.json({
      ok: true,
      revision,
      upserted: upserts.length,
      deleted: deletes.length,
      backend: USE_RELATIONAL ? "relational" : "documents",
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
    const ownerId = BUSINESS_OWNER_ID;
    const revRow = db.prepare("SELECT revision, updated_at FROM sync_revisions WHERE owner_id = ?").get(ownerId) as any;
    const countRow = db.prepare("SELECT count(*) as total FROM app_documents WHERE owner_id = ?").get(ownerId) as any;

    let relational: any = null;
    if (USE_RELATIONAL) {
      try {
        const tx = makeNodeAdapter(db);
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
    }

    const latencyMs = Date.now() - start;

    return res.json({
      status: "healthy",
      connected: true,
      backend: USE_RELATIONAL ? "relational" : "documents",
      databaseId: NODE_D1_DATABASE_ID,
      revision: Number(revRow?.revision || 0),
      totalDocuments: Number(countRow?.total || 0),
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
        answer: `[IdoferaLabs AI Analysis]\n\nBased on your recent business data:\n- Today's Total Sales: â‚¦${businessContext?.todaySales || 0}\n- Active Low Stock Items: ${businessContext?.lowStockCount || 0}\n- Monthly Revenue: â‚¦${businessContext?.monthlyRevenue || 0}\n\n**Key Takeaway**: ${prompt.toLowerCase().includes("reorder") ? "We recommend immediate replenishment for items below minimum stock threshold to prevent lost revenue." : "Sales trends show consistent activity. Monitor top-performing categories to optimize inventory turnover."}`,
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
        explanation: `Based on a cost price of â‚¦${cost}, the suggested retail price (â‚¦${suggestedRetail}) maintains a healthy ${margin}% margin while remaining competitive in the current category market. The wholesale price (â‚¦${suggestedWholesale}) yields a stable 20% margin for volume orders.`,
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
          "Expected net cash inflow is projected at â‚¦142,000 after pending supplier commitments.",
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

    // Asynchronously seed the business owner without blocking HTTP readiness.
    // The deployed Worker owns Cloudflare D1, so startup only prepares this
    // runtime's own store.
    (async () => {
      try {
        await ensureBusinessDataOwner();
      } catch (seedErr: any) {
        console.warn("Background startup seed warning:", seedErr?.message || seedErr);
      }

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
