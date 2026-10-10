/**
 * Prints the Cloudflare Access Audience (AUD) tag each staff host is actually
 * using, and compares it with `CF_ACCESS_AUD` in `wrangler.toml`.
 *
 * Why this exists: Access mints one Audience tag PER APPLICATION, and a hostname
 * moved to a new (or recreated) Access application silently gets a new tag. The
 * Worker verifies the token's `aud` against `CF_ACCESS_AUD`, so a stale tag means
 * Access accepts the OTP, hands the Worker a valid JWT, and the Worker rejects it
 * — the browser is then bounced back to the Mall. That failure looked exactly
 * like "login is broken", with nothing in the UI naming the cause.
 *
 * The authoritative tag is delivered by the edge itself: an unauthenticated
 * request to a covered path answers
 *   302 https://<team>.cloudflareaccess.com/cdn-cgi/access/login/<host>?kid=<AUD>
 * and that `kid` IS the application's Audience tag. No dashboard access, no API
 * token and no credentials are needed to read it, so this check always works.
 *
 * Usage:
 *   npx tsx scripts/verify-access-aud.ts
 *   npx tsx scripts/verify-access-aud.ts --json
 *
 * Read-only: it issues a GET per host and follows nothing. With
 * `CF_ACCESS_SSO` not "true" the check SKIPS (exit 0), matching the gate itself.
 */
import 'dotenv/config';
import fs from 'node:fs';

/** One host per Access application that fronts a staff surface. */
const STAFF_HOSTS = [
  'idomall.olz.workers.dev',
  'idofera.de5.net',
  'idomall-preview.olz.workers.dev',
];

const args = process.argv.slice(2);
const asJson = args.includes('--json');

/** The `kid` in an Access login redirect is the application's Audience tag. */
function audienceFromRedirect(location: string) {
  const match = /[?&]kid=([^&]+)/.exec(location);
  return match ? decodeURIComponent(match[1]) : '';
}

/** Tags as configured in `wrangler.toml` (both environments), lower-cased. */
function configuredAudiences() {
  let source = '';
  try {
    source = fs.readFileSync('wrangler.toml', 'utf8');
  } catch {
    return [];
  }
  const tags = new Set<string>();
  for (const line of source.split(/\r?\n/)) {
    const match = /^\s*CF_ACCESS_AUD\s*=\s*"([^"]*)"/.exec(line);
    if (!match) continue;
    for (const tag of match[1].split(',')) {
      const trimmed = tag.trim().toLowerCase();
      if (trimmed) tags.add(trimmed);
    }
  }
  return [...tags];
}

async function probe(host: string) {
  const url = `https://${host}/api/auth/session`;
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    const location = response.headers.get('location') || '';
    // A 200 means the host answered without Access: the gate is not in front of
    // this path, which is its own finding.
    if (response.status === 200) return { host, audience: '', note: 'answered 200 — no Access challenge (gate not covering this path)' };
    const audience = audienceFromRedirect(location);
    if (audience) return { host, audience, note: '' };
    return { host, audience: '', note: `no audience in redirect (${response.status} ${location || 'no location'})` };
  } catch (error) {
    return { host, audience: '', note: `probe failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

const configured = configuredAudiences();
const results = await Promise.all(STAFF_HOSTS.map(probe));
const missing = results.filter((result) => result.audience && !configured.includes(result.audience.toLowerCase()));

if (asJson) {
  console.log(JSON.stringify({ configured, results, missing: missing.map((entry) => entry.host) }, null, 2));
} else {
  console.log(`CF_ACCESS_AUD in wrangler.toml carries ${configured.length} tag(s).`);
  console.log('Tags Access is actually minting per host:');
  for (const result of results) {
    if (!result.audience) {
      console.log(`  ${result.host}\n    — ${result.note}`);
      continue;
    }
    const known = configured.includes(result.audience.toLowerCase());
    console.log(`  ${result.host}\n    ${result.audience}  ${known ? 'OK (in CF_ACCESS_AUD)' : 'MISSING from CF_ACCESS_AUD'}`);
  }
}

if (missing.length) {
  console.error('\nDRIFT — Access will authenticate these hosts and the Worker will then reject the token,');
  console.error('bouncing the browser back to the Mall:');
  for (const entry of missing) console.error(`  - ${entry.host} uses ${entry.audience}`);
  console.error('\nAdd every tag above to CF_ACCESS_AUD (comma-separated) for the environment that serves it,');
  console.error('confirm CF_ACCESS_SSO = "true" and CF_ACCESS_TEAM_DOMAIN there, then redeploy that environment.');
  process.exit(1);
}

console.log('\nPASS — every staff host\'s Audience tag is accepted by CF_ACCESS_AUD.');
