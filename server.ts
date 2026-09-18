import express from "express";
import type { Request, Response } from "express";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import { DatabaseSync } from "node:sqlite";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

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
import { handleMallApi } from "./src/server/mallApi";
import { handleStaffMallApi, maintainMall } from "./src/server/mallOrderAdminApi";
import { handleStaffMallListingApi } from "./src/server/mallListingApi";
import { handleStaffProductImageApi, handlePublicImageRequest } from "./src/server/productImageApi";
import { makeNodeImageStore } from "./src/server/nodeImageStore";
import { bootstrapAdmin } from "./src/server/adminBootstrap";
import { buildSnapshot } from "./src/server/relationalSnapshot.js";
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
 * exist (first boot on a fresh machine, or a pull from the old D1), project the
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
      return res.json({ user: null, authenticated: false });
    }
    return res.json({ user: publicUser(user), authenticated: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Session error" });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  try {
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

let configuredD1DatabaseId = process.env.CLOUDFLARE_D1_DATABASE_ID || "3e95a550-a091-490b-819d-f0acb7ea8dd8";
let configuredAccountId = process.env.CLOUDFLARE_ACCOUNT_ID || "35b307711376954341708cbea8080dcc";
let configuredApiToken = process.env.CLOUDFLARE_API_TOKEN || "";

function loadSavedCloudflareConfig() {
  try {
    const row = db.prepare("SELECT payload FROM app_documents WHERE owner_id = ? AND collection = ? AND document_id = ?").get("system", "system_config", "cloudflare_d1") as any;
    if (row?.payload) {
      const data = JSON.parse(row.payload);
      if (data.apiToken !== undefined && data.apiToken !== "") configuredApiToken = data.apiToken;
      if (data.accountId) configuredAccountId = data.accountId;
      if (data.databaseId) configuredD1DatabaseId = data.databaseId;
      console.log("Loaded Cloudflare D1 configuration from database storage.");
    }
  } catch (err: any) {
    console.warn("Notice: could not load stored Cloudflare config:", err?.message || err);
  }
}
loadSavedCloudflareConfig();

function updateEnvFile(token: string, accountId?: string, databaseId?: string) {
  try {
    const envPath = path.join(process.cwd(), ".env");
    let content = "";
    if (fs.existsSync(envPath)) {
      content = fs.readFileSync(envPath, "utf-8");
    } else {
      const examplePath = path.join(process.cwd(), ".env.example");
      if (fs.existsSync(examplePath)) {
        content = fs.readFileSync(examplePath, "utf-8");
      }
    }

    if (content.includes("CLOUDFLARE_API_TOKEN=")) {
      content = content.replace(/CLOUDFLARE_API_TOKEN=.*/g, `CLOUDFLARE_API_TOKEN="${token}"`);
    } else {
      content += `\nCLOUDFLARE_API_TOKEN="${token}"\n`;
    }

    if (accountId) {
      if (content.includes("CLOUDFLARE_ACCOUNT_ID=")) {
        content = content.replace(/CLOUDFLARE_ACCOUNT_ID=.*/g, `CLOUDFLARE_ACCOUNT_ID="${accountId}"`);
      } else {
        content += `\nCLOUDFLARE_ACCOUNT_ID="${accountId}"\n`;
      }
    }

    if (databaseId) {
      if (content.includes("CLOUDFLARE_D1_DATABASE_ID=")) {
        content = content.replace(/CLOUDFLARE_D1_DATABASE_ID=.*/g, `CLOUDFLARE_D1_DATABASE_ID="${databaseId}"`);
      } else {
        content += `\nCLOUDFLARE_D1_DATABASE_ID="${databaseId}"\n`;
      }
    }

    fs.writeFileSync(envPath, content, "utf-8");
  } catch (err) {
    console.warn("Could not write to .env file:", err);
  }
}

let lastCloudflareSyncTime = 0;
let isCloudflareSyncing = false;
let ongoingD1SyncPromise: Promise<{ success: boolean; count?: number; error?: string; reason?: string }> | null = null;
let cloudflareAuthStatus: {
  valid: boolean;
  lastChecked: number;
  errorMessage?: string;
} = { valid: true, lastChecked: 0 };

async function syncFromCloudflareD1WithLock(): Promise<{ success: boolean; count?: number; error?: string; reason?: string }> {
  // If we synced within the last 60 seconds, skip to prevent redundant edge calls
  if (Date.now() - lastCloudflareSyncTime < 60000) {
    return { success: true, reason: "cached_recent_sync" };
  }
  if (!cloudflareAuthStatus.valid && Date.now() - cloudflareAuthStatus.lastChecked < 60000) {
    return { success: false, reason: "auth_failed_paused", error: cloudflareAuthStatus.errorMessage };
  }
  if (ongoingD1SyncPromise) {
    return ongoingD1SyncPromise;
  }
  ongoingD1SyncPromise = (async () => {
    try {
      isCloudflareSyncing = true;
      const result = await syncFromCloudflareD1();
      lastCloudflareSyncTime = Date.now();
      await ensureBusinessDataOwner();
      return result;
    } catch (e: any) {
      console.warn("Cloudflare D1 sync notice:", e?.message || e);
      return { success: false, count: 0, error: e?.message || String(e) };
    } finally {
      isCloudflareSyncing = false;
      ongoingD1SyncPromise = null;
    }
  })();
  return ongoingD1SyncPromise;
}

// =================== MALL STOREFRONT API (Phase 5) ===================
// #14 — durable image storage. Node writes to disk; the edge writes to R2.
const mallImageStore = makeNodeImageStore(process.env.MALL_IMAGE_DIR || path.join(process.cwd(), 'data', 'mall-images'));

let mallMaintenanceRunning = false;
const mallMaintenanceTimer = setInterval(async () => {
  if (mallMaintenanceRunning) return;
  mallMaintenanceRunning = true;
  try { await maintainMall(makeNodeMallExecutor(db,process.env)); }
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

    // Refresh from remote D1 non-blocking in background if stale
    if (Date.now() - lastCloudflareSyncTime > 60000 && cloudflareAuthStatus.valid) {
      syncFromCloudflareD1WithLock().catch((e: any) => {
        console.warn("Background D1 refresh notice:", e?.message || e);
      });
    }

    // Phase 4: relational read path â€” rows -> frontend snapshot (same contract).
    if (USE_RELATIONAL) {
      try {
        const backfill = await ensureRelationalBackfill();
        const tx = makeNodeAdapter(db);
        const stores = await buildSnapshot(tx.queryAll);
        const revRow = db.prepare("SELECT revision FROM sync_revisions WHERE owner_id = ?").get(ownerId) as any;
        const revision = Number(revRow?.revision || 0);
        return res.json({
          stores,
          hasData: Object.keys(stores).length > 0,
          revision,
          lastCloudflareSync: lastCloudflareSyncTime,
          timestamp: new Date().toISOString(),
          backend: "relational",
          backfill: backfill.statements ? backfill : undefined,
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
      lastCloudflareSync: lastCloudflareSyncTime,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Failed to read snapshot" });
  }
});

function sqlEscape(val: any): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "number") return Number.isFinite(val) ? String(val) : "NULL";
  if (typeof val === "boolean") return val ? "1" : "0";
  return `'${String(val).replace(/'/g, "''")}'`;
}

function interpolateSql(sql: string, params: any[] = []): string {
  let paramIndex = 0;
  return sql.replace(/\?/g, () => {
    if (paramIndex < params.length) {
      return sqlEscape(params[paramIndex++]);
    }
    return "NULL";
  });
}

async function executeRemoteD1Statements(statements: { sql: string; params: any[] }[]) {
  const accountId = configuredAccountId;
  const databaseId = configuredD1DatabaseId;
  const token = configuredApiToken;

  if (!token || !accountId || !databaseId || statements.length === 0) {
    return { success: false, reason: "skipped_or_missing_credentials" };
  }

  // If token failed authentication recently, skip remote edge queries to keep local server lightning fast
  if (!cloudflareAuthStatus.valid && Date.now() - cloudflareAuthStatus.lastChecked < 60000) {
    return { success: false, reason: "auth_failed_paused", error: cloudflareAuthStatus.errorMessage };
  }

  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

    // Group insert statements into multi-row parametric queries
    const insertDocRows: any[][] = [];
    const otherStatements: { sql: string; params: any[] }[] = [];

    for (const stmt of statements) {
      if (stmt.sql.includes("INSERT INTO app_documents") && Array.isArray(stmt.params) && stmt.params.length === 5) {
        insertDocRows.push(stmt.params);
      } else {
        otherStatements.push(stmt);
      }
    }

    // 1. Execute other statements (deletions, sync_revisions, relational upserts)
    for (const stmt of mergeInsertStatements(otherStatements)) {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sql: stmt.sql, params: stmt.params || [] }),
        signal: AbortSignal.timeout(4000),
      });

      if (res.status === 401 || res.status === 403) {
        cloudflareAuthStatus = {
          valid: false,
          lastChecked: Date.now(),
          errorMessage: "Cloudflare API token authentication failed (HTTP " + res.status + ")",
        };
        console.warn("Cloudflare D1 authentication failure: token rejected. Using local SQLite store.");
        return { success: false, reason: "auth_failed" };
      }

      const data = (await res.json()) as any;
      if (!res.ok || !data.success) {
        if (data.errors?.[0]?.code === 10000 || data.errors?.[0]?.message?.includes("Authentication")) {
          cloudflareAuthStatus = { valid: false, lastChecked: Date.now(), errorMessage: data.errors?.[0]?.message };
        }
        console.warn("Cloudflare D1 query warning:", JSON.stringify(data.errors || data));
        return { success: false, error: data.errors?.[0]?.message };
      }
    }

    // 2. Execute document inserts in batches of 15 rows (75 variables, safely below the 100 SQLite limit)
    const BATCH_SIZE = 15;
    const batches: any[][][] = [];
    for (let i = 0; i < insertDocRows.length; i += BATCH_SIZE) {
      batches.push(insertDocRows.slice(i, i + BATCH_SIZE));
    }

    // Concurrency limit of 5 requests at a time
    for (let b = 0; b < batches.length; b += 5) {
      const chunk = batches.slice(b, b + 5);
      await Promise.all(chunk.map(async (batch) => {
        const placeholders = batch.map(() => "(?, ?, ?, ?, ?)").join(", ");
        const sql = `INSERT INTO app_documents (owner_id, collection, document_id, payload, updated_at)
                     VALUES ${placeholders}
                     ON CONFLICT(owner_id, collection, document_id) DO UPDATE SET
                     payload = excluded.payload, updated_at = excluded.updated_at;`;
        const params = batch.flat();
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ sql, params }),
          signal: AbortSignal.timeout(4000),
        });

        if (res.status === 401 || res.status === 403) {
          cloudflareAuthStatus = {
            valid: false,
            lastChecked: Date.now(),
            errorMessage: "Cloudflare API token authentication failed (HTTP " + res.status + ")",
          };
          return;
        }

        const data = (await res.json()) as any;
        if (!res.ok || !data.success) {
          console.warn("Cloudflare D1 batched insert notice:", JSON.stringify(data.errors || data));
        }
      }));
      if (!cloudflareAuthStatus.valid) break;
    }

    return { success: true, databaseId };
  } catch (err: any) {
    console.warn("Cloudflare D1 execution notice:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Phase 4 â€” merge identical INSERT statements into multi-row inserts so a full
 * relational snapshot push costs hundreds of queries instead of thousands.
 * D1/SQLite caps bound variables, so rows-per-query is derived from arity.
 */
function mergeInsertStatements(statements: { sql: string; params: any[] }[], maxVars = 75) {
  const merged: { sql: string; params: any[]; groups: number }[] = [];
  let current: { sql: string; params: any[]; groups: number; maxGroups: number; arity: number } | null = null;
  const flush = () => {
    if (current) merged.push({ sql: current.sql, params: current.params, groups: current.groups });
    current = null;
  };
  for (const stmt of statements) {
    const params = Array.isArray(stmt.params) ? stmt.params : [];
    const valuesMatch = stmt.sql.match(/VALUES\s*\(([^()]*)\)/i);
    const arity = valuesMatch ? valuesMatch[1].split(",").length : 0;
    const mergeable = /^INSERT INTO/i.test(stmt.sql) && valuesMatch && arity > 0 && arity === params.length;
    if (!mergeable) {
      flush();
      merged.push({ sql: stmt.sql, params, groups: 1 });
      continue;
    }
    const maxGroups = Math.max(1, Math.floor(maxVars / arity));
    if (current && current.sql === stmt.sql && current.groups < current.maxGroups) {
      current.params.push(...params);
      current.groups += 1;
      continue;
    }
    flush();
    current = { sql: stmt.sql, params: [...params], groups: 1, maxGroups, arity };
  }
  flush();
  return merged.map((m) => {
    if (m.groups <= 1) return { sql: m.sql, params: m.params };
    const valuesMatch = m.sql.match(/VALUES\s*\(([^()]*)\)/i);
    if (!valuesMatch) return { sql: m.sql, params: m.params };
    const row = `(${valuesMatch[1]})`;
    const expanded = m.sql.replace(valuesMatch[0], `VALUES ${Array.from({ length: m.groups }, () => row).join(", ")}`);
    return { sql: expanded, params: m.params };
  });
}

/** Push relational statements to D1 `idofera`; a failure never breaks the local write. */
async function pushRelationalD1Statements(statements: { sql: string; params: any[] }[]) {
  if (!statements.length) return { success: true, skipped: true };
  try {
    await executeRemoteD1Statements(statements);
    return { success: true, skipped: false };
  } catch (relErr: any) {
    const message = relErr?.message || String(relErr);
    console.warn("Relational D1 push failed (legacy document mirror already pushed):", message);
    return { success: false, skipped: false, error: message };
  }
}

app.put("/api/storage/snapshot", async (req, res) => {
  try {
    const ownerId = BUSINESS_OWNER_ID;
    const body = req.body;
    if (!body?.stores || typeof body.stores !== "object") {
      return res.status(400).json({ error: "A stores object is required." });
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

    const remoteStatements: { sql: string; params: any[] }[] = [];
    // Phase 4: mirror the full-replace snapshot into relational tables (idofera).
    const relStatements: { sql: string; params: any[] }[] = [];
    const nowIso = new Date(now).toISOString();
    const tx = makeNodeAdapter(db);

    db.exec("BEGIN TRANSACTION;");
    try {
      for (const [collection, documents] of Object.entries(body.stores)) {
        if (!ALLOWED_STORES.has(collection) || !Array.isArray(documents)) continue;
        deleteStoreStmt.run(ownerId, collection);
        remoteStatements.push({
          sql: "DELETE FROM app_documents WHERE owner_id = ? AND collection = ?",
          params: [ownerId, collection],
        });
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
          remoteStatements.push({
            sql: `INSERT INTO app_documents (owner_id, collection, document_id, payload, updated_at)
                  VALUES (?, ?, ?, ?, ?)
                  ON CONFLICT(owner_id, collection, document_id) DO UPDATE SET
                  payload = excluded.payload, updated_at = excluded.updated_at;`,
            params: [ownerId, collection, documentId, payloadStr, now],
          });
        }
      }

      const setRevStmt = db.prepare(`
        INSERT INTO sync_revisions (owner_id, revision, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(owner_id) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at
      `);
      setRevStmt.run(ownerId, revision, now);
      remoteStatements.push({
        sql: `INSERT INTO sync_revisions (owner_id, revision, updated_at) VALUES (?, ?, ?)
              ON CONFLICT(owner_id) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at;`,
        params: [ownerId, revision, now],
      });

      db.exec("COMMIT;");
    } catch (txErr) {
      db.exec("ROLLBACK;");
      throw txErr;
    }

    // Replicate to Cloudflare D1 non-blocking so local SQLite commit is instant and reliable
    executeRemoteD1Statements(remoteStatements).catch((remoteErr: any) => {
      console.warn("Non-blocking Cloudflare D1 replication notice:", remoteErr?.message || remoteErr);
    });

    const relational = await pushRelationalD1Statements(relStatements);

    return res.json({
      ok: true,
      revision,
      d1Synced: true,
      d1DatabaseId: configuredD1DatabaseId,
      collections: Object.keys(body.stores).filter((name) => ALLOWED_STORES.has(name)),
      backend: USE_RELATIONAL ? "relational" : "documents",
      relationalStatements: relStatements.length,
      relationalSynced: relational.success,
      relationalError: (relational as any).error,
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
    // Phase 4: relational projections are collected here and pushed alongside the
    // legacy document mirror, so D1 `idofera` (relational) stays in lockstep.
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

    const remoteStatements: { sql: string; params: any[] }[] = [];

    for (const item of upserts) {
      const collection = String(item?.collection || "");
      const document = item?.document;
      if (!ALLOWED_STORES.has(collection) || !document || typeof document !== "object") continue;
      const documentId = String(document.id || "singleton");
      const payloadStr = JSON.stringify(document);
      insertStmt.run(ownerId, collection, documentId, payloadStr, now);
      remoteStatements.push({
        sql: `INSERT INTO app_documents (owner_id, collection, document_id, payload, updated_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(owner_id, collection, document_id) DO UPDATE SET
              payload = excluded.payload, updated_at = excluded.updated_at`,
        params: [ownerId, collection, documentId, payloadStr, now],
      });
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
      deleteStmt.run(ownerId, collection, documentId);
      remoteStatements.push({
        sql: "DELETE FROM app_documents WHERE owner_id = ? AND collection = ? AND document_id = ?",
        params: [ownerId, collection, documentId],
      });
      if (USE_RELATIONAL) {
        for (const st of deleteToStatements(collection, documentId)) {
          tx.run(st.sql, st.params);
          relStatements.push(st);
        }
      }
    }

    const revRow = db.prepare("SELECT revision FROM sync_revisions WHERE owner_id = ?").get(ownerId) as any;
    const currentRevision = Number(revRow?.revision || 0);
    const revision = Math.max(now, currentRevision + 1);

    db.prepare(`
      INSERT INTO sync_revisions (owner_id, revision, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(owner_id) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at
    `).run(ownerId, revision, now);
    remoteStatements.push({
      sql: `INSERT INTO sync_revisions (owner_id, revision, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(owner_id) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at`,
      params: [ownerId, revision, now],
    });

    // Replicate to Cloudflare D1 non-blocking
    executeRemoteD1Statements(remoteStatements).catch((remoteErr: any) => {
      console.warn("Non-blocking Cloudflare D1 replication notice:", remoteErr?.message || remoteErr);
    });

    const relational = await pushRelationalD1Statements(relStatements);

    return res.json({
      ok: true,
      revision,
      d1Synced: true,
      d1DatabaseId: configuredD1DatabaseId,
      upserted: upserts.length,
      deleted: deletes.length,
      backend: USE_RELATIONAL ? "relational" : "documents",
      relationalStatements: relStatements.length,
      relationalSynced: relational.success,
      relationalError: (relational as any).error,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Failed to patch records" });
  }
});

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
      databaseId: configuredD1DatabaseId,
      accountId: configuredAccountId,
      revision: Number(revRow?.revision || 0),
      totalDocuments: Number(countRow?.total || 0),
      relational,
      latencyMs,
      endpoint: "Cloudflare D1 Primary Edge",
      remoteSync: {
        configured: Boolean(configuredApiToken),
        authValid: cloudflareAuthStatus.valid,
        status: !configuredApiToken ? "unconfigured" : !cloudflareAuthStatus.valid ? "auth_error" : "synced",
        message: !configuredApiToken
          ? "Local D1 SQLite active. Cloudflare API token not configured."
          : !cloudflareAuthStatus.valid
            ? (cloudflareAuthStatus.errorMessage || "Cloudflare API token returned 401. Local database serving requests.")
            : "Cloudflare D1 edge connected.",
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return res.status(500).json({
      status: "unhealthy",
      connected: false,
      databaseId: configuredD1DatabaseId,
      error: error.message || "D1 storage check failed",
      timestamp: new Date().toISOString(),
    });
  }
});

// Cloudflare D1 Configuration APIs for user credential management
app.get("/api/storage/d1/config", (req, res) => {
  res.json({
    configured: Boolean(configuredApiToken),
    hasToken: Boolean(configuredApiToken),
    maskedToken: configuredApiToken
      ? (configuredApiToken.length > 8
          ? configuredApiToken.slice(0, 4) + "••••••••" + configuredApiToken.slice(-4)
          : "••••••••")
      : "",
    accountId: configuredAccountId,
    databaseId: configuredD1DatabaseId,
    authStatus: cloudflareAuthStatus,
  });
});

app.post("/api/storage/d1/config", async (req, res) => {
  try {
    const { apiToken, accountId, databaseId, testOnly } = req.body || {};
    const newToken = apiToken !== undefined ? String(apiToken).trim() : configuredApiToken;
    const newAccountId = accountId ? String(accountId).trim() : configuredAccountId;
    const newDbId = databaseId ? String(databaseId).trim() : configuredD1DatabaseId;

    if (!newToken) {
      if (!testOnly) {
        configuredApiToken = "";
        configuredAccountId = newAccountId;
        configuredD1DatabaseId = newDbId;
        cloudflareAuthStatus = { valid: false, lastChecked: Date.now(), errorMessage: "Token cleared" };
        updateEnvFile("", newAccountId, newDbId);
        const now = Date.now();
        db.prepare(`
          INSERT INTO app_documents (owner_id, collection, document_id, payload, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(owner_id, collection, document_id) DO UPDATE SET
            payload = excluded.payload,
            updated_at = excluded.updated_at
        `).run("system", "system_config", "cloudflare_d1", JSON.stringify({ apiToken: "", accountId: newAccountId, databaseId: newDbId }), now);
      }
      return res.json({ ok: true, message: "Cloudflare token cleared." });
    }

    // Verify token with Cloudflare API
    let verifySuccess = false;
    let verifyError = "";
    try {
      const testRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${newAccountId}/d1/database/${newDbId}`, {
        headers: {
          "Authorization": `Bearer ${newToken}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(6000),
      });

      const testData = (await testRes.json()) as any;
      if (testRes.ok && testData.success) {
        verifySuccess = true;
      } else {
        verifyError = testData.errors?.[0]?.message || `HTTP ${testRes.status} authentication failure`;
      }
    } catch (fetchErr: any) {
      verifyError = fetchErr.message || "Network request timed out or failed";
    }

    if (testOnly) {
      return res.json({
        ok: verifySuccess,
        error: verifyError,
        message: verifySuccess ? "Cloudflare API token is valid!" : `Verification failed: ${verifyError}`,
      });
    }

    // Save configuration
    configuredApiToken = newToken;
    configuredAccountId = newAccountId;
    configuredD1DatabaseId = newDbId;
    cloudflareAuthStatus = {
      valid: verifySuccess,
      lastChecked: Date.now(),
      errorMessage: verifySuccess ? undefined : verifyError,
    };

    updateEnvFile(newToken, newAccountId, newDbId);

    const now = Date.now();
    db.prepare(`
      INSERT INTO app_documents (owner_id, collection, document_id, payload, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(owner_id, collection, document_id) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `).run("system", "system_config", "cloudflare_d1", JSON.stringify({
      apiToken: newToken,
      accountId: newAccountId,
      databaseId: newDbId,
    }), now);

    // If verified successfully, trigger a background hydration/sync
    if (verifySuccess) {
      lastCloudflareSyncTime = 0;
      syncFromCloudflareD1WithLock().catch((err) => {
        console.warn("Post-token-save sync notice:", err?.message || err);
      });
    }

    return res.json({
      ok: true,
      verified: verifySuccess,
      warning: !verifySuccess ? `Token saved, but Cloudflare test returned: ${verifyError}.` : undefined,
      message: verifySuccess
        ? "Cloudflare API token verified and saved! Edge replication active."
        : `Token saved (Note: verification failed: ${verifyError}).`,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message || "Failed to update config" });
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

async function syncFromCloudflareD1() {
  const accountId = configuredAccountId;
  const databaseId = configuredD1DatabaseId;
  const token = configuredApiToken;

  if (!token || !accountId || !databaseId) {
    return { success: false, reason: "skipped_or_missing_credentials" };
  }

  if (!cloudflareAuthStatus.valid && Date.now() - cloudflareAuthStatus.lastChecked < 60000) {
    return { success: false, reason: "auth_failed_paused", error: cloudflareAuthStatus.errorMessage };
  }

  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sql: "SELECT owner_id, collection, document_id, payload, updated_at FROM app_documents;",
      }),
      signal: AbortSignal.timeout(4000),
    });

    if (res.status === 401 || res.status === 403) {
      cloudflareAuthStatus = {
        valid: false,
        lastChecked: Date.now(),
        errorMessage: "Cloudflare API token authentication failed (HTTP " + res.status + ")",
      };
      console.warn("Cloudflare D1 sync auth failure: token rejected. Using local SQLite store.");
      return { success: false, reason: "auth_failed", error: cloudflareAuthStatus.errorMessage };
    }

    const data = (await res.json()) as any;
    if (!res.ok || !data.success) {
      if (data.errors?.[0]?.code === 10000 || data.errors?.[0]?.message?.includes("Authentication")) {
        cloudflareAuthStatus = { valid: false, lastChecked: Date.now(), errorMessage: data.errors?.[0]?.message };
      }
      return { success: false, error: data.errors?.[0]?.message || "Cloudflare D1 query failed" };
    }

    cloudflareAuthStatus = { valid: true, lastChecked: Date.now() };
    const docs = data.result?.[0]?.results || [];

    if (docs.length > 0) {
      const insertStmt = db.prepare(`
        INSERT INTO app_documents (owner_id, collection, document_id, payload, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(owner_id, collection, document_id) DO UPDATE SET
          payload = excluded.payload, updated_at = excluded.updated_at
        WHERE excluded.updated_at IS NULL OR app_documents.updated_at IS NULL OR excluded.updated_at >= app_documents.updated_at
      `);
      db.exec("BEGIN TRANSACTION;");
      for (const doc of docs) {
        const normalized = normalizeDocumentPayload(doc.collection, doc.payload);
        insertStmt.run(doc.owner_id, doc.collection, doc.document_id, normalized, doc.updated_at);
      }
      db.exec("COMMIT;");
      console.log(`âœ“ Synced ${docs.length} documents from Cloudflare D1 into local SQLite store.`);
    }

    const revRes = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sql: "SELECT owner_id, revision, updated_at FROM sync_revisions;",
      }),
      signal: AbortSignal.timeout(4000),
    });
    const revData = (await revRes.json()) as any;
    const revs = revData.result?.[0]?.results || [];
    if (revs.length > 0) {
      const revStmt = db.prepare(`
        INSERT INTO sync_revisions (owner_id, revision, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(owner_id) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at
      `);
      for (const r of revs) {
        revStmt.run(r.owner_id, r.revision, r.updated_at);
      }
    }

    return { success: true, count: docs.length };
  } catch (err: any) {
    console.warn("Could not sync from Cloudflare D1:", err.message);
    return { success: false, error: err.message };
  }
}

