/**
 * Rotate an administrator password in a DEPLOYED Cloudflare D1 database.
 *
 * The Worker verifies passwords with WebCrypto PBKDF2-HMAC-SHA256, 32-byte
 * derived key, hex-encoded (see hashPassword in sites-worker.ts). This script
 * derives the hash with the SAME parameters so the stored value verifies.
 *
 * Safety:
 *  - Requires an explicit --database and --env; there is no default target.
 *  - Refuses to run without --apply (dry-run default).
 *  - Refuses if the target account does not exist.
 *  - Revokes every session for that account in the same batch, because a
 *    password rotation that leaves old sessions alive has not revoked anything.
 *  - Writes the generated password ONLY to a 0600 file under the git-ignored
 *    data/ directory and never prints it.
 *
 * Usage:
 *   npx tsx scripts/rotate-deployed-admin.ts --database idofera --env mall \
 *     --id usr-admin-1 --username admin --apply
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ITERATIONS = 100000;

const args = process.argv.slice(2);
function flag(name: string) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
const database = flag('database');
const envName = flag('env');
const id = flag('id');
const username = flag('username');
const apply = args.includes('--apply');

if (!database || !envName || !id || !username) {
  console.error('Usage: --database <name> --env <env> --id <userId> --username <name> [--apply]');
  process.exit(1);
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: ITERATIONS, hash: 'SHA-256' },
    key, 256,
  );
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Run one or more statements against the remote database and return parsed rows.
 *
 * `shell: true` must NOT be used here: the SQL is passed as a single argv entry,
 * and going through a shell re-splits it on whitespace so wrangler sees the query
 * as a pile of stray positional arguments. On Windows the executable is npx.cmd,
 * and execFileSync cannot use it without shell EITHER — so this resolves the
 * npx CLI script and runs it with node directly, which is unambiguous on all
 * platforms and keeps the SQL as one intact argument.
 */
function runWrangler(sql: string, raw = false): any {
  const npxCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
  const argv = ['wrangler', 'd1', 'execute', database!, '--remote', '--env', envName!, '--json', '--yes', '--command', sql];
  const out = fs.existsSync(npxCli)
    ? execFileSync(process.execPath, [npxCli, ...argv], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    : execFileSync('npx.cmd', argv, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, shell: true, windowsHide: true });
  if (raw) return out;
  const start = out.indexOf('[');
  const end = out.lastIndexOf(']');
  if (start < 0) throw new Error(`Could not parse D1 output:\n${out}`);
  return (JSON.parse(out.slice(start, end + 1))[0] as any).results ?? [];
}

function d1(statement: string): any[] {
  return runWrangler(statement) as any[];
}

const existing = d1(`SELECT id, email, username, is_super_admin, is_protected FROM app_users WHERE id = '${id.replace(/'/g, "''")}'`);
if (!existing.length) {
  console.error(`No account ${id} in ${database}. Nothing to rotate.`);
  process.exit(1);
}
const account = existing[0];
if (account.username !== username) {
  console.error(`Refusing: ${id} has username "${account.username}", not "${username}". Run again with the real username.`);
  process.exit(1);
}

const before = d1('SELECT COUNT(*) AS n FROM app_sessions WHERE expires_at > (unixepoch()*1000)')[0];
const password = crypto.randomBytes(32).toString('base64url');
const salt = crypto.randomBytes(16).toString('hex');
const hash = await hashPassword(password, salt);
const now = new Date().toISOString();

console.log(`database : ${database} (--env ${envName})`);
console.log(`account  : ${account.id}  ${account.email}  username=${account.username}`);
console.log(`flags    : is_super_admin=${account.is_super_admin}  is_protected=${account.is_protected}`);
console.log(`sessions : ${before.n} unexpired (will be revoked)`);
console.log(`action   : rotate password to a new 32-byte secret`);

if (!apply) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.');
  process.exit(0);
}

// One batch: the rotation and the session revocation land together, so there is
// no window where the old sessions survive a changed password.
const statements = [
  `UPDATE app_users SET password_hash = '${hash}', password_salt = '${salt}', password_iterations = ${ITERATIONS}, password_last_changed = '${now}', status = 'Active' WHERE id = '${account.id}'`,
  `DELETE FROM app_sessions WHERE user_id = '${account.id}'`,
].join('; ');

const rawExec = runWrangler(statements, true) as string;
if (!/success"\s*:\s*true/.test(rawExec)) {
  console.error('Rotation FAILED — D1 did not report success:');
  console.error(rawExec.slice(-2000));
  process.exit(1);
}
console.log('\nD1 reported success.');

const after = d1(`SELECT COUNT(*) AS n FROM app_sessions WHERE user_id = '${account.id}' AND expires_at > (unixepoch()*1000)`)[0];
const current = d1(`SELECT password_hash, password_last_changed FROM app_users WHERE id = '${account.id}'`)[0];
const applied = current.password_hash === hash && Number(after.n) === 0;

const passwordFile = path.join(process.cwd(), 'data', `${database}-${username}-password.txt`);
fs.mkdirSync(path.dirname(passwordFile), { recursive: true });
fs.writeFileSync(passwordFile, `${password}\n`, { mode: 0o600 });

console.log(`\nVerified against the database:`);
console.log(`  password_hash updated : ${current.password_hash === hash}`);
console.log(`  password_last_changed : ${current.password_last_changed}`);
console.log(`  remaining sessions    : ${after.n}`);
console.log(`  password file         : ${passwordFile} (mode 0600, never printed)`);
if (!applied) {
  console.error('\nWARNING: verification did not match what was written — inspect before relying on this.');
  process.exit(1);
}
console.log('\nRotation applied and verified.');