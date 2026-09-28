/**
 * Staff app-session lifetime policy.
 *
 * The app session (`app_sessions`) is minted by the password login, the Google
 * login and the Access SSO bootstrap. It used to be a flat seven-day row with no
 * idle check, so a shared counter terminal kept authorizing private APIs for a
 * week after the operator walked away. Two windows now apply:
 *
 *   - ABSOLUTE — seven days from mint. Unchanged, and it still bounds a session
 *     even while somebody keeps using it.
 *   - IDLE — `last_seen_at` is refreshed on every authenticated request, and a
 *     session that has not been seen for `CF_SESSION_IDLE_SECONDS` (default 30
 *     minutes) stops authorizing anything. The row is not deleted on the idle
 *     read path: the same expiry sweep the hot path already tolerates removes it
 *     later, so a request never pays a write for merely being stale.
 *
 * Access SSO is why the idle window matters more than it used to. Sign-out now
 * ends the Access session too (see `authLogout`), but a terminal that is simply
 * abandoned never signs out at all — the idle window is what closes it.
 */

export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_IDLE_SECONDS = 30 * 60;
export const SESSION_COOKIE = 'idofera_session';

type SessionEnv = { CF_SESSION_IDLE_SECONDS?: string };

/** Idle window in seconds; malformed or non-positive values fall back to the default. */
export function sessionIdleSeconds(env: SessionEnv) {
  const parsed = Number(env.CF_SESSION_IDLE_SECONDS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : SESSION_IDLE_SECONDS;
}

/** Absolute lifetime in milliseconds, from a mint timestamp. */
export const sessionExpiry = (now: number) => now + SESSION_SECONDS * 1000;

/** True when a session idle for this long must stop authorizing. */
export const sessionIdleExpired = (lastSeenAt: number, now: number, idleSeconds: number) =>
  now - lastSeenAt > idleSeconds * 1000;