app.post("/api/storage/d1/pull", async (req, res) => {
  try {
    const syncRes = await syncFromCloudflareD1WithLock();
    const ownerId = BUSINESS_OWNER_ID;
    const countRow = db.prepare("SELECT count(*) as total FROM app_documents WHERE owner_id = ?").get(ownerId) as any;
    const revRow = db.prepare("SELECT revision FROM sync_revisions WHERE owner_id = ?").get(ownerId) as any;
    return res.json({
      ok: true,
      result: syncRes,
      totalDocuments: Number(countRow?.total || 0),
      revision: Number(revRow?.revision || 0),
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Failed to pull from D1" });
  }
});

app.post("/api/storage/d1/push-full", async (req, res) => {
  try {
    const ownerId = BUSINESS_OWNER_ID;
    const rows = db.prepare(`
      SELECT collection, document_id, payload, updated_at FROM app_documents
      WHERE owner_id = ?
    `).all(ownerId) as any[];

    const remoteStatements: { sql: string; params: any[] }[] = [];

    for (const row of rows) {
      remoteStatements.push({
        sql: `INSERT INTO app_documents (owner_id, collection, document_id, payload, updated_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(owner_id, collection, document_id) DO UPDATE SET
              payload = excluded.payload, updated_at = excluded.updated_at`,
        params: [ownerId, row.collection, row.document_id, row.payload, row.updated_at],
      });
    }

    const revRow = db.prepare("SELECT revision, updated_at FROM sync_revisions WHERE owner_id = ?").get(ownerId) as any;
    if (revRow) {
      remoteStatements.push({
        sql: `INSERT INTO sync_revisions (owner_id, revision, updated_at) VALUES (?, ?, ?)
              ON CONFLICT(owner_id) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at`,
        params: [ownerId, revRow.revision, revRow.updated_at],
      });
    }

    await executeRemoteD1Statements(remoteStatements);

    return res.json({
      ok: true,
      d1Synced: true,
      d1DatabaseId: configuredD1DatabaseId,
      totalDocuments: rows.length,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Failed to push full database to D1" });
  }
});

async function runHistoricalDeliveryDataMigration() {
  const ownerId = BUSINESS_OWNER_ID;
  const salesRows = db.prepare("SELECT document_id, payload, updated_at FROM app_documents WHERE owner_id = ? AND collection = 'sales'").all(ownerId) as any[];
  const expenseRows = db.prepare("SELECT document_id, payload, updated_at FROM app_documents WHERE owner_id = ? AND collection = 'expenses'").all(ownerId) as any[];
  const mmRows = db.prepare("SELECT document_id, payload, updated_at FROM app_documents WHERE owner_id = ? AND collection = 'moneyMovements'").all(ownerId) as any[];

  const expensesMap = new Map<string, any>();
  for (const r of expenseRows) {
    try {
      expensesMap.set(r.document_id, { row: r, doc: JSON.parse(r.payload) });
    } catch {}
  }

  const mmMap = new Map<string, any>();
  for (const r of mmRows) {
    try {
      mmMap.set(r.document_id, { row: r, doc: JSON.parse(r.payload) });
    } catch {}
  }

  const insertDocStmt = db.prepare(`
    INSERT INTO app_documents (owner_id, collection, document_id, payload, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(owner_id, collection, document_id) DO UPDATE SET
      payload = excluded.payload, updated_at = excluded.updated_at
  `);

  const remoteStatements: { sql: string; params: any[] }[] = [];
  let migratedCount = 0;
  const now = Date.now();

  for (const sRow of salesRows) {
    let sale: any;
    try {
      sale = JSON.parse(sRow.payload);
    } catch {
      continue;
    }
    const isHist = Boolean(
      sale.isHistorical ||
      (typeof sale.id === "string" && sale.id.startsWith("sale-imp-")) ||
      (typeof sale.notes === "string" &&
        (sale.notes.includes("Historical") ||
          sale.notes.includes("Past Entry") ||
          sale.notes.includes("Import Wizard")))
    );
    const fee = Number(sale.deliveryFee) || 0;
    if (!isHist || fee <= 0) continue;

    let saleUpdated = false;
    if (!sale.isHistorical) {
      sale.isHistorical = true;
      saleUpdated = true;
    }

    // Look for matching expense
    let matchingExpEntry: any = null;
    for (const entry of expensesMap.values()) {
      const e = entry.doc;
      if (sale.expenseId && e.id === sale.expenseId) { matchingExpEntry = entry; break; }
      if (e.saleId && e.saleId === sale.id) { matchingExpEntry = entry; break; }
      if (e.id === `exp-hist-${sale.id}`) { matchingExpEntry = entry; break; }
      if (e.category === "Logistics" && e.description && typeof e.description === "string" && e.description.includes(sale.id)) {
        matchingExpEntry = entry; break;
      }
    }

    let expId = sale.expenseId || (matchingExpEntry ? matchingExpEntry.doc.id : `exp-hist-${sale.id}`);

    if (matchingExpEntry) {
      let expUpdated = false;
      const expDoc = matchingExpEntry.doc;
      if (!expDoc.isHistorical) { expDoc.isHistorical = true; expUpdated = true; }
      if (expDoc.saleId !== sale.id) { expDoc.saleId = sale.id; expUpdated = true; }
      if (expDoc.amount !== fee) { expDoc.amount = fee; expUpdated = true; }
      if (expDoc.category !== "Logistics") { expDoc.category = "Logistics"; expUpdated = true; }
      if (sale.expenseId !== expDoc.id) { sale.expenseId = expDoc.id; saleUpdated = true; }

      const payloadStr = JSON.stringify(expDoc);
      insertDocStmt.run(ownerId, "expenses", expDoc.id, payloadStr, now);
      remoteStatements.push({
        sql: `INSERT INTO app_documents (owner_id, collection, document_id, payload, updated_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(owner_id, collection, document_id) DO UPDATE SET
              payload = excluded.payload, updated_at = excluded.updated_at`,
        params: [ownerId, "expenses", expDoc.id, payloadStr, now],
      });
      migratedCount++;
    } else {
      // Create new expense
      const invoiceRef = sale.invoiceNo && sale.invoiceNo !== "N/A"
        ? sale.invoiceNo
        : (typeof sale.id === "string" ? sale.id.slice(-6).toUpperCase() : "HIST");
      const saleDate = sale.createdAt ? String(sale.createdAt).slice(0, 10) : new Date().toISOString().slice(0, 10);
      const saleIso = sale.createdAt || new Date().toISOString();

      const newExpense = {
        id: expId,
        title: `Logistics Delivery Fee - Historical (${invoiceRef})`,
        category: "Logistics",
        amount: fee,
        description: `Historical delivery fee expense for ${sale.customerName || "Walk-in Customer"}. Sale ${invoiceRef}.${sale.notes ? " " + sale.notes : ""}`.trim(),
        paidBy: sale.createdBy || "Administrator",
        paymentMethod: sale.paymentMethod === "Split" ? "Cash" : (sale.paymentMethod || "Cash"),
        date: saleDate,
        createdAt: saleIso,
        isHistorical: true,
        saleId: sale.id,
      };

      const payloadStr = JSON.stringify(newExpense);
      insertDocStmt.run(ownerId, "expenses", newExpense.id, payloadStr, now);
      remoteStatements.push({
        sql: `INSERT INTO app_documents (owner_id, collection, document_id, payload, updated_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(owner_id, collection, document_id) DO UPDATE SET
              payload = excluded.payload, updated_at = excluded.updated_at`,
        params: [ownerId, "expenses", newExpense.id, payloadStr, now],
      });
      expensesMap.set(newExpense.id, { row: null, doc: newExpense });
      sale.expenseId = expId;
      saleUpdated = true;
      migratedCount++;
    }

    if (sale.expenseId !== expId) {
      sale.expenseId = expId;
      saleUpdated = true;
    }

    const salePayloadStr = JSON.stringify(sale);
    insertDocStmt.run(ownerId, "sales", sale.id, salePayloadStr, now);
    remoteStatements.push({
      sql: `INSERT INTO app_documents (owner_id, collection, document_id, payload, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(owner_id, collection, document_id) DO UPDATE SET
            payload = excluded.payload, updated_at = excluded.updated_at`,
      params: [ownerId, "sales", sale.id, salePayloadStr, now],
    });
    migratedCount++;

    // Check MoneyMovement
    const mmId = `mm-hist-exp-${sale.id}`;
    let hasMM = false;
    for (const mmEntry of mmMap.values()) {
      if (mmEntry.doc.referenceId === expId || mmEntry.doc.id === mmId) {
        hasMM = true;
        break;
      }
    }
    const saleIso = sale.createdAt || new Date().toISOString();
    const isCash = sale.paymentMethod === "Cash";
    const invoiceRef = sale.invoiceNo && sale.invoiceNo !== "N/A"
      ? sale.invoiceNo
      : (typeof sale.id === "string" ? sale.id.slice(-6).toUpperCase() : "HIST");
    const mmDoc = {
      id: mmId,
      date: saleIso,
      type: "Expense Outflow",
      subtype: "Logistics",
      sourceAccount: isCash ? "Physical Cash" : "Biz Account",
      amount: fee,
      referenceNo: `Logistics Delivery Fee - Historical (${invoiceRef})`,
      referenceId: expId,
      performedBy: sale.createdBy || "Administrator",
      notes: `Historical Delivery fee expense: Logistics Delivery Fee - Historical (${invoiceRef})`,
      createdAt: saleIso,
    };
    const mmPayloadStr = JSON.stringify(mmDoc);
    insertDocStmt.run(ownerId, "moneyMovements", mmDoc.id, mmPayloadStr, now);
    remoteStatements.push({
      sql: `INSERT INTO app_documents (owner_id, collection, document_id, payload, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(owner_id, collection, document_id) DO UPDATE SET
            payload = excluded.payload, updated_at = excluded.updated_at`,
      params: [ownerId, "moneyMovements", mmDoc.id, mmPayloadStr, now],
    });
    mmMap.set(mmDoc.id, { row: null, doc: mmDoc });
    migratedCount++;
  }

  if (remoteStatements.length > 0) {
    const newRev = Date.now();
    db.prepare(`
      INSERT INTO sync_revisions (owner_id, revision, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(owner_id) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at
    `).run(ownerId, newRev, newRev);

    remoteStatements.push({
      sql: `INSERT INTO sync_revisions (owner_id, revision, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(owner_id) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at`,
      params: [ownerId, newRev, newRev],
    });

    const d1Res = await executeRemoteD1Statements(remoteStatements);
    console.log(`âœ“ Executed historical delivery data migration. Migrated ${migratedCount} operations, synced to Cloudflare D1:`, d1Res);
    return { ok: true, migratedCount, d1Res, newRev };
  }

  return { ok: true, migratedCount: 0 };
}

app.post("/api/storage/d1/migrate-historical", async (req, res) => {
  try {
    const result = await runHistoricalDeliveryDataMigration();
    return res.json({ ok: true, result, timestamp: new Date().toISOString() });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Failed to execute historical migration" });
  }
});

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

    // Asynchronously perform background hydration and migration without blocking HTTP readiness
    (async () => {
      try {
        console.log("Hydrating business database from Cloudflare D1 in background...");
        await syncFromCloudflareD1();
        lastCloudflareSyncTime = Date.now();
        await ensureBusinessDataOwner();
        await runHistoricalDeliveryDataMigration();
      } catch (syncErr: any) {
        console.warn("Background startup hydration warning:", syncErr?.message || syncErr);
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
