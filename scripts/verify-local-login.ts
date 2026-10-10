/**
 * Proves the local administrator credentials actually work against the real
 * Node login handler. Complements scripts/provision-admin.ts: that script writes
 * the hashes, this one verifies a live POST /api/auth/login succeeds with them.
 *
 * Run the server first (npm run dev), then:
 *   npx tsx scripts/verify-local-login.ts --identifier idoferalm --password-file data/idoferalm-password.txt
 *   npx tsx scripts/verify-local-login.ts --identifier admin@idoferapackaging.com --password-file data/idoferamgr-password.txt
 */
import fs from 'node:fs';

const args = process.argv.slice(2);
function flag(name: string) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

const base = flag('base') || process.env.MALL_LOCAL_BASE_URL || 'http://127.0.0.1:3000';
const identifier = flag('identifier');
const passwordFile = flag('password-file');
if (!identifier || !passwordFile) {
  console.error('Usage: --identifier <email|username> --password-file <path> [--base http://127.0.0.1:3000]');
  process.exit(1);
}
if (!fs.existsSync(passwordFile)) {
  console.error(`Password file not found: ${passwordFile}`);
  process.exit(1);
}
const password = fs.readFileSync(passwordFile, 'utf8').trim();

// The staff entrance gate protects private APIs. /api/auth/login is exempt, but
// the login response is what mints the session, so we assert on that directly.
const wrong = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier, password: `${password}-deliberately-wrong` }),
});
console.log(`negative control (wrong password): HTTP ${wrong.status} ${JSON.stringify(await wrong.json().catch(() => ({})))}`);
if (wrong.status !== 401) {
  console.error('FAIL: a wrong password must answer 401.');
  process.exit(1);
}

const response = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier, password }),
});
const body: any = await response.json().catch(() => ({}));
const setCookie = response.headers.get('set-cookie') || '';
console.log(`real login: HTTP ${response.status}`);
console.log(`  user        : ${body.user?.username ?? '(none)'} / ${body.user?.email ?? '(none)'}`);
console.log(`  isSuperAdmin: ${body.user?.isSuperAdmin}`);
console.log(`  session     : ${/idofera_session=/.test(setCookie) ? 'cookie issued + ' : ''}${body.sessionToken ? 'token returned' : 'NO TOKEN'}`);

if (response.status !== 200 || !body.user || !(body.sessionToken || /idofera_session=/.test(setCookie))) {
  console.error('FAIL: expected 200 with a user and a session.');
  process.exit(1);
}
console.log('\nPASS — credentials are valid and a session was issued.');