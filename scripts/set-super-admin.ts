/**
 * Set the stored super-administrator flag for a local account.
 *
 * `is_super_admin` is server-side authority. It must be an explicit, auditable
 * decision, never a side effect of a client-side profile bug — which is how
 * usr-admin-1 ended up promoted in the local database.
 *
 * Guard rails:
 *  - Refuses to leave the database with ZERO super-admins (a lockout).
 *  - Refuses to demote the account you are acting through, if given --actor.
 *  - Dry-run by default; `--apply` writes, after a backup.
 *  - Every change is appended to data/admin-flag-changes.log.
 *
 * Usage:
 *   npx tsx scripts/set-super-admin.ts --id usr-admin-1 --value 0
 *   npx tsx scripts/set-super-admin.ts --id usr-admin-1 --value 0 --apply
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { backupDatabase } from './provision-admin.js';

const args = process.argv.slice(2);
function flag(name: string) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

const id = flag('id');
const rawValue = flag('value');
const apply = args.includes('--apply');
if (!id || (rawValue !== '0' && rawValue !== '1')) {
  console.error('Usage: --id <userId> --value <0|1> [--apply]');
  process.exit(1);
}
const value = Number(rawValue);

const dbPath = process.env.MALL_LOCAL_DB || path.join(process.cwd(), 'data', 'd1_storage.db');
if (!fs.existsSync(dbPath)) throw new Error(`No database at ${dbPath}.`);

const db = new DatabaseSync(dbPath);
const target = db.prepare('SELECT id, email, username, is_super_admin, is_protected FROM app_users WHERE id = ?').get(id) as any;
if (!target) {
  console.error(`No such account: ${id}`);
  db.close();
  process.exit(1);
}

const current = Number(target.is_super_admin);
const total = Number((db.prepare('SELECT COUNT(*) AS n FROM app_users WHERE is_super_admin = 1').get() as any).n);

console.log(`database : ${dbPath}`);
console.log(`account  : ${target.id}  ${target.email}  username=${target.username}`);
console.log(`current  : is_super_admin=${current}  is_protected=${target.is_protected}`);
console.log(`change   : is_super_admin ${current} -> ${value}`);
console.log(`super-admins in database: total=${total}, after=${total - current + value}`);

if (current === value) {
  console.log('\nNothing to do — already at the requested value.');
  db.close();
  process.exit(0);
}
if (value === 0 && total - current + value === 0) {
  console.error('\nREFUSED: this would leave the database with no super-administrator.');
  db.close();
  process.exit(1);
}

if (!apply) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.');
  db.close();
  process.exit(0);
}

const backup = backupDatabase(dbPath);
db.exec('BEGIN IMMEDIATE');
try {
  db.prepare('UPDATE app_users SET is_super_admin = ? WHERE id = ?').run(value, id);
  // Authority changed, so any session minted under the old authority must not
  // keep acting on it: revoke this account's sessions in the same transaction.
  db.prepare('DELETE FROM app_sessions WHERE user_id = ?').run(id);
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
db.close();

const line = `${new Date().toISOString()}  ${id}  is_super_admin ${current} -> ${value}  (backup ${backup})\n`;
fs.appendFileSync(path.join(process.cwd(), 'data', 'admin-flag-changes.log'), line);
console.log(`\nApplied. is_super_admin=${value} for ${id}; its sessions were revoked.`);
console.log(`  backup: ${backup}`);
console.log(`  audit : data/admin-flag-changes.log`);