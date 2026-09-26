/**
 * Cloudflare Access identity for the staff gate.
 *
 * Access authenticates the *person* (an IdP login) and injects a signed JWT on
 * every request that reaches a path covered by an Access application. This
 * module verifies that JWT with Web Crypto only — the same primitive
 * `staffEntrance.ts` and `sites-worker.ts` already use — so the Worker and the
 * Node twin share one implementation with no new dependency.
 *
 * The verified JWT is the ONLY identity input trusted here.
 * `Cf-Access-Authenticated-User-Email` and the other `cf-access-*` headers are
 * plain request headers: anything that can reach the origin WITHOUT passing
 * Access (another environment's hostname, a direct workers.dev hit, a local
 * `wrangler dev`) can set them, so they are never read.
 *
 * Access grants no privileges: it only proves an email address and, when the
 * IdP asserts them, group memberships. Super-admin remains an `app_users`
 * column (see docs/staff-access.md).
 */

export const ACCESS_JWT_HEADER = 'cf-access-jwt-assertion';

/** Cached signing keys are re-read at most once an hour. */
const JWKS_TTL_MS = 60 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 60;

export interface AccessJwk {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
  alg?: string;
  use?: string;
}

export interface AccessIdentity {
  /** Lower-cased email asserted by the IdP. */
  email: string;
  subject: string;
  groups: string[];
}

export interface AccessJwtConfig {
  /** `https://<team-name>.cloudflareaccess.com`; also the expected `iss`. */
  teamDomain?: string;
  /** The Access application's Audience (AUD) tag. */
  audience?: string;
  /** Test seam: replaces the network JWKS read (bypasses the cache). */
  jwks?: () => Promise<AccessJwk[]>;
  /** Test seam: replaces the clock, in seconds since the epoch. */
  now?: () => number;
}

interface CachedKeys {
  url: string;
  keys: AccessJwk[];
  fetchedAt: number;
}

const keyCache = new Map<string, CachedKeys>();

/** Test-only: drops the module-level signing-key cache. */
export function resetAccessKeyCache() {
  keyCache.clear();
}

const trimSlash = (value: string) => value.replace(/\/+$/, '');

export function accessJwksUrl(teamDomain: string) {
  return `${trimSlash(teamDomain)}/cdn-cgi/access/certs`;
}

