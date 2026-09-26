/**
 * Verify a rotated credential actually authenticates against the LIVE Worker.
 *
 * A rotation is only complete when the new secret verifies through the deployed
 * login handler — a hash written with the wrong parameters would leave the
 * account locked out. This POSTs to /api/auth/login with a wrong-password
 * negative control first, so it distinguishes "the hash is wrong" from
 * "the endpoint is unreachable".
 *
 *   npx tsx scripts/verify-deployed-login.ts \
 *     --base https://idomall.<subdomain>.workers.dev \
 *     --identifier admin --password-file data/idofera-admin-password.txt
 */
import fs from 'node:fs';

const args = process.argv.slice(2);
function flag(name: string) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

const base = flag('base');
const identifier = flag('identifier');
const passwordFile = flag('password-file');
if (!base || !identifier || !passwordFile) {
  console.error('Usage: --base <https origin> --identifier <email|username> --password-file <path>');
  process.exit(1);
}
if (!fs.existsSync(passwordFile)) {
  console.error(`Password file not found: ${passwordFile}`);
  process.exit(1);
}
const password = fs.readFileSync(passwordFile, 'utf8').trim();

async function attempt(label: string, candidate: string) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password: candidate }),
  });
  const body: any = await response.json().catch(() => ({}));
  console.log(`${label}: HTTP ${response.status} ${body.error ? `- ${body.error}` : ''}`);
  return { response, body };
}

const wrong = await attempt('negative control (wrong password)', `${password}-wrong`);
if (wrong.response.status !== 401) {
  console.error('FAIL: a wrong password must answer 401 from the deployed handler.');
  process.exit(1);
}

const real = await attempt('real password              ', password);
const cookies = real.response.headers.getSetCookie();
const session = cookies.find((c) => c.startsWith('idofera_session='))?.split(';')[0] || '';
console.log(`  user        : ${real.body.user?.username ?? '(none)'} / ${real.body.user?.email ?? '(none)'}`);
console.log(`  isSuperAdmin: ${real.body.user?.isSuperAdmin}`);
console.log(`  session     : ${session ? 'cookie issued' : 'NO COOKIE'}`);

if (real.response.status !== 200 || !real.body.user || !session) {
  console.error('\nFAIL: the rotated credential did not authenticate. The account may be locked out.');
  process.exit(1);
}

// Prove the session is actually usable, not merely issued.
const users = await fetch(`${base}/api/auth/users`, { headers: { cookie: session } });
console.log(`  private API : GET /api/auth/users -> HTTP ${users.status}`);
if (users.status !== 200) {
  console.error('\nFAIL: the session cookie does not unlock a private API.');
  process.exit(1);
}
console.log('\nPASS — rotated credential authenticates and its session works on the live Worker.');