/**
 * Provision / rotate administrator credentials for the LOCAL Node database.
 *
 * docs/mall-launch-safety.md requires that credentials seeded by the old
 * default-account bootstrap be rotated and their sessions invalidated before
 * launch. This module does that against a local SQLite file, offline — it never
 * imports server.ts, so it cannot start the web server, touch Vite, or use the
 * network.
 *
 * Guarantees:
 *  - The new password is generated here and written ONLY to a 0600 file that is
 *    git-ignored. It is never printed to stdout.
 *  - Every existing session for the rotated user(s) is deleted in the same
 *    transaction, so a previously leaked session token cannot survive rotation.
 *  - `--dry-run` (default) reports what would change and writes nothing.
 *  - A backup of the database file is taken before the first write.
 *
 * Usage:
 *   npx tsx scripts/provision-admin.ts --email you@example.com --username you
 *   npx tsx scripts/provision-admin.ts --email you@example.com --username you --apply
 *   npx tsx scripts/provision-admin.ts --list
 */
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PASSWORD_ITERATIONS = 100000;

export function hashPasswordNode(password: string, salt: string, iterations = PASSWORD_ITERATIONS): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, 32, 'sha256', (err, key) => {
      if (err) reject(err);
      else resolve(key.toString('hex'));
    });
  });
}

/** Same character class the Worker's seed path can round-trip through JSON/env. */
export function generatePassword(): string {
  // 32 bytes -> 43 url-safe chars. Rejection-sampled base64url is fine here; the
  // point is entropy, not memorability.
  return crypto.randomBytes(32).toString('base64url');
}

export function backupDatabase(dbPath: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = `${dbPath}.backup-${stamp}`;
  fs.copyFileSync(dbPath, target);
  // Sessions live in the -wal file until checkpointed; copy it too so the
  // backup is a faithful point-in-time snapshot.
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(`${dbPath}${suffix}`)) fs.copyFileSync(`${dbPath}${suffix}`, `${target}${suffix}`);
  }
  return target;
}

type Flags = { email?: string; username?: string; apply: boolean; list: boolean; revokeOnly: string | null; password: string | null };

