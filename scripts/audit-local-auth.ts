/**
 * READ-ONLY audit of the local Node/SQLite auth state.
 *
 * Reports every app_users row, its privilege flags, and how many live sessions
 * it holds. Use this before/after provisioning or rotation; it never writes.
 *
 *   npx tsx scripts/audit-local-auth.ts [dbPath]
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const dbPath = process.argv[2] || path.join(process.cwd(), 'data', 'd1_storage.db');
if (!fs.existsSync(dbPath)) {
  console.error(`No database at ${dbPath}. Start the server once (npm run dev) so it is created.`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath, { readOnly: true });

function tableExists(name: string) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

console.log(`database: ${dbPath}\n`);

for (const name of ['app_users', 'app_sessions']) {
  if (!tableExists(name)) {
    console.log(`${name}: TABLE MISSING (server has never bootstrapped auth here)\n`);
  }
}

if (tableExists('app_users')) {
  const users = db.prepare(`
    SELECT id, email, username, role, status, is_super_admin, is_protected,
           password_iterations, created_at, last_login, password_last_changed
    FROM app_users ORDER BY is_super_admin DESC, created_at
  `).all() as any[];

  console.log(`app_users: ${users.length} row(s)`);
  if (users.length === 0) {
    console.log('  (none — bootstrap never ran; no account can sign in until BOOTSTRAP_ADMIN_* is set)\n');
  }
  const liveByUser = new Map<string, number>();
  if (tableExists('app_sessions')) {
    for (const row of db.prepare(
      'SELECT user_id, COUNT(*) AS n FROM app_sessions WHERE expires_at > ? GROUP BY user_id',
    ).all(Date.now()) as any[]) {
      liveByUser.set(row.user_id, Number(row.n));
    }
  }
  for (const u of users) {
    const flags = [
      u.is_super_admin ? 'SUPER_ADMIN' : null,
      u.is_protected ? 'protected' : null,
      u.status !== 'Active' ? `status=${u.status}` : null,
    ].filter(Boolean).join(' ');
    console.log(`  ${u.id}`);
    console.log(`    email=${u.email}  username=${u.username}  role=${u.role}`);
    console.log(`    ${flags || '(no privileges)'}  iterations=${u.password_iterations}`);
    console.log(`    created=${u.created_at}  lastLogin=${u.last_login ?? 'never'}  pwChanged=${u.password_last_changed}`);
    console.log(`    live sessions=${liveByUser.get(u.id) ?? 0}`);
  }
  console.log('');
}

if (tableExists('app_sessions')) {
  const total = Number((db.prepare('SELECT COUNT(*) AS n FROM app_sessions').get() as any).n);
  const live = Number((db.prepare('SELECT COUNT(*) AS n FROM app_sessions WHERE expires_at > ?').get(Date.now()) as any).n);
  console.log(`app_sessions: ${total} row(s), ${live} unexpired`);
}

db.close();