function base64UrlBytes(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function decodeJson(segment: string): Record<string, unknown> | null {
  try {
    const text = new TextDecoder().decode(base64UrlBytes(segment));
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * Group claims reach us in several shapes depending on the IdP: a list of
 * names, a list of ids, a comma-separated string, or an object map. Anything
 * that cannot be read as a group name is ignored, so a missing claim degrades
 * to "no groups" rather than to an error.
 */
export function normalizeAccessGroups(raw: unknown): string[] {
  const groups = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === 'string') {
      for (const part of value.split(',')) {
        const group = part.trim();
        if (group) groups.add(group);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (entry === true || entry === key || typeof entry === 'string') groups.add(key);
        else visit(entry);
      }
    }
  };
  visit(raw);
  return [...groups];
}

function audienceMatches(claim: unknown, audience: string) {
  if (typeof claim === 'string') return claim === audience;
  if (Array.isArray(claim)) return claim.some((entry) => entry === audience);
  return false;
}

async function loadKeys(url: string, config: AccessJwtConfig, refresh: boolean): Promise<AccessJwk[]> {
  if (config.jwks) return await config.jwks();
  const cached = keyCache.get(url);
  if (!refresh && cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`JWKS request failed (${response.status})`);
  const body = await response.json() as { keys?: AccessJwk[] };
  const keys = Array.isArray(body?.keys) ? body.keys : [];
  if (keys.length) keyCache.set(url, { url, keys, fetchedAt: Date.now() });
  return keys;
}

async function verifySignature(jwk: AccessJwk, signingInput: Uint8Array, signature: Uint8Array) {
  const key = await crypto.subtle.importKey(
    'jwk',
    { ...jwk, alg: jwk.alg || 'RS256', ext: true } as JsonWebKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signingInput);
}

/**
 * Verifies the Access JWT on the request and returns the asserted identity.
 * Returns null when Access is unconfigured, the header is absent, or anything
 * about the token fails to check out — callers must treat null as
 * "not authenticated by Access", never as "unknown, allow anyway".
 */
export async function readAccessIdentity(request: Request, config: AccessJwtConfig): Promise<AccessIdentity | null> {
  return await verifyAccessToken(request.headers.get(ACCESS_JWT_HEADER) || '', config);
}

/**
 * Verifies a raw Access JWT. Both runtimes share this: the Worker reads it from
 * the request header (above), the Node twin from `req.headers['cf-access-jwt-assertion']`.
 */
export async function verifyAccessToken(token: string, config: AccessJwtConfig): Promise<AccessIdentity | null> {
  const teamDomain = config.teamDomain ? trimSlash(config.teamDomain) : '';
  const audience = config.audience || '';
  if (!teamDomain || !audience) return null;
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) {
    console.warn('Access JWT rejected: malformed token');
    return null;
  }
  const [headerSegment, payloadSegment, signatureSegment] = parts;
  const header = decodeJson(headerSegment);
  const payload = decodeJson(payloadSegment);
  if (!header || !payload) {
    console.warn('Access JWT rejected: unreadable header/payload');
    return null;
  }
  if (header.alg !== 'RS256') {
    console.warn(`Access JWT rejected: unsupported alg ${String(header.alg)}`);
    return null;
  }
  const now = config.now ? config.now() : Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_SECONDS <= now) {
    console.warn('Access JWT rejected: expired');
    return null;
  }
  if (typeof payload.nbf === 'number' && payload.nbf - CLOCK_SKEW_SECONDS > now) {
    console.warn('Access JWT rejected: not yet valid');
    return null;
  }
  if (!audienceMatches(payload.aud, audience)) {
    console.warn('Access JWT rejected: audience mismatch');
    return null;
  }
  if (trimSlash(String(payload.iss || '')) !== teamDomain) {
    console.warn('Access JWT rejected: issuer mismatch');
    return null;
  }
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!email || !email.includes('@')) {
    console.warn('Access JWT rejected: no email claim');
    return null;
  }
  const signingInput = new TextEncoder().encode(`${headerSegment}.${payloadSegment}`);
  const signature = base64UrlBytes(signatureSegment);
  try {
    const url = accessJwksUrl(teamDomain);
    const keyId = typeof header.kid === 'string' ? header.kid : '';
    let keys = await loadKeys(url, config, false);
    let match = keys.find((key) => (keyId ? key.kid === keyId : true));
    if (!match && !config.jwks) {
      // A rotated key is the expected reason a `kid` is unknown, so re-read the
      // key set once (bypassing the TTL) before rejecting the request.
      keys = await loadKeys(url, config, true);
      match = keys.find((key) => (keyId ? key.kid === keyId : true));
    }
    if (!match) {
      console.warn('Access JWT rejected: no matching signing key');
      return null;
    }
    if (!await verifySignature(match, signingInput, signature)) {
      console.warn('Access JWT rejected: signature mismatch');
      return null;
    }
  } catch (error) {
    console.warn('Access JWT rejected: verification error', error instanceof Error ? error.message : error);
    return null;
  }
  return {
    email,
    subject: typeof payload.sub === 'string' ? payload.sub : '',
    groups: normalizeAccessGroups(payload.groups),
  };
}

/**
 * The IdP group gate, combined with the `app_users.is_super_admin` column.
 * When no group is configured the group requirement is disabled (so an
 * installation whose IdP cannot emit group claims is never locked out of user
 * administration); setting `CF_ACCESS_SUPER_ADMIN_GROUP` turns it on.
 */
export function accessGroupAllowed(identity: AccessIdentity | null, requiredGroup?: string) {
  if (!requiredGroup) return true;
  return Boolean(identity && identity.groups.includes(requiredGroup));
}

