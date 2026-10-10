/**
 * Post-fix gate assertions against a running local server.
 *
 * Proves the staff-entrance fix did not open a hole: sign-in works from a cold
 * browser, but the staff pages and private APIs still refuse an unauthenticated
 * caller. Run `npm run dev` first.
 */
const base = process.env.MALL_LOCAL_BASE_URL || 'http://127.0.0.1:3000';

async function probe(label: string, path: string, init?: RequestInit) {
  const response = await fetch(`${base}${path}`, { redirect: 'manual', ...init });
  console.log(`${label.padEnd(42)} HTTP ${response.status}`);
  return response;
}

let failed = false;
function expect(label: string, response: Response, want: number) {
  if (response.status !== want) {
    console.error(`  FAIL: expected ${want}`);
    failed = true;
  }
}

// 1. A cold browser can reach both sign-in endpoints (no entrance cookie).
expect('POST /api/auth/login  (no entrance)',
  await probe('POST /api/auth/login  (no entrance)', '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: 'nobody', password: 'x' }),
  }), 401);
// ^ must be a CREDENTIALS 401, not STAFF_ENTRANCE_REQUIRED. Checked below.

const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: 'nobody@example.test', password: 'x' }),
});
const loginBody: any = await login.json().catch(() => ({}));
if (loginBody.code === 'STAFF_ENTRANCE_REQUIRED') {
  console.error('  FAIL: login is still gated behind the staff entrance.');
  failed = true;
} else {
  console.log(`  login reached the credential check (code=${loginBody.code ?? 'none'}).`);
}

// 2. The private API and staff pages still reject an unauthenticated caller.
expect('GET  /api/auth/users     (no session)', await probe('GET  /api/auth/users     (no session)', '/api/auth/users'), 401);
expect('GET  /api/storage/snapshot(no session)', await probe('GET  /api/storage/snapshot(no session)', '/api/storage/snapshot'), 401);
expect('GET  /app               (no session)', await probe('GET  /app               (no session)', '/app'), 302);

// 3. A real session still unlocks the private API.
const real = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: 'idoferalm', password: (await import('node:fs')).readFileSync('data/idoferalm-password.txt', 'utf8').trim() }),
});
if (real.status !== 200) {
  console.error(`  FAIL: could not establish a session to test the positive path (HTTP ${real.status}).`);
  failed = true;
} else {
  // The response sets TWO cookies (a cleared staff-entrance cookie first, then
  // the session). Taking the first Set-Cookie header would send the empty
  // entrance cookie and look unauthenticated, so select the session explicitly.
  const cookies = real.headers.getSetCookie();
  const cookie = cookies.find((c) => c.startsWith('idofera_session='))?.split(';')[0] || '';
  if (!cookie) {
    console.error('  FAIL: login returned no idofera_session cookie.');
    failed = true;
  }
  const users = await probe('GET  /api/auth/users     (session)', '/api/auth/users', { headers: { cookie } });
  expect('  positive path', users, 200);
}

console.log(failed ? '\nFAILED' : '\nPASS — sign-in reachable from a cold browser; private APIs still protected.');
process.exit(failed ? 1 : 0);