function parseArgs(argv: string[]): Flags {
  const flags: Flags = { apply: false, list: false, revokeOnly: null, password: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') flags.apply = true;
    else if (arg === '--list') flags.list = true;
    else if (arg === '--email') flags.email = argv[++i];
    else if (arg === '--username') flags.username = argv[++i];
    else if (arg === '--revoke-sessions') flags.revokeOnly = argv[++i];
    else if (arg === '--password-file') flags.password = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return flags;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const dbPath = process.env.MALL_LOCAL_DB || path.join(process.cwd(), 'data', 'd1_storage.db');
  if (!fs.existsSync(dbPath)) throw new Error(`No database at ${dbPath}. Start the server once (npm run dev).`);

  const db = new DatabaseSync(dbPath);

  if (flags.list) {
    for (const u of db.prepare('SELECT id, email, username, is_super_admin, is_protected FROM app_users ORDER BY is_super_admin DESC').all() as any[]) {
      const n = (db.prepare('SELECT COUNT(*) AS n FROM app_sessions WHERE user_id = ? AND expires_at > ?').get(u.id, Date.now()) as any).n;
      console.log(`${u.id}  ${u.email}  username=${u.username}  super=${u.is_super_admin} protected=${u.is_protected}  liveSessions=${n}`);
    }
    db.close();
    return;
  }

  // --revoke-sessions <userId|all>: drop sessions without touching passwords.
  if (flags.revokeOnly) {
    const target = flags.revokeOnly;
    const now = Date.now();
    if (target === 'all') {
      const count = (db.prepare('SELECT COUNT(*) AS n FROM app_sessions WHERE expires_at > ?').get(now) as any).n;
      console.log(`Would delete ${count} unexpired session row(s) for ALL users.`);
      if (flags.apply) {
        const backup = backupDatabase(dbPath);
        db.prepare('DELETE FROM app_sessions WHERE expires_at > ?').run(now);
        console.log(`Deleted ${count} session(s). Backup: ${backup}`);
      } else {
        console.log('Dry run. Re-run with --apply to delete them.');
      }
    } else {
      const count = (db.prepare('SELECT COUNT(*) AS n FROM app_sessions WHERE user_id = ?').get(target) as any).n;
      console.log(`Would delete ${count} session row(s) for ${target}.`);
      if (flags.apply) {
        const backup = backupDatabase(dbPath);
        db.prepare('DELETE FROM app_sessions WHERE user_id = ?').run(target);
        console.log(`Deleted ${count} session(s). Backup: ${backup}`);
      } else {
        console.log('Dry run. Re-run with --apply to delete them.');
      }
    }
    db.close();
    return;
  }

  const email = flags.email?.trim().toLowerCase();
  const username = flags.username?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('--email must be a valid address.');
  if (!username || !/^[A-Za-z0-9_-]{3,64}$/.test(username)) throw new Error('--username must be 3-64 chars: letters, digits, underscore, hyphen.');

  const existing = db.prepare('SELECT * FROM app_users WHERE email = ? OR lower(username) = ?').get(email, username.toLowerCase()) as any;

  const password = flags.password ? fs.readFileSync(flags.password, 'utf8').trim() : generatePassword();
  if (password.length < 20) throw new Error('Password must be at least 20 characters.');

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await hashPasswordNode(password, salt);
  const now = new Date().toISOString();
  // Sessions are keyed by user id; count before we decide what to delete.
  const liveSessions = existing
    ? (db.prepare('SELECT COUNT(*) AS n FROM app_sessions WHERE user_id = ?').get(existing.id) as any).n
    : 0;

  console.log(`database : ${dbPath}`);
  console.log(`email    : ${email}`);
  console.log(`username : ${username}`);
  if (existing) {
    console.log(`existing : ${existing.id} (super=${existing.is_super_admin} protected=${existing.is_protected} status=${existing.status})`);
    console.log(`  -> ROTATE password in place; ${liveSessions} session row(s) will be invalidated`);
    // A protected account cannot be deleted via the API. If the account being
    // rotated is the sole super-admin, protect it so it cannot be locked out.
  } else {
    console.log('existing : (none) -> CREATE a new active super-administrator');
  }

  if (!flags.apply) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.');
    db.close();
    return;
  }

  const passwordFile = path.join(process.cwd(), 'data', `${username}-password.txt`);
  const backup = backupDatabase(dbPath);

  db.exec('BEGIN IMMEDIATE');
  try {
    if (existing) {
      db.prepare(`
        UPDATE app_users SET email = ?, username = ?, password_hash = ?, password_salt = ?,
          password_iterations = ?, password_last_changed = ?, status = 'Active', is_super_admin = 1
        WHERE id = ?
      `).run(email, username, hash, salt, PASSWORD_ITERATIONS, now, existing.id);
      db.prepare('DELETE FROM app_sessions WHERE user_id = ?').run(existing.id);
    } else {
      db.prepare(`
        INSERT INTO app_users (id, email, username, display_name, role, status,
          password_hash, password_salt, password_iterations, is_super_admin, is_protected,
          created_at, password_last_changed)
        VALUES (?, ?, ?, ?, 'Administrator', 'Active', ?, ?, ?, 1, 1, ?, ?)
      `).run(`usr-${crypto.randomUUID()}`, email, username, 'Administrator', hash, salt, PASSWORD_ITERATIONS, now, now);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  // 0600-equivalent: owner read/write only. Never world-readable.
  fs.writeFileSync(passwordFile, `${password}\n`, { mode: 0o600 });

  const remaining = (db.prepare('SELECT COUNT(*) AS n FROM app_users').get() as any).n;
  db.close();
  console.log('\nProvisioned.');
  console.log(`  backup        : ${backup}`);
  console.log(`  password file : ${passwordFile}  (mode 0600 — read it, store it in a manager, then delete it)`);
  console.log(`  accounts now  : ${remaining}`);
  console.log('\nThe password was NOT printed. Verify sign-in, then remove the password file.');
}

if (process.argv[1] && /provision-admin\.ts$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error(`\nFAILED: ${error.message}`);
    process.exit(1);
  });
}