/**
 * The staff surfaces that must sit behind a Cloudflare Access application.
 *
 * This list is the single source of truth shared by the runbook
 * (`docs/staff-access.md`), the drift guard in `scripts/staff-access.test.ts`,
 * and the optional live check in `scripts/verify-access-apps.ts`. The Access
 * applications themselves are configured in the Cloudflare dashboard, so
 * nothing here is enforced at runtime — it exists so that adding a staff or
 * private route without extending the Access application fails `npm run
 * test:frontend` instead of silently shipping an unguarded path.
 *
 * Patterns are the ones Access supports in an application's Path field: a
 * single `*` per path segment, matching any suffix (so `/labs*` covers both
 * `/labs` and `/labs/pos`, which Access treats as separate paths).
 *
 * Deliberately NOT covered — these must stay reachable by anyone:
 *   `/` and every storefront route (`/category/*`, `/product/*`, `/search`,
 *   `/checkout`, `/orders`, `/order-success`), `/assets/*`, `/mall-images/*`,
 *   `/api/health`, `/api/mall`, `/api/mall/*`, `/api/mall-webhook` (HMAC
 *   machine call), `/api/auth/entrance` (the cart-hold second factor is issued
 *   from the public storefront), `/api/auth/login`, `/api/auth/google`,
 *   `/api/auth/logout`.
 */
export const STAFF_ACCESS_PATHS = [
  '/labs*',
  '/app*',
  '/api/storage*',
  '/api/ai*',
  '/api/staff*',
  // Covered so Access injects the verified identity the SSO bootstrap reads.
  '/api/auth/session',
  '/api/auth/users*',
  '/api/auth/password',
] as const;

/**
 * Paths that look private to `isPrivateApi` but must never be covered, because
 * the sign-in flow itself needs them (covering them re-creates the circular
 * gate that once answered 401 STAFF_ENTRANCE_REQUIRED to every login).
 */
export const STAFF_ACCESS_EXEMPT_PATHS = [
  '/api/auth/entrance',
  '/api/auth/login',
  '/api/auth/google',
  '/api/auth/logout',
] as const;

/** Executable mirror of an Access application's Path matching. */
export function matchesAccessPattern(pattern: string, path: string) {
  if (pattern.endsWith('*')) return path.startsWith(pattern.slice(0, -1));
  return path === pattern;
}

export function isAccessProtectedPath(path: string) {
  if ((STAFF_ACCESS_EXEMPT_PATHS as readonly string[]).includes(path)) return false;
  return (STAFF_ACCESS_PATHS as readonly string[]).some((pattern) => matchesAccessPattern(pattern, path));
}
