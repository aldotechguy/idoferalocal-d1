/**
 * Optional dashboard drift check (docs/staff-access.md §10).
 *
 * `STAFF_ACCESS_PATHS` and `scripts/staff-access.test.ts` keep THIS repository
 * honest, but the Access applications themselves live in the Cloudflare
 * dashboard. This script reads them back via the Cloudflare API and fails when
 * the dashboard no longer agrees with the repo:
 *
 *   - a staff pattern from STAFF_ACCESS_PATHS has no application on a covered
 *     host (an unguarded staff surface), or
 *   - an application covers a path the storefront or the sign-in flow needs
 *     (an outage waiting to happen), or
 *   - an application exists on a covered host with a path nobody documented.
 *
 * Usage:
 *   npm run verify:access-apps
 *   npx tsx scripts/verify-access-apps.ts --account <accountId> --token <apiToken>
 *
 * Needs CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (env or flags) with the
 * `Access: Apps and Policies Read` permission. Read-only: GET requests only.
 * Without credentials the check SKIPS (exit 0) — it is deliberately optional.
 */
import 'dotenv/config';
import {
  STAFF_ACCESS_EXEMPT_PATHS,
  STAFF_ACCESS_PATHS,
  matchesAccessPattern,
} from '../src/server/staffAccess.ts';

const args = process.argv.slice(2);
function flag(name: string) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

const accountId = flag('account') || process.env.CLOUDFLARE_ACCOUNT_ID || '';
const apiToken = flag('token') || process.env.CLOUDFLARE_API_TOKEN || '';

if (!accountId || !apiToken) {
  console.log('SKIP — verify:access-apps needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN');
  console.log('       (a read-only API token with "Access: Apps and Policies Read").');
  console.log('       The repo-side guard still runs: npm run test:access.');
  process.exit(0);
}

/** Hosts an Access application must cover (docs/staff-access.md §2). */
const EXPECTED_HOSTS = ['idomall.olz.workers.dev', 'idomall-preview.olz.workers.dev'];

/** Any dashboard path matching one of these would block a shopper or the sign-in flow. */
const PUBLIC_SAMPLES = [
  '/', '/category/packaging', '/checkout', '/orders',
  '/api/health', '/api/mall/products', '/api/mall-webhook',
  ...STAFF_ACCESS_EXEMPT_PATHS,
];

interface CfAccessApp {
  id: string;
  name?: string;
  domain?: string;
  type?: string;
  policies?: Array<{ decision?: string }>;
}

async function cfGet(pathname: string): Promise<CfAccessApp[]> {
  const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}${pathname}`);
  url.searchParams.set('per_page', '100');
  const response = await fetch(url, { headers: { authorization: `Bearer ${apiToken}` } });
  const body = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: CfAccessApp[];
    result_info?: { total_pages?: number; page?: number };
  };
  if (!response.ok || body.success !== true || !Array.isArray(body.result)) {
    const detail = body.errors?.map((error) => error.message).filter(Boolean).join('; ');
    throw new Error(`Cloudflare API ${response.status}: ${detail || 'unexpected response'}`);
  }
  return body.result;
}

/** `host/path*` (the Access app's domain field) split into its parts. */
function splitDomain(domain: string) {
  const withoutScheme = domain.replace(/^https?:\/\//, '');
  const slash = withoutScheme.indexOf('/');
  const host = (slash >= 0 ? withoutScheme.slice(0, slash) : withoutScheme).toLowerCase();
  const rawPath = slash >= 0 ? withoutScheme.slice(slash) : '/';
  const path = rawPath === '/' || rawPath === '/*' ? '/' : rawPath.replace(/\/+$/, '');
  return { host, path };
}

const problems: string[] = [];
const notes: string[] = [];

const apps = await cfGet('/access/apps');
const selfHosted = apps.filter((app) => (app.type || 'self_hosted') === 'self_hosted');
const pathsByHost = new Map<string, Set<string>>();

for (const app of selfHosted) {
  const { host, path } = splitDomain(app.domain || '');
  if (!host) continue;
  if (!pathsByHost.has(host)) pathsByHost.set(host, new Set());
  pathsByHost.get(host)!.add(path);

  // The storefront and the cart-hold sign-in must never sit behind Access.
  for (const sample of PUBLIC_SAMPLES) {
    if (matchesAccessPattern(path, sample)) {
      problems.push(`application "${app.name || app.id}" covers ${path}, which matches public path ${sample}`);
      break;
    }
  }
  // An application must actually ALLOW (not only block/challenge).
  if (app.policies && app.policies.length > 0 && !app.policies.some((policy) => policy.decision === 'allow')) {
    problems.push(`application "${app.name || app.id}" has no Allow policy`);
  }
  if (EXPECTED_HOSTS.includes(host) && path !== '/' && !(STAFF_ACCESS_PATHS as readonly string[]).includes(path)) {
    problems.push(`${host} has an application for undocumented path ${path}`);
  }
}

for (const host of EXPECTED_HOSTS) {
  const covered = pathsByHost.get(host);
  if (!covered) {
    problems.push(`${host} has no self-hosted Access application at all`);
    continue;
  }
  for (const pattern of STAFF_ACCESS_PATHS) {
    if (!covered.has(pattern)) {
      problems.push(`${host} is missing an application for ${pattern} — staff path left unguarded`);
    }
  }
}

for (const host of pathsByHost.keys()) {
  if (!EXPECTED_HOSTS.includes(host)) notes.push(`note: ignoring Access application on unexpected host ${host}`);
}
for (const note of notes) console.log(note);

if (problems.length) {
  console.error('\nDRIFT — the dashboard does not match src/server/staffAccess.ts:');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\nFix the Access applications (Zero Trust → Access) or update STAFF_ACCESS_PATHS.');
  process.exit(1);
}

const total = EXPECTED_HOSTS.reduce((sum, host) => sum + (pathsByHost.get(host)?.size || 0), 0);
console.log(`PASS — ${total} Access applications cover all ${STAFF_ACCESS_PATHS.length} staff patterns on ${EXPECTED_HOSTS.join(' and ')}.`);
